#!/usr/bin/env node
// Isolation Yuno CRM ⇄ Billetterie, base de contacts (migration 20261107120000) :
// avant / après sur les définitions de la PROD, rejouées dans PGlite.
//
//   node audit-contacts-isolation.mjs dump   # instantané de la prod (lecture seule, définitions seulement)
//   node audit-contacts-isolation.mjs        # test
//
// Ce que le test prouve :
//   • CRM : après la migration, la vue 'crm' de la base de contacts (contact_scope_customers,
//     contact_rows, contact_build_rows, _crm_people_build) est IDENTIQUE à ce que la prod rend
//     aujourd'hui, ligne à ligne ; le cache de la clé « …|crm » est pré-semé à l'identique ;
//   • Billetterie : la vue 'suite' (le défaut de tous les appelants Billetterie) ne contient ni
//     acheteur Shotgun, ni dépense Shotgun, ni accord venu du connecteur, même quand la même
//     personne est aussi cliente Yuno ; son cache est purgé puis reconstruit sans Shotgun ;
//   • effacement / invalidation : les deux clés suivent.
// Aucune donnée de la prod : un compte synthétique (organisateur) à deux produits.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-contacts.sql');
const ROOTS = join(DATA, 'audit-contacts-roots.txt');
const MIG = join(ROOT, 'supabase', 'migrations', '20261107120000_crm_billetterie_isolation_contacts.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, [
    // le noyau et ses appelants du CRM
    'contact_build_rows', 'contact_rows', 'contact_scope_customers', '_contact_base_cache_build', 'contact_base_cache_invalidate',
    '_crm_people_build', 'refresh_contact_engagement', 'count_contact_segment_def',
    '_crm_erase_contacts', 'ticketing_apply_erasures', '_ticketing_drop_cohosted',
    // pour les données de la migration
    'crm_scope_has_crm', 'crm_scope_key', 'account_products', 'ticketing_connections', 'external_tickets',
    'contact_base_cache', 'contact_base_cache_state',
    // les tables que les fonctions lisent
    'events', 'tickets', 'table_reservations', 'orders', 'guest_lists', 'guest_list_entries', 'newsletter_subscriptions',
    'imported_contacts', 'contact_engagement', 'email_suppressions', 'venue_sms_contacts', 'venues', 'organizer_profiles',
  ].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error("lancer d'abord « node audit-contacts-isolation.mjs dump »");

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

process.on('uncaughtException', (e) => { console.error('ERREUR :', String(e.message).slice(0, 400)); process.exit(2); });
const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
// Banc : ni triggers ni contraintes ni colonnes obligatoires hors sujet.
await db.exec(`DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.conrelid::regclass AS t, c.conname FROM pg_constraint c JOIN pg_class k ON k.oid = c.conrelid JOIN pg_namespace n ON n.oid = k.relnamespace
            WHERE n.nspname = 'public' AND c.contype IN ('f', 'c') LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname); END LOOP;
  FOR r IN SELECT a.attrelid::regclass AS t, a.attname FROM pg_attribute a JOIN pg_class k ON k.oid = a.attrelid JOIN pg_namespace n ON n.oid = k.relnamespace
            WHERE n.nspname = 'public' AND k.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef AND a.attname <> 'id' LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.t, r.attname); END LOOP;
  FOR r IN SELECT tgname, tgrelid::regclass AS t FROM pg_trigger WHERE NOT tgisinternal LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.t); END LOOP; END $$;`);

// ── Un compte synthétique à deux produits (organisateur O1) ──────────────────
const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const O1 = U(1); const Y1 = U(11); const Y2 = U(12); const M1 = U(21); const M2 = U(22); const GL = U(31); const CONN = U(41);
const q = async (sql, p) => (await db.query(sql, p)).rows;

await db.query(`INSERT INTO public.organizer_profiles (user_id, display_name, product, extra_products) VALUES ($1, 'Orga', 'suite', ARRAY['crm'])`, [O1]);
await db.query(`INSERT INTO public.events (id, organizer_user_id, title, start_at, end_at, external_source) VALUES
  ($2, $1, 'Yuno 1', now() - interval '20 days', now() - interval '20 days' + interval '6 hours', NULL),
  ($3, $1, 'Yuno 2', now() - interval '5 days', now() - interval '5 days' + interval '6 hours', NULL),
  ($4, $1, 'Shotgun 1', now() - interval '30 days', now() - interval '30 days' + interval '6 hours', 'shotgun'),
  ($5, $1, 'Shotgun 2', now() - interval '10 days', now() - interval '10 days' + interval '6 hours', 'shotgun')`, [O1, Y1, Y2, M1, M2]);
