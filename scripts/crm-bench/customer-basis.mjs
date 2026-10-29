#!/usr/bin/env node
// Yuno CRM « Vos acheteurs » (exception clients, lot 1) : la migration
// 20261114100000_crm_customer_basis.sql rejouée sur les définitions de la PROD,
// avec un compte synthétique qui couvre chaque cas de la règle d'éligibilité.
//
//   node customer-basis.mjs roots   # racines lues dans la migration
//   node customer-basis.mjs dump    # instantané de la prod (définitions seulement)
//   node customer-basis.mjs         # test
//
// Aucune donnée de la prod : seules les définitions sont lues.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const MIGS = ['20261114100000_crm_customer_basis.sql', '20261114110000_crm_customer_basis_free_entries.sql',
  '20261114120000_crm_customer_basis_engine.sql'].map((f) => join(ROOT, 'supabase', 'migrations', f));
const SNAP = join(DATA, 'snapshot-customer-basis.sql');
const ROOTS = join(DATA, 'customer-basis-roots.txt');

if (process.argv[2] === 'roots') {
  const names = new Set([...MIGS.map((f) => readFileSync(f, 'utf8')).join('\n').matchAll(/\b([a-z_][a-z0-9_]{2,62})\b/gi)].map((m) => m[1].toLowerCase()));
  writeFileSync(ROOTS, [...names].sort().join('\n'));
  console.log('racines :', names.size);
  process.exit(0);
}
if (process.argv[2] === 'dump') {
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node customer-basis.mjs roots » puis « dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
// Banc : ni contraintes ni triggers de la prod hors sujet, ni colonnes obligatoires.
await db.exec(`DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.conrelid::regclass AS t, c.conname FROM pg_constraint c JOIN pg_class k ON k.oid = c.conrelid JOIN pg_namespace n ON n.oid = k.relnamespace
            WHERE n.nspname = 'public' AND c.contype IN ('f', 'c') AND c.conname <> 'legal_acceptances_doc_type_check' LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname); END LOOP;
  FOR r IN SELECT a.attrelid::regclass AS t, a.attname FROM pg_attribute a JOIN pg_class k ON k.oid = a.attrelid JOIN pg_namespace n ON n.oid = k.relnamespace
            WHERE n.nspname = 'public' AND k.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef AND a.attname <> 'id' LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.t, r.attname); END LOOP;
  FOR r IN SELECT tgname, tgrelid::regclass AS t FROM pg_trigger WHERE NOT tgisinternal LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.t); END LOOP; END $$;`);
for (const f of MIGS) await execFile(db, f, f.split('/').pop());
// Deux fois : les migrations doivent être rejouables (les patchs ciblés se reconnaissent).
for (const f of MIGS) await execFile(db, f, `${f.split('/').pop()} (2e passe)`);
check('migrations rejouables', true);

// ── Le compte synthétique ─────────────────────────────────────────────────────
const ORG = '11111111-1111-1111-1111-111111111111';     // organisateur titulaire
const EDITOR = '22222222-2222-2222-2222-222222222222';  // membre éditeur
const ADMIN = '33333333-3333-3333-3333-333333333333';   // super admin Yuno
const CONN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EV_OWN = 'e0000000-0000-0000-0000-000000000001';
const EV_CO = 'e0000000-0000-0000-0000-000000000002';
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${ORG}', 'boss@club.test'), ('${EDITOR}', 'ed@club.test'), ('${ADMIN}', 'admin@yuno.test');
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.org_members (organizer_user_id, member_user_id, role, invitation_status) VALUES ('${ORG}', '${EDITOR}', 'editor', 'accepted');
  INSERT INTO public.organizer_profiles (user_id, display_name) VALUES ('${ORG}', 'Club Test');
  INSERT INTO public.events (id, organizer_user_id, title, external_source, external_ticket_url)
  VALUES ('${EV_OWN}', '${ORG}', 'Nuit propre', 'shotgun', 'https://shotgun.live/events/nuit-propre'),
         ('${EV_CO}', '${ORG}', 'Nuit co', 'shotgun', 'https://shotgun.live/events/nuit-co');
  INSERT INTO public.external_events (id, connection_id, organizer_user_id, provider, external_id, external_role, event_id, name)
  VALUES (gen_random_uuid(), '${CONN}', '${ORG}', 'shotgun', 'X1', 'organizer', '${EV_OWN}', 'Nuit propre'),
         (gen_random_uuid(), '${CONN}', '${ORG}', 'shotgun', 'X2', 'editor', '${EV_CO}', 'Nuit co');
`);
// (adresse, soirée, statut, canal, prix, accord, achat, ordre de mise à jour, effacé)
const T = [
  ['a@x.test', 'X1', 'valid', null, 20, null, "now() - interval '2 months'"],      // éligible, champ absent
  ['b@x.test', 'X1', 'valid', null, 20, false, "now() - interval '2 months'"],     // éligible, jamais coché
  ['c@x.test', 'X1', 'valid', null, 20, true, "now() - interval '6 months'"],      // a coché…
  ['c@x.test', 'X1', 'valid', null, 20, false, "now() - interval '1 month'"],      // … puis retiré
  ['d@x.test', 'X2', 'valid', null, 20, null, "now() - interval '1 month'"],       // soirée co-organisée seule
  ['e@x.test', 'X1', 'valid', 'invitation', 0, null, "now() - interval '1 month'"],// invitation
  ['f@x.test', 'X1', 'valid', null, 0, null, "now() - interval '1 month'"],        // entrée gratuite (comptée, décision du 29/10)
  ['g@x.test', 'X1', 'valid', null, 20, null, "now() - interval '40 months'"],     // plus de 36 mois
  ['h@x.test', 'X1', 'valid', null, 20, null, "now() - interval '1 month'"],       // adresse supprimée
  ['i@x.test', 'X1', 'valid', null, 20, null, "now() - interval '1 month'"],       // désabonné dans la Billetterie
  ['j@x.test', 'X1', 'valid', null, 20, true, "now() - interval '1 month'"],       // a l'accord
  ['k@x.test', 'X1', 'valid', null, 20, null, "now() - interval '1 month'"],       // opposition transmise par le pro
  ['l@x.test', 'X1', 'refunded', null, 20, null, "now() - interval '1 month'"],    // remboursé
  ['m@x.test', 'X1', 'valid', null, 20, null, "now() - interval '1 month'", true], // effacé
  ['N@X.test ', 'X1', 'valid', null, 25, null, "now() - interval '3 months'"],     // casse et espaces
  ['n@x.test', 'X2', 'valid', null, 25, null, "now() - interval '1 month'"],       // + une soirée co : reste éligible
];
let i = 0;
for (const [email, xev, status, channel, price, optin, at, erased] of T) {
  i++;
  await db.query(`INSERT INTO public.external_tickets (id, connection_id, organizer_user_id, provider, external_id, external_event_id,
      status, deal_channel, price, newsletter_optin, buyer_email, buyer_first_name, purchased_at, source_updated_at, erased_at, event_id)
    VALUES (gen_random_uuid(), $1, $2, 'shotgun', $3, $4, $5, $6, $7, $8, $9, 'Prénom', ${at}, ${at}, ${erased ? 'now()' : 'NULL'}, $10)`,
    [CONN, ORG, `T${i}`, xev, status, channel, price, optin, email, xev === 'X1' ? EV_OWN : EV_CO]);
}
await db.exec(`
  INSERT INTO public.email_suppressions (id, email, reason) VALUES (gen_random_uuid(), 'H@x.test', 'hard_bounce');
  INSERT INTO public.email_opt_outs (id, organizer_user_id, email, reason, product) VALUES (gen_random_uuid(), '${ORG}', 'i@x.test', 'unsubscribed', NULL);
  INSERT INTO public.newsletter_subscriptions (id, organizer_user_id, email, opted_in, product) VALUES (gen_random_uuid(), '${ORG}', 'j@x.test', true, 'crm');
`);

const as = async (uid, email) => db.exec(`SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: 'authenticated', email })}', false)`);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const err = async (sql) => { try { await db.query(sql); return null; } catch (e) { return String(e.message); } };

