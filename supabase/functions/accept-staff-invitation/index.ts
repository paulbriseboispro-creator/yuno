import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'Yuno <contact@yunoapp.eu>',
                to: [invitation.email.toLowerCase()],
                subject: 'Bienvenue sur Yuno - Créez votre mot de passe',
                html: `
                  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; padding: 40px; border-radius: 16px;">
                    <div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #ffffff; margin: 0;">🎉 Bienvenue sur Yuno !</h1></div>
                    <div style="background: #1a1a1a; padding: 30px; border-radius: 12px; border: 1px solid #333;">
                      <p style="color: #ffffff; font-size: 16px; line-height: 1.6;">Votre compte a été créé avec succès !</p>
                      <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6;">
                        Cliquez ci-dessous pour définir votre mot de passe. Vous choisirez ensuite votre propre code PIN.
                      </p>
                      <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetData.properties.action_link}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                          Créer mon mot de passe
                        </a>
                      </div>
                    </div>
                  </div>`,
              }),
            });
            passwordResetSent = true;
          }
        }
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Impossible de créer le compte' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
