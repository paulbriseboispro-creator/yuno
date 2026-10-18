#!/usr/bin/env node
// Lot envois de l'audit du 18/10 (migration 20261021110000), rejoué au banc sur
// les définitions de la PROD : un accord retiré après la mise en file.
//
//   node prod.mjs --activity
//   node audit-mail.mjs dump      # instantané des fonctions touchées (lecture seule)
//   node audit-mail.mjs           # test (code 1 si une assertion tombe)
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-mail.sql');
const ROOTS = join(DATA, 'audit-mail-roots.txt');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261021110000_audit_claim_recheck_consent.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['claim_campaign_recipients', 'requeue_stale_campaign_claims', 'crm_yunits_refund', 'crm_yunits_balance',
    'crm_campaign_is_crm', 'email_campaigns', 'email_campaign_recipients', 'newsletter_subscriptions', 'email_suppressions',
    'email_opt_outs', 'crm_yunit_lots', 'crm_yunit_moves', 'organizer_profiles'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-mail.mjs dump »');

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })]);
let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const CRM = 'cccccccc-0000-4000-8000-0000000000c1';   // campagne marketing CRM de A
const INFO = 'cccccccc-0000-4000-8000-0000000000c2';  // e-mail pratique de A
const STALE = 'cccccccc-0000-4000-8000-0000000000c3'; // campagne CRM aux envois abandonnés

async function seed() {
  await db.exec(`
    TRUNCATE public.email_campaigns, public.email_campaign_recipients, public.newsletter_subscriptions,
             public.email_suppressions, public.email_opt_outs, public.crm_yunit_lots, public.crm_yunit_moves,
             public.organizer_profiles;`);
  for (const u of [A, B]) await db.query(`INSERT INTO public.organizer_profiles (user_id, display_name, product) VALUES ($1, 'Espace', 'crm')`, [u]);
  await db.query(`INSERT INTO public.email_campaigns (id, organizer_user_id, name, subject, status, type, practical, failed_count, policy_skipped_count)
    VALUES ($1, $4, 'Annonce', 'Objet', 'sending', 'promotional', false, 0, 0),
           ($2, $4, 'Pratique', 'Objet', 'sending', 'informational', true, 0, 0),
           ($3, $4, 'Abandons', 'Objet', 'sending', 'promotional', false, 0, 0)`, [CRM, INFO, STALE, A]);
  const people = ['ok1', 'ok2', 'optout', 'suppressed', 'repoussoir', 'optout_ailleurs'];
  for (const c of [CRM, INFO]) for (const p of people)
    await db.query(`INSERT INTO public.email_campaign_recipients (campaign_id, email, status, attempts)
      VALUES ($1, $2, 'pending', 0)`, [c, `${p}@x.test`]);
  // Après la mise en file : un désabonnement dans l'espace A, une plainte (suppression
  // globale), une adresse purgée (repoussoir de A), un désabonnement dans l'espace B.
  await db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, opted_out_at)
    VALUES ($1, 'optout@x.test', false, now()), ($2, 'optout_ailleurs@x.test', false, now()),
           ($1, 'ok1@x.test', true, NULL), ($1, 'optout_ailleurs@x.test', true, NULL)`, [A, B]);
  await db.query(`INSERT INTO public.email_suppressions (email, reason) VALUES ('suppressed@x.test', 'complaint')`);
  await db.query(`INSERT INTO public.email_opt_outs (organizer_user_id, email, reason) VALUES ($1, 'repoussoir@x.test', 'purged')`, [A]);
  // Abandons : 2 lignes « sending » réclamées il y a 20 min, l'une à sa 3e tentative.
  await db.query(`INSERT INTO public.email_campaign_recipients (campaign_id, email, status, attempts, claimed_at)
    VALUES ($1, 'stale1@x.test', 'sending', 3, now() - interval '20 minutes'),
           ($1, 'stale2@x.test', 'sending', 1, now() - interval '20 minutes')`, [STALE]);
}
const claim = async (c) => (await db.query(`SELECT email FROM public.claim_campaign_recipients($1, 100) ORDER BY email`, [c])).rows.map((r) => r.email.split('@')[0]);
const refunded = async () => Number((await db.query(`SELECT COALESCE(sum(delta), 0) AS n FROM public.crm_yunit_moves WHERE kind = 'refund'`)).rows[0].n);
const statusOf = async (c, who) => (await db.query(`SELECT status, error_message FROM public.email_campaign_recipients WHERE campaign_id = $1 AND email = $2`, [c, `${who}@x.test`])).rows[0];

// ── Avant : la définition de la prod ────────────────────────────────────────
await seed();
const before = await claim(CRM);
check('avant : le désabonné, l\'adresse en plainte et l\'adresse purgée partent quand même (faille reproduite)',
  ['optout', 'suppressed', 'repoussoir'].every((p) => before.includes(p)), before.join(', '));
await db.query(`SELECT public.requeue_stale_campaign_claims(10, 3)`);
const sb = (await db.query(`SELECT failed_count FROM public.email_campaigns WHERE id = $1`, [STALE])).rows[0].failed_count;
check('avant : un abandon après 3 tentatives ne compte pas dans failed_count et ne rend rien (faille reproduite)',
  sb === 0 && (await refunded()) === 0, `failed_count=${sb}`);

// ── Après la migration ──────────────────────────────────────────────────────
await execFile(db, MIGRATION, '20261021110000_audit_claim_recheck_consent.sql');
await seed();
const after = await claim(CRM);
check('après : seuls les accords valables partent', after.join(',') === 'ok1,ok2,optout_ailleurs', after.join(', '));
check('après : désabonné écarté avec sa raison', (await statusOf(CRM, 'optout')).error_message === 'policy:opted_out_after_queue');
check('après : plainte écartée avec sa raison', (await statusOf(CRM, 'suppressed')).error_message === 'policy:suppressed_after_queue');
check('après : adresse purgée écartée', (await statusOf(CRM, 'repoussoir')).status === 'skipped');
check('après : un désabonnement dans un AUTRE espace ne touche pas cet espace', after.includes('optout_ailleurs'));
const camp = (await db.query(`SELECT policy_skipped_count FROM public.email_campaigns WHERE id = $1`, [CRM])).rows[0];
check('après : les 3 écartés comptent dans « protégés par les règles Yuno »', camp.policy_skipped_count === 3);
check('après : 3 Yunits rendus', (await refunded()) === 3, `rendus=${await refunded()}`);
const again = await claim(CRM);
check('après : une 2e réclamation ne reprend rien et ne rend rien de plus', again.length === 0 && (await refunded()) === 3);
const info = await claim(INFO);
check('après : l\'e-mail pratique (service) part à tous les détenteurs, comme avant', info.length === 6, info.join(', '));

await db.query(`SELECT public.requeue_stale_campaign_claims(10, 3)`);
const st = (await db.query(`SELECT failed_count FROM public.email_campaigns WHERE id = $1`, [STALE])).rows[0].failed_count;
check('après : l\'abandon compte dans failed_count', st === 1, `failed_count=${st}`);
check('après : son Yunit revient (3 + 1)', (await refunded()) === 4);
check('après : la ligne à 1 tentative revient en file', (await statusOf(STALE, 'stale2')).status === 'pending');

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
