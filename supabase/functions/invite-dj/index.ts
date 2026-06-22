import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InviteRequest {
  email: string;
  // Either venue_id (club owner inviting) OR organizer_user_id is required
  venue_id?: string | null;
  venue_name?: string;
  organizer_user_id?: string | null;
  organizer_name?: string;
  resend?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: InviteRequest = await req.json();
    const { email, venue_id, venue_name, organizer_user_id, organizer_name, resend } = body;

    // Determine scope: venue (owner) or organizer
    const isOrgScope = !!organizer_user_id && !venue_id;
    const isVenueScope = !!venue_id && !organizer_user_id;

    if (!email || (!isOrgScope && !isVenueScope)) {
      return new Response(JSON.stringify({
        error: 'Email and either venue_id or organizer_user_id required (not both)',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authorization: owners can invite for venues; organizers can invite for themselves
    if (isVenueScope) {
      const { data: hasOwnerRole } = await supabase.rpc('has_role', {
        _user_id: user.id,
        _role: 'owner',
      });
      if (!hasOwnerRole) {
        return new Response(JSON.stringify({ error: 'Only owners can invite DJs to a venue' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else if (isOrgScope) {
      // Organizer can only invite under their own user id
      if (organizer_user_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Cannot invite DJs for another organizer' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const normalizedEmail = email.toLowerCase().trim();
    const inviterLabel = isVenueScope ? (venue_name || 'Un club') : (organizer_name || 'Un organisateur');

    // Step 1: target user must exist
    const { data: existingProfiles } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .limit(1);

    if (!existingProfiles || existingProfiles.length === 0) {
      return new Response(JSON.stringify({
        error: "Aucun compte Yuno trouvé avec cet email. L'utilisateur doit d'abord créer un compte.",
        code: 'no_account',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = existingProfiles[0].id;

    // Step 2: target must already have a DJ profile somewhere (any scope)
    const { data: existingDJProfile } = await supabase
      .from('djs')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if (!existingDJProfile || existingDJProfile.length === 0) {
      return new Response(JSON.stringify({
        error: "Cet utilisateur n'a pas de profil DJ. Il doit d'abord être DJ dans un club ou une organisation.",
        code: 'no_dj_profile',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: already linked to THIS scope?
    const linkQuery = supabase.from('djs').select('*').eq('user_id', userId);
    const { data: existingForScope } = isVenueScope
      ? await linkQuery.eq('venue_id', venue_id!).limit(1)
      : await linkQuery.eq('organizer_user_id', organizer_user_id!).limit(1);

    if (existingForScope && existingForScope.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          already_linked: true,
          message: 'Ce DJ fait déjà partie de votre équipe.',
          code: 'already_linked',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Step 4: pending invitation for THIS scope?
    const invQuery = supabase
      .from('dj_invitations')
      .select('id, status, token')
      .eq('email', normalizedEmail)
      .eq('status', 'pending');
    const { data: existingInvitation } = isVenueScope
      ? await invQuery.eq('venue_id', venue_id!).limit(1)
      : await invQuery.eq('organizer_user_id', organizer_user_id!).limit(1);

    let invitationToken: string;

    if (existingInvitation && existingInvitation.length > 0) {
      if (resend) {
        const newToken = crypto.randomUUID();
        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + 7);

        const { error: updateError } = await supabase
          .from('dj_invitations')
          .update({ token: newToken, expires_at: newExpiry.toISOString() })
          .eq('id', existingInvitation[0].id);

        if (updateError) {
          console.error('Error updating invitation:', updateError);
          return new Response(JSON.stringify({ error: updateError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        invitationToken = newToken;
      } else {
        return new Response(JSON.stringify({
          error: 'Une invitation a déjà été envoyée à ce DJ.',
          code: 'invitation_pending',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      const insertPayload: Record<string, unknown> = {
        email: normalizedEmail,
        invited_by: user.id,
      };
      if (isVenueScope) insertPayload.venue_id = venue_id;
      if (isOrgScope) insertPayload.organizer_user_id = organizer_user_id;

      const { data: invitation, error: inviteError } = await supabase
        .from('dj_invitations')
        .insert(insertPayload)
        .select('token')
        .single();

      if (inviteError) {
        console.error('Error creating invitation:', inviteError);
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      invitationToken = invitation.token;
    }

    // Step 5: send email
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const appUrl = 'https://yunoapp.eu';

    if (resendApiKey) {
      const acceptUrl = `${appUrl}/accept-dj-invitation?token=${invitationToken}`;
      const headline = isVenueScope ? 'Invitation DJ' : 'Invitation Organisation';
      const bodyText = isVenueScope
        ? `Le club <strong style="color: #dc2626;">${inviterLabel}</strong> vous invite à rejoindre leur équipe de DJs sur Yuno.`
        : `L'organisation <strong style="color: #dc2626;">${inviterLabel}</strong> vous invite à rejoindre son roster de DJs sur Yuno.`;

      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; padding: 40px; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #ffffff; margin: 0;">🎧 ${headline}</h1>
          </div>
          <div style="background: #1a1a1a; padding: 30px; border-radius: 12px; border: 1px solid #333;">
            <p style="color: #ffffff; font-size: 16px; line-height: 1.6;">${bodyText}</p>
            <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6;">
              Votre profil DJ existant sera automatiquement partagé. Acceptez pour apparaître dans la programmation.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${acceptUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Accepter l'invitation
              </a>
            </div>
            <p style="color: #666; font-size: 12px; text-align: center;">Cette invitation expire dans 7 jours.</p>
          </div>
          <p style="color: #666; font-size: 12px; text-align: center; margin-top: 20px;">
            Si vous n'attendiez pas cette invitation, vous pouvez l'ignorer.
          </p>
        </div>
      `;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Yuno <contact@yunoapp.eu>',
          to: [normalizedEmail],
          subject: `${headline} - ${inviterLabel}`,
          html: emailHtml,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('invite-dj email send failed:', res.status, body);
        return new Response(JSON.stringify({ error: "Échec de l'envoi de l'invitation par email" }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      invitation_sent: true,
      message: 'Invitation envoyée par email',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
