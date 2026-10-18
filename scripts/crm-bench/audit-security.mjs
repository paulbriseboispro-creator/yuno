#!/usr/bin/env node
// Lot sécurité de l'audit du 18/10 (migration 20261021100000), rejoué au banc
// sur les définitions de la PROD : avant / après, droits réels et gel d'envoi.
//
//   node prod.mjs --activity
//   node audit-security.mjs dump     # instantané des fonctions touchées (lecture seule)
//   node audit-security.mjs          # test (sort en code 1 si une assertion tombe)
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-security.sql');
const ROOTS = join(DATA, 'audit-security-roots.txt');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261021100000_audit_security_revokes.sql');
const FUNCS = ['_admin_customer_activity()', '_admin_customer_identity(text)', '_admin_customer_rfm()',
  'get_customer_timeline(uuid, text, uuid, integer)', 'refresh_analytics_rollup()', 'refresh_analytics_daily_rollup()'];

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['_admin_customer_activity', '_admin_customer_identity', '_admin_customer_rfm', 'get_customer_timeline',
    'refresh_analytics_rollup', 'refresh_analytics_daily_rollup', 'guard_crm_send_frozen', 'email_campaigns', 'crm_settings',
    'analytics_daily_rollup'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-security.mjs dump »');

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); if (!ok) failed++; };
const priv = async (role, f) => (await db.query(`SELECT has_function_privilege($1, 'public.${f}', 'EXECUTE') AS x`, [role])).rows[0].x;

// Comme en prod : un compte connecté écrit ses campagnes (RLS d'email_campaigns,
// ici réduite à « c'est la mienne »), et `crm_settings` a la RLS SANS policy.
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
await db.exec(`
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
  GRANT SELECT, UPDATE ON public.email_campaigns TO authenticated;
  ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
  CREATE POLICY mine ON public.email_campaigns FOR ALL TO authenticated
    USING (organizer_user_id = auth.uid()) WITH CHECK (organizer_user_id = auth.uid());
  GRANT SELECT ON public.crm_settings TO authenticated;  -- comme en prod (lu le 18/10)
  ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
  CREATE TRIGGER trg_guard_crm_send_frozen BEFORE INSERT OR UPDATE OF status ON public.email_campaigns
    FOR EACH ROW EXECUTE FUNCTION public.guard_crm_send_frozen();
  INSERT INTO public.crm_settings (scope_key, sending_frozen_at) VALUES ('org:${A}', now());`);
await db.query(`INSERT INTO public.email_campaigns (id, organizer_user_id, name, subject, status)
  VALUES ('cccccccc-0000-4000-8000-0000000000c1', $1, 'Campagne A', 'Objet', 'draft')`, [A]);
async function clientSetsSending() {
  await db.exec('BEGIN');
  try {
    await db.exec(`SET LOCAL ROLE authenticated;`);
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: A, role: 'authenticated' })]);
    await db.exec(`UPDATE public.email_campaigns SET status = 'sending' WHERE id = 'cccccccc-0000-4000-8000-0000000000c1'`);
    return 'passe';
  } catch (e) {
    return /crm_send_frozen/.test(e.message) ? 'refusé (gel)' : `erreur : ${e.message.split('\n')[0]}`;
  } finally {
    await db.exec('ROLLBACK');
  }
}

// ── Avant : l'état de la prod ────────────────────────────────────────────────
for (const f of FUNCS.slice(0, 3)) check(`avant : anon peut exécuter ${f} (faille reproduite)`, await priv('anon', f));
check('avant : un client gelé passe sa campagne en « sending » (faille reproduite)', (await clientSetsSending()) === 'passe');

// ── La migration ─────────────────────────────────────────────────────────────
await execFile(db, MIGRATION, '20261021100000_audit_security_revokes.sql');

for (const f of FUNCS) {
  check(`après : anon ne peut pas exécuter ${f}`, !(await priv('anon', f)));
  check(`après : authenticated ne peut pas exécuter ${f}`, !(await priv('authenticated', f)));
  check(`après : service_role peut exécuter ${f}`, await priv('service_role', f));
}
const mv = (await db.query(`SELECT has_table_privilege('anon', 'public.analytics_daily_rollup', 'SELECT') a,
                                   has_table_privilege('authenticated', 'public.analytics_daily_rollup', 'SELECT') u`)).rows[0];
check('après : analytics_daily_rollup illisible par anon et authenticated', !mv.a && !mv.u);
check('après : le client gelé est refusé', (await clientSetsSending()) === 'refusé (gel)');
await db.exec(`DELETE FROM public.crm_settings`);
check('après : sans gel, le client passe toujours (pas de faux refus)', (await clientSetsSending()) === 'passe');

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
