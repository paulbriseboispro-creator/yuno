#!/usr/bin/env node
// Lot connecteur de l'audit du 18/10 (migration 20261021120000), rejoué au banc
// sur les définitions de la PROD : accords après « Supprimer les données
// importées », et reprise d'une connexion en erreur.
//
//   node prod.mjs --activity
//   node audit-sync.mjs dump      # instantané des fonctions touchées (lecture seule)
//   node audit-sync.mjs           # test (code 1 si une assertion tombe)
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-sync.sql');
const ROOTS = join(DATA, 'audit-sync-roots.txt');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261021120000_audit_ticketing_purge_and_retry.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['claim_ticketing_connections', 'ticketing_connections', 'newsletter_subscriptions',
    'marketing_consent_events', 'crm_scope_paused', 'crm_scope_key'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-sync.mjs dump »');

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })]);
let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = { a: '11111111-0000-4000-8000-0000000000a1', err: '11111111-0000-4000-8000-0000000000e1', later: '11111111-0000-4000-8000-0000000000e2', tok: '11111111-0000-4000-8000-0000000000f1', b: '11111111-0000-4000-8000-0000000000b1' };

async function seed() {
  await db.exec(`TRUNCATE public.ticketing_connections, public.newsletter_subscriptions, public.marketing_consent_events;`);
  const conn = (id, org, status, next) => db.query(`INSERT INTO public.ticketing_connections
      (id, organizer_user_id, provider, external_org_id, status, vault_secret_id, next_sync_at, sync_interval_minutes, fail_count)
      VALUES ($1, $2, 'shotgun', '123', $3, gen_random_uuid(), $4, 15, $5)`,
    [id, org, status, next, status === 'error' ? 5 : 0]);
  await conn(C.a, A, 'active', new Date(Date.now() - 60e3).toISOString());
  await conn(C.err, B, 'error', new Date(Date.now() - 60e3).toISOString());
  await conn(C.tok, '22222222-0000-4000-8000-000000000022', 'token_invalid', new Date(Date.now() - 60e3).toISOString());
  await conn(C.later, '33333333-0000-4000-8000-000000000033', 'error', new Date(Date.now() + 3600e3).toISOString());
  const sub = (org, email, optedIn, source) => db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source)
      VALUES ($1, $2, $3, $4)`, [org, email, optedIn, source]);
  await sub(A, 'shotgun1@x.test', true, 'connector:shotgun');
  await sub(A, 'shotgun2@x.test', true, 'connector:shotgun');
  await sub(A, 'refus@x.test', false, 'connector:shotgun');      // un refus : reste en mémoire
  await sub(A, 'page@x.test', true, 'signup_page:p1');           // accord donné ailleurs : reste
  await sub(B, 'shotgun1@x.test', true, 'connector:shotgun');    // autre espace : intact
}
const claimed = async () => (await db.query(`SELECT id FROM public.claim_ticketing_connections(10, 150, NULL)`)).rows.map((r) => r.id);
const subsOf = async (org) => (await db.query(`SELECT email, opted_in FROM public.newsletter_subscriptions WHERE organizer_user_id = $1 ORDER BY email`, [org])).rows;

// ── Avant ───────────────────────────────────────────────────────────────────
await seed();
check('avant : une connexion en erreur n\'est jamais reprise (faille reproduite)', !(await claimed()).includes(C.err));
await db.query(`DELETE FROM public.ticketing_connections WHERE id = $1`, [C.a]);
check('avant : après suppression des données, les accords versés par Shotgun restent actifs (faille reproduite)',
  (await subsOf(A)).filter((s) => s.opted_in && s.email.startsWith('shotgun')).length === 2);

// ── Après ───────────────────────────────────────────────────────────────────
await execFile(db, MIGRATION, '20261021120000_audit_ticketing_purge_and_retry.sql');
await seed();
const got = await claimed();
check('après : la connexion en erreur échue est reprise', got.includes(C.err));
check('après : une connexion en erreur dont le repli n\'est pas échu attend', !got.includes(C.later));
check('après : un jeton refusé n\'est jamais retenté', !got.includes(C.tok));
check('après : une connexion active échue est toujours prise', got.includes(C.a));
await db.exec(`UPDATE public.ticketing_connections SET locked_until = NULL`);
await db.query(`DELETE FROM public.ticketing_connections WHERE id = $1`, [C.a]);
const a = await subsOf(A);
check('après : les accords actifs versés par Shotgun sont retirés', !a.some((s) => s.email.startsWith('shotgun')), JSON.stringify(a));
check('après : un refus reste en mémoire', a.some((s) => s.email === 'refus@x.test' && !s.opted_in));
check('après : un accord donné sur une page reste', a.some((s) => s.email === 'page@x.test' && s.opted_in));
check('après : l\'autre espace n\'est pas touché', (await subsOf(B)).some((s) => s.email === 'shotgun1@x.test' && s.opted_in));
const ev = (await db.query(`SELECT count(*)::int AS n FROM public.marketing_consent_events WHERE action = 'withdrawn' AND wording_key = 'connector_purged' AND organizer_user_id = $1`, [A])).rows[0].n;
check('après : chaque retrait est tracé', ev === 2, `traces=${ev}`);

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
