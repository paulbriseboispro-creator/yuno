#!/usr/bin/env node
// Lot « données » de l'audit du 18/10 (DATA-01, 02, 03, 05, 07, SYNC-03),
// rejoué au banc sur les définitions de la PROD : la même base synthétique est
// posée deux fois, sur les fonctions de la prod (avant) et sur les fonctions
// de la prod + les migrations 20261022… (après).
//
//   node prod.mjs --activity
//   node audit-data.mjs dump      # instantané des fonctions touchées + triggers (lecture seule)
//   node audit-data.mjs           # test (code 1 si une assertion tombe)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';
import { prodQuery } from './prod.mjs';

const SNAP = join(DATA, 'snapshot-audit-data.sql');
const TRIG = join(DATA, 'snapshot-audit-data-triggers.sql');
const ROOTS = join(DATA, 'audit-data-roots.txt');
const MIGS = ['20261022100000_crm_free_entry_needs_scan.sql', '20261022110000_crm_customer_spend_sales_only.sql',
  '20261022120000_ticketing_cohosted_toggle.sql', '20261022130000_ticketing_ticket_guards.sql']
  .map((f) => join(ROOT, 'supabase', 'migrations', f));
const FIXTURE = join(ROOT, 'src', 'crm', 'lib', '__tests__', 'fixtures', 'sale-counts-as-night.json');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['_crm_people_build', 'crm_client__core', '_crm_activity_build', 'crm_rules_preview', 'crm_home__core',
    'crm_night_detail__core', 'contact_scope_customers', 'crm_ticketing_set_cohosted', '_crm_erase_contacts',
    'external_tickets_note_provider_erasure', 'external_tickets_note_email_move', 'external_tickets_typed_fields',
    'ticketing_minimize_raw', 'crm_retention_sweep', 'ticketing_erasures', 'ticketing_email_moves', 'external_events',
    'marketing_consent_events', 'crm_prediction_people', 'crm_person_night_score', 'contact_base_cache_state',
    'contact_base_scope_key', 'crm_profile_optouts', 'crm_analysis_dirty', 'crm_person_profile'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  const trg = await prodQuery(`SELECT pg_get_triggerdef(t.oid) AS d FROM pg_trigger t
    WHERE t.tgrelid = 'public.external_tickets'::regclass AND NOT t.tgisinternal ORDER BY t.tgname`);
  writeFileSync(TRIG, trg.map((r) => `${r.d};`).join('\n') + '\n');
  console.log(`${trg.length} triggers → ${TRIG}`);
  process.exit(0);
}
if (!existsSync(SNAP) || !existsSync(TRIG)) throw new Error('lancer d\'abord « node audit-data.mjs dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const CONN = '22222222-0000-4000-8000-0000000000c1';
const day = 86400e3;
const iso = (d) => new Date(Date.now() + d * day).toISOString();
// Soirées : E1-E3 passées à porte mesurée, E4 passée à porte NON mesurée,
// E5 à venir, EC co-organisée (rôle « editor »), passée et mesurée.
const EV = {
  E1: ['eeeeeeee-0000-4000-8000-0000000000e1', -60], E2: ['eeeeeeee-0000-4000-8000-0000000000e2', -40],
  E3: ['eeeeeeee-0000-4000-8000-0000000000e3', -20], E4: ['eeeeeeee-0000-4000-8000-0000000000e4', -10],
  E5: ['eeeeeeee-0000-4000-8000-0000000000e5', 10], EC: ['eeeeeeee-0000-4000-8000-0000000000ec', -30],
};

async function open(withMigrations) {
  const db = await openFresh();
  await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
  await execFile(db, SNAP, 'snapshot');
  await execFile(db, TRIG, 'triggers');
  if (withMigrations) for (const m of MIGS) await execFile(db, m, m.split('/').pop());
  return db;
}

// Insère seulement les colonnes que l'instantané connaît (une table absente est sautée).
async function put(db, table, values) {
  const cols = (await db.query(`SELECT column_name AS c, is_nullable = 'NO' AS nn, column_default IS NOT NULL AS hasdef, data_type AS dt
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows;
  if (!cols.length) return;
  const row = {};
  for (const [k, v] of Object.entries(values)) if (cols.some((c) => c.c === k)) row[k] = v;
  for (const c of cols) if (c.nn && !c.hasdef && !(c.c in row)) row[c.c] = c.dt === 'uuid' ? crypto.randomUUID() : /int|numeric/.test(c.dt) ? 0 : c.dt === 'boolean' ? false : /timestamp/.test(c.dt) ? new Date().toISOString() : /json/.test(c.dt) ? '{}' : 'x';
  const keys = Object.keys(row);
  await db.query(`INSERT INTO public.${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => row[k]));
}

async function seed(db) {
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'a@bench.test')`, [A]);
  await put(db, 'profiles', { id: A, email: 'a@bench.test', profile_type: 'organizer', first_name: 'A' });
  await put(db, 'organizer_profiles', { user_id: A, name: 'Espace A', organization_name: 'Espace A', product: 'crm', slug: 'espace-a' });
  await put(db, 'crm_subscriptions', { scope_key: `org:${A}`, status: 'active', plan: 'base', trial_ends_at: iso(30) });
  await put(db, 'crm_settings', { scope_key: `org:${A}` });
  await db.query(`INSERT INTO public.ticketing_connections (id, organizer_user_id, provider, external_org_id, status, include_cohosted,
      tickets_cursor, events_synced_at, initial_import_done_at, next_sync_at, sync_interval_minutes, vault_secret_id)
    VALUES ($1, $2, 'shotgun', '123', 'active', true, '2026-10-18 10:00:00_1', now(), now() - interval '30 days', now() + interval '10 minutes', 15, gen_random_uuid())`, [CONN, A]);
  for (const [k, [id, d]] of Object.entries(EV)) {
    await db.query(`INSERT INTO public.events (id, organizer_user_id, title, start_at, end_at, external_source, is_active, status)
      VALUES ($1, $2, $3, $4, $4::timestamptz + interval '6 hours', 'shotgun', false, 'active')`, [id, A, `Soirée ${k}`, iso(d)]);
    await db.query(`INSERT INTO public.external_events (connection_id, external_id, event_id, organizer_user_id, provider, name, start_at, external_role)
      VALUES ($1, $2, $3, $4, 'shotgun', $5, $6, $7)`, [CONN, k, id, A, `Soirée ${k}`, iso(d), k === 'EC' ? 'editor' : 'organizer']);
  }
  let n = 0;
  const tk = async (ev, email, { price = 0, scanned = false, status = 'valid', channel = 'online', bought = null } = {}) => {
    const [id, d] = EV[ev];
    await db.query(`INSERT INTO public.external_tickets (connection_id, external_id, external_event_id, event_id, organizer_user_id, provider,
        status, price, quantity, currency, buyer_email, buyer_first_name, purchased_at, scanned_at, deal_channel, newsletter_optin,
        source_updated_at, synced_at, first_seen_at)
      VALUES ($1, $2, $3, $4, $5, 'shotgun', $6, $7, 1, 'EUR', $8, 'Prénom', $9, $10, $11, true, $9, now(), $9)`,
      [CONN, `t${++n}`, ev, id, A, status, price, email, bought ?? iso(Math.min(d - 5, -0.1)), scanned ? iso(d + 0.1) : null, channel]);
  };
  // Portes mesurées : 12 billets payants scannés sur 20 par soirée E1-E3 et EC.
  for (const ev of ['E1', 'E2', 'E3', 'EC']) for (let i = 0; i < 20; i++) await tk(ev, `filler${i}@x.test`, { price: 10, scanned: i < 12 });
  // E4 : porte non mesurée (aucun scan).
  for (let i = 0; i < 5; i++) await tk('E4', `filler${i}@x.test`, { price: 10 });
  // Les personnes testées.
  for (const ev of ['E1', 'E2', 'E3']) await tk(ev, 'free.noshow@x.test');                    // gratuit jamais venu ×3
  for (const ev of ['E1', 'E2', 'E3']) await tk(ev, 'free.came@x.test', { scanned: true });   // gratuit venu ×3
  await tk('E4', 'free.unmeasured@x.test');                                                     // gratuit, porte non mesurée
  await tk('E1', 'paid.noshow@x.test', { price: 15 });                                          // payant non scanné
  await tk('E1', 'free.upcoming@x.test'); await tk('E5', 'free.upcoming@x.test', { price: 15 });// absent puis place à venir
  await tk('E1', 'inv.came@x.test', { channel: 'invitation', scanned: true });                  // invitation scannée
  await tk('E5', 'free.noshow@x.test', { price: 15 });                                          // reprend une place payante pour E5
  // DATA-03 : revendu, invitation à prix, duplicata.
  await tk('E2', 'spend@x.test', { price: 20 });
  await tk('E2', 'spend@x.test', { price: 30, status: 'transferred' });
  await tk('E3', 'spend@x.test', { price: 25, channel: 'invitation' });
  await tk('E3', 'spend@x.test', { price: 40, channel: 'duplicata' });
  // DATA-05 : soirée co-organisée.
  await tk('EC', 'cohost.only@x.test', { price: 10, scanned: true });
  await tk('EC', 'both@x.test', { price: 10, scanned: true });
  await tk('E2', 'both@x.test', { price: 10, scanned: true });
  for (const em of ['cohost.only@x.test', 'both@x.test']) {
    await db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source) VALUES ($1, $2, true, 'connector:shotgun')`, [A, em]);
  }
  await db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source) VALUES ($1, 'cohost.page@x.test', true, 'signup_page:p1')`, [A]);
}

async function asUser(db) {
  await db.query(`SELECT set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)`,
    [JSON.stringify({ sub: A, role: 'authenticated', email: 'a@bench.test' }), A]);
}
async function asService(db) {
  await db.query(`SELECT set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', '', false)`,
    [JSON.stringify({ role: 'service_role' })]);
}

