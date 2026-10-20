#!/usr/bin/env node
// Isolation Yuno CRM ⇄ Billetterie, registre de consentement (migration 20261107140000) :
// avant / après sur les définitions de la PROD, rejouées dans PGlite.
//
//   node audit-consents-isolation.mjs dump   # instantané de la prod (lecture seule, définitions seulement)
//   node audit-consents-isolation.mjs        # test
//
// Ce que le test prouve : une audience e-mail de la Billetterie ne contient plus un abonné dont l'accord vient du
// connecteur (source connector:%) — « tous les abonnés », « VIP… » — pendant que la même audience d'une campagne du CRM
// (product = 'crm') garde ces accords ; les compteurs de l'écran disent la même chose que la résolution de l'envoi ;
// une adresse qui a un accord Yuno ET une ligne connecteur n'existe pas (une ligne par adresse) ; rien d'autre ne change.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-consents.sql');
const ROOTS = join(DATA, 'audit-consents-roots.txt');
const MIG_CONTACTS = join(ROOT, 'supabase', 'migrations', '20261107120000_crm_billetterie_isolation_contacts.sql');
const MIG = join(ROOT, 'supabase', 'migrations', '20261107140000_crm_billetterie_isolation_consents.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, [
    'resolve_campaign_audience', 'collect_email_automations', 'count_campaign_recipients', 'count_organizer_audience_kinds', 'crm_campaign_is_crm', 'contact_scope_customers',
    'contact_rows', 'contact_build_rows', 'count_contact_segment_def', 'marketing_scope_match', 'email_campaigns', 'newsletter_subscriptions',
    'tickets', 'events', 'table_reservations', 'guest_list_entries', 'guest_lists', 'email_suppressions', 'organizer_profiles', 'venues', 'contact_segments',
    'imported_contacts', 'contact_engagement', 'external_tickets', 'crm_scope_is_crm', 'crm_scope_key', 'crm_scope_has_crm', 'account_products',
    '_crm_campaign_audience', 'crm_home__core', '_crm_admin_rows', '_mcp_tool', '_crm_people_build', '_crm_ana_setup', 'refresh_contact_engagement',
    '_contact_base_cache_build', 'contact_base_cache_invalidate', '_crm_erase_contacts', 'ticketing_apply_erasures', '_ticketing_drop_cohosted', 'ticketing_after_sync',
  ].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error("lancer d'abord « node audit-consents-isolation.mjs dump »");

process.on('uncaughtException', (e) => { console.error('ERREUR :', String(e.message).slice(0, 500)); process.exit(2); });
let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
await db.exec(`DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.conrelid::regclass AS t, c.conname FROM pg_constraint c JOIN pg_class k ON k.oid = c.conrelid JOIN pg_namespace n ON n.oid = k.relnamespace
            WHERE n.nspname = 'public' AND c.contype IN ('f', 'c') LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname); END LOOP;
  FOR r IN SELECT a.attrelid::regclass AS t, a.attname FROM pg_attribute a JOIN pg_class k ON k.oid = a.attrelid JOIN pg_namespace n ON n.oid = k.relnamespace
            WHERE n.nspname = 'public' AND k.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef AND a.attname <> 'id' LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.t, r.attname); END LOOP;
  FOR r IN SELECT tgname, tgrelid::regclass AS t FROM pg_trigger WHERE NOT tgisinternal LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.t); END LOOP; END $$;`);

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const O1 = U(1);
const q = async (sql, p) => (await db.query(sql, p)).rows;
await db.exec(`SET SESSION AUTHORIZATION postgres`);
await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
await db.query(`INSERT INTO public.organizer_profiles (user_id, display_name, product, extra_products) VALUES ($1, 'Dual', 'suite', ARRAY['crm'])`, [O1]);
await db.query(`INSERT INTO public.events (id, organizer_user_id, title, start_at, end_at) VALUES ($1, $2, 'Yuno 1', now() - interval '20 days', now() - interval '20 days' + interval '6 hours')`, [U(11), O1]);
// Registre : a (Yuno), f (accord Shotgun), k (accord Shotgun) ; a et k ont acheté chez Yuno (VIP : dépense >= 500)
await db.query(`INSERT INTO public.newsletter_subscriptions (id, organizer_user_id, email, opted_in, source, unsubscribe_token, created_at, updated_at) VALUES
  (gen_random_uuid(), $1, 'a@x.test', true, 'ticket_purchase', gen_random_uuid(), now() - interval '19 days', now() - interval '19 days'),
  (gen_random_uuid(), $1, 'f@x.test', true, 'connector:shotgun', gen_random_uuid(), now() - interval '9 days', now() - interval '9 days'),
  (gen_random_uuid(), $1, 'k@x.test', true, 'connector:shotgun', gen_random_uuid(), now() - interval '19 days', now() - interval '19 days')`, [O1]);