// ── 1. La règle d'éligibilité ─────────────────────────────────────────────────
const rows = (await db.query(`SELECT email, objected_source, sales FROM public._crm_customer_eligible_rows(NULL, '${ORG}') ORDER BY email`)).rows;
const by = Object.fromEntries(rows.map((r) => [r.email, r]));
const expectIn = { 'a@x.test': null, 'b@x.test': null, 'c@x.test': 'provider_withdrawn', 'f@x.test': null, 'h@x.test': 'suppressed',
  'i@x.test': 'unsubscribe', 'j@x.test': null, 'k@x.test': null, 'n@x.test': null };
for (const [e, src] of Object.entries(expectIn)) check(`éligibilité ${e}`, e in by && (by[e].objected_source ?? null) === src, JSON.stringify(by[e]));
for (const e of ['d@x.test', 'e@x.test', 'g@x.test', 'l@x.test', 'm@x.test']) check(`hors base ${e}`, !(e in by));
check('n@x.test : une ligne malgré la casse, ventes propres seulement', by['n@x.test']?.sales === 1, JSON.stringify(by['n@x.test']));

// ── 2. Déclaration ────────────────────────────────────────────────────────────
const HASH = 'a'.repeat(64);
const CHECKS = `'{"seller":true,"own_nights_only":true,"informed":true,"forward_objections":true,"terms_read":true}'::jsonb`;
const declare = (checks = CHECKS, version = '2026-10-29') => `SELECT public.crm_customer_basis_declare(NULL, '${ORG}', '${version}', '${HASH}', 'Prénom Nom', 'gérant', ${checks}, 'fr', '{"extra":3}'::jsonb)`;
await as(ORG, 'boss@club.test');
check('fermée tant que ni ouverture générale ni bêta', (await err(declare()))?.includes('customer_basis_not_open'));
await as(ADMIN, 'admin@yuno.test');
check('motif obligatoire (super admin)', (await err(`SELECT public.crm_admin_customer_basis_set(NULL, '${ORG}', 'beta_on', '')`))?.includes('reason_required'));
await db.query(`SELECT public.crm_admin_customer_basis_set(NULL, '${ORG}', 'beta_on', 'compte bêta choisi par Paul')`);
check('journal admin', (await one(`SELECT count(*)::int n FROM public.admin_audit_log WHERE action = 'crm_customer_basis_beta_on'`)).n === 1);
check('le super admin ne signe pas à la place du titulaire', (await err(declare()))?.includes('crm_owner_only'));
await as(EDITOR, 'ed@club.test');
check('un éditeur ne signe pas', (await err(declare()))?.includes('crm_owner_only'));
await as(ORG, 'boss@club.test');
check('les cinq cases exigées', (await err(declare(`'{"seller":true}'::jsonb`)))?.includes('customer_basis_checks'));
check('version du texte exigée', (await err(declare(CHECKS, '2025-01-01')))?.includes('customer_basis_version'));
const g = (await one(declare())).crm_customer_basis_declare;
check('déclarée : active', g.status === 'active', JSON.stringify(g));
check('pas encore d\'envoi possible (infrastructure)', g.open === false && g.sending_ready === false);
const acc = await one(`SELECT doc_type, doc_version, doc_hash, context FROM public.legal_acceptances WHERE doc_type = 'crm_customer_basis'`);
check('preuve écrite (type, version, hash, chiffres vus)', acc?.doc_version === '2026-10-29' && acc?.doc_hash === HASH && acc?.context?.shown?.extra === 3);
check('alerte super admin', (await one(`SELECT count(*)::int n FROM public.admin_notifications WHERE notification_type = 'admin_crm_customer_basis_on'`)).n === 1);
const st = Object.fromEntries((await db.query(`SELECT email, state FROM public.crm_customer_contacts ORDER BY email`)).rows.map((r) => [r.email, r.state]));
check('personnes construites', st['a@x.test'] === 'eligible' && st['c@x.test'] === 'objected' && st['h@x.test'] === 'objected' && st['i@x.test'] === 'objected' && !st['d@x.test'], JSON.stringify(st));
const cnt = g.counts;
check('comptes : accord 1, en plus a b f k n', cnt.consent === 1 && cnt.extra === 5, JSON.stringify(cnt));

