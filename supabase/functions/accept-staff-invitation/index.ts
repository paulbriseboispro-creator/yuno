import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildPasswordSetup } from '../_shared/email-templates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_URL = 'https://yunoapp.eu';

// ─── Onboarding-link roles (shared with create/redeem branches) ──────────────
// This function also hosts the email-free "onboarding link" mechanism (create +
// redeem), folded in here as action branches because the Supabase edge-function
// cap forbids creating brand-new functions — updating an existing one is allowed.
const ALL_LINK_ROLES = ['owner', 'organizer', 'barman', 'bouncer', 'cloakroom', 'vip_host', 'manager', 'dj', 'promoter'];
const STAFF_ROLES = new Set(['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager']);
const VENUE_ONLY_STAFF = new Set(['vip_host', 'manager']);
const ORG_STAFF_ROLES = new Set(['barman', 'bouncer', 'cloakroom']);
const SUPERADMIN_ROLES = new Set(['owner', 'organizer']);
const REDIRECTS: Record<string, string> = {
  owner: '/owner', organizer: '/organizer-app', dj: '/dj', promoter: '/promoter',
  barman: '/setup-pin', bouncer: '/setup-pin', cloakroom: '/setup-pin', vip_host: '/setup-pin', manager: '/setup-pin',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function slugify(input: string): string {
  return (input || 'org')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 40) || 'org';
}

function randomCode(len = 4): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function uniquePromoCode(
  supabase: SupabaseClient, base: string,
  scope: { venue_id?: string | null; organizer_user_id?: string | null },
): Promise<string> {
  const root = slugify(base).replace(/-/g, '').toUpperCase().slice(0, 8) || 'PROMO';
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${root}${randomCode(attempt < 4 ? 4 : 6)}`;
    let q = supabase.from('promoters').select('id').eq('promo_code', candidate);
    q = scope.venue_id ? q.eq('venue_id', scope.venue_id) : q.eq('organizer_user_id', scope.organizer_user_id!);
    const { data } = await q.limit(1);
    if (!data || data.length === 0) return candidate;
  }
  return `PROMO${randomCode(8)}`;
}

async function uniqueOrgSlug(supabase: SupabaseClient, display: string): Promise<string> {
  const base = slugify(display);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomCode(3).toLowerCase()}`;
    const { data } = await supabase.from('organizer_profiles').select('user_id').eq('slug', candidate).limit(1);
    if (!data || data.length === 0) return candidate;
  }
  return `${base}-${randomCode(4).toLowerCase()}`;
}

