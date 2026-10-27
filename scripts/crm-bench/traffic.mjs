#!/usr/bin/env node
// Banc de l'onglet Trafic du CRM (crm_ana_clicks, TRAFFIC_TAB_PLAN.md, lot C2).
//
//   node traffic.mjs [profil]     (demo par défaut ; `node run.mjs gen demo` avant)
//
// Le schéma du banc s'arrête avant les Scénarios (config.mjs) : les fonctions
// plus récentes que lit crm_ana_clicks sont recopiées de la prod (lecture
// seule), puis les migrations du Trafic sont rejouées depuis le dépôt. Le
// compte généré n'a ni lien ni clic : ce script les sème (graine fixe), puis
// mesure la lecture en mode période et en mode soirée, en tant que titulaire.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openSaved, execFile, timed, ROOT } from './lib.mjs';
import { prodQuery } from './prod.mjs';

const name = process.argv[2] || 'demo';
process.on('uncaughtException', (e) => { console.error(`ERREUR : ${e.message}${e.where ? `\n  où : ${e.where}` : ''}`); process.exit(1); });
const db = await openSaved(name);
const MIG = join(ROOT, 'supabase', 'migrations');

// Fonctions lues par le Trafic dont la version du banc est plus ancienne.
const FROM_PROD = ['_crm_ticket_is_sale', 'crm_campaign_is_crm', 'crm_link_source_for', 'crm_link_source',
  '_crm_ana_sends', '_link_base', '_crm_money_gate', 'crm_scope_allowed', 'crm_scope_rules', '_crm_night_date',
  '_crm_night_series', 'tracked_link_id_for_code', 'links_visitor_context', 'platform_parse_ua',
  '_crm_signup_state', '_crm_signup_close_at', '_crm_signup_is_demo', 'crm_space_display_name', '_crm_signup_event'];
await db.exec(`ALTER TABLE external_tickets ADD COLUMN IF NOT EXISTS deal_channel text;
  ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS product text;
  ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS product text;
  ALTER TABLE tracked_links ADD COLUMN IF NOT EXISTS partner_name text;
  ALTER TABLE tracked_links ADD COLUMN IF NOT EXISTS archived_at timestamptz;
  ALTER TABLE crm_signup_pages ADD COLUMN IF NOT EXISTS after_url text;`);
const defs = await prodQuery(`SELECT p.proname, pg_get_functiondef(p.oid) AS d FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[${FROM_PROD.map((f) => `'${f}'`).join(',')}])`);
for (const x of defs) {
  try { await db.exec(x.d); } catch (e) { console.log(`(prod) ${x.proname} : ${e.message}`); }
}
for (const f of readdirSync(MIG).filter((x) => /^2026111210/.test(x) || /^2026111211/.test(x)).sort()) {
  await execFile(db, join(MIG, f), f);
}

const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;