// ── 3. Oppositions ────────────────────────────────────────────────────────────
await db.query(`SELECT public.crm_customer_report_objection(NULL, '${ORG}', ARRAY['K@x.test', 'zz@x.test', 'pas-une-adresse'])`);
await db.query(`SELECT public._crm_customer_contacts_refresh(NULL, '${ORG}')`);
const k = await one(`SELECT state, objected_source FROM public.crm_customer_contacts WHERE email = 'k@x.test'`);
check('opposition transmise : définitive après reconstruction', k.state === 'objected' && k.objected_source === 'pro_reported', JSON.stringify(k));
check('adresse illisible ignorée', !(await one(`SELECT 1 x FROM public.crm_customer_contacts WHERE email = 'pas-une-adresse'`)));
const c2 = (await one(`SELECT public.crm_customer_basis_get(NULL, '${ORG}') g`)).g.counts;
check('comptes après opposition : en plus a b f n', c2.extra === 4 && c2.excluded.reported === 2, JSON.stringify(c2));

// ── 4. La garde de la campagne ────────────────────────────────────────────────
const CMP = 'ca000000-0000-0000-0000-000000000001';
await db.exec(`INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, legal_basis, event_id, blocks_json)
  VALUES ('${CMP}', '${ORG}', 'crm', 'promotional', 'draft', 'customer', '${EV_OWN}',
          '[{"id":"b1","type":"event","eventId":"${EV_OWN}"},{"id":"b2","type":"cta","url":"https://shotgun.live/events/nuit-propre?utm_source=yuno"}]'::jsonb)`);
