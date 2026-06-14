import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InviteRequest {
  email: string;
  // Either venue_id (club context) OR organizer_user_id (organizer context)
  venue_id?: string;
  organizer_user_id?: string;
  venue_name?: string;
  promo_code?: string;
  first_name?: string;
  last_name?: string;
  resend?: boolean;
  commission_config?: {
    ticket_commission_type?: string;
    ticket_commission_value?: number;
    table_commission_type?: string;
    table_commission_value?: number;
  };
}

function generatePromoCode(email: string, firstName?: string, lastName?: string): string {
  if (firstName) {
    const base = firstName.replace(/[^a-zA-Z]/g, '').toUpperCase();
    const initial = lastName ? lastName.replace(/[^a-zA-Z]/g, '')[0]?.toUpperCase() || '' : '';
    const code = `${base}${initial}`;
    if (code.length >= 3) return code.slice(0, 10);
  }
  const prefix = email.split('@')[0].replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6);
  const suffix = Math.floor(Math.random() * 100).toString();
  return `${prefix || 'PROMO'}${suffix}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: InviteRequest = await req.json();
    const { email, venue_id, organizer_user_id, venue_name, promo_code, first_name, last_name, resend, commission_config } = body;

    if (!email || (!venue_id && !organizer_user_id)) {
      return new Response(JSON.stringify({ error: 'Email and venue_id or organizer_user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isOrganizerScope = !!organizer_user_id && !venue_id;

    // Auth check based on scope
    if (isOrganizerScope) {
      // Must be the organizer themselves OR an org admin
      if (organizer_user_id !== user.id) {
        const { data: isAdmin } = await supabase.rpc('is_org_team_member', {
          _user_id: user.id, _organizer_user_id: organizer_user_id, _min_role: 'admin',
        });
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: 'Only organizer admins can invite promoters' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } else {
      const { data: hasOwnerRole } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'owner' });
      if (!hasOwnerRole) {
        return new Response(JSON.stringify({ error: 'Only owners can invite promoters' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const normalizedEmail = email.toLowerCase().trim();
    const scopeFilter = isOrganizerScope
      ? { col: 'organizer_user_id' as const, val: organizer_user_id! }
      : { col: 'venue_id' as const, val: venue_id! };

    let finalPromoCode = promo_code?.toUpperCase().trim();
    if (!finalPromoCode) {
      let attempts = 0;
      while (attempts < 5) {
        const candidate = generatePromoCode(normalizedEmail, first_name, last_name);
        const { data: existing } = await supabase
          .from('promoters').select('id')
          .eq(scopeFilter.col, scopeFilter.val).eq('promo_code', candidate).limit(1);
        if (!existing || existing.length === 0) { finalPromoCode = candidate; break; }
        attempts++;
      }
      if (!finalPromoCode) finalPromoCode = `PROMO${Date.now().toString().slice(-6)}`;
    }

    if (promo_code) {
      const { data: existingPromoCode } = await supabase
        .from('promoters').select('id')
        .eq(scopeFilter.col, scopeFilter.val).eq('promo_code', finalPromoCode).limit(1);
      if (existingPromoCode && existingPromoCode.length > 0) {
        return new Response(JSON.stringify({
          error: 'Ce code promo est déjà utilisé', code: 'promo_code_exists',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const { data: existingProfiles } = await supabase
      .from('profiles').select('id').eq('email', normalizedEmail).limit(1);
    const userId = existingProfiles?.[0]?.id;
    const hasYunoAccount = !!userId;

    if (userId) {
      const { data: existingPromoter } = await supabase
        .from('promoters').select('id')
        .eq('user_id', userId).eq(scopeFilter.col, scopeFilter.val).limit(1);
      if (existingPromoter && existingPromoter.length > 0) {
        return new Response(JSON.stringify({
          success: true, already_linked: true,
          message: 'Promoteur déjà dans l\'équipe.',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Pending invitation check
    let invitationQuery = supabase
      .from('promoter_invitations')
      .select('id, status, token, promo_code')
      .eq('email', normalizedEmail).eq('status', 'pending');
    invitationQuery = isOrganizerScope
      ? invitationQuery.eq('organizer_user_id', organizer_user_id!)
      : invitationQuery.eq('venue_id', venue_id!);
    const { data: existingInvitation } = await invitationQuery.limit(1);

    let invitationToken: string;
    let usedPromoCode = finalPromoCode;

    if (existingInvitation && existingInvitation.length > 0) {
      if (resend) {
        const newToken = crypto.randomUUID();
        const newExpiry = new Date(); newExpiry.setDate(newExpiry.getDate() + 7);
        await supabase.from('promoter_invitations')
          .update({ token: newToken, expires_at: newExpiry.toISOString() })
          .eq('id', existingInvitation[0].id);
        invitationToken = newToken;
        usedPromoCode = existingInvitation[0].promo_code;
      } else {
        return new Response(JSON.stringify({
          error: 'Une invitation a déjà été envoyée.', code: 'invitation_pending',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      const insertPayload: Record<string, unknown> = {
        email: normalizedEmail,
        invited_by: user.id,
        promo_code: finalPromoCode,
        commission_config: { ...commission_config, has_yuno_account: hasYunoAccount },
      };
      if (isOrganizerScope) insertPayload.organizer_user_id = organizer_user_id;
      else insertPayload.venue_id = venue_id;

      const { data: invitation, error: inviteError } = await supabase
        .from('promoter_invitations').insert(insertPayload).select('token').single();
      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      invitationToken = invitation.token;
    }

    // Resolve display name for the inviter context (venue or org)
    let inviterDisplayName = venue_name || 'Yuno';
    if (isOrganizerScope) {
      const { data: orgProfile } = await supabase
        .from('organizer_profiles').select('display_name').eq('user_id', organizer_user_id!).maybeSingle();
      inviterDisplayName = orgProfile?.display_name || 'Une organisation';
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const appUrl = 'https://yunoapp.eu';

    if (resendApiKey) {
      const acceptUrl = `${appUrl}/accept-promoter-invitation?token=${invitationToken}`;
      const accountNote = hasYunoAccount
        ? 'Votre profil promoteur existant sera utilisé.'
        : 'Un compte Yuno sera créé pour vous lors de l\'acceptation.';
      const inviterLabel = isOrganizerScope ? `L'organisation ${inviterDisplayName}` : `Le club ${inviterDisplayName}`;

      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; padding: 40px; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #ffffff; margin: 0;">🎉 Invitation Promoteur</h1></div>
          <div style="background: #1a1a1a; padding: 30px; border-radius: 12px; border: 1px solid #333;">
            <p style="color: #ffffff; font-size: 16px; line-height: 1.6;">
              ${inviterLabel} vous invite à devenir promoteur sur Yuno.
            </p>
            <div style="background: #262626; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <p style="color: #a0a0a0; font-size: 12px; margin: 0 0 5px 0;">Votre code promo</p>
              <p style="color: #dc2626; font-size: 24px; font-weight: bold; margin: 0; letter-spacing: 2px;">${usedPromoCode}</p>
            </div>
            <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6;">${accountNote}</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${acceptUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Accepter l'invitation
              </a>
            </div>
            <p style="color: #666; font-size: 12px; text-align: center;">Cette invitation expire dans 7 jours.</p>
          </div>
        </div>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Yuno <contact@yunoapp.eu>',
          to: [normalizedEmail],
          subject: `Invitation Promoteur - ${inviterDisplayName}`,
          html: emailHtml,
        }),
      });
    }

    return new Response(JSON.stringify({
      success: true, invitation_sent: true, has_yuno_account: hasYunoAccount,
      message: hasYunoAccount ? 'Invitation envoyée par email' : 'Invitation envoyée. Un compte sera créé à l\'acceptation.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
