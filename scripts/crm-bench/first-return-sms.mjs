#!/usr/bin/env node
// Recette « Faire revenir après la 1re soirée », étape SMS : un SMS bloqué
// faute de Yunits attend, repart quand le solde suffit, et ne part plus une
// fois sa fenêtre passée (20261014120000).
//
//   node first-return-sms.mjs demo
//
// Sur une base GÉNÉRÉE : e-mails de la recette partis il y a 4 jours (SMS dû à
// 3 jours, fenêtre jusqu'à 6), collecte, échec simulé de l'envoi (ce que fait
// send-sms-campaign quand le solde manque), puis les passages suivants.
import { openSaved } from './lib.mjs';

process.on('uncaughtException', (e) => {
  console.error(`ERREUR ${e.code || ''} : ${e.message}${e.where ? `\n  où : ${e.where}` : ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (e) => { throw e; });

const name = process.argv[2] || 'demo';
const db = await openSaved(name);
const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
const scope = `org:${org}`;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
let ok = true;
const check = (label, cond, got) => { console.log(`${cond ? '✓' : '✗'} ${label}${got !== undefined ? ` (${JSON.stringify(got)})` : ''}`); if (!cond) ok = false; };

await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
// Identité légale de l'expéditeur (exigée avant tout SMS).
await db.query(`UPDATE organizer_profiles SET legal_name = 'Banc SAS', siret = '12345678900011' WHERE user_id = $1`, [org]);
const ev = (await one(`SELECT event_id FROM external_events WHERE organizer_user_id = $1 AND start_at > now() + interval '5 days' ORDER BY start_at LIMIT 1`, [org])).event_id;
// La recette, étape SMS allumée.
const auto = (await one(`
  INSERT INTO email_automations (organizer_user_id, kind, enabled, enabled_at, sms_enabled, sms_body, sms_delay_days)
  VALUES ($1, 'first_return', true, now() - interval '30 days', true, 'On vous attend ce week-end', 3) RETURNING id`, [org])).id;
// 40 e-mails de la recette partis il y a 4 jours, à des contacts au numéro consenti et sans place.
const people = await q(`
  SELECT DISTINCT lower(vc.email) AS em FROM venue_sms_contacts vc
   WHERE vc.organizer_user_id = $1 AND vc.phone_e164 LIKE '+33%'
     AND NOT EXISTS (SELECT 1 FROM external_tickets t JOIN events e ON e.id = t.event_id
                      WHERE lower(t.buyer_email) = lower(vc.email) AND e.start_at > now())
   ORDER BY 1 LIMIT 40`, [org]);
const camp = (await one(`
  INSERT INTO email_campaigns (organizer_user_id, name, subject, status, event_id, automation_id, child_kind, product, blocks_version)
  VALUES ($1, 'Banc · 1re soirée', 'On vous attend', 'sent', $2, $3, 'automation', 'crm', 2) RETURNING id`, [org, ev, auto])).id;
for (const p of people) {
  await db.query(`INSERT INTO email_automation_sends (automation_id, organizer_user_id, kind, trigger_key, email, status, campaign_id, trigger_event_id)
                  VALUES ($1, $5, 'first_return', 'fr', $2, 'queued', $3, $4)`, [auto, p.em, camp, ev, org]);
  await db.query(`INSERT INTO email_campaign_recipients (campaign_id, email, status, sent_at)
                  VALUES ($1, $2, 'sent', now() - interval '4 days')`, [camp, p.em]);
}
console.log(`${people.length} e-mails de la recette partis il y a 4 jours ; soirée ${ev}`);

const card = async () => {
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: org, role: 'authenticated' })]);
  const r = (await one(`SELECT crm_automations(NULL, $1, '30d') AS r`, [org])).r;
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  return r.recipes.find((x) => x.kind === 'first_return')?.sms;
};
const collect = async () => (await one(`SELECT crm_first_return_sms_collect() AS r`)).r;
const fail = () => db.query(`UPDATE sms_campaigns SET status = 'draft', error_message = 'crm_yunits_insufficient', segments_per_message = 1
                              WHERE segment_filters->>'automation_id' = $1 AND status = 'scheduled'`, [auto]);
const status = async () => q(`SELECT status, error_message, (SELECT count(*) FROM sms_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'pending')::int AS pending
                                FROM sms_campaigns c WHERE segment_filters->>'automation_id' = $1 ORDER BY created_at`, [auto]);

// 1. La collecte crée la campagne et la programme.
const c1 = await collect();
const n = c1.recipients;
check('collecte : campagne programmée', c1.campaigns === 1 && n > 0, c1);
// 2. L'envoi échoue faute de Yunits (comme send-sms-campaign), le solde est vide.
await fail();
await db.query(`UPDATE crm_yunit_lots SET remaining = 0 WHERE scope_key = $1`, [scope]);
const c2 = await collect();
check('solde vide : rien ne repart', c2.retried === 0 && c2.campaigns === 0, c2);
let s = await card();
check(`carte : ${n} en attente de Yunits, 0 envoyé`, s.waiting === n && s.sent === 0, s);
// 3. Le pro recharge : la campagne repart seule.
await db.query(`UPDATE crm_yunit_lots SET remaining = 1000000 WHERE scope_key = $1`, [scope]);
const c3 = await collect();
check('recharge : la campagne repart', c3.retried === n, c3);
check('campagne programmée', (await status())[0].status === 'scheduled', await status());
// 4. Les SMS partent (simulé) : la carte les compte, ils ne sont plus en attente.
await db.query(`UPDATE sms_campaign_recipients SET status = 'sent', sent_at = now()
                 WHERE campaign_id IN (SELECT id FROM sms_campaigns WHERE segment_filters->>'automation_id' = $1)`, [auto]);
await db.query(`UPDATE sms_campaigns SET status = 'sent' WHERE segment_filters->>'automation_id' = $1`, [auto]);
s = await card();
check(`carte : ${n} envoyés, 0 en attente`, s.sent === n && s.waiting === 0, s);
check('pas de double envoi : la collecte ne reprend personne', (await collect()).recipients === 0);

// 5. Une seconde vague retombe faute de Yunits, puis sa fenêtre passe.
await db.query(`DELETE FROM crm_first_return_sms WHERE automation_id = $1`, [auto]);
await db.query(`UPDATE email_campaign_recipients SET sent_at = now() - interval '4 days' WHERE campaign_id = $1`, [camp]);
const c5 = await collect();
await fail();
await db.query(`UPDATE crm_yunit_lots SET remaining = 0 WHERE scope_key = $1`, [scope]);
await collect();
await db.query(`UPDATE email_campaign_recipients SET sent_at = now() - interval '7 days' WHERE campaign_id = $1`, [camp]);
const c6 = await collect();
check(`fenêtre passée : ${c5.recipients} marqués non envoyés`, c6.expired === c5.recipients, c6);
const st = await status();
check('campagne vide annulée', st[st.length - 1].status === 'cancelled' && st[st.length - 1].pending === 0, st[st.length - 1]);
s = await card();
check(`carte : ${c5.recipients} non envoyés (fenêtre passée), 0 en attente`, s.expired === c5.recipients && s.waiting === 0, s);
// 6. Recharger après coup ne fait rien partir.
await db.query(`UPDATE crm_yunit_lots SET remaining = 1000000 WHERE scope_key = $1`, [scope]);
check('recharge après la fenêtre : rien ne repart', (await collect()).retried === 0);

console.log(ok ? '\nTOUT EST BON' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
