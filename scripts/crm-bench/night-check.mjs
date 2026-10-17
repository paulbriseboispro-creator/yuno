#!/usr/bin/env node
// Relevé d'une soirée Shotgun suivie dans Yuno CRM, en LECTURE SEULE.
// Runbook : docs/designs/CRM_NIGHT_RUNBOOK.md (soirée WOH du 29/10, espace Amoris).
//
//   node scripts/crm-bench/night-check.mjs                # relevé complet (+ temps des écrans)
//   node scripts/crm-bench/night-check.mjs --no-screens   # sans les écrans (relevé de nuit, toutes les 30 min)
//   node scripts/crm-bench/night-check.mjs --heavy        # + Ventes 90 j, Qui cibler, Plan de la soirée
//   node scripts/crm-bench/night-check.mjs --json         # tout le relevé en JSON
//   options : --event <uuid> --owner <uuid> --connection <uuid> --force --no-save
//
// Deux temps, rien n'est jamais écrit sur la prod :
//  1. une requête dans une transaction READ ONLY (connexion, passes, billets
//     de la soirée, liens, campagnes, familles d'hypothèses, score) ;
//  2. les écrans de la Console joués EN TANT QUE le titulaire de l'espace
//     (rôle authenticated, request.jwt.claims sub = titulaire) dans un bloc DO
//     qui finit TOUJOURS par RAISE EXCEPTION : la transaction est annulée (les
//     RPC créent des tables temporaires, interdites en READ ONLY). Sautés si
//     une autre requête lourde tourne (pg_stat_activity), sauf --force.
//
// Le relevé est gardé dans .data/night-check/ (ignoré par git) pour donner
// l'écart avec le relevé précédent. Jeton : SUPABASE_ACCESS_TOKEN de .env.local
// (cherché en remontant depuis ce dossier et depuis le dossier courant), jamais affiché.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REF = 'fulawxvdlwtdlpkycixe';
const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(HERE, '.data', 'night-check');

// Soirée du 29/10 : WOH (Shotgun « Club Sonore ») testé dans l'espace Amoris.
const DEFAULTS = {
  owner: '06ce47f8-66a5-42d5-a7bf-56253619ff96',
  event: '01eccd74-74dc-4787-8be7-0330a10d3a6c',
  connection: '55566e29-be6d-40e3-a979-052c01275302',
};

// Seuils (même liste que le runbook, §3).
const SCREEN_WARN_MS = 3000; // cible du plan S4
const SCREEN_RED_MS = 8000; // l'API coupe à 8 s
const BUSY_SECS = 5; // une autre requête qui tourne depuis plus longtemps : pas d'écrans

// ── Arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const P = {
  owner: opt('owner') ?? DEFAULTS.owner,
  event: opt('event') ?? DEFAULTS.event,
  connection: opt('connection') ?? DEFAULTS.connection,
};
for (const [k, v] of Object.entries(P)) {
  if (!UUID.test(v)) {
    console.error(`--${k} : uuid attendu, reçu « ${v} »`);
    process.exit(2);
  }
}