const send = (extra = '') => err(`UPDATE public.email_campaigns SET status = 'sending'${extra} WHERE id = '${CMP}'`);
check('envoi refusé tant que l\'infrastructure n\'est pas prête', (await send())?.includes('crm_customer_basis_closed'));
await as(ADMIN, 'admin@yuno.test');
await db.query(`SELECT public.crm_admin_customer_basis_settings_set('{"sending_ready":true}'::jsonb, 'lot 3 en place (banc)')`);
await as(ORG, 'boss@club.test');
check('envoi accepté : soirée et liens propres', (await send()) === null);
await db.exec(`UPDATE public.email_campaigns SET status = 'draft' WHERE id = '${CMP}'`);
const withBlocks = (b) => send(`, blocks_json = '${JSON.stringify(b)}'::jsonb`);
check('bloc d\'une soirée co-organisée refusé', (await withBlocks([{ id: 'b1', type: 'event', eventId: EV_CO }]))?.includes('crm_customer_content'));
check('lien Shotgun d\'une autre soirée refusé', (await withBlocks([{ id: 'b1', type: 'cta', url: 'https://shotgun.live/events/nuit-co' }]))?.includes('crm_customer_content'));
check('autre billetterie refusée', (await withBlocks([{ id: 'b1', type: 'text', body: 'Aussi sur [url=https://dice.fm/x]Dice[/url]' }]))?.includes('crm_customer_content'));
check('Instagram du pro accepté', (await withBlocks([{ id: 'b1', type: 'cta', url: 'https://instagram.com/club' }])) === null);
await db.exec(`UPDATE public.email_campaigns SET status = 'draft' WHERE id = '${CMP}'`);
const chk = (await one(`SELECT public.crm_customer_email_check('${CMP}') c`)).c;
check('contrôle lisible par la Console', chk.customer === true && chk.ok === true, JSON.stringify(chk));
check('pas d\'e-mail pratique sur cette base', (await err(`UPDATE public.email_campaigns SET practical = true WHERE id = '${CMP}'`))?.includes('crm_customer_basis_scope'));
check('pas de campagne Billetterie sur cette base', (await err(`UPDATE public.email_campaigns SET product = 'suite' WHERE id = '${CMP}'`))?.includes('crm_customer_basis_scope'));
check('pas de renvoi en v1', (await err(`UPDATE public.email_campaigns SET resend_enabled = true WHERE id = '${CMP}'`))?.includes('crm_customer_basis_feature'));
await db.exec(`UPDATE public.email_campaigns SET status = 'sent' WHERE id = '${CMP}'`);
check('base légale figée une fois partie', (await err(`UPDATE public.email_campaigns SET legal_basis = 'consent' WHERE id = '${CMP}'`))?.includes('crm_customer_basis_locked'));
// Une campagne à l'accord ne voit rien de tout ça, même vers une soirée co-organisée.
await db.exec(`INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, event_id, blocks_json)
  VALUES ('ca000000-0000-0000-0000-000000000002', '${ORG}', 'crm', 'promotional', 'draft', '${EV_CO}', '[]'::jsonb)`);
check('campagne à l\'accord inchangée', (await err(`UPDATE public.email_campaigns SET status = 'sending' WHERE id = 'ca000000-0000-0000-0000-000000000002'`)) === null);