async function people(db, light = false) {
  await db.exec('BEGIN');
  await db.query(`SELECT public._crm_people_build(NULL, $1::uuid, NULL, $2::boolean)`, [A, light]);
  const rows = (await db.query(`SELECT email, nights, nights_win, lifecycle, source FROM _cp`)).rows;
  await db.exec('COMMIT');
  return Object.fromEntries(rows.map((r) => [r.email, r]));
}
async function json(db, sql, params = []) {
  await db.exec('BEGIN');
  try { return (await db.query(sql, params)).rows[0]?.j ?? null; } finally { await db.exec('COMMIT'); }
}

process.on('uncaughtException', (e) => { console.error(`ERREUR ${e.code ?? ''} ${e.message}${e.where ? ` — ${e.where.split('\n')[0]}` : ''}`); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error(`ERREUR ${e?.code ?? ''} ${e?.message}${e?.where ? ` — ${e.where.split('\n')[0]}` : ''}`); process.exit(2); });

// ── Les cas partagés de la porte pure (miroir TS) ───────────────────────────
const after = await open(true);
const cases = JSON.parse(readFileSync(FIXTURE, 'utf8')).cases;
let bad = 0;
for (const [p, s, m, want] of cases) {
  const got = (await after.query(`SELECT public._crm_sale_counts_as_night($1::numeric, $2::boolean, $3::boolean) AS v`, [p, s, m])).rows[0].v;
  if (got !== want) { bad++; console.log('  écart', p, s, m, got, want); }
}
check(`_crm_sale_counts_as_night = saleCountsAsNight sur les ${cases.length} cas partagés`, bad === 0);

