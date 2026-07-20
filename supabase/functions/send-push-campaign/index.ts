import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Plafond anti-spam pour les clubs : au-delà, les notifs Yuno perdent leur
// valeur pour tout le monde. Le super admin n'est pas plafonné.
const OWNER_MAX_CAMPAIGNS_PER_24H = 4;

type CampaignRequest = {
  title?: string;
  body?: string;
  url?: string;
  segment?: string;          // segments admin : all | active_30d | inactive_30d | ticket_holders | vip | loyal
  scope?: string;            // scopes club : event_tickets | checked_in | followers | rfm:<segment> | all_customers
  venue_id?: string;         // présent => campagne club (auth is_venue_owner)
  event_id?: string;         // requis pour event_tickets / checked_in
  template_key?: string;
  platform?: string;         // DÉPRÉCIÉ (ignoré) : les campagnes ciblent toujours l'app iOS
  city?: string;             // filtre optionnel (profiles.city, admin uniquement)
  dry_run?: boolean;         // => renvoie { targeted } sans envoyer
  scheduled_at?: string;     // ISO futur => enregistre la campagne, le cron l'enverra
  campaign_id?: string;      // chemin cron (service role) : envoyer une campagne 'scheduled'
  // Multi-langue par destinataire (campagnes générées par l'IA) : chaque
  // destinataire reçoit sa langue (profiles.preferred_language), title/body
  // restent le fallback. Clés attendues : en / fr / es.
  title_i18n?: Record<string, string> | null;
  body_i18n?: Record<string, string> | null;
};

