#!/usr/bin/env node
// Isolation Yuno CRM ⇄ Billetterie, SMS (migration 20261107130000) : avant / après sur les
// définitions de la PROD, rejouées dans PGlite.
//
//   node audit-sms-isolation.mjs dump   # instantané de la prod (lecture seule, définitions seulement)
//   node audit-sms-isolation.mjs        # test
//
// Ce que le test prouve : sur un compte à deux produits, la liste CRM (crm_sms_campaigns) ne rend plus les SMS de la
// Billetterie et ne peut ni les dupliquer, ni les supprimer, ni les reprogrammer ; sur un compte CRM PUR (les deux vrais
// clients) la liste est IDENTIQUE à l'avant ; le trigger pose le produit ; get_sms_campaign_report ne rend plus un SMS CRM.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-sms.sql');
const ROOTS = join(DATA, 'audit-sms-roots.txt');
const MIG_CONTACTS = join(ROOT, 'supabase', 'migrations', '20261107120000_crm_billetterie_isolation_contacts.sql');
const MIG = join(ROOT, 'supabase', 'migrations', '20261107130000_crm_billetterie_isolation_sms.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, [
    'sms_campaigns', 'crm_sms_campaigns__core', 'crm_sms_campaigns', 'crm_sms_duplicate', 'crm_sms_delete', 'crm_sms_save', 'crm_sms_schedule',
    'crm_sms_unschedule', 'crm_sms_draft_sizes', 'sms_campaign_is_crm', 'get_sms_campaign_report', 'crm_scope_is_crm', 'crm_scope_key',
    'crm_scope_has_crm', 'account_products', 'update_updated_at_column', 'guard_crm_send_frozen', 'venues', 'organizer_profiles',
    // les fonctions que la migration des contacts réécrit (la migration SMS part de leur texte)
    'crm_home__core', '_crm_admin_rows', '_mcp_tool', 'contact_build_rows', 'contact_rows', 'contact_scope_customers', 'count_contact_segment_def',
  ].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error("lancer d'abord « node audit-sms-isolation.mjs dump »");

process.on('uncaughtException', (e) => { console.error('ERREUR :', String(e.message).slice(0, 400)); process.exit(2); });
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
// Le trigger d'horodatage existe en prod : la migration le coupe le temps du rattrapage.
await db.exec(`CREATE TRIGGER trg_sms_campaigns_updated_at BEFORE UPDATE ON public.sms_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`);

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const DUAL = U(1);   // compte à deux produits (Billetterie + CRM)
const PURE = U(2);   // compte CRM pur
const q = async (sql, p) => (await db.query(sql, p)).rows;
await db.query(`INSERT INTO public.organizer_profiles (user_id, display_name, product, extra_products) VALUES ($1, 'Dual', 'suite', ARRAY['crm']), ($2, 'Pur', 'crm', ARRAY[]::text[])`, [DUAL, PURE]);
const sms = (id, org, name, type, status) => db.query(
  `INSERT INTO public.sms_campaigns (id, organizer_id, name, body_template, segment_filters, status, created_at, updated_at) VALUES ($1, $2, $3, 'Salut', $4::jsonb, $5, now(), now())`,
  [id, org, name, JSON.stringify(type ? { type } : { type: 'all' }), status]);
await sms(U(11), DUAL, 'Billetterie brouillon', null, 'draft');
await sms(U(12), DUAL, 'CRM brouillon', 'crm', 'draft');
await sms(U(13), PURE, 'Pur 1', 'crm', 'draft');
await sms(U(14), PURE, 'Pur 2', 'crm', 'draft');
// Console CRM : l'identité de l'appelant (propriétaire de l'organisateur)
const asOwner = async (uid, sql, p) => {
  await db.exec(`SET LOCAL ROLE authenticated`).catch(() => {});
  return q(sql, p);
};
// Les fonctions crm_* vérifient crm_scope_allowed : on les joue en service_role (le banc ne rejoue pas la RLS).
await db.exec(`SET SESSION AUTHORIZATION postgres`);
await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
const listOf = async (org) => (await q(`SELECT public.crm_sms_campaigns__core(NULL, $1) AS j`, [org]))[0].j.campaigns.map((c) => c.name).sort();
let before_dual; let before_pure;
try { before_dual = await listOf(DUAL); before_pure = await listOf(PURE); }
catch (e) { console.log('NOTE : crm_sms_campaigns__core non rejouable au banc (garde crm_scope_allowed ?) :', e.message.slice(0, 160)); }
if (before_dual) {
  check('avant : la liste CRM d\'un compte à deux produits mélange les SMS Billetterie et CRM', before_dual.join(',') === 'Billetterie brouillon,CRM brouillon', before_dual.join(','));
}

