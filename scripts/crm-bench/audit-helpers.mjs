#!/usr/bin/env node
// Suite de l'audit du 18/10 — SEC-04 : révocation des fonctions d'aide que le
// navigateur n'appelle pas (migration 20261023150000). Les fonctions sont
// recréées avec leur signature et leurs droits de la PROD (lus le 18/10 :
// pg_proc.proacl) ; le banc prouve que la migration retire exactement ce
// qu'elle dit et garde le reste. Aucune lecture de la prod.
//
//   node audit-helpers.mjs
import { join } from 'node:path';
import { openFresh, execFile, HERE, ROOT } from './lib.mjs';

const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261023150000_sec_revoke_unused_helpers.sql');
// signature → rôles qui l'exécutaient en prod le 18/10 (en plus de postgres / service_role).
const PROD = {
  'campaign_scope_is_event_principal(text, uuid, uuid)': ['authenticated'],
  'contact_base_scope_key(text, uuid)': ['PUBLIC', 'anon', 'authenticated'],
  'crm_org_role(uuid, uuid)': ['authenticated'],
  'crm_practical_email_check(uuid)': ['authenticated'],
  'crm_scope_has_crm(text)': ['authenticated'],
  'crm_scope_key(text, uuid)': ['authenticated'],
  'crm_user_in_scope(uuid, text, uuid)': ['authenticated'],
  'crm_user_manages_team(uuid, text, uuid)': ['authenticated'],
  'email_sender_daily_cap(text)': ['PUBLIC', 'anon', 'authenticated'],
  'email_sender_monthly_free(text)': ['PUBLIC', 'anon', 'authenticated'],
  'count_transactional_email()': ['anon', 'authenticated'],
};
// Attendu après : qui exécute encore.
const AFTER = {
  'campaign_scope_is_event_principal(text, uuid, uuid)': [],
  'contact_base_scope_key(text, uuid)': ['authenticated'],
  'crm_org_role(uuid, uuid)': [],
  'crm_practical_email_check(uuid)': ['authenticated'],
  'crm_scope_has_crm(text)': ['authenticated'],
  'crm_scope_key(text, uuid)': ['authenticated'],
  'crm_user_in_scope(uuid, text, uuid)': ['authenticated'],
  'crm_user_manages_team(uuid, text, uuid)': [],
  'email_sender_daily_cap(text)': [],
  'email_sender_monthly_free(text)': [],
  'count_transactional_email()': [],
};

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
for (const [sig, roles] of Object.entries(PROD)) {
  const ret = sig.startsWith('count_') ? 'void' : 'boolean';
  const args = sig.slice(sig.indexOf('(') + 1, -1).split(',').map((x) => x.trim()).filter(Boolean)
    .map((t, i) => `p${i} ${t}`).join(', ');
  await db.exec(`CREATE FUNCTION public.${sig.slice(0, sig.indexOf('('))}(${args}) RETURNS ${ret} LANGUAGE sql AS $$ SELECT ${ret === 'void' ? 'NULL::void' : 'true'} $$;
    REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.${sig} TO service_role${roles.length ? `, ${roles.join(', ')}` : ''};`);
}
const who = async (sig) => {
  const out = [];
  for (const r of ['anon', 'authenticated']) {
    if ((await db.query(`SELECT has_function_privilege($1, 'public.${sig}', 'EXECUTE') AS x`, [r])).rows[0].x) out.push(r);
  }
  return out;
};
const svc = async (sig) => (await db.query(`SELECT has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') AS x`)).rows[0].x;

check('avant : count_transactional_email (écrit un compteur) exécutable par anon', (await who('count_transactional_email()')).includes('anon'));
check('avant : plafonds d\'envoi exécutables par anon', (await who('email_sender_daily_cap(text)')).includes('anon'));
await execFile(db, MIGRATION, '20261023150000_sec_revoke_unused_helpers.sql');
for (const [sig, expected] of Object.entries(AFTER)) {
  const got = await who(sig);
  check(`après : ${sig} → ${expected.length ? expected.join(', ') : 'serveur seul'}`, got.join(',') === expected.join(','), got.join(', ') || '—');
  check(`après : ${sig} reste exécutable par service_role`, await svc(sig));
}
console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