/** Nettoie un dictionnaire i18n : ne garde que en/fr/es non vides, null si vide. */
function sanitizeI18n(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, string> = {};
  for (const lang of ['en', 'fr', 'es']) {
    const v = (input as Record<string, unknown>)[lang];
    if (typeof v === 'string' && v.trim()) out[lang] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

// deno-lint-ignore no-explicit-any
async function pushSubscriberIds(supabase: any): Promise<Set<string>> {
  // Campagnes = clients de l'APP iOS uniquement (stratégie app-first : le web
  // push est abandonné, les visiteurs web sont redirigés vers l'app). On ne
  // cible jamais 'web' ni 'ios_pro' (staff).
  // Paginé : le select PostgREST est plafonné à ~1000 lignes par défaut —
  // sans range(), toute audience au-delà était silencieusement tronquée.
  const out = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .eq('platform', 'ios')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`push_subscriptions read failed: ${error.message}`);
    // deno-lint-ignore no-explicit-any
    (data || []).forEach((d: any) => { if (d.user_id) out.add(d.user_id); });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/**
 * Résout l'audience en user_ids abonnés au push.
 * Scopes club (venue_id) : toujours bornés aux données DU club.
 */
// deno-lint-ignore no-explicit-any
async function resolveAudience(supabase: any, req: CampaignRequest): Promise<{ userIds: string[]; error?: string }> {
  let subscribers: Set<string>;
  try {
    subscribers = await pushSubscriberIds(supabase);
  } catch (e) {
    return { userIds: [], error: e instanceof Error ? e.message : 'push subscribers unavailable' };
  }

  // ── Scopes club ───────────────────────────────────────────────────────────
  if (req.venue_id) {
    const scope = req.scope || 'all_customers';
    let ids = new Set<string>();

    if (scope === 'event_tickets' || scope === 'checked_in') {
      if (!req.event_id) return { userIds: [], error: 'event_id required for this scope' };
      // L'event doit appartenir au club — un owner ne cible jamais les
      // acheteurs d'un autre établissement.
      const { data: event } = await supabase
        .from('events').select('id, venue_id').eq('id', req.event_id).maybeSingle();
      if (!event || event.venue_id !== req.venue_id) {
        return { userIds: [], error: 'event does not belong to this venue' };
      }
      let q = supabase.from('tickets').select('user_id').eq('event_id', req.event_id).eq('status', 'paid').not('user_id', 'is', null);
      if (scope === 'checked_in') q = q.eq('entry_scanned', true);
      const { data } = await q;
      // deno-lint-ignore no-explicit-any
      ids = new Set((data || []).map((d: any) => d.user_id));
      // Une soirée se vit aussi en tables et en commandes : pour "checked_in"
      // on reste strict (scan billets) ; pour event_tickets on ajoute les
      // réservations VIP payées de la même soirée.
      if (scope === 'event_tickets') {
        const { data: tables } = await supabase
          .from('table_reservations').select('user_id').eq('event_id', req.event_id).eq('status', 'paid').not('user_id', 'is', null);
        // deno-lint-ignore no-explicit-any
        (tables || []).forEach((d: any) => ids.add(d.user_id));
      }
    } else if (scope === 'followers') {
      const { data } = await supabase
        .from('favorites').select('user_id').eq('venue_id', req.venue_id).not('user_id', 'is', null);
      // deno-lint-ignore no-explicit-any
      ids = new Set((data || []).map((d: any) => d.user_id));
    } else if (scope.startsWith('rfm:')) {
      const wanted = scope.slice(4);
      const { data, error } = await supabase.rpc('get_venue_customer_segments', { p_venue_id: req.venue_id });
      if (error) return { userIds: [], error: `RFM segments unavailable: ${error.message}` };
      // La RPC ne renvoie PAS de colonne segment : le segment RFM est calculé
      // côté client (OwnerCustomers.tsx). On réplique EXACTEMENT ce scoring
      // (quintiles relatifs au club) pour que la cible du push corresponde à
      // ce que l'owner voit sur sa page Clients. Avant ce fix, r.segment était
      // toujours undefined → tous les segments RFM ciblaient 0 personne.
      // deno-lint-ignore no-explicit-any
      const rows: any[] = data || [];
      const now = Date.now();
      // deno-lint-ignore no-explicit-any
      const recencyOf = (r: any) =>
        Math.floor((now - new Date(r.last_activity_at || r.last_visit_at || r.first_visit_at).getTime()) / 86400000);
      // deno-lint-ignore no-explicit-any
      const freqOf = (r: any) => r.visit_nights || ((r.ticket_count || 0) + (r.order_count || 0) + (r.table_count || 0));
      const quintile = (value: number, sortedAsc: number[], invert = false): number => {
        const n = sortedAsc.length;
        if (n <= 1) return 3;
        let below = 0;
        for (let i = 0; i < n; i++) { if (sortedAsc[i] < value) below++; else break; }
        const pct = below / (n - 1);
        const score = Math.min(5, Math.max(1, Math.floor(pct * 5) + 1));
        return invert ? 6 - score : score;
      };
      const segmentOf = (r: number, f: number, m: number): string => {
        if (r >= 4 && f >= 4) return 'champions';
        if (f >= 4) return 'loyal';
        if (r <= 2 && f >= 3) return 'at_risk';
        if (r >= 4 && f <= 2) return m >= 3 ? 'promising' : 'new';
        if (r >= 3) return 'loyal';
        if (r === 2) return 'dormant';
        return 'lost';
      };
      const recArr = rows.map(recencyOf).sort((a, b) => a - b);
      const freqArr = rows.map(freqOf).sort((a, b) => a - b);
      const monArr = rows.map((r) => Number(r.total_spent) || 0).sort((a, b) => a - b);
      ids = new Set(
        rows
          .filter((row) => {
            if (!row.user_id) return false;
            const r = quintile(recencyOf(row), recArr, true);
            const f = quintile(freqOf(row), freqArr);
            const m = quintile(Number(row.total_spent) || 0, monArr);
            return segmentOf(r, f, m) === wanted;
          })
          .map((row) => row.user_id),
      );
    } else { // all_customers
      const { data } = await supabase
        .from('venue_customers').select('user_id').eq('venue_id', req.venue_id).not('user_id', 'is', null);
      // deno-lint-ignore no-explicit-any
      ids = new Set((data || []).map((d: any) => d.user_id));
    }

    return { userIds: [...ids].filter((id) => subscribers.has(id)) };
  }

  // ── Segments admin (comportement historique + filtres platform/city) ─────
  const segment = req.segment || 'all';
  let ids: string[] = [];

  if (segment === 'active_30d' || segment === 'inactive_30d') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentOrders } = await supabase.from('orders').select('user_id').gte('created_at', thirtyDaysAgo);
    const { data: recentTickets } = await supabase.from('tickets').select('user_id').gte('created_at', thirtyDaysAgo);
    const activeSet = new Set([
      // deno-lint-ignore no-explicit-any
      ...(recentOrders || []).map((d: any) => d.user_id),
      // deno-lint-ignore no-explicit-any
      ...(recentTickets || []).map((d: any) => d.user_id),
    ].filter(Boolean));
    ids = segment === 'active_30d'
      ? [...activeSet].filter((id) => subscribers.has(id as string)) as string[]
      : [...subscribers].filter((id) => !activeSet.has(id));
  } else if (segment === 'ticket_holders') {
    const { data } = await supabase.from('tickets').select('user_id').eq('status', 'paid');
    // deno-lint-ignore no-explicit-any
    ids = [...new Set((data || []).map((d: any) => d.user_id).filter(Boolean))].filter((id) => subscribers.has(id as string)) as string[];
  } else if (segment === 'vip') {
    const { data } = await supabase.from('table_reservations').select('user_id').eq('status', 'paid');
    // deno-lint-ignore no-explicit-any
    ids = [...new Set((data || []).map((d: any) => d.user_id).filter(Boolean))].filter((id) => subscribers.has(id as string)) as string[];
  } else if (segment === 'loyal') {
    const { data } = await supabase.from('customer_loyalty').select('user_id').in('tier', ['silver', 'gold', 'platinum']);
    // deno-lint-ignore no-explicit-any
    ids = [...new Set((data || []).map((d: any) => d.user_id).filter(Boolean))].filter((id) => subscribers.has(id as string)) as string[];
  } else { // all
    ids = [...subscribers];
  }

  // Filtre ville optionnel (admin) — matching tolérant sur profiles.city.
  if (req.city && ids.length > 0) {
    const cityIds = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data } = await supabase
        .from('profiles').select('id').in('id', chunk).ilike('city', `%${req.city}%`);
      // deno-lint-ignore no-explicit-any
      (data || []).forEach((d: any) => cityIds.add(d.id));
    }
    ids = ids.filter((id) => cityIds.has(id));
  }

  return { userIds: ids };
}