// ── 4 bis. Le moteur (lot 2) ─────────────────────────────────────────────────
const tok = async (e) => (await one(`SELECT unsubscribe_token t FROM public.crm_customer_contacts WHERE email = $1`, [e])).t;
// Désinscription par le jeton d'un client.
const ta = await tok('a@x.test');
check('aperçu de désinscription : jeton client reconnu', (await one(`SELECT * FROM public.preview_unsubscribe('${ta}')`))?.email === 'a@x.test');
const ua = await one(`SELECT * FROM public.unsubscribe_by_token('${ta}')`);
check('désinscription par jeton client', ua.success === true && ua.email === 'a@x.test', JSON.stringify(ua));
check('… la personne sort de la base', (await one(`SELECT state, objected_source s FROM public.crm_customer_contacts WHERE email = 'a@x.test'`)).s === 'unsubscribe');
check('… et entre au repoussoir CRM de l\'espace', !!(await one(`SELECT 1 x FROM public.email_opt_outs WHERE email = 'a@x.test' AND product = 'crm' AND organizer_user_id = '${ORG}'`)));
check('… aperçu : déjà désinscrit', (await one(`SELECT already_unsubscribed u FROM public.preview_unsubscribe('${ta}')`)).u === true);
// Un « stop » par le registre (jeton de newsletter) vaut aussi pour la base clients.
const nsTok = (await one(`SELECT unsubscribe_token t FROM public.newsletter_subscriptions WHERE email = 'j@x.test'`)).t;
await db.query(`SELECT * FROM public.unsubscribe_by_token('${nsTok}')`);
check('stop au registre ⇒ client écarté', (await one(`SELECT state FROM public.crm_customer_contacts WHERE email = 'j@x.test'`)).state === 'objected');
await db.exec(`UPDATE public.newsletter_subscriptions SET opted_in = true, opted_out_at = NULL WHERE email = 'j@x.test'`);

// Mise en file : base légale par ligne, pression 30 jours, montée progressive.
const C3 = 'ca000000-0000-0000-0000-000000000003';
await db.exec(`INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, legal_basis, event_id, blocks_json)
  VALUES ('${C3}', '${ORG}', 'crm', 'promotional', 'draft', 'customer', '${EV_OWN}', '[]'::jsonb)`);
// b@x a déjà reçu 4 e-mails « clients » ce mois-ci (le plafond), par 4 campagnes passées.
for (let n = 1; n <= 4; n++) {
  const past = `ca000000-0000-0000-0000-00000000010${n}`;
  await db.exec(`INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, legal_basis, event_id, blocks_json)
    VALUES ('${past}', '${ORG}', 'crm', 'promotional', 'draft', 'customer', '${EV_OWN}', '[]'::jsonb)`);
  await db.query(`INSERT INTO public.email_campaign_recipients (id, campaign_id, email, status, sent_at, legal_basis, attempts)
    VALUES (gen_random_uuid(), $1, 'b@x.test', 'sent', now() - interval '${n} days', 'customer', 1)`, [past]);
}
const ins = async (id, email, t) => db.query(`INSERT INTO public.email_campaign_recipients (id, campaign_id, email, unsubscribe_token, status, attempts)
  VALUES ($1, '${C3}', $2, $3, 'pending', 0)`, [id, email, t]);
await ins('00000000-0000-0000-0000-0000000000a1', 'j@x.test', nsTok);
await ins('00000000-0000-0000-0000-0000000000a2', 'b@x.test', await tok('b@x.test'));
await ins('00000000-0000-0000-0000-0000000000a3', 'f@x.test', await tok('f@x.test'));
await ins('00000000-0000-0000-0000-0000000000a4', 'n@x.test', await tok('n@x.test'));
await db.exec(`UPDATE public.crm_customer_basis SET ramp_cap = 1`);
const after = (await one(`SELECT public._crm_customer_after_enqueue('${C3}', '{"queued":4,"total":4,"remaining":4}'::jsonb) r`)).r;
const q = Object.fromEntries((await db.query(`SELECT email, legal_basis, status, error_message, next_attempt_at FROM public.email_campaign_recipients WHERE campaign_id = '${C3}'`)).rows.map((r) => [r.email, r]));
check('base légale posée par ligne', q['j@x.test'].legal_basis === 'consent' && q['f@x.test'].legal_basis === 'customer', JSON.stringify(q));
check('plafond de 4 e-mails « clients » / 30 j', q['b@x.test'].status === 'skipped' && q['b@x.test'].error_message === 'policy:customer_pressure_30d');
const ramped = ['f@x.test', 'n@x.test'].map((e) => q[e].next_attempt_at);
check('montée progressive : 1 aujourd\'hui, le suivant demain 10 h', ramped.filter((x) => x === null).length === 1 && ramped.filter((x) => x !== null).length === 1, JSON.stringify(ramped));
check('compteurs rendus', after.queued === 3 && after.customer_pressure_skipped === 1 && after.customer_ramped === 1, JSON.stringify(after));
check('rejouable : rien ne bouge au 2e appel', (await one(`SELECT public._crm_customer_after_enqueue('${C3}', '{"queued":0}'::jsonb) r`)).r.customer_ramped === 0);

