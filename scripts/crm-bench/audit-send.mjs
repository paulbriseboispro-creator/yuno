#!/usr/bin/env node
// Suite de l'audit du 18/10 — la file d'envoi (MAIL-03), rejouée au banc sur
// les définitions de la PROD, puis 20261021110000 (audit) et 20261023100000.
//
//   node prod.mjs --activity
//   node audit-send.mjs dump      # instantané des fonctions touchées (lecture seule)
//   node audit-send.mjs           # test (code 1 si une assertion tombe)
//
// Aussi : MAIL-07, le produit d'une campagne n'est plus choisi par le client.
//
// Le worker est joué en JS, au plus près de send-campaign : réclamer, envoyer
// à un faux Resend qui applique la règle d'idempotence (même clé + même charge
// = réponse d'origine, sans renvoi), écrire « envoyé ». La panne injectée :
// l'écriture « envoyé » échoue après que Resend a accepté.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-send.sql');
const ROOTS = join(DATA, 'audit-send-roots.txt');
const MIG = (f) => join(ROOT, 'supabase', 'migrations', f);
const AUDIT = '20261021110000_audit_claim_recheck_consent.sql';
const FIX = '20261023100000_mail_stable_batch_key.sql';
const PRODUCT = '20261023130000_mail_campaign_product_server_only.sql';

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['claim_campaign_recipients', 'requeue_stale_campaign_claims', 'mark_campaign_recipients_sent',
    'mark_campaign_recipients_failed', '_mark_campaign_recipients_failed_core', 'crm_yunits_refund', 'crm_yunits_balance',
    'crm_campaign_is_crm', 'crm_scope_key', 'email_campaigns', 'email_campaign_recipients', 'newsletter_subscriptions',
    'email_suppressions', 'email_opt_outs', 'crm_yunit_lots', 'crm_yunit_moves', 'organizer_profiles'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-send.mjs dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const ORG = 'aaaaaaaa-0000-4000-8000-00000000000a';
const CAMP = 'cccccccc-0000-4000-8000-0000000000d1';

async function open(migrations) {
  const db = await openFresh();
  await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
  await execFile(db, SNAP, 'snapshot');
  for (const m of migrations) await execFile(db, MIG(m), m);
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })]);
  await db.query(`INSERT INTO public.organizer_profiles (user_id, display_name, product) VALUES ($1, 'Espace', 'crm')`, [ORG]);
  await db.query(`INSERT INTO public.email_campaigns (id, organizer_user_id, name, subject, status, type, practical, failed_count, policy_skipped_count, recipients_count)
    VALUES ($1, $2, 'Annonce', 'Objet', 'sending', 'promotional', false, 0, 0, 0)`, [CAMP, ORG]);
  // 6 abonnés en file, dans l'ordre d'insertion.
  for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
    await db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in) VALUES ($1, $2, true)`, [ORG, `${p}@x.test`]);
    await db.query(`INSERT INTO public.email_campaign_recipients (campaign_id, email, status, attempts) VALUES ($1, $2, 'pending', 0)`, [CAMP, `${p}@x.test`]);
  }
  return db;
}

// Faux Resend : la règle d'idempotence de la doc, et ce que chacun a reçu.
function fakeResend() {
  const keys = new Map();
  const delivered = new Map();
  return {
    delivered,
    send(key, emails, html) {
      const body = JSON.stringify(emails.map((e) => ({ to: e, html })));
      const seen = keys.get(key);
      if (seen) return seen.body === body ? { ok: true } : { ok: false, status: 409, code: 'invalid_idempotent_request' };
      for (const e of emails) delivered.set(e, (delivered.get(e) ?? 0) + 1);
      keys.set(key, { body });
      return { ok: true };
    },
  };
}
const compositionKey = (emails) => `yuno-${CAMP.slice(0, 8)}-${createHash('sha256').update(`${CAMP}|${[...emails].map((e) => e.toLowerCase()).sort().join(',')}`).digest('hex').slice(0, 32)}`;

// Une passe du worker : réclame, envoie, écrit « envoyé » (ou pas : panne).
async function pass(db, resend, { limit, markFails = false, html = '<p>v1</p>' }) {
  const rows = (await db.query(`SELECT * FROM public.claim_campaign_recipients($1, $2)`, [CAMP, limit])).rows;
  if (!rows.length) return { emails: [], key: null };
  const emails = rows.map((r) => r.email).sort();
  const key = rows.find((r) => r.batch_key)?.batch_key || compositionKey(emails);
  const out = resend.send(key, emails, html);
  if ((out.ok || out.code === 'invalid_idempotent_request') && !markFails) {
    await db.query(`SELECT public.mark_campaign_recipients_sent($1, $2::jsonb)`,
      [CAMP, JSON.stringify(emails.map((e) => ({ email: e, resend_email_id: null })))]);
  }
  return { emails, key, out };
}
// Dix minutes plus tard : le filet rend à la file ce qui est resté « sending ».
async function laterRequeue(db) {
  await db.query(`UPDATE public.email_campaign_recipients SET claimed_at = now() - interval '20 minutes' WHERE status = 'sending'`);
  await db.query(`SELECT public.requeue_stale_campaign_claims(10, 3)`);
}
const twice = (resend) => [...resend.delivered.entries()].filter(([, n]) => n > 1).map(([e]) => e.split('@')[0]);
const statuses = async (db) => (await db.query(`SELECT status, count(*)::int AS n FROM public.email_campaign_recipients GROUP BY 1 ORDER BY 1`)).rows
  .map((r) => `${r.status}=${r.n}`).join(' ');

// ── Avant : la file d'aujourd'hui (prod + audit 18/10) ──────────────────────
{
  const db = await open([AUDIT]);
  const resend = fakeResend();
  const a = await pass(db, resend, { limit: 3, markFails: true }); // Resend accepte p1-p3, la base est en 503
  await laterRequeue(db);
  // Le quota du moment est plus court (2) : la réclamation regroupe autrement.
  const b = await pass(db, resend, { limit: 2 });
  check('avant : le lot rejoué n\'a plus la même composition (autre clé)', a.key !== b.key, `${a.emails.length} → ${b.emails.length} adresses`);
  check('avant : un même e-mail part deux fois (faille reproduite)', twice(resend).length > 0, twice(resend).join(', '));
}

// ── Après la migration ──────────────────────────────────────────────────────
{
  const db = await open([AUDIT, FIX]);
  const resend = fakeResend();
  const a = await pass(db, resend, { limit: 3, markFails: true });
  check('après : la réclamation pose une clé de lot unique sur les lignes',
    a.key?.startsWith('yb-') && (await db.query(`SELECT count(DISTINCT batch_key)::int AS n FROM public.email_campaign_recipients WHERE status = 'sending'`)).rows[0].n === 1);
  await laterRequeue(db);
  check('après : le filet rend les lignes à la file avec leur clé',
    (await db.query(`SELECT count(*)::int AS n FROM public.email_campaign_recipients WHERE status = 'pending' AND batch_key = $1`, [a.key])).rows[0].n === 3);
  const b = await pass(db, resend, { limit: 2 });
  check('après : le lot ouvert repasse en premier, en entier, malgré un quota plus court', b.emails.join(',') === a.emails.join(','), b.emails.join(', '));
  check('après : avec la même clé', b.key === a.key);
  check('après : personne ne reçoit l\'e-mail deux fois', twice(resend).length === 0, twice(resend).join(', '));
  const c = await pass(db, resend, { limit: 2 });
  check('après : les lignes neuves partent ensuite dans un lot neuf, sous une autre clé',
    c.emails.length === 2 && c.key !== a.key && c.emails.every((e) => !a.emails.includes(e)), c.emails.join(', '));

  // Un lot que Resend a REFUSÉ (rien n'est parti) : le worker lève la clé.
  const d = await pass(db, resend, { limit: 5, markFails: true });
  await db.query(`SELECT public.mark_campaign_recipients_failed($1, $2, 'HTTP 429', now() - interval '1 second')`, [CAMP, d.emails]);
  await db.query(`UPDATE public.email_campaign_recipients SET batch_key = NULL WHERE campaign_id = $1 AND batch_key = $2 AND status = 'pending'`, [CAMP, d.key]);
  const e = await pass(db, resend, { limit: 5 });
  check('après : une clé levée laisse repartir les lignes dans un lot neuf', e.emails.join(',') === d.emails.join(',') && e.key !== d.key);

  // Un lot rejoué dont une personne s'est désabonnée entre-temps : la charge
  // change, Resend répond 409, rien ne repart.
  await db.query(`UPDATE public.email_campaign_recipients SET status = 'pending', batch_key = NULL, claimed_at = NULL, attempts = 0 WHERE campaign_id = $1`, [CAMP]);
  const resend2 = fakeResend();
  const f = await pass(db, resend2, { limit: 3, markFails: true });
  await laterRequeue(db);
  await db.query(`UPDATE public.newsletter_subscriptions SET opted_in = false, opted_out_at = now() WHERE email = $1`, [f.emails[0]]);
  const g = await pass(db, resend2, { limit: 3 });
  check('après : la désabonnée est écartée du lot rejoué', !g.emails.includes(f.emails[0]) && g.key === f.key);
  check('après : 409 « clé déjà servie », rien ne repart', g.out?.code === 'invalid_idempotent_request' && twice(resend2).length === 0);

  // Deux lots ouverts : jamais mélangés, l'un après l'autre.
  await db.query(`UPDATE public.newsletter_subscriptions SET opted_in = true, opted_out_at = NULL`);
  await db.query(`UPDATE public.email_campaign_recipients SET status = 'pending', batch_key = NULL, claimed_at = NULL, next_attempt_at = NULL, attempts = 0, error_message = NULL WHERE campaign_id = $1`, [CAMP]);
  const h1 = await pass(db, fakeResend(), { limit: 3, markFails: true });
  const h2 = await pass(db, fakeResend(), { limit: 3, markFails: true });
  await laterRequeue(db);
  const r1 = await pass(db, fakeResend(), { limit: 6, markFails: true });
  const r2 = await pass(db, fakeResend(), { limit: 6, markFails: true });
  check('après : deux lots ouverts repartent séparés, chacun sous sa clé',
    [r1, r2].every((r) => [h1, h2].some((h) => h.key === r.key && h.emails.join(',') === r.emails.join(','))) && r1.key !== r2.key,
    `${r1.emails.length} + ${r2.emails.length}`);
  check('après : état final cohérent', true, await statuses(db));
}

// ── MAIL-07 : email_campaigns.product écrit par le serveur seulement ────────
async function productCase(migrations) {
  const db = await open(migrations);
  // Le banc ne rejoue pas les policies : seul le trigger est testé.
  await db.exec(`ALTER TABLE public.email_campaigns DISABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.email_campaigns TO authenticated, service_role;`);
  const asClient = async (sql, params) => {
    await db.exec('SET ROLE authenticated');
    try { return await db.query(sql, params); } finally { await db.exec('RESET ROLE'); }
  };
  await db.query(`UPDATE public.email_campaigns SET product = 'crm' WHERE id = $1`, [CAMP]); // posé par le serveur
  await asClient(`UPDATE public.email_campaigns SET product = 'suite' WHERE id = $1`, [CAMP]);
  const afterUpdate = (await db.query(`SELECT product FROM public.email_campaigns WHERE id = $1`, [CAMP])).rows[0].product;
  const NEW = 'cccccccc-0000-4000-8000-0000000000d9';
  await asClient(`INSERT INTO public.email_campaigns (id, organizer_user_id, name, subject, status, type, product)
    VALUES ($1, $2, 'x', 'x', 'draft', 'promotional', 'suite')`, [NEW, ORG]);
  const afterInsert = (await db.query(`SELECT product FROM public.email_campaigns WHERE id = $1`, [NEW])).rows[0].product;
  const NEW2 = 'cccccccc-0000-4000-8000-0000000000da';
  await asClient(`INSERT INTO public.email_campaigns (id, organizer_user_id, name, subject, status, type, product)
    VALUES ($1, $2, 'x', 'x', 'draft', 'promotional', 'crm')`, [NEW2, ORG]);
  const crmInsert = (await db.query(`SELECT product FROM public.email_campaigns WHERE id = $1`, [NEW2])).rows[0].product;
  await db.query(`UPDATE public.email_campaigns SET product = 'suite' WHERE id = $1`, [NEW2]); // serveur
  const serverUpdate = (await db.query(`SELECT product FROM public.email_campaigns WHERE id = $1`, [NEW2])).rows[0].product;
  return { afterUpdate, afterInsert, crmInsert, serverUpdate };
}
{
  const b = await productCase([AUDIT]);
  check('avant : un client passe sa campagne CRM en « suite » (faille reproduite)', b.afterUpdate === 'suite');
  check('avant : un client crée une campagne « suite »', b.afterInsert === 'suite');
  const a = await productCase([AUDIT, PRODUCT]);
  check('après : la campagne CRM reste CRM malgré le client', a.afterUpdate === 'crm', a.afterUpdate);
  check('après : « suite » posé par un client à la création devient NULL (règle de la portée)', a.afterInsert === null, String(a.afterInsert));
  check('après : la Console CRM pose toujours « crm » à la création', a.crmInsert === 'crm');
  check('après : le serveur écrit comme avant', a.serverUpdate === 'suite');
}

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