// ── DATA-02 : soirées faites ────────────────────────────────────────────────
const before = await open(false);
await seed(before); await seed(after);
await asService(before); await asService(after);
const pb = await people(before);
const pa = await people(after);
check('avant : un gratuit jamais venu sur porte mesurée compte 3 soirées (faille reproduite)', pb['free.noshow@x.test']?.nights === 3, JSON.stringify(pb['free.noshow@x.test']));
check('après : il ne compte plus aucune soirée', pa['free.noshow@x.test']?.nights === 0, JSON.stringify(pa['free.noshow@x.test']));
check('après : il n\'est plus habitué ; sa place à venir en fait un « nouveau »', pa['free.noshow@x.test']?.lifecycle === 'nou');
check('après : sa provenance reste Shotgun (il avait une place)', pa['free.noshow@x.test']?.source === pb['free.noshow@x.test']?.source, `${pb['free.noshow@x.test']?.source} → ${pa['free.noshow@x.test']?.source}`);
check('après : un gratuit VENU garde ses 3 soirées et reste habitué', pa['free.came@x.test']?.nights === 3 && pa['free.came@x.test']?.lifecycle === 'hab');
check('après : porte non mesurée, l\'entrée gratuite compte toujours', pa['free.unmeasured@x.test']?.nights === 1);
check('après : un billet payant non scanné compte toujours', pa['paid.noshow@x.test']?.nights === 1);
check('après : une invitation scannée compte toujours', pa['inv.came@x.test']?.nights === 1);
check('après : absent puis place à venir = « nouveau »', pa['free.upcoming@x.test']?.nights === 0 && pa['free.upcoming@x.test']?.lifecycle === 'nou');
const same = Object.keys(pb).filter((e) => !['free.noshow@x.test', 'free.upcoming@x.test'].includes(e))
  .filter((e) => JSON.stringify(pb[e]) !== JSON.stringify(pa[e]));