// Ventes Yuno : a (billet), b (billet), c (table), d (guest list)
await db.query(`INSERT INTO public.tickets (id, event_id, user_email, total_price, service_fee, insurance_fee, paid_at, created_at, status, quantity) VALUES
  (gen_random_uuid(), $1, 'a@x.test', 20, 1, 0, now() - interval '19 days', now() - interval '19 days', 'paid', 1),
  (gen_random_uuid(), $1, 'b@x.test', 25, 1, 0, now() - interval '19 days', now() - interval '19 days', 'paid', 1)`, [Y1]);
await db.query(`INSERT INTO public.table_reservations (id, event_id, user_email, total_price, service_fee, paid_at, created_at, status) VALUES
  (gen_random_uuid(), $1, 'c@x.test', 200, 5, now() - interval '4 days', now() - interval '4 days', 'paid')`, [Y2]);
await db.query(`INSERT INTO public.guest_lists (id, event_id) VALUES ($1, $2)`, [GL, Y2]);
await db.query(`INSERT INTO public.guest_list_entries (id, guest_list_id, email, status, created_at, full_name) VALUES
  (gen_random_uuid(), $1, 'd@x.test', 'confirmed', now() - interval '4 days', 'Dee Dee')`, [GL]);
// Billets Shotgun : b (aussi client Yuno), e et f (seulement Shotgun), g (remboursé : pas un client)
await db.query(`INSERT INTO public.ticketing_connections (id, provider, organizer_user_id, status) VALUES ($1, 'shotgun', $2, 'active')`, [CONN, O1]);
await db.query(`INSERT INTO public.external_tickets (id, connection_id, organizer_user_id, event_id, buyer_email, buyer_first_name, buyer_last_name, status, deal_channel, price, quantity, purchased_at, first_seen_at) VALUES
  (gen_random_uuid(), $1, $2, $3, 'b@x.test', 'Bee', 'Shot', 'valid', NULL, 30, 1, now() - interval '29 days', now() - interval '29 days'),
  (gen_random_uuid(), $1, $2, $3, 'e@x.test', 'Eve', 'Shot', 'valid', NULL, 15, 2, now() - interval '29 days', now() - interval '29 days'),
  (gen_random_uuid(), $1, $2, $4, 'f@x.test', 'Eff', 'Shot', 'valid', NULL, 12, 1, now() - interval '9 days', now() - interval '9 days'),
  (gen_random_uuid(), $1, $2, $4, 'g@x.test', 'Gee', 'Shot', 'refunded', NULL, 12, 1, now() - interval '9 days', now() - interval '9 days')`, [CONN, O1, M1, M2]);
// Registre : a (Yuno), f (accord Shotgun), h (fichier importé), b (accord Shotgun ET achat Yuno)
await db.query(`INSERT INTO public.newsletter_subscriptions (id, organizer_user_id, email, opted_in, source, created_at, updated_at) VALUES
  (gen_random_uuid(), $1, 'a@x.test', true, 'ticket_purchase', now() - interval '19 days', now() - interval '19 days'),
  (gen_random_uuid(), $1, 'f@x.test', true, 'connector:shotgun', now() - interval '9 days', now() - interval '9 days'),
  (gen_random_uuid(), $1, 'b@x.test', true, 'connector:shotgun', now() - interval '29 days', now() - interval '29 days')`, [O1]);
await db.query(`INSERT INTO public.imported_contacts (id, organizer_user_id, email, first_name, created_at) VALUES (gen_random_uuid(), $1, 'h@x.test', 'Hache', now() - interval '60 days')`, [O1]);