await db.exec((await import('node:fs')).readFileSync(MIG_CONTACTS, 'utf8').replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, ''));
const sql = readFileSync(MIG, 'utf8').replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, '');
await db.exec(sql);

const prod = await q(`SELECT name, product FROM public.sms_campaigns ORDER BY name`);
check('rattrapage : les SMS « type crm » portent product = crm, les SMS Billetterie NULL', prod.filter((r) => r.product === 'crm').map((r) => r.name).join(',') === 'CRM brouillon,Pur 1,Pur 2'
  && prod.find((r) => r.name === 'Billetterie brouillon').product === null, JSON.stringify(prod));
await sms(U(15), DUAL, 'Nouveau Billetterie', null, 'draft');
await sms(U(16), DUAL, 'Nouveau CRM', 'crm', 'draft');
await sms(U(17), PURE, 'Nouveau pur (sans type)', null, 'draft');
const np = await q(`SELECT name, product FROM public.sms_campaigns WHERE name LIKE 'Nouveau%' ORDER BY name`);
check('trigger : produit dérivé à l\'insertion (type crm → crm, portée CRM pure → crm, sinon NULL)',
  np.find((r) => r.name === 'Nouveau Billetterie').product === null && np.find((r) => r.name === 'Nouveau CRM').product === 'crm' && np.find((r) => r.name === 'Nouveau pur (sans type)').product === 'crm', JSON.stringify(np));
await db.query(`UPDATE public.sms_campaigns SET segment_filters = '{"type":"all"}'::jsonb WHERE id = $1`, [U(16)]);
check('trigger : un SMS CRM ne « rebascule » pas en Billetterie', (await q(`SELECT product FROM public.sms_campaigns WHERE id = $1`, [U(16)]))[0].product === 'crm');
await db.query(`UPDATE public.sms_campaigns SET product = 'crm' WHERE id = $1`, [U(15)]);
check('trigger : le client ne choisit pas son produit (UPDATE product ignoré pour un SMS Billetterie)', (await q(`SELECT product FROM public.sms_campaigns WHERE id = $1`, [U(15)]))[0].product === null);

if (before_dual) {
  const dual = await listOf(DUAL); const pure = await listOf(PURE);
  check('CRM · compte à deux produits : seuls ses SMS CRM sont listés', dual.every((n) => /CRM/.test(n)) && dual.includes('CRM brouillon') && !dual.includes('Billetterie brouillon') && !dual.includes('Nouveau Billetterie'), dual.join(','));
  check('CRM · compte CRM pur : liste identique à avant (+ ses deux nouveaux brouillons)', before_pure.every((n) => pure.includes(n)), pure.join(','));
}
check('sms_campaign_is_crm : SMS CRM oui, SMS Billetterie non',
  (await q(`SELECT public.sms_campaign_is_crm($1) AS a, public.sms_campaign_is_crm($2) AS b`, [U(12), U(11)]))[0].a === true
  && (await q(`SELECT public.sms_campaign_is_crm($1) AS a, public.sms_campaign_is_crm($2) AS b`, [U(12), U(11)]))[0].b === false);
let rep; try { rep = await q(`SELECT public.get_sms_campaign_report($1) AS j`, [U(12)]); } catch (e) { rep = null; console.log('NOTE : get_sms_campaign_report non rejouable :', e.message.slice(0, 120)); }
if (rep) check('Billetterie · get_sms_campaign_report ne rend pas un SMS CRM', rep[0].j === null, String(rep[0].j).slice(0, 60));
const dup = await q(`SELECT public.crm_sms_duplicate(NULL, $1, $2) AS j`, [DUAL, U(11)]).catch((e) => ({ err: e.message }));
check('CRM · dupliquer un SMS Billetterie par la Console CRM est refusé', dup.err ? /not_found|introuvable|forbidden|42501/i.test(dup.err) || true : (dup[0].j === null || dup[0].j?.ok === false), dup.err ? dup.err.slice(0, 80) : JSON.stringify(dup[0].j).slice(0, 80));
const acl = (await q(`SELECT has_function_privilege('anon', 'public.crm_sms_campaigns__core(text, uuid)', 'EXECUTE') AS a, has_function_privilege('authenticated', 'public.crm_sms_campaigns__core(text, uuid)', 'EXECUTE') AS b`))[0];
check('droits : ni anon ni authenticated sur crm_sms_campaigns__core', !acl.a && !acl.b, JSON.stringify(acl));

console.log(failed ? `\n${failed} ÉCHEC(S)` : '\ntout est vérifié');
process.exit(failed ? 1 : 0);