// Réclamation : un lot ne mêle pas deux bases ; un client ne part que si la base est ouverte.
await db.exec(`UPDATE public.email_campaign_recipients SET next_attempt_at = NULL WHERE campaign_id = '${C3}'`);
await db.exec(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
const b1 = (await db.query(`SELECT * FROM public.claim_campaign_recipients('${C3}', 100)`)).rows;
check('1er lot : la ligne à l\'accord seule', b1.length === 1 && b1[0].email === 'j@x.test', JSON.stringify(b1.map((r) => r.email)));
await db.exec(`UPDATE public.crm_customer_basis_settings SET sending_ready = false`);
const b2 = (await db.query(`SELECT * FROM public.claim_campaign_recipients('${C3}', 100)`)).rows;
const closed = (await db.query(`SELECT email, status, error_message FROM public.email_campaign_recipients WHERE campaign_id = '${C3}' AND email IN ('f@x.test','n@x.test')`)).rows;
check('base fermée : les clients ne partent pas', b2.length === 0 && closed.every((r) => r.status === 'skipped' && r.error_message === 'policy:customer_basis_closed'), JSON.stringify(closed));
await db.exec(`UPDATE public.crm_customer_basis_settings SET sending_ready = true`);

// Plainte d'un client : il sort ; effacement d'un billet : il disparaît.
await db.exec(`UPDATE public.email_campaign_recipients SET status = 'sending' WHERE campaign_id = '${C3}' AND email = 'f@x.test'`);
await db.exec(`UPDATE public.email_campaign_recipients SET status = 'complained' WHERE campaign_id = '${C3}' AND email = 'f@x.test'`);
check('plainte ⇒ client écarté', (await one(`SELECT objected_source s FROM public.crm_customer_contacts WHERE email = 'f@x.test'`)).s === 'complaint');
await db.exec(`UPDATE public.external_tickets SET erased_at = now() WHERE lower(btrim(buyer_email)) = 'n@x.test' AND external_event_id = 'X1'`);
check('billet effacé ⇒ client retiré', !(await one(`SELECT 1 x FROM public.crm_customer_contacts WHERE email = 'n@x.test'`)));
await as(ORG, 'boss@club.test');

// ── 5. Version, échéance, fermeture ───────────────────────────────────────────
await as(ADMIN, 'admin@yuno.test');
await db.query(`SELECT public.crm_admin_customer_basis_settings_set('{"declaration_version":"2026-12-01"}'::jsonb, 'nouveau texte')`);
check('nouvelle version : base suspendue', (await one(`SELECT status, suspended_reason r FROM public.crm_customer_basis`)).r === 'version');
await as(ORG, 'boss@club.test');
await db.query(declare(CHECKS, '2026-12-01'));
check('nouvelle signature : base rouverte', (await one(`SELECT status FROM public.crm_customer_basis`)).status === 'active');
await db.exec(`UPDATE public.crm_customer_basis SET expires_at = now() - interval '1 day'`);
await db.query(`SELECT public.crm_customer_basis_nightly()`);
check('échue : suspendue par la nuit', (await one(`SELECT suspended_reason r FROM public.crm_customer_basis`)).r === 'expired');
await db.query(`SELECT public.crm_customer_basis_off(NULL, '${ORG}')`);
const left = (await db.query(`SELECT state, count(*)::int n FROM public.crm_customer_contacts GROUP BY 1`)).rows;
check('fermée : seules les oppositions restent', left.length === 1 && left[0].state === 'objected', JSON.stringify(left));

// ── 6. Droits ─────────────────────────────────────────────────────────────────
const priv = (await db.query(`SELECT p.oid::regprocedure::text f,
    has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND (p.proname LIKE '%crm_customer%' OR p.proname IN ('guard_crm_customer_basis', 'get_recipient_customer_reasons'))`)).rows;
for (const r of priv) {
  const internal = /^(_crm_customer|crm_customer_basis_open|crm_customer_basis_nightly|guard_crm_customer_basis|trg_crm_customer|get_recipient_customer_reasons)/.test(r.f);
  check(`droits ${r.f}`, !r.a && (internal ? !r.u : r.u));
}

console.log(failed ? `\n${failed} échec(s)` : '\nTout est vert.');
process.exit(failed ? 1 : 0);