// ─── Branch: create an onboarding link (authenticated) ───────────────────────
async function handleCreateOnboardingLink(req: Request, supabase: SupabaseClient, body: any): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const role = String(body.role ?? '');
  const venue_id: string | null = body.venue_id ? String(body.venue_id) : null;
  const organizer_user_id: string | null = body.organizer_user_id ? String(body.organizer_user_id) : null;
  const label: string | null = body.label ? String(body.label).trim().slice(0, 120) : null;
  const config: Record<string, unknown> = (body.config && typeof body.config === 'object') ? body.config : {};
  let max_uses: number | null =
    body.max_uses === null || body.max_uses === undefined ? null : Math.max(1, parseInt(String(body.max_uses), 10) || 1);
  const expires_in_days = Math.min(365, Math.max(1, parseInt(String(body.expires_in_days ?? 14), 10) || 14));

  if (!ALL_LINK_ROLES.includes(role)) return json({ error: 'Invalid role' }, 400);
  if (venue_id && organizer_user_id) return json({ error: 'A link cannot carry both a venue and an organizer scope' }, 400);

  if (role === 'owner') {
    if (!venue_id) return json({ error: 'Owner links require a venue_id' }, 400);
    max_uses = 1; // ownership transfer must never be reusable.
  } else if (role === 'organizer') {
    if (venue_id || organizer_user_id) return json({ error: 'Organizer links are platform-level (no scope)' }, 400);
  } else {
    if (!venue_id && !organizer_user_id) return json({ error: 'A venue_id or organizer_user_id is required' }, 400);
    if (VENUE_ONLY_STAFF.has(role) && !venue_id) return json({ error: 'This role is only available for clubs' }, 400);
    if (organizer_user_id && STAFF_ROLES.has(role) && !ORG_STAFF_ROLES.has(role)) {
      return json({ error: 'This role is not available for organizers' }, 400);
    }
  }

  // Authorization: super admin (role 'admin' or the demo owner) for owner/organizer;
  // venue owner / staff-manager for venue scope; organizer / org admin for org scope.
  const { data: adminRole } = await supabase
    .from('user_roles').select('user_id').eq('user_id', user.id).eq('role', 'admin').limit(1);
  const isSuperAdmin = (adminRole && adminRole.length > 0) || user.email?.toLowerCase() === 'owner@womber.fr';

  if (SUPERADMIN_ROLES.has(role)) {
    if (!isSuperAdmin) return json({ error: 'Only administrators can generate this link' }, 403);
  } else if (venue_id) {
    let allowed = isSuperAdmin;
    if (!allowed) {
      const { data: hasOwnerRole } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'owner' });
      if (hasOwnerRole) {
        const { data: ownsVenue } = await supabase.rpc('is_venue_owner', { _user_id: user.id, _venue_id: venue_id });
        allowed = !!ownsVenue;
      }
    }
    if (!allowed) {
      const { data: canManage } = await supabase.rpc('manager_has_permission', {
        _user_id: user.id, _venue_id: venue_id, _permission: 'staff',
      });
      allowed = !!canManage;
    }
    if (!allowed) return json({ error: 'You are not allowed to invite for this club' }, 403);
  } else if (organizer_user_id) {
    let allowed = isSuperAdmin || organizer_user_id === user.id;
    if (!allowed) {
      const { data: isAdmin } = await supabase.rpc('is_org_team_member', {
        _user_id: user.id, _organizer_user_id: organizer_user_id, _min_role: 'admin',
      });
      allowed = !!isAdmin;
    }
    if (!allowed) return json({ error: 'You are not allowed to invite for this organizer' }, 403);
  }

  const expires_at = new Date(Date.now() + expires_in_days * 86400_000).toISOString();
  const { data: link, error: insertError } = await supabase
    .from('onboarding_links')
    .insert({ role, venue_id, organizer_user_id, config, label, created_by: user.id, max_uses, expires_at })
    .select('token, role, max_uses, expires_at, id')
    .single();

  if (insertError || !link) {
    console.error('create onboarding link insert error:', insertError);
    return json({ error: insertError?.message ?? 'Could not create link' }, 400);
  }

  return json({
    success: true, id: link.id, token: link.token,
    url: `${APP_URL}/join?token=${link.token}`,
    role: link.role, max_uses: link.max_uses, expires_at: link.expires_at,
  });
}