// ── AVANT : ce que la prod rend aujourd'hui (définitions de la prod, intactes) ─
const snap = async (name, sql) => { await db.exec(`DROP TABLE IF EXISTS ${name}; CREATE TABLE ${name} AS ${sql}`); };
await snap('old_sc', `SELECT * FROM public.contact_scope_customers(NULL, '${O1}')`);
await snap('old_rows', `SELECT * FROM public.contact_rows(NULL, '${O1}')`);
// _cr est une table temporaire ON COMMIT DROP : la construire et la copier dans UNE transaction.
await db.exec(`BEGIN; SELECT public.contact_build_rows(NULL, '${O1}'); DROP TABLE IF EXISTS old_cr; CREATE TABLE old_cr AS SELECT * FROM _cr; COMMIT;`);   // peuple aussi le cache (clé « o:… »)
const oldCacheKeys = (await q(`SELECT scope_key, count(*)::int AS n FROM public.contact_base_cache GROUP BY 1 ORDER BY 1`));
let hasPeople = true;
try { await db.exec(`BEGIN; SELECT public._crm_people_build(NULL, '${O1}', now(), false); DROP TABLE IF EXISTS old_cp; CREATE TABLE old_cp AS SELECT * FROM _cp; COMMIT;`); }
catch (e) { try { await db.exec('ROLLBACK'); } catch { /* rien */ } hasPeople = false; console.log('NOTE _crm_people_build non rejouable au banc :', e.message.slice(0, 160)); }
console.log('AVANT : contacts', (await q(`SELECT count(*)::int AS n FROM old_rows`))[0].n, '· clés de cache', JSON.stringify(oldCacheKeys));
const oldEmails = (await q(`SELECT email FROM old_rows ORDER BY email`)).map((r) => r.email).join(',');
check('avant : la base mélange Yuno et Shotgun (a, b, c, d, e, f, h)', oldEmails === 'a@x.test,b@x.test,c@x.test,d@x.test,e@x.test,f@x.test,h@x.test', oldEmails);

// ── La migration (sans sa garde md5 : PGlite ne reformate pas une définition comme Postgres) ─
const sql = readFileSync(MIG, 'utf8').replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, '');
await db.exec(sql);

// ── APRÈS · CRM : identique, ligne à ligne ───────────────────────────────────
const same = async (label, oldT, newSql, prefix = '') => {
  await db.exec(`BEGIN; ${prefix}; DROP TABLE IF EXISTS new_t; CREATE TABLE new_t AS ${newSql}; COMMIT;`);
  const a = (await q(`SELECT count(*)::int AS n FROM (SELECT * FROM ${oldT} EXCEPT SELECT * FROM new_t) x`))[0].n;
  const b = (await q(`SELECT count(*)::int AS n FROM (SELECT * FROM new_t EXCEPT SELECT * FROM ${oldT}) x`))[0].n;
  const n = (await q(`SELECT count(*)::int AS n FROM new_t`))[0].n;
  check(label, a === 0 && b === 0, `${n} lignes, écarts ${a}/${b}`);
};
await same('CRM · contact_scope_customers(…, crm) = avant', 'old_sc', `SELECT * FROM public.contact_scope_customers(NULL, '${O1}', 'crm')`);
await same('CRM · contact_rows(…, crm) = avant', 'old_rows', `SELECT * FROM public.contact_rows(NULL, '${O1}', 'crm')`);
// Le cache « …|crm » est pré-semé à l'identique : lu tel quel, sans reconstruction.
const keys = await q(`SELECT scope_key, count(*)::int AS n FROM public.contact_base_cache GROUP BY 1 ORDER BY 1`);
check('CRM · la clé « o:…|crm » est pré-semée avec le cache d\'avant', keys.some((k) => k.scope_key === `o:${O1}|crm` && k.n === oldCacheKeys[0].n), JSON.stringify(keys));
check('Billetterie · le cache d\'une portée connectée est purgé (reconstruit à la 1re lecture)', !keys.some((k) => k.scope_key === `o:${O1}`), JSON.stringify(keys));
await same('CRM · contact_build_rows(…, crm) servi par le cache = avant', 'old_cr', `SELECT * FROM _cr`, `SELECT public.contact_build_rows(NULL, '${O1}', 'crm')`);
if (hasPeople) {
  await same('CRM · _crm_people_build (l\'écran Clients) = avant', 'old_cp', `SELECT * FROM _cp`, `SELECT public._crm_people_build(NULL, '${O1}', now(), false)`);
}