check('après : toutes les autres personnes sont identiques', same.length === 0, same.join(', '));
const pl = await people(after, true);
const lightDiff = Object.keys(pa).filter((e) => pa[e].nights !== pl[e]?.nights || pa[e].lifecycle !== pl[e]?.lifecycle);
check('après : la base légère (Communauté, Clients) compte pareil', lightDiff.length === 0, lightDiff.join(', '));

await asUser(before); await asUser(after);
const fiche = async (db) => json(db, `SELECT public.crm_client__core(NULL, $1::uuid, 'free.noshow@x.test') AS j`, [A]);
const fb = await fiche(before); const fa = await fiche(after);
const months = (f) => (f?.months ?? []).reduce((s, m) => s + Number(m.n), 0);
check('fiche client : soirées par mois, les 3 soirées où il n\'est pas venu disparaissent', months(fb) - months(fa) === 3, `${months(fb)} → ${months(fa)}`);
check('fiche client : nights suit la base', fa?.nights === 0 && fb?.nights === 3);

const prev = async (db) => json(db, `SELECT public.crm_rules_preview(NULL, $1::uuid) AS j`, [A]);
const rb = await prev(before); const ra = await prev(after);
check('aperçu des règles : « venus » baisse du seul gratuit jamais venu', rb?.came - ra?.came === 2, `${rb?.came} → ${ra?.came}`);

const home = async (db) => json(db, `SELECT public.crm_home__core(NULL, $1::uuid, '30d') AS j`, [A]);
const hb = await home(before); const ha = await home(after);
const regs = (h) => h?.kpi?.regulars?.total;
check('Accueil : habitués, le gratuit jamais venu n\'en est plus un', regs(hb) - regs(ha) === 1, `${regs(hb)} → ${regs(ha)}`);
const nb = hb?.next?.buyers; const na = ha?.next?.buyers;
check('Accueil : acheteurs de la prochaine soirée, « nouveaux » +2 (absents reclassés)', na?.new - nb?.new === 2, `${JSON.stringify(nb)} → ${JSON.stringify(na)}`);

const night = async (db) => json(db, `SELECT public.crm_night_detail__core(NULL, $1::uuid, $2::uuid) AS j`, [A, EV.E5[0]]);
const db5 = await night(before); const da5 = await night(after);
check('Volet de soirée : mêmes classements que l\'Accueil', da5?.buyers?.new === na?.new && da5?.buyers?.regular === na?.regulars
  && da5?.buyers?.occasional === na?.occasional && da5?.buyers?.new - db5?.buyers?.new === 2, `${JSON.stringify(db5?.buyers)} → ${JSON.stringify(da5?.buyers)}`);

// ── DATA-03 : dépense de la base de contacts ────────────────────────────────
await asService(before); await asService(after);
const spend = async (db) => (await db.query(`SELECT spent::float AS s FROM public.contact_scope_customers(NULL, $1::uuid) WHERE email = 'spend@x.test'`, [A])).rows[0]?.s;
check('avant : revendu + invitation + duplicata comptés (115 €, faille)', (await spend(before)) === 115);
check('après : seule la vente compte (20 €)', (await spend(after)) === 20);
const members = async (db) => (await db.query(`SELECT count(*)::int AS n FROM public.contact_scope_customers(NULL, $1::uuid)`, [A])).rows[0].n;
check('après : l\'appartenance ne change pas', (await members(before)) === (await members(after)));

