import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLES = ['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager'] as const;
type StaffRole = (typeof ROLES)[number];

const ROLE_LABELS: Record<StaffRole, string> = {
  barman: 'Barman',
  bouncer: 'Videur',
  cloakroom: 'Vestiaire',
  vip_host: 'VIP Host',
  manager: 'Manager',
};

interface InviteRequest {
  email: string;
  role: StaffRole;
  // Either venue_id (club context) OR organizer_user_id (organizer context)
  venue_id?: string;
  organizer_user_id?: string;
  venue_name?: string;
  display_name?: string;
  manager_permissions?: Record<string, boolean>;
  resend?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: InviteRequest = await req.json();
    const { role, venue_id, organizer_user_id, venue_name, resend, manager_permissions } = body;
    const email = String(body.email ?? '').toLowerCase().trim();
    const displayName = String(body.display_name ?? '').trim() || null;

    if (!email || !ROLES.includes(role) || (!venue_id && !organizer_user_id)) {
      return new Response(JSON.stringify({ error: 'email, valid role and venue_id or organizer_user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isOrganizerScope = !!organizer_user_id && !venue_id;

    // vip_host / manager only exist in the club (venue) context.
    if (isOrganizerScope && (role === 'vip_host' || role === 'manager')) {
      return new Response(JSON.stringify({ error: 'Ce rôle n\'est disponible que pour les clubs.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authorization based on scope.
    if (isOrganizerScope) {
      if (organizer_user_id !== user.id) {
        const { data: isAdmin } = await supabase.rpc('is_org_team_member', {
          _user_id: user.id, _organizer_user_id: organizer_user_id, _min_role: 'admin',
        });
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: 'Only organizer admins can invite staff' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } else {
      const { data: hasOwnerRole } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'owner' });
      let allowed = !!hasOwnerRole;
      if (!allowed) {
        const { data: canManage } = await supabase.rpc('manager_has_permission', {
          _user_id: user.id, _venue_id: venue_id, _permission: 'staff',
        });
        allowed = !!canManage;
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: 'Only owners or staff managers can invite staff' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const scope = isOrganizerScope
      ? { col: 'organizer_user_id' as const, val: organizer_user_id! }
      : { col: 'venue_id' as const, val: venue_id! };

    // Already a Yuno account?
    const { data: existingProfiles } = await supabase
      .from('profiles').select('id, venue_id').eq('email', email).limit(1);
    const userId = existingProfiles?.[0]?.id ?? null;
    const hasYunoAccount = !!userId;

    // Already linked in this scope for this role?
    if (userId) {
      const { data: existingRole } = await supabase
        .from('user_roles').select('user_id').eq('user_id', userId).eq('role', role).limit(1);
      const hasRole = !!existingRole && existingRole.length > 0;
      let linkedInScope = false;
      if (hasRole) {
        if (isOrganizerScope) {
          const { data: staffRow } = await supabase
            .from('org_staff').select('id')
            .eq('organizer_user_id', organizer_user_id).eq('user_id', userId).eq('role', role)
            .eq('invitation_status', 'accepted').limit(1);
          linkedInScope = !!staffRow && staffRow.length > 0;
        } else {
          linkedInScope = existingProfiles?.[0]?.venue_id === venue_id;
        }
      }
      if (linkedInScope) {
        return new Response(JSON.stringify({
          success: true, already_linked: true, message: 'Cet employé fait déjà partie de l\'équipe pour ce rôle.',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Pending invitation for this (email, scope, role)?
    const { data: existingInvitation } = await supabase
      .from('staff_invitations')
      .select('id, status, token')
      .eq('email', email).eq('role', role).eq('status', 'pending')
      .eq(scope.col, scope.val)
      .limit(1);

    let invitationToken: string;

    if (existingInvitation && existingInvitation.length > 0) {
      if (resend) {
        const newExpiry = new Date(); newExpiry.setDate(newExpiry.getDate() + 7);
        const { data: updated } = await supabase
          .from('staff_invitations')
          .update({ expires_at: newExpiry.toISOString() })
          .eq('id', existingInvitation[0].id)
          .select('token').single();
        invitationToken = updated?.token ?? existingInvitation[0].token;
      } else {
        return new Response(JSON.stringify({
          error: 'Une invitation est déjà en attente pour ce rôle.', code: 'invitation_pending',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      const insertPayload: Record<string, unknown> = {
        email,
        role,
        display_name: displayName,
        invited_by: user.id,
      };
      if (isOrganizerScope) insertPayload.organizer_user_id = organizer_user_id;
      else insertPayload.venue_id = venue_id;
      if (role === 'manager' && manager_permissions) insertPayload.manager_permissions = manager_permissions;

      const { data: invitation, error: inviteError } = await supabase
        .from('staff_invitations').insert(insertPayload).select('token').single();
      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      invitationToken = invitation.token;
    }

    // Resolve the inviter display name.
    let inviterDisplayName = venue_name || 'Yuno';
    if (isOrganizerScope) {
      const { data: orgProfile } = await supabase
        .from('organizer_profiles').select('display_name').eq('user_id', organizer_user_id!).maybeSingle();
      inviterDisplayName = orgProfile?.display_name || 'Une organisation';
    } else if (!venue_name) {
      const { data: venue } = await supabase.from('venues').select('name').eq('id', venue_id!).maybeSingle();
      inviterDisplayName = venue?.name || 'Votre club';
    }

    const roleLabel = ROLE_LABELS[role];
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const appUrl = 'https://yunoapp.eu';

    if (resendApiKey) {
      const acceptUrl = `${appUrl}/accept-staff-invitation?token=${invitationToken}`;
      const accountNote = hasYunoAccount
        ? 'Votre compte Yuno existant sera utilisé. Vous choisirez votre code PIN après connexion.'
        : 'Un compte Yuno sera créé pour vous. Vous définirez votre mot de passe puis votre propre code PIN.';
      const inviterLabel = isOrganizerScope ? `L'organisation ${inviterDisplayName}` : `Le club ${inviterDisplayName}`;

      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; padding: 40px; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 30px;"><h1 style="color: #ffffff; margin: 0;">👋 Invitation Équipe</h1></div>
          <div style="background: #1a1a1a; padding: 30px; border-radius: 12px; border: 1px solid #333;">
            <p style="color: #ffffff; font-size: 16px; line-height: 1.6;">
              ${inviterLabel} vous invite à rejoindre son équipe sur Yuno.
            </p>
            <div style="background: #262626; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <p style="color: #a0a0a0; font-size: 12px; margin: 0 0 5px 0;">Votre rôle</p>
              <p style="color: #dc2626; font-size: 22px; font-weight: bold; margin: 0; letter-spacing: 1px;">${roleLabel}</p>
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

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Yuno <contact@yunoapp.eu>',
          to: [email],
          subject: `Invitation ${roleLabel} - ${inviterDisplayName}`,
          html: emailHtml,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('invite-staff email send failed:', res.status, body);
        return new Response(JSON.stringify({ error: "Échec de l'envoi de l'invitation par email" }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true, invitation_sent: true, has_yuno_account: hasYunoAccount,
      message: hasYunoAccount ? 'Invitation envoyée par email.' : 'Invitation envoyée. Un compte sera créé à l\'acceptation.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('invite-staff error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