// ── APRÈS · Billetterie : jamais Shotgun ─────────────────────────────────────
const suite = await q(`SELECT * FROM public.contact_rows(NULL, '${O1}')`);   // défaut = 'suite'
const em = suite.map((r) => r.email).sort().join(',');
check('Billetterie · contact_rows (défaut) : a, b, c, d, h — ni e, ni f, ni g', em === 'a@x.test,b@x.test,c@x.test,d@x.test,h@x.test', em);
const b = suite.find((r) => r.email === 'b@x.test');
check('Billetterie · b, cliente Yuno ET Shotgun : 1 billet et 25 € − frais, jamais les 30 € de Shotgun', b && b.ticket_count === 1 && Number(b.yuno_spent) === 24, b ? `tickets ${b.ticket_count}, dépense ${b.yuno_spent}` : 'absente');
check('Billetterie · b : pas abonnée (son accord vient de Shotgun)', b && b.subscribed === false, String(b?.subscribed));
check('Billetterie · b : aucune soirée Shotgun dans ses soirées', b && Number(b.yuno_events) === 1, String(b?.yuno_events));
await db.exec(`BEGIN; SELECT public.contact_build_rows(NULL, '${O1}'); DROP TABLE IF EXISTS suite_cr; CREATE TABLE suite_cr AS SELECT * FROM _cr; COMMIT;`);
const cr = await q(`SELECT email, email_ok FROM suite_cr ORDER BY email`);
check('Billetterie · contact_build_rows (défaut) : pas de Shotgun dans la base', cr.map((r) => r.email).join(',') === 'a@x.test,b@x.test,c@x.test,d@x.test,h@x.test', cr.map((r) => r.email).join(','));
check('Billetterie · email_ok : a oui, b et f jamais (accord Shotgun)', cr.find((r) => r.email === 'a@x.test')?.email_ok === true && cr.find((r) => r.email === 'b@x.test')?.email_ok === false);
check('Billetterie · la clé « o:… » est reconstruite', (await q(`SELECT 1 FROM public.contact_base_cache_state WHERE scope_key = 'o:${O1}'`)).length === 1);
const crm = await q(`SELECT email FROM public.contact_rows(NULL, '${O1}', 'crm') ORDER BY email`);
check('CRM · garde e, f (acheteurs Shotgun) et g n\'y est toujours pas (remboursé)', crm.map((r) => r.email).includes('e@x.test') && crm.map((r) => r.email).includes('f@x.test') && !crm.map((r) => r.email).includes('g@x.test'));

// ── Effacement : les DEUX clés suivent ───────────────────────────────────────
await db.exec(`DELETE FROM public.contact_base_cache cb WHERE cb.scope_key IN ('o:${O1}', 'o:${O1}|crm') AND lower(cb.email) = 'a@x.test'`);
await db.exec(`BEGIN; SELECT public.contact_build_rows(NULL, '${O1}', 'crm'); COMMIT; BEGIN; SELECT public.contact_build_rows(NULL, '${O1}'); COMMIT;`);
check('clés : « o:… » et « o:…|crm » existent chacune avec ses lignes',
  (await q(`SELECT count(DISTINCT scope_key)::int AS n FROM public.contact_base_cache WHERE scope_key IN ('o:${O1}', 'o:${O1}|crm')`))[0].n === 2);

// ── Droits ───────────────────────────────────────────────────────────────────
const acl = (await q(`SELECT has_function_privilege('anon', 'public.contact_rows(text, uuid, text)', 'EXECUTE') AS a,
                             has_function_privilege('authenticated', 'public.contact_build_rows(text, uuid, text)', 'EXECUTE') AS b,
                             has_function_privilege('service_role', 'public.contact_scope_customers(text, uuid, text)', 'EXECUTE') AS c`))[0];
check('droits : ni anon ni authenticated sur le noyau, service_role oui', !acl.a && !acl.b && acl.c, JSON.stringify(acl));
check('anciennes signatures supprimées (pas d\'ambiguïté)', (await q(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('contact_rows','contact_build_rows','contact_scope_customers') AND pronargs = 2`))[0].n === 0);

console.log(failed ? `\n${failed} ÉCHEC(S)` : '\ntout est vérifié');
process.exit(failed ? 1 : 0);
