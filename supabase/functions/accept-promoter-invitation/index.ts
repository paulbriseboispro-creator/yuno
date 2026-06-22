import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { token, first_name, last_name } = await req.json();

    if (!token) {
      return new Response(JSON.stringify({ error: 'Token requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the invitation (works for both venue and organizer scopes)
    const { data: invitation, error: inviteError } = await supabase
      .from('promoter_invitations')
      .select('*, venues(name)')
      .eq('token', token)
      .single();

    const isOrganizerInvitation = !!invitation?.organizer_user_id && !invitation?.venue_id;
    let organizerDisplayName: string | null = null;
    if (isOrganizerInvitation && invitation?.organizer_user_id) {
      const { data: orgProfile } = await supabase
        .from('organizer_profiles').select('display_name')
        .eq('user_id', invitation.organizer_user_id).maybeSingle();
      organizerDisplayName = orgProfile?.display_name || 'Organisation';
    }

    if (inviteError || !invitation) {
      return new Response(JSON.stringify({ error: 'Invitation non trouvée' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if invitation is still valid
    if (invitation.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Cette invitation a déjà été utilisée' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await supabase
        .from('promoter_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);
      
      return new Response(JSON.stringify({ error: 'Cette invitation a expiré' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is authenticated
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    let userEmail = invitation.email;
    let accountCreated = false;
    let passwordResetSent = false;

    if (authHeader) {
      // User is logged in
      const userToken = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(userToken);
      
      if (user) {
        // Verify email matches
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', user.id)
          .single();

        if (profile && profile.email.toLowerCase() === invitation.email.toLowerCase()) {
          userId = user.id;
          userEmail = profile.email;
        } else if (profile) {
          return new Response(JSON.stringify({ 
            error: 'Cette invitation est destinée à une autre adresse email' 
          }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // If user is not authenticated, create account or find existing
    if (!userId) {
      // Check if account already exists
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', invitation.email.toLowerCase())
        .limit(1);

      if (existingProfiles && existingProfiles.length > 0) {
        userId = existingProfiles[0].id;
      } else {
        // Create new Yuno account
        const tempPassword = crypto.randomUUID();
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: invitation.email.toLowerCase(),
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            first_name: first_name || '',
            last_name: last_name || '',
          },
        });

        if (createError || !newUser.user) {
          console.error('Error creating user:', createError);
          return new Response(JSON.stringify({ 
            error: 'Erreur lors de la création du compte' 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        userId = newUser.user.id;
        accountCreated = true;

        // Update profile with names
        if (first_name || last_name) {
          await supabase
            .from('profiles')
            .update({ 
              first_name: first_name || null, 
              last_name: last_name || null 
            })
            .eq('id', userId);
        }

        // Send password reset email
        const resendApiKey = Deno.env.get('RESEND_API_KEY');
        if (resendApiKey) {
          const appUrl = 'https://yunoapp.eu';
          const { data: resetData } = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email: invitation.email.toLowerCase(),
            options: {
              redirectTo: `${appUrl}/auth`,
            },
          });

          if (resetData?.properties?.action_link) {
            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Yuno <contact@yunoapp.eu>',
                to: [invitation.email.toLowerCase()],
                subject: 'Bienvenue sur Yuno - Créez votre mot de passe',
                html: `
                  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; padding: 40px; border-radius: 16px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                      <h1 style="color: #ffffff; margin: 0;">🎉 Bienvenue sur Yuno !</h1>
                    </div>
                    <div style="background: #1a1a1a; padding: 30px; border-radius: 12px; border: 1px solid #333;">
                      <p style="color: #ffffff; font-size: 16px; line-height: 1.6;">
                        Votre compte promoteur a été créé avec succès !
                      </p>
                      <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6;">
                        Cliquez sur le bouton ci-dessous pour définir votre mot de passe et accéder à votre tableau de bord promoteur.
                      </p>
                      <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetData.properties.action_link}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                          Créer mon mot de passe
                        </a>
                      </div>
                    </div>
                  </div>
                `,
              }),
            });
            if (res.ok) {
              passwordResetSent = true;
            } else {
              const body = await res.text().catch(() => '');
              console.error('accept-promoter-invitation password email send failed:', res.status, body);
            }
          }
        }

        // Add promoter role
        await supabase
          .from('user_roles')
          .upsert({ 
            user_id: userId, 
            role: 'promoter',
            email: invitation.email.toLowerCase()
          }, { 
            onConflict: 'user_id,role' 
          });
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Impossible de créer le compte' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if promoter already exists in this scope
    let existingScopeQuery = supabase.from('promoters').select('id').eq('user_id', userId);
    existingScopeQuery = isOrganizerInvitation
      ? existingScopeQuery.eq('organizer_user_id', invitation.organizer_user_id)
      : existingScopeQuery.eq('venue_id', invitation.venue_id);
    const { data: existingPromoterForScope } = await existingScopeQuery.limit(1);

    if (existingPromoterForScope && existingPromoterForScope.length > 0) {
      await supabase.from('promoter_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);
      return new Response(JSON.stringify({
        success: true,
        message: isOrganizerInvitation ? 'Vous êtes déjà promoteur pour cette organisation' : 'Vous êtes déjà promoteur pour ce club',
        venue_name: invitation.venues?.name,
        organizer_name: organizerDisplayName,
        account_created: accountCreated,
        password_reset_sent: passwordResetSent,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Check if user has existing promoter profile from another venue
    const { data: existingPromoterProfile } = await supabase
      .from('promoters')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .single();

    // Parse commission config from invitation
    const commissionConfig = invitation.commission_config || {};

    // Get user profile for names
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('first_name, last_name, email, phone')
      .eq('id', userId)
      .single();

    // Create promoter profile for this scope (venue OR organizer)
    const promoterData: Record<string, unknown> = {
      user_id: userId,
      promo_code: invitation.promo_code,
      ticket_commission_type: commissionConfig.ticket_commission_type || 'percentage',
      ticket_commission_value: commissionConfig.ticket_commission_value || 0,
      table_commission_type: commissionConfig.table_commission_type || 'percentage',
      table_commission_value: commissionConfig.table_commission_value || 0,
      is_active: true,
    };
    if (isOrganizerInvitation) promoterData.organizer_user_id = invitation.organizer_user_id;
    else promoterData.venue_id = invitation.venue_id;

    // Copy data from existing promoter profile if exists, otherwise use user profile
    if (existingPromoterProfile) {
      promoterData.instagram_url = existingPromoterProfile.instagram_url;
      promoterData.whatsapp_number = existingPromoterProfile.whatsapp_number;
      promoterData.iban = existingPromoterProfile.iban;
      promoterData.bic = existingPromoterProfile.bic;
      promoterData.profile_image_url = existingPromoterProfile.profile_image_url;
    }

    // Always use user profile data for names if available
    if (userProfile) {
      promoterData.first_name = userProfile.first_name || first_name;
      promoterData.last_name = userProfile.last_name || last_name;
      promoterData.phone = userProfile.phone;
    }

    const { error: promoterError } = await supabase.from('promoters').insert(promoterData);

    if (promoterError) {
      console.error('Error creating promoter profile:', promoterError);
      return new Response(JSON.stringify({ error: 'Erreur lors de la création du profil promoteur' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ensure user has promoter role
    await supabase
      .from('user_roles')
      .upsert({ 
        user_id: userId, 
        role: 'promoter',
        email: userEmail.toLowerCase()
      }, { 
        onConflict: 'user_id,role' 
      });

    // Mark invitation as accepted
    await supabase
      .from('promoter_invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    return new Response(JSON.stringify({ 
      success: true, 
      message: accountCreated 
        ? 'Compte créé et invitation acceptée ! Vérifiez votre email pour définir votre mot de passe.'
        : 'Invitation acceptée ! Vous êtes maintenant promoteur pour ce club.',
      venue_name: invitation.venues?.name,
      venue_id: invitation.venue_id,
      promo_code: invitation.promo_code,
      account_created: accountCreated,
      password_reset_sent: passwordResetSent,
      warning: accountCreated && !passwordResetSent
        ? "L'email pour définir votre mot de passe n'a pas pu être envoyé. Utilisez « Mot de passe oublié » sur la page de connexion."
        : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Erreur inconnue' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