// ─── Branch: redeem an onboarding link (public, account created inline) ───────
async function handleRedeemOnboardingLink(req: Request, supabase: SupabaseClient, body: any): Promise<Response> {
  const token = String(body.token ?? '');
  const email = String(body.email ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  const first_name = body.first_name ? String(body.first_name).trim() : null;
  const last_name = body.last_name ? String(body.last_name).trim() : null;
  const stage_name = body.stage_name ? String(body.stage_name).trim() : null;

  if (!token) return json({ error: 'Token requis' }, 400);

  const { data: link, error: linkError } = await supabase
    .from('onboarding_links').select('*').eq('token', token).single();
  if (linkError || !link) return json({ error: 'Lien introuvable', code: 'not_found' }, 404);
  if (!link.is_active || link.revoked_at) return json({ error: 'Ce lien a été désactivé', code: 'revoked' }, 400);
  if (new Date(link.expires_at) < new Date()) return json({ error: 'Ce lien a expiré', code: 'expired' }, 400);

  const cfg: Record<string, any> = link.config || {};
  const role: string = link.role;
  const venueId: string | null = link.venue_id;
  const orgId: string | null = link.organizer_user_id;
  const isOrgScope = !!orgId && !venueId;

  // Resolve the user (session, or create a fresh account).
  const authHeader = req.headers.get('Authorization');
  let userId: string | null = null;
  let userEmail = email;
  let accountCreated = false;

  if (authHeader) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (user) { userId = user.id; userEmail = (user.email ?? email).toLowerCase(); }
  }

  if (!userId) {
    if (!email || !password) return json({ error: 'Email et mot de passe requis', code: 'need_credentials' }, 400);
    if (password.length < 6) return json({ error: 'Mot de passe trop court (min. 6 caractères)', code: 'weak_password' }, 400);
    // The link's email is untrusted, so never auto-grant onto an existing account.
    const { data: existingProfiles } = await supabase.from('profiles').select('id').eq('email', email).limit(1);
    if (existingProfiles && existingProfiles.length > 0) {
      return json({ error: 'Un compte existe déjà pour cet email. Connecte-toi puis rouvre le lien.', code: 'account_exists' }, 409);
    }
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { first_name: first_name || '', last_name: last_name || '' },
    });
    if (createError || !newUser.user) {
      console.error('redeem onboarding link create user error:', createError);
      if (String(createError?.message ?? '').toLowerCase().includes('already')) {
        return json({ error: 'Un compte existe déjà pour cet email. Connecte-toi puis rouvre le lien.', code: 'account_exists' }, 409);
      }
      return json({ error: 'Erreur lors de la création du compte' }, 500);
    }
    userId = newUser.user.id;
    userEmail = email;
    accountCreated = true;
    if (first_name || last_name) await supabase.from('profiles').update({ first_name, last_name }).eq('id', userId);
  }

  if (!userId) return json({ error: 'Impossible de résoudre le compte' }, 500);

  // Idempotency: already redeemed?
  const { data: priorRedemption } = await supabase
    .from('onboarding_link_redemptions').select('id').eq('link_id', link.id).eq('user_id', userId).limit(1);
  if (priorRedemption && priorRedemption.length > 0) {
    return json({
      success: true, already_redeemed: true, role, account_created: accountCreated,
      redirect: REDIRECTS[role] ?? '/', message: 'Tu as déjà rejoint via ce lien.',
    });
  }

  if (link.max_uses != null && link.used_count >= link.max_uses) {
    return json({ error: 'Ce lien a atteint sa limite', code: 'full' }, 400);
  }

  // Per-role grant (idempotent). Mirrors the accept-* functions.
  if (STAFF_ROLES.has(role)) {
    await supabase.from('user_roles').upsert({ user_id: userId, role, email: userEmail }, { onConflict: 'user_id,role' });
    if (isOrgScope) {
      await supabase.from('org_staff').upsert({
        organizer_user_id: orgId, user_id: userId, email: userEmail,
        display_name: [first_name, last_name].filter(Boolean).join(' ') || null,
        role, invitation_status: 'accepted',
      }, { onConflict: 'organizer_user_id,email,role' });
    } else {
      await supabase.from('profiles').update({ venue_id: venueId }).eq('id', userId);
      if (role === 'manager' && cfg.manager_permissions) {
        await supabase.from('manager_permissions').upsert(
          { user_id: userId, venue_id: venueId, ...(cfg.manager_permissions as Record<string, boolean>) },
          { onConflict: 'user_id,venue_id' },
        );
      }
    }
  } else if (role === 'dj') {
    await supabase.from('user_roles').upsert({ user_id: userId, role: 'dj', email: userEmail }, { onConflict: 'user_id,role' });
    let scopeQ = supabase.from('djs').select('id').eq('user_id', userId);
    scopeQ = isOrgScope ? scopeQ.eq('organizer_user_id', orgId) : scopeQ.eq('venue_id', venueId);
    const { data: alreadyLinked } = await scopeQ.limit(1);
    if (!alreadyLinked || alreadyLinked.length === 0) {
      const { data: existing } = await supabase.from('djs').select('*').eq('user_id', userId);
      const src = (existing ?? []).sort((a: any, b: any) =>
        ((b.cover_image_url ? 2 : 0) + (b.profile_image_url ? 1 : 0)) -
        ((a.cover_image_url ? 2 : 0) + (a.profile_image_url ? 1 : 0)))[0];
      const payload: Record<string, unknown> = src
        ? {
            user_id: userId, first_name: src.first_name, last_name: src.last_name, stage_name: src.stage_name,
            music_genres: src.music_genres || [], bio: src.bio, description: src.description,
            instagram_url: src.instagram_url, tiktok_url: src.tiktok_url, soundcloud_url: src.soundcloud_url,
            spotify_url: src.spotify_url, youtube_url: src.youtube_url, whatsapp_number: src.whatsapp_number,
            city: src.city, country: src.country, profile_image_url: src.profile_image_url,
            cover_image_url: src.cover_image_url, is_verified: src.is_verified, is_active: true,
          }
        : {
            user_id: userId, first_name, last_name,
            stage_name: stage_name || [first_name, last_name].filter(Boolean).join(' ') || 'DJ',
            music_genres: [], is_active: true,
          };
      if (isOrgScope) payload.organizer_user_id = orgId; else payload.venue_id = venueId;
      const { error: djErr } = await supabase.from('djs').insert(payload);
      if (djErr) { console.error('dj insert error', djErr); return json({ error: 'Erreur création profil DJ' }, 500); }
    }
  } else if (role === 'promoter') {
    await supabase.from('user_roles').upsert({ user_id: userId, role: 'promoter', email: userEmail }, { onConflict: 'user_id,role' });
    let scopeQ = supabase.from('promoters').select('id').eq('user_id', userId);
    scopeQ = isOrgScope ? scopeQ.eq('organizer_user_id', orgId) : scopeQ.eq('venue_id', venueId);
    const { data: alreadyPromoter } = await scopeQ.limit(1);
    if (!alreadyPromoter || alreadyPromoter.length === 0) {
      const { data: prof } = await supabase.from('profiles').select('first_name, last_name, phone').eq('id', userId).single();
      const nameForCode = stage_name || prof?.first_name || first_name || 'promo';
      const promo_code = await uniquePromoCode(supabase, nameForCode, { venue_id: venueId, organizer_user_id: orgId });
      const promoterData: Record<string, unknown> = {
        user_id: userId, promo_code,
        first_name: prof?.first_name ?? first_name, last_name: prof?.last_name ?? last_name, phone: prof?.phone ?? null,
        ticket_commission_type: cfg.ticket_commission_type || 'percentage',
        ticket_commission_value: cfg.ticket_commission_value ?? 0,
        table_commission_type: cfg.table_commission_type || 'percentage',
        table_commission_value: cfg.table_commission_value ?? 0,
        is_active: true,
      };
      if (isOrgScope) promoterData.organizer_user_id = orgId; else promoterData.venue_id = venueId;
      const { error: pErr } = await supabase.from('promoters').insert(promoterData);
      if (pErr) { console.error('promoter insert error', pErr); return json({ error: 'Erreur création profil promoteur' }, 500); }
    }
  } else if (role === 'organizer') {
    const orgName = String(cfg.organization_name || [first_name, last_name].filter(Boolean).join(' ') || 'Organisation');
    await supabase.from('profiles').update({ profile_type: 'organizer', organization_name: orgName }).eq('id', userId);
    const { data: existingOrg } = await supabase.from('organizer_profiles').select('user_id').eq('user_id', userId).limit(1);
    if (!existingOrg || existingOrg.length === 0) {
      const slug = await uniqueOrgSlug(supabase, orgName);
      await supabase.from('organizer_profiles').upsert({ user_id: userId, display_name: orgName, slug }, { onConflict: 'user_id' });
    }
    await supabase.from('user_roles').upsert({ user_id: userId, role: 'organizer', email: userEmail }, { onConflict: 'user_id,role' });
  } else if (role === 'owner') {
    await supabase.from('user_roles').upsert({ user_id: userId, role: 'owner', email: userEmail }, { onConflict: 'user_id,role' });
    await supabase.from('venues').update({ owner_id: userId }).eq('id', venueId);
    await supabase.from('profiles').update({ venue_id: venueId }).eq('id', userId);
  } else {
    return json({ error: 'Rôle non pris en charge' }, 400);
  }

  await supabase.from('onboarding_link_redemptions').insert({ link_id: link.id, user_id: userId, role });
  const newCount = (link.used_count ?? 0) + 1;
  const deactivate = role === 'owner' || (link.max_uses != null && newCount >= link.max_uses);
  await supabase.from('onboarding_links')
    .update({ used_count: newCount, ...(deactivate ? { is_active: false } : {}) })
    .eq('id', link.id);

  return json({
    success: true, role, account_created: accountCreated,
    redirect: REDIRECTS[role] ?? '/', email: userEmail,
    message: accountCreated ? 'Compte créé et profil activé !' : 'Profil activé !',
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json();

    // Onboarding-link mechanism (folded in — see header note on the edge-fn cap).
    if (body?.action === 'create_onboarding_link') return await handleCreateOnboardingLink(req, supabase, body);
    if (body?.action === 'redeem_onboarding_link') return await handleRedeemOnboardingLink(req, supabase, body);

    // ─── Default behavior: accept an email-based staff invitation ────────────
    const { token, first_name, last_name } = body;
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
              const errBody = await res.text().catch(() => '');
              console.error('accept-staff-invitation password email send failed:', res.status, errBody);
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