// ── Accès à la prod ──────────────────────────────────────────────────────────
function token() {
  for (const start of [process.cwd(), HERE]) {
    let dir = resolve(start);
    for (;;) {
      const f = join(dir, '.env.local');
      if (existsSync(f)) {
        const m = readFileSync(f, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  throw new Error('SUPABASE_ACCESS_TOKEN introuvable (.env.local)');
}

async function post(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function readOnly(sql) {
  const r = await post(`SET TRANSACTION READ ONLY;\n${sql}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.text.slice(0, 1500)}`);
  return JSON.parse(r.text);
}

// ── 1. Le relevé (READ ONLY) ─────────────────────────────────────────────────
const SK = `org:${P.owner}`;
const READ_SQL = `
WITH p AS (
  SELECT '${P.owner}'::uuid AS org, '${P.event}'::uuid AS ev, '${P.connection}'::uuid AS conn, '${SK}'::text AS sk,
         ((now() AT TIME ZONE 'Europe/Paris')::date)::timestamp AT TIME ZONE 'Europe/Paris' AS today,
         ((now() AT TIME ZONE 'Europe/Paris')::date - 1)::timestamp AT TIME ZONE 'Europe/Paris' AS yday
), t AS (
  SELECT t.*, public._crm_ticket_is_sale(t.status, t.raw) AS is_sale, t.raw->>'deal_channel' AS channel
    FROM public.external_tickets t, p WHERE t.event_id = p.ev
), buy AS (
  -- Premier achat de chaque acheteur de la soirée (même règle que le règlement
  -- du journal prévu / réel, _crm_score_settle).
  SELECT lower(buyer_email) AS em, min(COALESCE(purchased_at, first_seen_at)) AS first_buy
    FROM t WHERE is_sale AND buyer_email IS NOT NULL GROUP BY 1
)
SELECT jsonb_build_object(
  'now', now(),
  'activity', (SELECT COALESCE(jsonb_agg(jsonb_build_object('pid', a.pid, 'secs', round(extract(epoch FROM now() - a.query_start)::numeric, 1),
                 'query', left(regexp_replace(a.query, '\\s+', ' ', 'g'), 100)) ORDER BY a.query_start), '[]'::jsonb)
                 FROM pg_stat_activity a
                WHERE a.state <> 'idle' AND a.pid <> pg_backend_pid() AND a.backend_type = 'client backend'),
  'connection', (SELECT to_jsonb(x) FROM (
      SELECT c.status, c.fail_count, c.sync_interval_minutes AS interval_min, c.last_ok_at, c.last_error_at,
             left(c.last_error, 300) AS last_error, c.next_sync_at, c.locked_until, c.last_sync_started_at,
             c.events_synced_at, c.tickets_cursor AS cursor, c.external_org_name AS org_name, c.include_cohosted
        FROM public.ticketing_connections c, p WHERE c.id = p.conn) x),
  'runs', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.started_at DESC) FROM (
      SELECT r.trigger, r.started_at, r.finished_at, round(extract(epoch FROM r.finished_at - r.started_at)::numeric, 1) AS secs,
             r.status, r.requests, r.pages, r.events_upserted, r.tickets_upserted, left(r.error, 200) AS error,
             r.detail->'tickets_linked' AS linked
        FROM public.ticketing_sync_runs r, p WHERE r.connection_id = p.conn ORDER BY r.started_at DESC LIMIT 5) r),
  'runs_24h', (SELECT jsonb_build_object('n', COALESCE(sum(s.n), 0), 'by_status', COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb))
                 FROM (SELECT r.status, count(*) AS n FROM public.ticketing_sync_runs r, p
                        WHERE r.connection_id = p.conn AND r.started_at > now() - interval '24 hours' GROUP BY 1) s),
  'max_gap_min_24h', (SELECT round(max(extract(epoch FROM g.gap)) / 60) FROM (
      SELECT r.started_at - lag(r.started_at) OVER (ORDER BY r.started_at) AS gap
        FROM public.ticketing_sync_runs r, p
       WHERE r.connection_id = p.conn AND r.status = 'ok' AND r.started_at > now() - interval '24 hours') g),
  'cron', (SELECT jsonb_object_agg(j.jobname, jsonb_build_object('schedule', j.schedule, 'active', j.active))
             FROM cron.job j WHERE j.jobname IN ('ticketing-sync', 'crm-analysis-nightly', 'crm-analysis-refresh', 'crm-score-nightly')),
  'event', (SELECT to_jsonb(x) FROM (
      SELECT ee.external_id, ee.name, ee.start_at, ee.end_at, ee.left_tickets, ee.synced_at, ee.cancelled_at, ee.external_role,
             (SELECT sum((d->>'quantity')::int) FROM jsonb_array_elements(COALESCE(ee.deals, '[]'::jsonb)) d) AS capacity,
             (SELECT jsonb_agg(jsonb_build_object('name', d->>'name', 'price', (d->>'price')::numeric, 'qty', (d->>'quantity')::int,
                     'channel', d->>'sales_channel')) FROM jsonb_array_elements(COALESCE(ee.deals, '[]'::jsonb)) d) AS deals
        FROM public.external_events ee, p WHERE ee.event_id = p.ev) x),
  'tickets', (SELECT jsonb_build_object(
      'rows', count(*),
      'sales', count(*) FILTER (WHERE is_sale),
      'paid', count(*) FILTER (WHERE is_sale AND COALESCE(price, 0) > 0),
      'free', count(*) FILTER (WHERE is_sale AND COALESCE(price, 0) = 0),
      'invitations', count(*) FILTER (WHERE status IN ('valid', 'transferred') AND channel = 'invitation'),
      'duplicata', count(*) FILTER (WHERE status IN ('valid', 'transferred') AND channel = 'duplicata'),
      'refunded', count(*) FILTER (WHERE status = 'refunded'),
      'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
      'face_eur', round(COALESCE(sum(price) FILTER (WHERE is_sale), 0), 2),
      'buyers', count(DISTINCT lower(buyer_email)) FILTER (WHERE is_sale AND buyer_email IS NOT NULL),
      'optin_buyers', count(DISTINCT lower(buyer_email)) FILTER (WHERE is_sale AND newsletter_optin),
      'scanned', count(*) FILTER (WHERE scanned_at IS NOT NULL AND status IN ('valid', 'transferred')),
      'scanned_paid', count(*) FILTER (WHERE scanned_at IS NOT NULL AND is_sale AND COALESCE(price, 0) > 0),
      'scanned_free', count(*) FILTER (WHERE scanned_at IS NOT NULL AND is_sale AND COALESCE(price, 0) = 0),
      'scanned_inv', count(*) FILTER (WHERE scanned_at IS NOT NULL AND channel = 'invitation'),
      'first_scan', min(scanned_at), 'last_scan', max(scanned_at),
      'today', count(*) FILTER (WHERE is_sale AND purchased_at >= (SELECT today FROM p)),
      'yesterday', count(*) FILTER (WHERE is_sale AND purchased_at >= (SELECT yday FROM p) AND purchased_at < (SELECT today FROM p)),
      'before_today', count(*) FILTER (WHERE is_sale AND purchased_at < (SELECT today FROM p)),
      'last_purchase', max(purchased_at), 'last_synced', max(synced_at),
      'by_status', (SELECT jsonb_object_agg(z.s, z.n) FROM (SELECT status AS s, count(*) AS n FROM t GROUP BY 1) z),
      'per_day', (SELECT jsonb_agg(jsonb_build_object('d', z.d, 'n', z.n, 'paid', z.paid) ORDER BY z.d) FROM (
          SELECT (purchased_at AT TIME ZONE 'Europe/Paris')::date AS d, count(*) AS n, count(*) FILTER (WHERE COALESCE(price, 0) > 0) AS paid
            FROM t WHERE is_sale GROUP BY 1 ORDER BY 1 DESC LIMIT 14) z),
      'by_deal', (SELECT jsonb_agg(jsonb_build_object('deal', z.deal_name, 'price', z.price, 'n', z.n, 'scanned', z.sc) ORDER BY z.n DESC) FROM (
          SELECT deal_name, price, count(*) FILTER (WHERE is_sale) AS n, count(*) FILTER (WHERE is_sale AND scanned_at IS NOT NULL) AS sc
            FROM t GROUP BY 1, 2) z),
      'scans_by_hour', (SELECT jsonb_agg(jsonb_build_object('h', z.h, 'n', z.n) ORDER BY z.h) FROM (
          SELECT to_char(date_trunc('hour', scanned_at AT TIME ZONE 'Europe/Paris'), 'MM-DD HH24') AS h, count(*) AS n
            FROM t WHERE scanned_at IS NOT NULL GROUP BY 1) z),
      'sources', (SELECT jsonb_agg(jsonb_build_object('src', z.src, 'n', z.n) ORDER BY z.n DESC) FROM (
          SELECT COALESCE(utm->>'utm_source', '∅') AS src, count(*) AS n FROM t WHERE is_sale GROUP BY 1) z),
      'families', (SELECT jsonb_object_agg(z.f, z.n) FROM (
          SELECT COALESCE(public._crm_ticket_source(utm), '∅') AS f, count(*) AS n FROM t WHERE is_sale GROUP BY 1) z)
    ) FROM t),
  'links', (SELECT jsonb_agg(jsonb_build_object('code', l.code, 'label', l.label, 'src', l.utm_source, 'medium', l.utm_medium,
              'clicks', l.clicks_count, 'archived', l.archived_at IS NOT NULL,
              'sales', (SELECT count(*) FROM t WHERE t.is_sale AND t.utm->>'utm_source' = 'yuno-' || l.code)) ORDER BY l.created_at)
              FROM public.tracked_links l, p WHERE l.event_id = p.ev),
  'yuno_sales', (SELECT count(*) FROM t WHERE is_sale AND t.utm->>'utm_source' LIKE 'yuno%'),
  'scan_known', (SELECT public._crm_event_scan_known(p.ev) FROM p),
  'campaigns', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.updated_at DESC) FROM (
      SELECT c.name, c.status, c.child_kind, c.scheduled_at, c.sent_at, c.total_recipients, c.delivered_count, c.opens_count,
             c.clicks_count, c.bounced_count, c.complained_count, c.policy_skipped_count, c.updated_at,
             (c.event_id = p.ev OR c.automation_trigger_event_id = p.ev) AS for_night
        FROM public.email_campaigns c, p
       WHERE c.organizer_user_id = p.org AND c.venue_id IS NULL
         AND (c.event_id = p.ev OR c.automation_trigger_event_id = p.ev OR (c.status <> 'draft' AND c.updated_at > now() - interval '7 days'))
       ORDER BY c.updated_at DESC LIMIT 8) c),
  'signup_pages', (SELECT jsonb_agg(jsonb_build_object('slug', sp.slug, 'status', sp.status, 'published_at', sp.published_at,
              'entries', (SELECT count(*) FROM public.crm_signup_entries se WHERE se.page_id = sp.id),
              'confirmed', (SELECT count(*) FROM public.crm_signup_entries se WHERE se.page_id = sp.id AND se.confirmed_at IS NOT NULL)))
              FROM public.crm_signup_pages sp, p WHERE sp.organizer_user_id = p.org AND sp.event_id = p.ev),
  'subscription', (SELECT to_jsonb(x) FROM (
      SELECT s.plan, s.status, s.trial_ends_at, s.offer, s.offer_until, s.current_period_end,
             s.granted_by IS NOT NULL AS granted, s.stripe_subscription_id IS NOT NULL AS stripe,
             public.crm_effective_plan(s.scope_key) AS effective
        FROM public.crm_subscriptions s, p WHERE s.scope_key = p.sk) x),
  'yunits', (SELECT public.crm_yunits_balance(p.sk) FROM p),
  'sender', (SELECT to_jsonb(x) FROM (
      SELECT es.sender_name, NULLIF(btrim(es.postal_address::text), '') IS NOT NULL AS has_postal
        FROM public.crm_email_settings es, p WHERE es.scope_key = p.sk) x),
  'profiles', (SELECT jsonb_build_object('n', count(*), 'at', max(pp.computed_at)) FROM public.crm_person_profile pp, p WHERE pp.scope_key = p.sk),
  'families', (SELECT jsonb_build_object(
      'computed_at', max(f.computed_at),
      'list', jsonb_agg(jsonb_build_object('f', f.family || CASE WHEN f.variant <> '' THEN ':' || f.variant ELSE '' END,
                'status', f.status, 'runs', f.supported_runs, 'z', round(f.z, 1), 'gain', round(f.gain, 2), 'n', f.n,
                'availability', f.availability) ORDER BY abs(COALESCE(f.z, 0)) DESC))
      FROM public.crm_family_status f, p WHERE f.scope_key = p.sk),
  'family_runs', (SELECT jsonb_agg(jsonb_build_object('d', z.computed_on, 'n', z.n, 'supported', z.sup) ORDER BY z.computed_on) FROM (
      SELECT h.computed_on, count(*) AS n, count(*) FILTER (WHERE h.status = 'supported') AS sup
        FROM public.crm_family_status_history h, p WHERE h.scope_key = p.sk GROUP BY 1) z),
  'score_model', (SELECT jsonb_build_object('status', m.status, 'trained_at', m.trained_at,
      'metrics', (SELECT jsonb_object_agg(e.k, e.v) FROM jsonb_each(m.metrics) e(k, v)
                   WHERE jsonb_typeof(e.v) IN ('number', 'string', 'boolean') OR e.k IN ('backtest', 'calib', 'recent')))
      FROM public.crm_score_model m, p WHERE m.scope_key = p.sk),
  'score_night', (SELECT to_jsonb(x) FROM (SELECT sn.remaining_share, sn.computed_at FROM public.crm_score_night sn, p
                    WHERE sn.scope_key = p.sk AND sn.event_id = p.ev) x),
  'person_scores', (SELECT jsonb_build_object('n', count(*), 'expected', round(sum(ps.p)::numeric, 1), 'at', max(ps.computed_at),
      'by_label', (SELECT jsonb_object_agg(z.l, z.n) FROM (SELECT ps2.label AS l, count(*) AS n FROM public.crm_person_night_score ps2, p
                     WHERE ps2.scope_key = p.sk AND ps2.event_id = p.ev GROUP BY 1) z))
      FROM public.crm_person_night_score ps, p WHERE ps.scope_key = p.sk AND ps.event_id = p.ev),
  'prediction_nights', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.snapshot_on) FROM (
      SELECT n.snapshot_on, n.days_left, n.sold, n.buyers, n.scored, round(n.expected_known::numeric, 1) AS expected_known,
             round(n.band::numeric, 1) AS band, round(n.newcomers_est::numeric, 1) AS newcomers_est, n.remaining_share
        FROM public.crm_prediction_nights n, p WHERE n.scope_key = p.sk AND n.event_id = p.ev) x),
  'prediction_people', (SELECT jsonb_object_agg(z.h, z.n) FROM (SELECT pp.horizon AS h, count(*) AS n
      FROM public.crm_prediction_people pp, p WHERE pp.scope_key = p.sk AND pp.event_id = p.ev GROUP BY 1) z),
  -- Prévu / réel PROVISOIRE (avant le règlement officiel, 48 h après la fin) :
  -- chances gardées à la 1re note (« first ») et à J-7 (« d7 ») contre les achats
  -- faits APRÈS la note.
  'prediction_preview', (SELECT jsonb_agg(jsonb_build_object('horizon', z.horizon, 'label', z.label, 'n', z.n,
      'expected', z.expected, 'actual', z.actual, 'snapshot_at', z.snap) ORDER BY z.horizon, z.label) FROM (
      SELECT pp.horizon, pp.label, count(*) AS n, round(sum(pp.p)::numeric, 1) AS expected,
             count(*) FILTER (WHERE b.first_buy > pp.snapshot_at) AS actual, min(pp.snapshot_at) AS snap
        FROM p CROSS JOIN public.crm_prediction_people pp LEFT JOIN buy b ON b.em = pp.email
       WHERE pp.scope_key = p.sk AND pp.event_id = p.ev
       GROUP BY 1, 2) z),
  'prediction_results', (SELECT jsonb_agg(jsonb_build_object('horizon', r.horizon, 'settled_at', r.settled_at,
      'n', r.metrics->'n', 'buyers', r.metrics->'buyers', 'expected', r.metrics->'expected', 'auc', r.metrics->'auc',
      'logloss', r.metrics->'logloss', 'brier', r.metrics->'brier', 'ece', r.metrics->'ece', 'projection', r.metrics->'projection'))
      FROM public.crm_prediction_results r, p WHERE r.scope_key = p.sk AND r.event_id = p.ev)
) AS r`;

// ── 2. Les écrans, en tant que le titulaire (bloc annulé) ────────────────────
function screensSql(heavy) {
  const o = `'${P.owner}'::uuid`;
  const e = `'${P.event}'::uuid`;
  const calls = [
    ['accueil_30j', `public.crm_home(NULL, ${o}, '30d')`,
      `jsonb_build_object('sold', v->'next'->'sold', 'today', v->'next'->'today', 'left', v->'next'->'left', 'days_to', v->'next'->'days_to',
         'buyers', v->'next'->'buyers', 'is_night', (v->'next'->>'id') = '${P.event}', 'prev', v->'next'->'prev'->'title',
         'curve', (SELECT jsonb_agg(c) FROM (SELECT c FROM jsonb_array_elements(v->'next'->'curve') c ORDER BY (c->>'jn')::int LIMIT 3) z),
         'todo', (SELECT jsonb_agg(td->>'kind') FROM jsonb_array_elements(v->'todo') td))`],
    ['soirees', `public.crm_nights(NULL, ${o})`, `NULL::jsonb`],
    ['soiree', `public.crm_night_detail(NULL, ${o}, ${e})`,
      `jsonb_build_object('sold', v->'sold', 'today', v->'today', 'cap', v->'cap', 'revenue', v->'revenue', 'buyers', v->'buyers',
         'synced_at', v->'synced_at', 'sold_out', v->'sold_out')`],
    ['ventes_soiree', `public.crm_ana_sales(NULL, ${o}, '90d', ${e}, 'all')`, `NULL::jsonb`],
  ];
  if (heavy) {
    calls.push(
      ['ventes_90j', `public.crm_ana_sales(NULL, ${o}, '90d', NULL, 'all')`, `NULL::jsonb`],
      ['qui_cibler', `public.crm_night_targets(NULL, ${o}, ${e})`, `NULL::jsonb`],
      ['plan_soiree', `public.crm_night_plan(NULL, ${o}, ${e})`, `NULL::jsonb`],
    );
  }
  const blocks = calls.map(([key, call, extract]) => `
  t0 := clock_timestamp();
  BEGIN
    v := ${call};
    out := out || jsonb_build_object('${key}', jsonb_build_object('ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
             'bytes', length(v::text), 'data', ${extract}));
  EXCEPTION WHEN others THEN
    out := out || jsonb_build_object('${key}', jsonb_build_object('ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
             'error', SQLSTATE || ' ' || SQLERRM));
  END;`).join('\n');
  return `
SELECT set_config('request.jwt.claims', '{"sub":"${P.owner}","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $night_check$
DECLARE t0 timestamptz; v jsonb; out jsonb := '{}'::jsonb;
BEGIN
  out := out || jsonb_build_object('as', current_user, 'uid', auth.uid());
${blocks}
  -- Toujours : rien de ce que les écrans ont pu écrire (tables temporaires,
  -- caches) ne reste. Le relevé sort dans le message d'erreur.
  RAISE EXCEPTION 'NIGHTCHECK<<%>>NIGHTCHECK', out::text;
END
$night_check$;`;
}

async function screens(heavy) {
  const r = await post(screensSql(heavy));
  let msg = r.text;
  try { msg = JSON.parse(r.text).message ?? r.text; } catch { /* corps non JSON : on le garde tel quel */ }
  const m = String(msg).match(/NIGHTCHECK<<([\s\S]*)>>NIGHTCHECK/);
  if (!m) throw new Error(`écrans : réponse inattendue (HTTP ${r.status}) ${String(msg).slice(0, 800)}`);
  return JSON.parse(m[1]);
}

// ── Mise en forme ────────────────────────────────────────────────────────────
const TZ = 'Europe/Paris';
const fmtDT = (iso, withDay = false) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const o = { timeZone: TZ, hour: '2-digit', minute: '2-digit' };
  if (withDay) Object.assign(o, { weekday: 'short', day: '2-digit', month: '2-digit' });
  return new Intl.DateTimeFormat('fr-FR', o).format(d);
};
const ago = (iso, now) => {
  if (!iso) return '—';
  const m = Math.round((now - new Date(iso)) / 60000);
  if (Math.abs(m) < 60) return m >= 0 ? `il y a ${m} min` : `dans ${-m} min`;
  const h = (Math.abs(m) / 60).toFixed(1).replace('.', ',');
  return m >= 0 ? `il y a ${h} h` : `dans ${h} h`;
};
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} s` : `${n} ms`);
const dec = (x) => (x == null ? '—' : String(x).replace('.', ','));
const pct = (a, b) => (b > 0 ? `${Math.round((100 * a) / b)} %` : '—');
const parisDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // AAAA-MM-JJ

// ── Le relevé ────────────────────────────────────────────────────────────────
const alerts = []; // { level: 'ROUGE' | 'ORANGE', text }
const red = (text) => alerts.push({ level: 'ROUGE', text });
const orange = (text) => alerts.push({ level: 'ORANGE', text });

const rows = await readOnly(READ_SQL);
const R = rows[0].r;
const now = new Date(R.now);

// Une autre requête lourde ? (règle de santé de la prod : une seule à la fois)
const busy = (R.activity ?? []).filter((a) => Number(a.secs) > BUSY_SECS && !/^START_REPLICATION/i.test(a.query));
let S = null;
let screensSkipped = null;
if (flag('no-screens')) screensSkipped = 'demandé (--no-screens)';
else if (busy.length && !flag('force')) screensSkipped = `une autre requête tourne (${busy.map((b) => `${b.secs} s`).join(', ')}) — relancer plus tard ou --force`;
else S = await screens(flag('heavy'));

const out = { at: R.now, params: P, read: R, screens: S };

if (flag('json')) {
  console.log(JSON.stringify(out, null, 1));
} else {
  const lines = [];
  const say = (s = '') => lines.push(s);
  const ev = R.event;
  const startAt = ev ? new Date(ev.start_at) : null;
  const endAt = ev ? new Date(ev.end_at) : null;
  const daysTo = startAt ? Math.round((new Date(parisDate(startAt)) - new Date(parisDate(now))) / 86400000) : null;
  const phase = !ev ? 'inconnue'
    : now < startAt ? `J-${daysTo}`
    : now <= endAt ? 'PENDANT LA SOIRÉE'
    : `J+${Math.round((new Date(parisDate(now)) - new Date(parisDate(startAt))) / 86400000)}`;

  // 1. Synchro
  const c = R.connection;
  say('1. Synchro Shotgun');
  if (!c) red('connexion introuvable');
  else {
    const late = c.last_ok_at && (now - new Date(c.last_ok_at)) / 60000 > 2 * c.interval_min + 10;
    if (c.status !== 'active') red(`connexion « ${c.status} » (attendu : active)`);
    if (c.fail_count >= 3) red(`${c.fail_count} échecs de suite : ${c.last_error ?? '?'}`);
    else if (c.fail_count > 0) orange(`${c.fail_count} échec(s) de suite : ${c.last_error ?? '?'}`);
    if (late) red(`dernière passe réussie ${ago(c.last_ok_at, now)} (plus de 2 × ${c.interval_min} min)`);
    if (c.locked_until && new Date(c.locked_until) > new Date(now.getTime() + 15 * 60000)) orange(`verrou de synchro posé jusqu'à ${fmtDT(c.locked_until)}`);
    say(`   ${c.org_name} · ${c.status} · toutes les ${c.interval_min} min · ${c.fail_count} échec · dernière passe OK ${fmtDT(c.last_ok_at)} (${ago(c.last_ok_at, now)}) · prochaine ${fmtDT(c.next_sync_at)}`);
    if (c.last_error_at) say(`   dernière erreur ${fmtDT(c.last_error_at, true)} : ${c.last_error}`);
  }
  const runs = R.runs ?? [];
  if (runs[0] && runs[0].status !== 'ok') (runs[0].status === 'partial' ? orange : red)(`dernière passe « ${runs[0].status} » ${runs[0].error ?? ''}`.trim());
  say(`   5 dernières passes : ${runs.map((r) => `${fmtDT(r.started_at)} ${r.trigger} ${r.status} ${String(r.secs).replace('.', ',')} s ${r.tickets_upserted} billet(s)`).join(' · ') || 'aucune'}`);
  const r24 = R.runs_24h ?? { n: 0, by_status: {} };
  say(`   24 h : ${r24.n} passe(s) ${JSON.stringify(r24.by_status)} · plus long écart entre deux passes OK : ${R.max_gap_min_24h ?? '—'} min`);
  const cronOff = Object.entries(R.cron ?? {}).filter(([, j]) => !j.active).map(([k]) => k);
  if (cronOff.length) red(`tâche(s) planifiée(s) éteinte(s) : ${cronOff.join(', ')}`);

  // 2. La soirée
  say();
  say(`2. La soirée — ${ev?.name ?? '?'} (${phase})`);
  const t = R.tickets ?? {};
  if (!ev) red('soirée miroir introuvable dans external_events');
  else {
    if (ev.cancelled_at) red(`soirée ANNULÉE chez Shotgun (${fmtDT(ev.cancelled_at, true)})`);
    const shotgunSold = ev.capacity != null && ev.left_tickets != null ? ev.capacity - ev.left_tickets : null;
    const ours = (t.by_status?.valid ?? 0) + (t.by_status?.transferred ?? 0);
    say(`   ${fmtDT(ev.start_at, true)} → ${fmtDT(ev.end_at, true)} · rôle de WOH chez Shotgun : ${ev.external_role} · soirée relue ${ago(ev.synced_at, now)}`);
    say(`   Shotgun : ${shotgunSold ?? '?'} place(s) prise(s) sur ${ev.capacity ?? '?'}, ${ev.left_tickets ?? '?'} restante(s) · Yuno : ${ours} billet(s) valides`);
    if (shotgunSold != null && Math.abs(shotgunSold - ours) > Math.max(3, Math.round(0.02 * shotgunSold))) {
      orange(`écart Shotgun (${shotgunSold}) / Yuno (${ours}) billets : synchro en retard ou billets non rapportés`);
    }
  }
  say(`   Ventes : ${t.sales ?? 0} = ${t.paid ?? 0} payant(s) + ${t.free ?? 0} gratuit(s) · invitations ${t.invitations ?? 0} · duplicata ${t.duplicata ?? 0} · remboursés ${t.refunded ?? 0} · annulés ${t.cancelled ?? 0}`);
  say(`   ${t.buyers ?? 0} acheteur(s), ${t.optin_buyers ?? 0} avec accord newsletter · valeur faciale ${t.face_eur ?? 0} € · aujourd'hui ${t.today ?? 0}, hier ${t.yesterday ?? 0} (total à minuit : ${t.before_today ?? 0})`);
  say(`   Par jour : ${(t.per_day ?? []).map((d) => `${d.d.slice(5)} ${d.n}${d.paid ? ` (${d.paid} payant)` : ''}`).join(' · ') || '—'}`);
  say(`   Par tarif : ${(t.by_deal ?? []).filter((d) => d.n).map((d) => `${d.deal} (${d.price} €) ${d.n}${d.scanned ? `, ${d.scanned} scannés` : ''}`).join(' · ') || '—'}`);
  say(`   Sources : ${(t.sources ?? []).map((s) => `${s.src} ${s.n}`).join(' · ') || '—'} · familles ${JSON.stringify(t.families ?? {})}`);
  say(`   Porte ${R.scan_known ? 'mesurée' : 'non mesurée'} (règle _crm_event_scan_known) : ${t.scanned ?? 0} scanné(s) (payants ${t.scanned_paid ?? 0} / ${t.paid ?? 0}, gratuits ${t.scanned_free ?? 0} / ${t.free ?? 0}, invitations ${t.scanned_inv ?? 0})${t.first_scan ? ` · 1er ${fmtDT(t.first_scan)}, dernier ${fmtDT(t.last_scan)}` : ''}`);
  if ((t.scans_by_hour ?? []).length) say(`   Scans par heure : ${t.scans_by_hour.map((h) => `${h.h.slice(6)}h ${h.n}`).join(' · ')}`);
  if (ev && now > new Date(startAt.getTime() + 2 * 3600000) && now < new Date(endAt.getTime() + 12 * 3600000) && !(t.scanned > 0)) {
    red('aucun scan remonté 2 h après l\'ouverture : le scanner Shotgun sert-il ? la synchro passe-t-elle ?');
  }
  if (ev && now > endAt && t.last_scan && (now - new Date(t.last_scan)) / 3600000 < 1) orange('des scans arrivent encore : relancer le relevé plus tard pour le bilan');

  // 3. Liens, pages, campagnes
  say();
  say('3. Ce que Yuno fait pour la soirée');
  const links = R.links ?? [];
  say(`   Liens /go/ : ${links.length ? links.map((l) => `${l.label ?? l.code} (${l.src}/${l.medium}) ${l.clicks} clic(s), ${l.sales} vente(s)${l.archived ? ', masqué' : ''}`).join(' · ') : 'aucun'} · ventes Yuno (utm yuno*) : ${R.yuno_sales ?? 0}`);
  const pages = R.signup_pages ?? [];
  say(`   Pages /j/ : ${pages.length ? pages.map((p) => `${p.slug} ${p.status} ${p.entries} inscrit(s) dont ${p.confirmed} confirmé(s)`).join(' · ') : 'aucune'}`);
  const camps = R.campaigns ?? [];
  say(`   Campagnes : ${camps.length ? '' : 'aucune liée à la soirée ni envoyée cette semaine'}`);
  for (const cp of camps) {
    say(`     · ${cp.name} — ${cp.status}${cp.for_night ? '' : ' (autre soirée)'}${cp.scheduled_at ? `, prévue ${fmtDT(cp.scheduled_at, true)}` : ''}${cp.sent_at ? `, partie ${fmtDT(cp.sent_at, true)}` : ''} · ${cp.total_recipients ?? 0} dest., ${cp.delivered_count ?? 0} remis, ${cp.opens_count ?? 0} ouv., ${cp.clicks_count ?? 0} clics, ${cp.bounced_count ?? 0} rebonds, ${cp.complained_count ?? 0} plaintes, ${cp.policy_skipped_count ?? 0} protégés`);
    const sent = Number(cp.delivered_count ?? 0) + Number(cp.bounced_count ?? 0);
    if (sent >= 50 && Number(cp.bounced_count) / sent > 0.05) red(`« ${cp.name} » : ${pct(cp.bounced_count, sent)} de rebonds (disjoncteur à 5 %)`);
    if (sent >= 50 && Number(cp.complained_count) / sent > 0.002) red(`« ${cp.name} » : ${pct(cp.complained_count, sent)} de plaintes (disjoncteur à 0,2 %)`);
    if (cp.status === 'paused' || cp.status === 'failed') red(`« ${cp.name} » est « ${cp.status} »`);
  }
  const sub = R.subscription;
  const subWhy = !sub ? '' : sub.status === 'trialing' ? ` · essai jusqu'au ${fmtDT(sub.trial_ends_at, true)}`
    : sub.granted && !sub.stripe ? ` · offert par Yuno${sub.current_period_end ? ` jusqu'au ${fmtDT(sub.current_period_end, true)}` : ', sans échéance'}`
    : sub.current_period_end ? ` · payé jusqu'au ${fmtDT(sub.current_period_end, true)}` : '';
  say(`   Offre CRM : ${sub ? `${sub.plan} · ${sub.status}${subWhy}${sub.offer ? ` · offre ${sub.offer} jusqu'au ${fmtDT(sub.offer_until, true)}` : ''} · plan effectif ${sub.effective}` : 'aucune ligne'} · ${R.yunits ?? '?'} Yunits`);
  if (!sub) red('aucun abonnement CRM : envois refusés');
  else if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) - now < 48 * 3600000) {
    (new Date(sub.trial_ends_at) < now ? red : orange)(`essai CRM ${new Date(sub.trial_ends_at) < now ? 'FINI' : 'fini'} le ${fmtDT(sub.trial_ends_at, true)} : « Offrir Yuno CRM » à Amoris (/admin/organizers)`);
  } else if (!['active', 'trialing'].includes(sub.status)) red(`abonnement CRM « ${sub.status} » : campagnes et automatisations refusées`);
  const snd = R.sender;
  say(`   Expéditeur : ${snd?.sender_name ? `« ${snd.sender_name} »` : 'non réglé'} · adresse postale ${snd?.has_postal ? 'oui' : 'non'}`);
  if (!snd?.sender_name || !snd?.has_postal) orange('Réglages › Envoi d\'Amoris : nom d\'expéditeur « WOH » et adresse postale à poser avant tout envoi');

  // 4. Intelligence
  say();
  say('4. Ce qui fait venir, Chances de venir');
  const fam = R.families ?? { list: [] };
  const byStatus = {};
  for (const f of fam.list ?? []) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
  say(`   ${R.profiles?.n ?? 0} profils (calcul ${fmtDT(R.profiles?.at, true)}) · familles calculées ${fmtDT(fam.computed_at, true)} : ${JSON.stringify(byStatus)}`);
  say(`   Calculs complets : ${(R.family_runs ?? []).map((h) => `${h.d.slice(5)} (${h.supported} confirmée(s))`).join(' · ') || '—'}`);
  const conf = (fam.list ?? []).filter((f) => f.status === 'supported');
  const cand = (fam.list ?? []).filter((f) => f.status !== 'supported' && f.runs > 0);
  say(`   Confirmées : ${conf.map((f) => `${f.f} (z ${dec(f.z)}, ×${dec(f.gain)})`).join(' · ') || 'aucune'}`);
  if (cand.length) say(`   À confirmer au prochain calcul : ${cand.map((f) => `${f.f} (z ${dec(f.z)}, ×${dec(f.gain)})`).join(' · ')}`);
  if (fam.computed_at && (now - new Date(fam.computed_at)) / 3600000 > 30) orange(`familles pas recalculées depuis ${ago(fam.computed_at, now)} (calcul de nuit attendu 04:19-06:49 Paris)`);
  const sm = R.score_model;
  say(`   Modèle du score : ${sm ? `${sm.status} (entraîné ${fmtDT(sm.trained_at, true)})${sm.metrics ? ` ${JSON.stringify(sm.metrics).slice(0, 300)}` : ''}` : 'pas encore entraîné'}`);
  const ps = R.person_scores ?? { n: 0 };
  say(`   Soirée : part des achats encore à venir ${R.score_night ? `${Math.round(100 * R.score_night.remaining_share)} % (${fmtDT(R.score_night.computed_at, true)})` : '—'} · ${ps.n} personne(s) notée(s), ${ps.expected ?? 0} acheteur(s) connus attendus ${ps.by_label ? JSON.stringify(ps.by_label) : ''}`);
  const pn = R.prediction_nights ?? [];
  if (pn.length) say(`   Journal prévu : ${pn.map((n) => `${n.snapshot_on.slice(5)} J-${n.days_left} vendus ${n.sold}, acheteurs ${n.buyers}, attendus ${n.expected_known} ± ${n.band}, nouveaux ${n.newcomers_est ?? '—'}`).join(' · ')} · personnes gardées ${JSON.stringify(R.prediction_people ?? {})}`);
  const prev2 = {};
  for (const r of R.prediction_preview ?? []) {
    const h = (prev2[r.horizon] ??= { n: 0, expected: 0, actual: 0, snap: r.snapshot_at, labels: [] });
    h.n += Number(r.n); h.expected += Number(r.expected); h.actual += Number(r.actual);
    h.labels.push(`${r.label} ${r.actual}/${r.expected}`);
  }
  for (const [h, v] of Object.entries(prev2)) {
    say(`   Prévu / réel provisoire (${h === 'd7' ? 'note de J-7' : '1re note'}, ${fmtDT(v.snap, true)}) : ${v.n} personnes notées, ${dec(v.expected.toFixed(1))} achats attendus, ${v.actual} faits depuis · par étiquette (réels / attendus) ${v.labels.join(' · ')}`);
  }
  for (const pr of R.prediction_results ?? []) {
    say(`   Prévu / réel (${pr.horizon}, réglé ${fmtDT(pr.settled_at, true)}) : ${pr.buyers} acheteurs pour ${pr.expected} attendus · AUC ${pr.auc} · perte log ${pr.logloss} · projection ${JSON.stringify(pr.projection ?? null)}`);
  }
  // Le 1er calcul complet est fait à la connexion ; le 2e passe la nuit
  // suivante (crm-analysis-nightly, 02:19-04:49 UTC), le score juste après
  // (crm-score-nightly, 05:27-06:57 UTC).
  const firstRun = (R.family_runs ?? [])[0]?.d;
  const nextNight = firstRun ? new Date(`${firstRun}T00:00:00Z`).getTime() + 86400000 : null;
  if (nextNight && now > nextNight + 5 * 3600000 && (R.family_runs ?? []).length < 2) orange('le 2e calcul complet des familles n\'a pas eu lieu (attendu la nuit qui suit la connexion)');
  if (nextNight && now > nextNight + 7 * 3600000 && (!sm || sm.status !== 'ok')) orange(`score « Chances de venir » non validé (modèle : ${sm?.status ?? 'absent'}) : aucune personne notée`);
  if (sm?.status === 'ok' && !R.score_night && ev && now < startAt) orange('modèle validé mais la soirée n\'a pas de note (crm_score_night vide)');

  // 5. Écrans
  say();
  say('5. Écrans de la Console (en tant que le titulaire, transaction annulée)');
  if (!S) say(`   sautés : ${screensSkipped}`);
  else {
    if (S.uid !== P.owner || S.as !== 'authenticated') red(`écrans joués en tant que ${S.as} / ${S.uid} (attendu : authenticated / titulaire)`);
    const names = { accueil_30j: 'Accueil 30 j', soirees: 'Soirées', soiree: 'Soirée', ventes_soiree: 'Ventes · la soirée', ventes_90j: 'Ventes 90 j', qui_cibler: 'Qui cibler', plan_soiree: 'Plan de la soirée' };
    const parts = [];
    for (const [k, label] of Object.entries(names)) {
      const s = S[k];
      if (!s) continue;
      if (s.error) { red(`${label} : ${s.error}`); parts.push(`${label} ERREUR`); continue; }
      parts.push(`${label} ${ms(s.ms)}`);
      if (s.ms > SCREEN_RED_MS) red(`${label} : ${ms(s.ms)} (au-delà du délai de 8 s de l'API)`);
      else if (s.ms > SCREEN_WARN_MS) orange(`${label} : ${ms(s.ms)} (cible < 3 s)`);
    }
    say(`   ${parts.join(' · ')}`);
    const h = S.accueil_30j?.data;
    if (h) {
      say(`   Accueil, prochaine soirée : ${h.is_night ? 'la bonne' : 'UNE AUTRE'} · ${h.sold} vendus, ${h.today} aujourd'hui, ${h.left} restants, J-${h.days_to} · acheteurs ${JSON.stringify(h.buyers)} · comparée à « ${h.prev ?? '—'} »`);
      say(`   Courbe J-N (3 derniers points) : ${(h.curve ?? []).map((p) => `J-${p.jn} ${p.cur} (préc. ${p.prev})`).join(' · ')} · à faire : ${(h.todo ?? []).join(', ') || '—'}`);
      if (h.is_night === false && ev && now < startAt) orange('l\'Accueil ne montre pas la soirée du 29/10 comme prochaine soirée');
      if (h.is_night && Number(h.sold) !== Number(t.sales)) orange(`l'Accueil dit ${h.sold} vendus, la base ${t.sales}`);
    }
    const sd = S.soiree?.data;
    if (sd) {
      say(`   Soirée : ${sd.sold} vendus / ${sd.cap ?? '?'} · ${sd.today} aujourd'hui · CA ${sd.revenue ?? '—'} · relue ${ago(sd.synced_at, now)}`);
      if (Number(sd.sold) !== Number(t.sales)) orange(`l'écran Soirée dit ${sd.sold} vendus, la base ${t.sales}`);
    }
  }

  // 6. Écart avec le relevé précédent
  say();
  say('6. Depuis le relevé précédent');
  const prev = latestSnapshot();
  if (!prev) say('   premier relevé gardé ici');
  else {
    const pr = prev.read;
    const d = (a, b) => { const x = Number(a ?? 0) - Number(b ?? 0); return x > 0 ? `+${x}` : `${x}`; };
    say(`   depuis ${fmtDT(prev.at, true)} : ventes ${d(t.sales, pr.tickets?.sales)} (payants ${d(t.paid, pr.tickets?.paid)}, gratuits ${d(t.free, pr.tickets?.free)}) · acheteurs ${d(t.buyers, pr.tickets?.buyers)} · scannés ${d(t.scanned, pr.tickets?.scanned)} · restants Shotgun ${d(ev?.left_tickets, pr.event?.left_tickets)} · passes OK sur 24 h ${R.runs_24h?.by_status?.ok ?? 0} · familles confirmées ${d(conf.length, (pr.families?.list ?? []).filter((f) => f.status === 'supported').length)} · personnes notées ${d(ps.n, pr.person_scores?.n)}`);
  }

  // Verdict
  const reds = alerts.filter((a) => a.level === 'ROUGE');
  const oranges = alerts.filter((a) => a.level === 'ORANGE');
  const verdict = reds.length ? 'ROUGE' : oranges.length ? 'ORANGE' : 'VERT';
  const head = [
    `Relevé Yuno CRM — soirée du ${ev ? fmtDT(ev.start_at, true) : '?'} (Shotgun ${c?.org_name ?? '?'} dans l'espace Amoris) — ${fmtDT(R.now, true)} (Paris), ${phase}`,
    `Verdict : ${verdict}${alerts.length ? ` (${reds.length} rouge, ${oranges.length} orange)` : ''}`,
    ...alerts.map((a) => `  ${a.level === 'ROUGE' ? '🔴' : '🟠'} ${a.text}`),
    '',
  ];
  console.log([...head, ...lines].join('\n'));
}

if (!flag('no-save')) {
  mkdirSync(SNAP_DIR, { recursive: true });
  const name = `${R.now.replace(/[:.]/g, '-')}.json`;
  writeFileSync(join(SNAP_DIR, name), JSON.stringify(out));
}

function latestSnapshot() {
  if (!existsSync(SNAP_DIR)) return null;
  const files = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json')).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const s = JSON.parse(readFileSync(join(SNAP_DIR, files[i]), 'utf8'));
    if (s.params?.event === P.event) return s;
  }
  return null;
}