/** Ajoute le paramètre de tracking clic ?pc=<campaign_id> à l'URL de la notif. */
function withTracking(url: string, campaignId: string): string {
  const base = url || '/';
  return base.includes('?') ? `${base}&pc=${campaignId}` : `${base}?pc=${campaignId}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Unauthorized' });
    const bearer = authHeader.replace('Bearer ', '').trim();
    const isServiceCall = !!bearer && bearer === serviceKey;

    const body: CampaignRequest = await req.json();

    // ── Chemin cron : envoyer une campagne planifiée existante ─────────────
    if (isServiceCall && body.campaign_id) {
      const { data: campaign } = await supabase
        .from('push_campaigns').select('*').eq('id', body.campaign_id).maybeSingle();
      // Le cron marque 'sending' avant d'invoquer (anti double-fire) : on
      // accepte donc les deux statuts.
      if (!campaign || !['scheduled', 'sending'].includes(campaign.status)) {
        return json(404, { error: 'scheduled campaign not found' });
      }
      const stored = (campaign.audience || {}) as CampaignRequest;
      const request: CampaignRequest = {
        title: campaign.title, body: campaign.body, url: campaign.url || '/',
        segment: campaign.segment, venue_id: campaign.venue_id || undefined,
        event_id: campaign.event_id || undefined, template_key: campaign.template_key || undefined,
        scope: stored.scope, platform: stored.platform, city: stored.city,
        title_i18n: sanitizeI18n(campaign.title_i18n), body_i18n: sanitizeI18n(campaign.body_i18n),
      };
      const { userIds, error } = await resolveAudience(supabase, request);
      if (error) {
        await supabase.from('push_campaigns').update({ status: 'failed' }).eq('id', campaign.id);
        return json(400, { error });
      }
      const result = await sendCampaign(supabase, supabaseUrl, serviceKey, campaign.id, request, userIds);
      return json(200, { success: true, ...result });
    }

    // ── Auth utilisateur ────────────────────────────────────────────────────
    let callerId: string | undefined;
    if (!isServiceCall) {
      const supabaseAuth = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) return json(401, { error: 'Unauthorized' });

      if (body.venue_id) {
        // Campagne club : owner du club, OU manager du club avec le droit CRM
        // (le mode manager de /owner/push obtenait un 403 → « Portée : … »).
        const { data: owns } = await supabase.rpc('is_venue_owner', {
          _user_id: user.id,
          _venue_id: body.venue_id,
        });
        let allowed = !!owns;
        if (!allowed) {
          const { data: mgr } = await supabase
            .from('manager_permissions')
            .select('can_manage_crm')
            .eq('user_id', user.id)
            .eq('venue_id', body.venue_id)
            .maybeSingle();
          allowed = !!mgr?.can_manage_crm;
        }
        if (!allowed) return json(403, { error: 'forbidden_not_owner_or_crm_manager' });
      } else {
        // Campagne globale : super admin uniquement.
        const { data: isSA } = await supabaseAuth.rpc('is_super_admin');
        if (!isSA) return json(403, { error: 'forbidden_not_super_admin' });
      }

      callerId = user.id;
    }

    if (!body.title || !body.body) {
      return json(400, { error: 'title and body required' });
    }

    // ── Résolution d'audience ───────────────────────────────────────────────
    const { userIds, error: audienceError } = await resolveAudience(supabase, body);
    if (audienceError) return json(400, { error: audienceError });

    // Portée estimée sans envoi (compteur live des UIs admin/owner).
    if (body.dry_run) return json(200, { targeted: userIds.length });

    // ── Garde-fou club : 4 campagnes / 24 h ────────────────────────────────
    if (body.venue_id) {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('push_campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', body.venue_id)
        .eq('source', 'manual')  // les campagnes AUTO ne consomment pas le cap manuel
        .gte('created_at', dayAgo);
      if ((count ?? 0) >= OWNER_MAX_CAMPAIGNS_PER_24H) {
        return json(429, { error: 'campaign_rate_limited', limit: OWNER_MAX_CAMPAIGNS_PER_24H });
      }
    }

    const audienceSnapshot = {
      scope: body.scope, platform: body.platform, city: body.city,
    };

    // ── Planification : on enregistre, process-scheduled-campaigns enverra ──
    if (body.scheduled_at && new Date(body.scheduled_at).getTime() > Date.now()) {
      const { data: row, error: insErr } = await supabase.from('push_campaigns').insert({
        title: body.title, body: body.body, url: body.url || '/',
        segment: body.segment || body.scope || 'all',
        venue_id: body.venue_id || null, event_id: body.event_id || null,
        template_key: body.template_key || null,
        audience: audienceSnapshot,
        status: 'scheduled', scheduled_at: body.scheduled_at,
        targeted_count: userIds.length,
        sent_count: 0,
        created_by: callerId || null,
        title_i18n: sanitizeI18n(body.title_i18n), body_i18n: sanitizeI18n(body.body_i18n),
      }).select('id').single();
      if (insErr) return json(500, { error: insErr.message });
      return json(200, { success: true, scheduled: true, campaign_id: row.id, targeted: userIds.length });
    }

    // ── Envoi immédiat ──────────────────────────────────────────────────────
    const { data: row, error: insErr } = await supabase.from('push_campaigns').insert({
      title: body.title, body: body.body, url: body.url || '/',
      segment: body.segment || body.scope || 'all',
      venue_id: body.venue_id || null, event_id: body.event_id || null,
      template_key: body.template_key || null,
      audience: audienceSnapshot,
      status: 'sending',
      targeted_count: userIds.length,
      sent_count: 0,
      created_by: callerId || null,
      title_i18n: sanitizeI18n(body.title_i18n), body_i18n: sanitizeI18n(body.body_i18n),
    }).select('id').single();
    if (insErr) return json(500, { error: insErr.message });

    const result = await sendCampaign(supabase, supabaseUrl, serviceKey, row.id, body, userIds);
    return json(200, { success: true, ...result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    console.error('[CAMPAIGN] Error:', msg);
    return json(500, { error: msg });
  }
});

/**
 * Fan-out d'une campagne vers ses destinataires + tracking sent/failed.
 * La campagne (row.id) existe déjà ; on met à jour ses compteurs à la fin.
 */
// deno-lint-ignore no-explicit-any
async function sendCampaign(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  campaignId: string,
  request: CampaignRequest,
  userIds: string[],
): Promise<{ sent: number; failed: number; total: number; campaign_id: string }> {
  const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;
  const trackedUrl = withTracking(request.url || '/', campaignId);

  // Multi-langue : résoudre la langue de chaque destinataire (même convention
  // que les push automations — profiles.preferred_language, fallback 'fr').
  const titleI18n = sanitizeI18n(request.title_i18n);
  const bodyI18n = sanitizeI18n(request.body_i18n);
  const userLang = new Map<string, string>();
  if (titleI18n || bodyI18n) {
    for (let i = 0; i < userIds.length; i += 500) {
      const { data } = await supabase
        .from('profiles').select('id, preferred_language').in('id', userIds.slice(i, i + 500));
      // deno-lint-ignore no-explicit-any
      (data || []).forEach((p: any) => userLang.set(p.id, p.preferred_language || 'fr'));
    }
  }
  const contentFor = (userId: string): { title: string; body: string } => {
    const lang = userLang.get(userId) || 'fr';
    return {
      title: titleI18n?.[lang] || request.title || '',
      body: bodyI18n?.[lang] || request.body || '',
    };
  };

  let sentUsers = 0;
  let failedUsers = 0;
  const events: Array<{ campaign_id: string; user_id: string; event_type: string }> = [];

  console.log(`[CAMPAIGN] ${campaignId} — targeting ${userIds.length} users${titleI18n || bodyI18n ? ' (multi-langue)' : ''}`);

  // Batchs de 10 (même cadence que l'implémentation historique).
  for (let i = 0; i < userIds.length; i += 10) {
    const batch = userIds.slice(i, i + 10);
    const results = await Promise.all(batch.map(async (userId) => {
      try {
        const localized = contentFor(userId);
        const r = await fetch(pushUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: userId,
            // Campagne marketing : app Yuno grand public uniquement — l'audience
            // est déjà filtrée sur 'ios', le relay doit l'être aussi.
            platforms: ['ios'],
            payload: { title: localized.title, body: localized.body, url: trackedUrl },
          }),
        });
        const d = await r.json().catch(() => ({}));
        return { userId, sent: Number(d.sent || 0) };
      } catch {
        return { userId, sent: 0 };
      }
    }));
    for (const { userId, sent } of results) {
      if (sent > 0) { sentUsers++; events.push({ campaign_id: campaignId, user_id: userId, event_type: 'sent' }); }
      else { failedUsers++; events.push({ campaign_id: campaignId, user_id: userId, event_type: 'failed' }); }
    }
  }

  // Tracking par utilisateur (chunks de 500).
  for (let i = 0; i < events.length; i += 500) {
    await supabase.from('push_campaign_events')
      .upsert(events.slice(i, i + 500), { onConflict: 'campaign_id,user_id,event_type', ignoreDuplicates: true });
  }

  // Journal anti-spam global (insert groupé, plus de boucle par utilisateur).
  for (let i = 0; i < userIds.length; i += 500) {
    await supabase.from('notification_log').insert(
      userIds.slice(i, i + 500).map((uid) => ({
        user_id: uid,
        notification_type: 'campaign',
        title: request.title,
      })),
    );
  }

  await supabase.from('push_campaigns').update({
    status: 'sent',
    sent_count: sentUsers,
    failed_count: failedUsers,
    targeted_count: userIds.length,
  }).eq('id', campaignId);

  return { sent: sentUsers, failed: failedUsers, total: userIds.length, campaign_id: campaignId };
}
