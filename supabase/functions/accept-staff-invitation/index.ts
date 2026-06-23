import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildPasswordSetup } from '../_shared/email-templates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { token, first_name, last_name } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token requis' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load invitation (venue or organizer scope).
    const { data: invitation, error: inviteError } = await supabase
      .from('staff_invitations')
      .select('*, venues(name)')
      .eq('token', token)
      .single();

    if (inviteError || !invitation) {
      return new Response(JSON.stringify({ error: 'Invitation non trouvée' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isOrganizerScope = !!invitation.organizer_user_id && !invitation.venue_id;

    if (invitation.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Cette invitation a déjà été utilisée' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (new Date(invitation.expires_at) < new Date()) {
      await supabase.from('staff_invitations').update({ status: 'expired' }).eq('id', invitation.id);
      return new Response(JSON.stringify({ error: 'Cette invitation a expiré' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let organizerDisplayName: string | null = null;
    if (isOrganizerScope) {
      const { data: orgProfile } = await supabase
        .from('organizer_profiles').select('display_name')
        .eq('user_id', invitation.organizer_user_id).maybeSingle();
      organizerDisplayName = orgProfile?.display_name || 'Organisation';
    }

    // Resolve / create the user.
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    let userEmail: string = invitation.email;
    let accountCreated = false;
    let passwordResetSent = false;

    if (authHeader) {
      const userToken = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(userToken);
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('email').eq('id', user.id).single();
        if (profile && profile.email.toLowerCase() === invitation.email.toLowerCase()) {
          userId = user.id;
          userEmail = profile.email;
        } else if (profile) {
          return new Response(JSON.stringify({ error: 'Cette invitation est destinée à une autre adresse email' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    if (!userId) {
      const { data: existingProfiles } = await supabase
        .from('profiles').select('id').eq('email', invitation.email.toLowerCase()).limit(1);

      if (existingProfiles && existingProfiles.length > 0) {
        userId = existingProfiles[0].id;
      } else {
        const tempPassword = crypto.randomUUID();
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: invitation.email.toLowerCase(),
          password: tempPassword,
          email_confirm: true,
          user_metadata: { first_name: first_name || invitation.display_name || '', last_name: last_name || '' },
        });
        if (createError || !newUser.user) {
          console.error('Error creating user:', createError);
          return new Response(JSON.stringify({ error: 'Erreur lors de la création du compte' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        userId = newUser.user.id;
        accountCreated = true;

        if (first_name || last_name || invitation.display_name) {
          await supabase.from('profiles').update({
            first_name: first_name || invitation.display_name || null,
            last_name: last_name || null,
          }).eq('id', userId);
        }

        // Send the "set your password" email.
        const resendApiKey = Deno.env.get('RESEND_API_KEY');
        if (resendApiKey) {
          const appUrl = 'https://yunoapp.eu';
          const { data: resetData } = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email: invitation.email.toLowerCase(),
            options: { redirectTo: `${appUrl}/auth` },
          });
          if (resetData?.properties?.action_link) {
            const mail = buildPasswordSetup({
              lang: 'fr',
              orgName: invitation.venues?.name ?? organizerDisplayName ?? undefined,
              roleLabel: invitation.role ?? undefined,
              setupUrl: resetData.properties.action_link,
            });
            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'Yuno <contact@yunoapp.eu>',
                to: [invitation.email.toLowerCase()],
                subject: mail.subject,
                html: mail.html,
              }),
            });
            if (res.ok) {
              passwordResetSent = true;
            } else {
              const body = await res.text().catch(() => '');
              console.error('accept-staff-invitation password email send failed:', res.status, body);
            }
          }
        }
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Impossible de créer le compte' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Defensive Core-plan staff cap (club scope). Primary enforcement lives in
    // invite-staff at invitation time; this backstops races where multiple pending
    // invitations outlive a plan that only allows 5 staff. Counts staff already
    // linked to the venue (excluding this accepting user).
    if (!isOrganizerScope && invitation.venue_id) {
      const { data: sub } = await supabase
        .from('venue_subscriptions').select('subscription_plan').eq('venue_id', invitation.venue_id).maybeSingle();
      if ((sub?.subscription_plan ?? 'core') === 'core') {
        const { data: venueProfiles } = await supabase
          .from('profiles').select('id').eq('venue_id', invitation.venue_id);
        const profileIds = (venueProfiles ?? []).map((p) => p.id).filter((id) => id !== userId);
        let activeStaff = 0;
        if (profileIds.length) {
          const { data: staffRoles } = await supabase
            .from('user_roles').select('user_id')
            .in('user_id', profileIds)
            .in('role', ['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager']);
          activeStaff = new Set((staffRoles ?? []).map((r) => r.user_id)).size;
        }
        if (activeStaff >= 5) {
          return new Response(JSON.stringify({
            error: 'Le plan Core de ce club est limité à 5 membres du staff.',
            code: 'core_staff_limit',
          }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    // Assign the role (idempotent). NO PIN is set — the employee sets it after login.
    await supabase.from('user_roles')
      .upsert({ user_id: userId, role: invitation.role, email: userEmail.toLowerCase() }, { onConflict: 'user_id,role' });

    if (isOrganizerScope) {
      // Link the org staff membership (no pin_hash).
      await supabase.from('org_staff').upsert({
        organizer_user_id: invitation.organizer_user_id,
        user_id: userId,
        email: invitation.email.toLowerCase(),
        display_name: invitation.display_name,
        role: invitation.role,
        invitation_status: 'accepted',
      }, { onConflict: 'organizer_user_id,email,role' });
    } else {
      // Club scope: bind the employee to the venue.
      await supabase.from('profiles').update({ venue_id: invitation.venue_id }).eq('id', userId);

      if (invitation.role === 'manager' && invitation.manager_permissions) {
        await supabase.from('manager_permissions').upsert({
          user_id: userId,
          venue_id: invitation.venue_id,
          ...(invitation.manager_permissions as Record<string, boolean>),
        }, { onConflict: 'user_id,venue_id' });
      }
    }

    await supabase.from('staff_invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    return new Response(JSON.stringify({
      success: true,
      role: invitation.role,
      venue_name: invitation.venues?.name ?? null,
      organizer_name: organizerDisplayName,
      account_created: accountCreated,
      password_reset_sent: passwordResetSent,
      warning: accountCreated && !passwordResetSent
        ? "L'email pour définir votre mot de passe n'a pas pu être envoyé. Utilisez « Mot de passe oublié » sur la page de connexion."
        : undefined,
      message: accountCreated
        ? 'Compte créé ! Vérifiez votre email pour définir votre mot de passe, puis votre code PIN.'
        : 'Invitation acceptée ! Connectez-vous et définissez votre code PIN.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('accept-staff-invitation error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Erreur inconnue' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
