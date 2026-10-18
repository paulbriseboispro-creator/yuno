#!/usr/bin/env node
// Suite de l'audit du 18/10 : les 8 migrations 20261023100000 → 170000 jouées
// À LA SUITE sur les définitions de la PROD (après 20261021110000 de l'audit),
// puis leur retour arrière (docs/audit/…/ROLLBACK-suite.sql) : chaque fonction
// touchée doit retrouver sa définition de départ, au caractère près.
//
//   node prod.mjs --activity
//   node audit-suite-rollback.mjs dump   # instantané (lecture seule)
//   node audit-suite-rollback.mjs        # test
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-suite.sql');
const ROOTS = join(DATA, 'audit-suite-roots.txt');
const MIG = (f) => join(ROOT, 'supabase', 'migrations', f);
const SUITE = ['20261023100000_mail_stable_batch_key.sql', '20261023110000_crm_filter_unknown_key_false.sql',
  '20261023120000_mail_test_send_team_only.sql', '20261023130000_mail_campaign_product_server_only.sql',
  '20261023140000_mail_quota_paris_day.sql', '20261023150000_sec_revoke_unused_helpers.sql',
  '20261023160000_mail_block_event_scope.sql', '20261023170000_mail_sender_local_registry.sql'];
const TOUCHED = ['claim_campaign_recipients', '_crm_filter_sql', 'consume_email_send_quota', 'refund_email_send_quota',
  'email_sender_daily_cap', 'count_transactional_email', 'get_email_quota_status', 'get_campaign_send_progress', 'crm_email_settings_get'];
const ACL_FUNCS = ['campaign_scope_is_event_principal', 'crm_org_role', 'crm_user_manages_team', 'email_sender_daily_cap',
  'email_sender_monthly_free', 'count_transactional_email', 'contact_base_scope_key'];

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, [...new Set([...TOUCHED, ...ACL_FUNCS, 'requeue_stale_campaign_claims', 'mark_campaign_recipients_sent',
    'mark_campaign_recipients_failed', 'email_campaigns', 'email_campaign_recipients', 'email_send_quota', 'email_send_quota_month',
    'events', 'event_cohosts', 'venues', 'profiles', 'manager_permissions', 'org_members', 'user_roles', 'crm_email_settings'])].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-suite-rollback.mjs dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
// Droits de la prod le 18/10 sur les fonctions que SEC-04 resserre (proacl).
const PROD_ACL = {
  'campaign_scope_is_event_principal(text, uuid, uuid)': 'authenticated, service_role',
  'contact_base_scope_key(text, uuid)': 'PUBLIC, anon, authenticated, service_role',
  'count_transactional_email()': 'anon, authenticated, service_role',
  'crm_org_role(uuid, uuid)': 'authenticated, service_role',
  'crm_user_manages_team(uuid, text, uuid)': 'authenticated, service_role',
  'email_sender_daily_cap(text)': 'PUBLIC, anon, authenticated, service_role',
  'email_sender_monthly_free(text)': 'PUBLIC, anon, authenticated, service_role',
};
for (const [sig, to] of Object.entries(PROD_ACL)) {
  await db.exec(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.${sig} TO ${to};`);
}
await db.exec(`DO $$ BEGIN CREATE ROLE quelqun NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
await execFile(db, MIG('20261021110000_audit_claim_recheck_consent.sql'), '20261021110000');

const defs = async () => {
  const out = {};
  for (const r of (await db.query(`SELECT p.oid::regprocedure::text AS sig, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY($1)`, [TOUCHED])).rows) out[r.sig] = r.def;
  return out;
};
// Droits EFFECTIFS (un rôle quelconque = PUBLIC).
const acls = async () => {
  const out = [];
  for (const sig of Object.keys(PROD_ACL)) {
    const r = (await db.query(`SELECT ${['quelqun', 'anon', 'authenticated', 'service_role'].map((x) => `has_function_privilege('${x}', 'public.${sig}', 'EXECUTE') AS "${x}"`).join(', ')}`)).rows[0];
    out.push(`${sig}: ${Object.entries(r).filter(([, v]) => v).map(([k]) => (k === 'quelqun' ? 'PUBLIC' : k)).join(', ')}`);
  }
  return out.join('\n');
};
const before = await defs();
const aclBefore = await acls();

for (const f of SUITE) {
  let ok = true; let msg = '';
  try { await execFile(db, MIG(f), f); } catch (e) { ok = false; msg = e.message; }
  check(`applique ${f}`, ok, msg);
}
const during = await defs();
check('les migrations changent bien les fonctions touchées', TOUCHED.every((n) => Object.keys(during).some((s) => s.startsWith(`${n}(`) && during[s] !== before[s])),
  TOUCHED.filter((n) => !Object.keys(during).some((s) => s.startsWith(`${n}(`) && during[s] !== before[s])).join(', '));

let rbOk = true; let rbMsg = '';
try { await execFile(db, join(ROOT, 'docs', 'audit', '2026-10-18-crm-readiness', 'ROLLBACK-suite.sql'), 'ROLLBACK-suite.sql'); } catch (e) { rbOk = false; rbMsg = e.message; }
check('le retour arrière se joue', rbOk, rbMsg);
const after = await defs();
const diff = Object.keys(before).filter((s) => before[s] !== after[s]);
check('chaque fonction retrouve sa définition de départ', diff.length === 0 && Object.keys(after).length === Object.keys(before).length, diff.join(', '));
const aclAfter = await acls();
check('les droits reviennent comme en prod', aclAfter === aclBefore, aclAfter === aclBefore ? '' : `\navant:\n${aclBefore}\naprès:\n${aclAfter}`);
const gone = (await db.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('email_sender_locals', 'email_test_sends') AND relnamespace = 'public'::regnamespace`)).rows[0].n;
check('les tables ajoutées sont retirées', gone === 0);

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