// ── DATA-05 : soirées co-organisées ─────────────────────────────────────────
await asUser(before); await asUser(after);
const counts = async (db) => (await db.query(`SELECT
    (SELECT count(*)::int FROM public.external_tickets WHERE external_event_id = 'EC') AS tickets,
    (SELECT count(*)::int FROM public.external_events WHERE external_id = 'EC') AS events,
    (SELECT count(*)::int FROM public.events WHERE id = $1) AS mirror,
    (SELECT string_agg(email || ':' || opted_in, ',' ORDER BY email) FROM public.newsletter_subscriptions WHERE organizer_user_id = $2) AS subs`, [EV.EC[0], A])).rows[0];
await before.query(`SELECT public.crm_ticketing_set_cohosted(NULL, $1::uuid, false)`, [A]);
const cb = await counts(before);
check('avant : éteindre ne retire rien (faille reproduite)', cb.tickets === 22 && cb.mirror === 1);
await after.exec(`UPDATE public.ticketing_connections SET locked_until = now() + interval '1 minute'`);
const busy = await json(after, `SELECT public.crm_ticketing_set_cohosted(NULL, $1::uuid, false) AS j`, [A]);
check('après : refusé pendant une lecture', busy?.error === 'sync_running');
await after.exec(`UPDATE public.ticketing_connections SET locked_until = NULL`);
const off = await json(after, `SELECT public.crm_ticketing_set_cohosted(NULL, $1::uuid, false) AS j`, [A]);
const ca = await counts(after);
check('après : éteindre retire billets, soirée et miroir', ca.tickets === 0 && ca.events === 0 && ca.mirror === 0, JSON.stringify(off));
check('après : l\'accord de la personne venue SEULEMENT par la soirée co-organisée est retiré', !/cohost\.only/.test(ca.subs ?? ''), ca.subs);
check('après : l\'accord d\'une personne qui garde un billet propre reste', /both@x\.test:true/.test(ca.subs ?? ''));
check('après : un accord donné sur une page reste', /cohost\.page@x\.test:true/.test(ca.subs ?? ''));
const trace = (await after.query(`SELECT count(*)::int AS n FROM public.marketing_consent_events WHERE wording_key = 'connector_cohosted_off'`)).rows[0].n;
check('après : le retrait est tracé', trace === 1, `traces=${trace}`);
const on = await json(after, `SELECT public.crm_ticketing_set_cohosted(NULL, $1::uuid, true) AS j`, [A]);
const cur = (await after.query(`SELECT tickets_cursor, events_synced_at, next_sync_at <= now() + interval '1 second' AS soon FROM public.ticketing_connections`)).rows[0];
check('après : rallumer relit tout (curseur et soirées remis à zéro, lecture tout de suite)', on?.reread === true && cur.tickets_cursor === null && cur.events_synced_at === null && cur.soon);
const again = await json(after, `SELECT public.crm_ticketing_set_cohosted(NULL, $1::uuid, true) AS j`, [A]);
check('après : redemander la même valeur ne fait rien', again?.ok === true && again?.reread === undefined);

// ── DATA-01 / DATA-07 / SYNC-03 : écritures du connecteur ───────────────────
await asService(before); await asService(after);
// synced_at fourni par le banc, toujours croissant : l'horloge de PGlite ne
// distingue pas deux écritures dans la même milliseconde.
let tick = 0;
const upsert = (db, id, email, extra = {}) => db.query(`
  INSERT INTO public.external_tickets (connection_id, external_id, external_event_id, organizer_user_id, provider, status, price, quantity,
     buyer_email, buyer_first_name, newsletter_optin, source_updated_at, synced_at ${extra.unreadable !== undefined ? ', buyer_email_unreadable' : ''})
  VALUES ($1, $2, 'E2', $3, 'shotgun', $4, 10, 1, $5, 'Prénom', true, $6, $7 ${extra.unreadable !== undefined ? ', $8' : ''})
  ON CONFLICT (connection_id, external_id) DO UPDATE SET status = EXCLUDED.status, buyer_email = EXCLUDED.buyer_email,
     buyer_first_name = EXCLUDED.buyer_first_name, newsletter_optin = EXCLUDED.newsletter_optin,
     source_updated_at = EXCLUDED.source_updated_at, synced_at = EXCLUDED.synced_at
     ${extra.unreadable !== undefined ? ', buyer_email_unreadable = EXCLUDED.buyer_email_unreadable' : ''}`,
  [CONN, id, A, extra.status ?? 'valid', email, extra.at ?? iso(0), iso(1 + ++tick / 1440), ...(extra.unreadable !== undefined ? [extra.unreadable] : [])]);