await db.query(`INSERT INTO public.tickets (id, event_id, user_email, total_price, service_fee, insurance_fee, paid_at, created_at, status, quantity) VALUES
  (gen_random_uuid(), $1, 'a@x.test', 600, 1, 0, now() - interval '19 days', now() - interval '19 days', 'paid', 1),
  (gen_random_uuid(), $1, 'k@x.test', 700, 1, 0, now() - interval '19 days', now() - interval '19 days', 'paid', 1)`, [U(11)]);
const camp = (id, product, atype, aj) => db.query(
  `INSERT INTO public.email_campaigns (id, organizer_user_id, name, audience_type, audiences_json, status, product, subject) VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6, 's')`,
  [id, O1, id, atype, JSON.stringify(aj), product]);
await camp(U(21), null, 'all_subscribers', []);          // Billetterie, v1 « tous les abonnés »
await camp(U(22), 'crm', 'all_subscribers', []);         // campagne du CRM (même audience)
await camp(U(23), null, 'vip', []);                      // Billetterie, VIP (dépense >= 500)
await camp(U(24), null, 'all_subscribers', [{ kind: 'all_subscribers' }]);   // v2
const aud = async (id) => (await q(`SELECT lower(a.email) AS e FROM public.resolve_campaign_audience($1::uuid) a ORDER BY 1`, [id])).map((r) => r.e).join(',');

const before = { all: await aud(U(21)), crm: await aud(U(22)), vip: await aud(U(23)), v2: await aud(U(24)) };
console.log('AVANT', JSON.stringify(before));
check('avant : « tous les abonnés » de la Billetterie inclut les accords Shotgun', before.all === 'a@x.test,f@x.test,k@x.test', before.all);

await db.exec(readFileSync(MIG_CONTACTS, 'utf8').replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, ''));
await db.exec(readFileSync(MIG, 'utf8').replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, ''));

const after = { all: await aud(U(21)), crm: await aud(U(22)), vip: await aud(U(23)), v2: await aud(U(24)) };
console.log('APRÈS', JSON.stringify(after));
check('Billetterie · « tous les abonnés » (v1) : plus d\'accord Shotgun', after.all === 'a@x.test', after.all);
check('Billetterie · « tous les abonnés » (v2) : idem', after.v2 === 'a@x.test', after.v2);
check('Billetterie · VIP : un acheteur Shotgun qui a aussi acheté chez Yuno n\'est pas ciblé (accord Shotgun)', after.vip === 'a@x.test', after.vip);
check('CRM · la campagne du CRM garde les accords du connecteur', after.crm === before.crm, after.crm);

// Les compteurs de l'écran et le moteur des recettes tournent sans erreur (plpgsql ne se compile qu'à l'appel).
try {
  const kinds = await q(`SELECT public.count_organizer_audience_kinds($1::uuid, NULL) AS j`, [O1]);
  check('Billetterie · count_organizer_audience_kinds tourne', kinds.length === 1, JSON.stringify(kinds[0].j).slice(0, 120));
} catch (e) { check('Billetterie · count_organizer_audience_kinds tourne', false, e.message.slice(0, 160)); }
try {
  await db.query(`INSERT INTO public.email_automations (id, organizer_user_id, kind, enabled, enabled_at, delay_hours, template_id, subject) VALUES (gen_random_uuid(), $1, 'last_call', true, now() - interval '30 days', 24, gen_random_uuid(), 's')`, [O1]);
  await db.query(`SELECT public.collect_email_automations()`);
  check('moteur des recettes : collect_email_automations tourne sur un compte à deux produits', true);
} catch (e) { check('moteur des recettes : collect_email_automations tourne', false, e.message.slice(0, 200)); }

console.log(failed ? `\n${failed} ÉCHEC(S)` : '\ntout est vérifié');
process.exit(failed ? 1 : 0);