// ── Semis (déterministe) ─────────────────────────────────────────────────────
const SEED = `
SELECT setseed(0.42);
UPDATE external_tickets SET deal_channel = COALESCE(deal_channel, 'link');
-- Les miroirs des soirées du compte, avec leur page Shotgun.
UPDATE events SET external_source = COALESCE(external_source, 'shotgun'),
       external_ticket_url = COALESCE(external_ticket_url, 'https://shotgun.live/events/bench-' || left(id::text, 8))
 WHERE organizer_user_id = '${org}';

INSERT INTO tracked_links (id, code, label, owner_kind, organizer_user_id, created_by, target_kind, event_id,
                           utm_source, utm_medium, utm_campaign, partner_name, created_at, is_active, clicks_count)
SELECT gen_random_uuid(), 'b' || left(e.id::text, 6) || '-' || k.code, k.label, 'organizer', '${org}', '${org}', 'event', e.id,
       k.src, k.med, 'yuno', k.partner, e.start_at - make_interval(days => k.days), true, 0
  FROM events e
 CROSS JOIN (VALUES ('st1', 'Story 1', 'instagram', 'story', NULL, 30), ('st2', 'Story 2', 'instagram', 'story', NULL, 12),
                    ('bio', 'Bio', 'instagram', 'bio', NULL, 40), ('tt', 'Bio TikTok', 'tiktok', 'bio', NULL, 40),
                    ('wa', 'Groupe WhatsApp', 'whatsapp', 'group', NULL, 20), ('telos', 'Telos', 'other', 'partner', 'Telos', 18),
                    ('sms', 'SMS', 'sms', 'campaign', NULL, 10)) k(code, label, src, med, partner, days)
 WHERE e.organizer_user_id = '${org}' AND e.start_at > now() - interval '120 days';

-- Clics : un poids par emplacement, un rythme de la semaine et du soir.
INSERT INTO tracked_link_clicks (tracked_link_id, clicked_at, visitor_id, device_type, country, in_app)
SELECT l.id,
       LEAST(now() - interval '5 minutes', l.created_at + make_interval(secs => (random() * 86400 * 30)::int)),
       'a:' || md5(l.id::text || (random() * 900)::int::text),
       CASE WHEN random() < 0.9 THEN 'mobile' WHEN random() < 0.9 THEN 'desktop' ELSE 'tablet' END,
       CASE WHEN random() < 0.92 THEN 'FR' WHEN random() < 0.5 THEN 'BE' ELSE 'CH' END,
       CASE WHEN l.utm_source = 'instagram' THEN CASE WHEN random() < 0.63 THEN 'instagram' ELSE 'none' END
            WHEN random() < 0.2 THEN NULL ELSE 'none' END
  FROM tracked_links l
 CROSS JOIN LATERAL generate_series(1, CASE l.utm_medium WHEN 'story' THEN 60 WHEN 'bio' THEN 40 WHEN 'partner' THEN 25 ELSE 15 END) g;

-- Des billets portent le code de leur lien (le retour de Shotgun).
UPDATE external_tickets t SET utm = jsonb_build_object('utm_source', 'yuno-' || l.code, 'utm_medium', 'app')
  FROM tracked_links l
 WHERE l.event_id = t.event_id AND l.utm_medium IN ('story', 'bio', 'partner')
   AND abs(hashtext(t.id::text || l.code)) % 23 = 0;

-- E-mails CRM et leurs clics.
INSERT INTO email_campaigns (id, name, subject, venue_id, organizer_user_id, status, sent_at, event_id, product, created_at)
SELECT gen_random_uuid(), 'E-mail ' || left(e.title, 20), 'Bench', NULL, '${org}', 'sent', e.start_at - interval '9 days', e.id, 'crm', now()
  FROM events e WHERE e.organizer_user_id = '${org}' AND e.start_at > now() - interval '120 days';
INSERT INTO email_campaign_events (campaign_id, recipient_email, event_type, created_at, metadata)
SELECT c.id, 'p' || g || '@bench.test', 'clicked', c.sent_at + make_interval(secs => (random() * 86400 * 3)::int),
       jsonb_build_object('click', jsonb_build_object('link', e.external_ticket_url || '?utm_source=yuno-m-' || left(c.id::text, 8)))
  FROM email_campaigns c JOIN events e ON e.id = c.event_id
 CROSS JOIN generate_series(1, 80) g
 WHERE c.sent_at < now();

-- Une page d'inscription par soirée à venir, ses visites et ses inscrits.
INSERT INTO crm_signup_pages (id, organizer_user_id, slug, status, event_id, title, kind, created_by, published_at, created_at)
SELECT gen_random_uuid(), '${org}', 'bench-' || left(e.id::text, 8), 'live', e.id, 'Prévente ' || left(e.title, 20), 'prevente',
       '${org}', e.start_at - interval '30 days', e.start_at - interval '31 days'
  FROM events e WHERE e.organizer_user_id = '${org}' AND e.start_at > now();
INSERT INTO crm_signup_visits (page_id, day, visitor_hash, src, at)
SELECT p.id, (now() - make_interval(days => (g % 20)))::date, 'a:' || md5(p.id::text || g), (ARRAY['instagram-story', 'instagram-bio', 'flyer-qr', 'whatsapp', 'direct'])[1 + g % 5],
       now() - make_interval(days => (g % 20))
  FROM crm_signup_pages p CROSS JOIN generate_series(1, 200) g
ON CONFLICT DO NOTHING;
INSERT INTO crm_signup_entries (page_id, consent_text, first_name, email, src, created_at, confirmed_at)
SELECT p.id, 'Bench', 'Fan' || g, 'p' || g || '@bench.test', (ARRAY['instagram-story', 'instagram-bio', 'flyer-qr', 'whatsapp', 'direct'])[1 + g % 5],
       now() - make_interval(days => (g % 20)), CASE WHEN g % 9 <> 0 THEN now() END
  FROM crm_signup_pages p CROSS JOIN generate_series(1, 60) g
ON CONFLICT DO NOTHING;
`;
for (const st of SEED.split(/;\s*\n(?=\s*(?:--|[A-Z]))/).map((x) => x.trim()).filter((x) => x && !/^--[^\n]*$/.test(x))) {
  try { await db.exec(st); } catch (e) { console.log(`semis : ${e.message} ${e.column ? `(${e.table}.${e.column})` : ''}\n  ${st.replace(/^--.*\n/gm, '').slice(0, 90)}`); }
}

const n = await db.query(`SELECT (SELECT count(*) FROM tracked_links) l, (SELECT count(*) FROM tracked_link_clicks) c,
  (SELECT count(*) FROM email_campaign_events) e, (SELECT count(*) FROM crm_signup_visits) v`);
console.log('semis', n.rows[0]);

await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: org, role: 'authenticated' })]);
const up = (await db.query(`SELECT id FROM events WHERE organizer_user_id = $1 AND start_at > now() ORDER BY start_at LIMIT 1`, [org])).rows[0].id;

for (const [label, sql, args] of [
  ['période 30 j', `SELECT crm_ana_clicks(NULL, $1, '30d') AS r`, [org]],
  ['période 24 h', `SELECT crm_ana_clicks(NULL, $1, '24h') AS r`, [org]],
  ['période 12 mois', `SELECT crm_ana_clicks(NULL, $1, '12m') AS r`, [org]],
  ['soirée à venir', `SELECT crm_ana_clicks(NULL, $1, '30d', $2) AS r`, [org, up]],
]) {
  const r = await timed(db, sql, args);
  const o = r.rows[0].r;
  console.log(`\n== ${label} : ${r.ms} ms`);
  console.log(JSON.stringify({
    meta: { mode: o.meta.mode, n: o.meta.n, event: o.meta.event?.title, prev: o.meta.prev_event?.title },
    totals: o.totals, families: o.families, keep: o.keep, links: o.links.slice(0, 3), pages: o.pages.slice(0, 2),
    page_srcs: o.page_srcs, messages: { ...o.messages, rows: o.messages.rows.slice(0, 3) }, click_no_buy: o.click_no_buy,
    devices: o.devices, countries: o.countries, platform: o.platform, nights: o.nights.slice(0, 3),
    curve: o.curve ? { span: o.curve.span, today_d: o.curve.today_d, cur: o.curve.cur.slice(-6), prev: o.curve.prev?.slice(-6) } : null,
    marks: o.marks.slice(0, 4), series0: o.series?.[o.series.length - 1], hours: o.hours, confirmed: o.confirmed,
  }, null, 1));
}