const row = async (db, id) => (await db.query(`SELECT buyer_email, buyer_first_name, status FROM public.external_tickets WHERE external_id = $1`, [id])).rows[0];

// DATA-01
for (const db of [before, after]) {
  await upsert(db, 'old1', 'old@x.test', { at: iso(-800) });
  await db.query(`SELECT public._crm_erase_contacts(NULL, $1::uuid, ARRAY['old@x.test'])`, [A]);
  await upsert(db, 'old1', 'old@x.test', { at: iso(-1) });         // Shotgun renvoie le billet
  await upsert(db, 'new1', 'old@x.test', { at: iso(-1) });         // et un NOUVEL achat
}
check('avant : un billet effacé que Shotgun renvoie retrouve son identité (faille)', (await row(before, 'old1')).buyer_email === 'old@x.test');
check('après : il reste anonyme', (await row(after, 'old1')).buyer_email === null && (await row(after, 'old1')).buyer_first_name === null);
check('après : un nouvel achat de la même personne entre normalement', (await row(after, 'new1')).buyer_email === 'old@x.test');

// DATA-07
await upsert(before, 'mal1', 'mal@x.test', { at: iso(-5) });
await upsert(before, 'mal1', null, { at: iso(-4) });               // ancien connecteur : adresse mal formée → null
await upsert(after, 'mal1', 'mal@x.test', { at: iso(-5), unreadable: false });
await upsert(after, 'mal1', null, { at: iso(-4), unreadable: true });
const erasures = async (db) => (await db.query(`SELECT count(*)::int AS n FROM public.ticketing_erasures WHERE email = 'mal@x.test'`)).rows[0].n;
check('avant : une adresse mal formée vaut effacement (faille)', (await erasures(before)) === 1);
check('après : l\'adresse précédente est gardée, rien n\'est effacé', (await row(after, 'mal1')).buyer_email === 'mal@x.test' && (await erasures(after)) === 0);
await upsert(after, 'mal1', null, { at: iso(-3), unreadable: false });
check('après : un champ vraiment vide reste un effacement', (await row(after, 'mal1')).buyer_email === null && (await erasures(after)) === 1);

// SYNC-03
for (const db of [before, after]) {
  await upsert(db, 'v1', 'v@x.test', { at: iso(-1), status: 'refunded' });
  await upsert(db, 'v1', 'v@x.test', { at: iso(-2), status: 'valid' });   // version plus ancienne, arrivée après
}
check('avant : une version plus ancienne écrase la plus récente (faille)', (await row(before, 'v1')).status === 'valid');
check('après : la plus récente reste', (await row(after, 'v1')).status === 'refunded');
await upsert(after, 'v1', 'v@x.test', { at: iso(0), status: 'valid' });
check('après : une version plus récente passe', (await row(after, 'v1')).status === 'valid');

// ── Retour arrière (ROLLBACK-data.sql) : revient aux définitions de la prod ─
const back = await open(true);
await execFile(back, join(ROOT, 'docs', 'audit', '2026-10-18-crm-readiness', 'ROLLBACK-data.sql'), 'ROLLBACK-data.sql');
await seed(back); await asService(back);
const pr = await people(back);
check('retour arrière : la base des personnes redevient celle de la prod', JSON.stringify(pr) === JSON.stringify(pb));
await asService(back);
check('retour arrière : la dépense redevient celle de la prod', (await spend(back)) === 115);

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
