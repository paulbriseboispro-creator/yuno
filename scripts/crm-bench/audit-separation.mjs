#!/usr/bin/env node
// Séparation STRICTE Yuno CRM ⇄ Yuno Tickets (décision de Paul du 20/10) : avant / après sur les
// définitions de la PROD rejouées dans PGlite, avec les migrations `20261107*` du dépôt.
//
//   node audit-separation.mjs roots   # écrit .data/audit-separation-roots.txt (fonctions et tables à lire)
//   node audit-separation.mjs dump    # instantané de la prod (lecture seule, définitions seulement)
//   node audit-separation.mjs         # test
//
// Trois comptes synthétiques (organisateurs) :
//   O1 = DEUX produits (Billetterie + CRM) : ventes Yuno, billets Shotgun, registre de consentement
//        mêlé (achat, guest list, connecteur, page d'inscription, fichier importé), fichiers importés,
//        contacts SMS, engagement ;
//   O2 = CRM PUR (Shotgun, connecteur, page d'inscription, fichier importé) ;
//   O3 = Billetterie PURE (ventes Yuno, accords d'achat, fichier importé).
// Ce que le test prouve :
//   • O2 (CRM pur) : la vue CRM d'après est IDENTIQUE à la vue d'avant, ligne à ligne ;
//   • O3 (Billetterie pure) : la vue Billetterie d'après est IDENTIQUE à celle d'avant ;
//   • O1 : la vue Billetterie ne contient ni acheteur Shotgun, ni accord du connecteur / d'une page
//     d'inscription ; la vue CRM ne contient ni client Yuno, ni dépense Yuno, ni accord né d'un achat ;
//     les fichiers importés du compte à deux produits sont COPIÉS (le CRM garde sa base) ;
//   • les deux jeux de lignes sont indépendants : retirer un accord d'un produit ne touche pas l'autre,
//     sauf la désinscription (une personne qui dit stop, c'est pour les deux).
// Aucune donnée de la prod : seules les définitions sont lues.
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-separation.sql');
const ROOTS = join(DATA, 'audit-separation-roots.txt');
const MIG_DIR = join(ROOT, 'supabase', 'migrations');
const migrations = () => readdirSync(MIG_DIR).filter((f) => /^20261107\d{6}_crm_billetterie_(isolation|separation)_.*\.sql$/.test(f)).sort();

if (process.argv[2] === 'roots') {
  const names = new Set();
  for (const f of migrations()) {
    const t = readFileSync(join(MIG_DIR, f), 'utf8');
    for (const m of t.matchAll(/\b([a-z_][a-z0-9_]{2,62})\b/gi)) names.add(m[1].toLowerCase());
  }
  writeFileSync(ROOTS, [...names].sort().join('\n'));
  console.log('racines :', names.size);
  process.exit(0);
}
if (process.argv[2] === 'dump') {
  if (!existsSync(ROOTS)) throw new Error("lancer d'abord « node audit-separation.mjs roots »");
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error("lancer d'abord « node audit-separation.mjs roots » puis « dump »");

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
process.on('uncaughtException', (e) => { console.error('ERREUR :', String(e.message).slice(0, 600)); process.exit(2); });

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
// Les valeurs par défaut des tables citent des fonctions que l'instantané définit APRÈS les tables.
await db.exec(`CREATE OR REPLACE FUNCTION public.paris_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Europe/Paris')::date $$;`);
await execFile(db, SNAP, 'snapshot');
// L'instantané ne rend pas les colonnes GÉNÉRÉES : contact_engagement.scope_key l'est en prod.
await db.exec(`ALTER TABLE public.contact_engagement DROP COLUMN scope_key;
  ALTER TABLE public.contact_engagement ADD COLUMN scope_key text GENERATED ALWAYS AS (COALESCE('v:' || venue_id, 'o:' || organizer_user_id::text, 'p')) STORED;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_engagement_scope_email ON public.contact_engagement (scope_key, email);
  CREATE INDEX IF NOT EXISTS idx_contact_engagement_scope_status ON public.contact_engagement (scope_key, status);`);
// Banc : ni triggers ni contraintes ni colonnes obligatoires hors sujet.
const relax = async (dropTriggers = true) => db.exec(`DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.conrelid::regclass AS t, c.conname FROM pg_constraint c JOIN pg_class k ON k.oid = c.conrelid JOIN pg_namespace n ON n.oid = k.relnamespace
            WHERE n.nspname = 'public' AND c.contype IN ('f', 'c') LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname); END LOOP;
  FOR r IN SELECT a.attrelid::regclass AS t, a.attname FROM pg_attribute a JOIN pg_class k ON k.oid = a.attrelid JOIN pg_namespace n ON n.oid = k.relnamespace
            WHERE n.nspname = 'public' AND k.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef AND a.attname <> 'id' LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.t, r.attname); END LOOP;
  IF ${dropTriggers} THEN FOR r IN SELECT tgname, tgrelid::regclass AS t FROM pg_trigger WHERE NOT tgisinternal LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.t); END LOOP; END IF; END $$;`);
await relax();
// Les migrations désactivent puis rétablissent quelques triggers de la prod (updated_at…) : il leur faut exister.
await db.exec(`CREATE OR REPLACE FUNCTION public.bench_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER trg_sms_campaigns_updated_at BEFORE UPDATE ON public.sms_campaigns FOR EACH ROW EXECUTE FUNCTION public.bench_noop();
  CREATE TRIGGER trg_newsletter_subs_updated_at BEFORE UPDATE ON public.newsletter_subscriptions FOR EACH ROW EXECUTE FUNCTION public.bench_noop();
  CREATE TRIGGER trg_email_automations_before_write BEFORE UPDATE ON public.email_automations FOR EACH ROW EXECUTE FUNCTION public.bench_noop();
  CREATE TRIGGER trg_email_campaign_templates_updated_at BEFORE UPDATE ON public.email_campaign_templates FOR EACH ROW EXECUTE FUNCTION public.bench_noop();`);

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O1 = U(1); const O2 = U(2); const O3 = U(3);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const emails = (rows) => rows.map((r) => r.email).sort().join(',');
const iso = (n) => `now() - interval '${n} days'`;

// ── Les trois comptes, tels que la PROD les contient AVANT la séparation ─────
await db.query(`INSERT INTO public.organizer_profiles (user_id, display_name, product, extra_products) VALUES
  ($1, 'Orga deux produits', 'suite', ARRAY['crm']), ($2, 'Orga CRM pur', 'crm', ARRAY[]::text[]), ($3, 'Orga Billetterie pure', 'suite', ARRAY[]::text[])`, [O1, O2, O3]);
let ev = 0;
const E = (org, title, days, ext) => { const id = U(100 + ev++); return db.query(`INSERT INTO public.events (id, organizer_user_id, title, start_at, end_at, external_source) VALUES ($1, $2, $3, ${iso(days)}, ${iso(days)} + interval '6 hours', $4)`, [id, org, title, ext]).then(() => id); };
const y1 = await E(O1, 'Yuno 1', 20, null); const y2 = await E(O1, 'Yuno 2', 5, null);
const m1 = await E(O1, 'Shotgun 1', 30, 'shotgun'); const m2 = await E(O1, 'Shotgun 2', 10, 'shotgun');
const m3 = await E(O2, 'Shotgun O2', 12, 'shotgun');
const y3 = await E(O3, 'Yuno O3', 9, null);
const ticket = (event, email, price, days) => db.query(`INSERT INTO public.tickets (id, event_id, user_email, total_price, service_fee, insurance_fee, paid_at, created_at, status, quantity) VALUES (gen_random_uuid(), $1, $2, $3, 1, 0, ${iso(days)}, ${iso(days)}, 'paid', 1)`, [event, email, price]);
await ticket(y1, 'a@x.test', 20, 19); await ticket(y1, 'b@x.test', 25, 19);
await db.query(`INSERT INTO public.table_reservations (id, event_id, user_email, total_price, service_fee, paid_at, created_at, status) VALUES (gen_random_uuid(), $1, 'c@x.test', 200, 5, ${iso(4)}, ${iso(4)}, 'paid')`, [y2]);
const GL = U(31);
await db.query(`INSERT INTO public.guest_lists (id, event_id) VALUES ($1, $2)`, [GL, y2]);
await db.query(`INSERT INTO public.guest_list_entries (id, guest_list_id, email, status, created_at, full_name) VALUES (gen_random_uuid(), $1, 'd@x.test', 'confirmed', ${iso(4)}, 'Dee Dee')`, [GL]);
await ticket(y3, 'a3@x.test', 18, 8); await ticket(y3, 'b3@x.test', 22, 8);
const CONN1 = U(41); const CONN2 = U(42);
await db.query(`INSERT INTO public.ticketing_connections (id, provider, organizer_user_id, status) VALUES ($1, 'shotgun', $3, 'active'), ($2, 'shotgun', $4, 'active')`, [CONN1, CONN2, O1, O2]);
const xt = (conn, org, event, email, fn, status, price, days) => db.query(`INSERT INTO public.external_tickets (id, connection_id, organizer_user_id, event_id, buyer_email, buyer_first_name, buyer_last_name, status, deal_channel, price, quantity, purchased_at, first_seen_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'Shot', $6, NULL, $7, 1, ${iso(days)}, ${iso(days)})`, [conn, org, event, email, fn, status, price]);
await xt(CONN1, O1, m1, 'b@x.test', 'Bee', 'valid', 30, 29); await xt(CONN1, O1, m1, 'e@x.test', 'Eve', 'valid', 15, 29);
await xt(CONN1, O1, m2, 'f@x.test', 'Eff', 'valid', 12, 9); await xt(CONN1, O1, m2, 'g@x.test', 'Gee', 'refunded', 12, 9);
await xt(CONN2, O2, m3, 'e2@x.test', 'Eve2', 'valid', 14, 11); await xt(CONN2, O2, m3, 'f2@x.test', 'Eff2', 'valid', 14, 11);
// Fichiers importés (un fichier = une liste de contacts + sa liste e-mail + sa liste SMS)
const mkImport = async (org, name, rows) => {
  const el = (await q(`INSERT INTO public.email_list_imports (organizer_user_id, filename, consent_source) VALUES ($1, $2, 'other') RETURNING id`, [org, name]))[0].id;
  const cl = (await q(`INSERT INTO public.contact_list_imports (organizer_user_id, filename, email_import_id, consent_source) VALUES ($1, $2, $3, 'other') RETURNING id`, [org, name, el]))[0].id;
  for (const [email, fn] of rows) {
    await db.query(`INSERT INTO public.imported_contacts (list_import_id, organizer_user_id, email, first_name, created_at) VALUES ($1, $2, $3, $4, ${iso(60)})`, [cl, org, email, fn]);
    await db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, import_id, created_at, updated_at) VALUES ($1, $2, true, 'import', $3, ${iso(60)}, ${iso(60)})`, [org, email, el]);
  }
  return { cl, el };
};
await mkImport(O1, 'wo.csv', [['h@x.test', 'Hache'], ['i@x.test', 'Hi']]);
await mkImport(O2, 'crm.csv', [['h2@x.test', 'Hache2']]);
await mkImport(O3, 'suite.csv', [['h3@x.test', 'Hache3']]);
// Registre : accords nés de chaque surface
const sub = (org, email, source) => db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, created_at, updated_at) VALUES ($1, $2, true, $3, ${iso(9)}, ${iso(9)})`, [org, email, source]);
await sub(O1, 'a@x.test', 'ticket_purchase'); await sub(O1, 'k@x.test', 'guest_list'); await sub(O1, 'f@x.test', 'connector:shotgun');
await sub(O1, 'b@x.test', 'connector:shotgun'); await sub(O1, 'j@x.test', 'signup_page:p1');
await sub(O2, 'f2@x.test', 'connector:shotgun'); await sub(O2, 'j2@x.test', 'signup_page:p2');
await sub(O3, 'a3@x.test', 'ticket_purchase');
// Engagement (une ligne par personne et par portée)
const eng = (org, email) => db.query(`INSERT INTO public.contact_engagement (organizer_user_id, email, emails_sent, opens, status, subscribed) VALUES ($1, $2, 3, 1, 'active', true)`, [org, email]);
await eng(O1, 'a@x.test'); await eng(O1, 'e@x.test'); await eng(O2, 'f2@x.test'); await eng(O3, 'a3@x.test');

// ── AVANT : ce que la prod rend aujourd'hui ──────────────────────────────────
const snapTable = async (name, sql) => { await db.exec(`DROP TABLE IF EXISTS ${name}; CREATE TABLE ${name} AS ${sql}`); };
await snapTable('old_rows_o2', `SELECT * FROM public.contact_rows(NULL, '${O2}')`);
await snapTable('old_rows_o3', `SELECT * FROM public.contact_rows(NULL, '${O3}')`);
await snapTable('old_rows_o1', `SELECT * FROM public.contact_rows(NULL, '${O1}')`);
const oldO1 = emails(await q(`SELECT email FROM old_rows_o1`));
check('avant : le compte à deux produits mélange tout (a b c d e f h i j k)', oldO1 === 'a@x.test,b@x.test,c@x.test,d@x.test,e@x.test,f@x.test,h@x.test,i@x.test,j@x.test,k@x.test', oldO1);

// ── Les migrations (sans leurs gardes md5 : PGlite ne reformate pas une définition comme Postgres) ─
const files = migrations();
console.log('migrations :', files.join(', '));
for (const f of files) {
  const sql = readFileSync(join(MIG_DIR, f), 'utf8').replace(/DO \$guard\$[\s\S]*?END \$guard\$;/g, '');
  try { await db.exec(sql); } catch (e) { throw new Error(`${f} : ${e.message}`); }
}
await relax(false);

const same = async (label, oldT, newSql, prefix = '') => {
  await db.exec(`BEGIN; ${prefix}; DROP TABLE IF EXISTS new_t; CREATE TABLE new_t AS ${newSql}; COMMIT;`);
  // created_at d'une personne sans billet ni fichier vaut now() au moment de la lecture : jamais comparable.
  const cols = (await q(`SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) AS c FROM information_schema.columns WHERE table_name = $1 AND column_name <> 'created_at'`, [oldT]))[0].c;
  const a = (await q(`SELECT count(*)::int AS n FROM (SELECT ${cols} FROM ${oldT} EXCEPT SELECT ${cols} FROM new_t) x`))[0].n;
  const b = (await q(`SELECT count(*)::int AS n FROM (SELECT ${cols} FROM new_t EXCEPT SELECT ${cols} FROM ${oldT}) x`))[0].n;
  const n = (await q(`SELECT count(*)::int AS n FROM new_t`))[0].n;
  check(label, a === 0 && b === 0, `${n} lignes, écarts ${a}/${b}`);
  if (a || b) {
    const cols = 'email, origin, user_id, has_account, subscribed, eng_status, emails_sent, newsletter_opt_in, total_spent, ticket_count';
    console.log('  avant seulement :', JSON.stringify(await q(`SELECT ${cols} FROM (SELECT * FROM ${oldT} EXCEPT SELECT * FROM new_t) x`)));
    console.log('  après seulement :', JSON.stringify(await q(`SELECT ${cols} FROM (SELECT * FROM new_t EXCEPT SELECT * FROM ${oldT}) x`)));
  }
};
// Comptes à un seul produit : rien ne change pour eux.
await same('O2 (CRM pur) · la vue CRM est identique à celle d\'avant', 'old_rows_o2', `SELECT * FROM public.contact_rows(NULL, '${O2}', 'crm')`);
await same('O3 (Billetterie pure) · la vue Billetterie est identique à celle d\'avant', 'old_rows_o3', `SELECT * FROM public.contact_rows(NULL, '${O3}')`);

// Compte à deux produits : deux bases qui ne se croisent pas.
const suite = await q(`SELECT * FROM public.contact_rows(NULL, '${O1}')`);
const crm = await q(`SELECT * FROM public.contact_rows(NULL, '${O1}', 'crm')`);
check('O1 · Billetterie : a b c d h i k — ni e, ni f, ni g, ni j (Shotgun / page d\'inscription)', emails(suite) === 'a@x.test,b@x.test,c@x.test,d@x.test,h@x.test,i@x.test,k@x.test', emails(suite));
check('O1 · CRM : b e f h i j — ni a, ni c, ni d, ni k (clients de la Billetterie)', emails(crm) === 'b@x.test,e@x.test,f@x.test,h@x.test,i@x.test,j@x.test', emails(crm));
const bs = suite.find((r) => r.email === 'b@x.test'); const bc = crm.find((r) => r.email === 'b@x.test');
check('O1 · b côté Billetterie : 1 billet Yuno, 24 € et rien de Shotgun', bs && bs.ticket_count === 1 && Number(bs.yuno_spent) === 24 && bs.yuno_events === 1, bs ? `${bs.ticket_count} billet(s), ${bs.yuno_spent} €` : 'absente');
check('O1 · b côté CRM : 1 billet Shotgun, 30 € et rien de Yuno', bc && bc.ticket_count === 1 && Number(bc.yuno_spent) === 30, bc ? `${bc.ticket_count} billet(s), ${bc.yuno_spent} €` : 'absente');
check('O1 · b : pas abonnée côté Billetterie (son accord vient du connecteur) ; abonnée côté CRM', bs?.subscribed === false && bc?.subscribed === true, `${bs?.subscribed}/${bc?.subscribed}`);
check('O1 · a (accord d\'achat) abonnée côté Billetterie, absente du CRM', suite.find((r) => r.email === 'a@x.test')?.subscribed === true && !crm.some((r) => r.email === 'a@x.test'));
check('O1 · aucun compte client Yuno rattaché à un contact du CRM', crm.every((r) => r.user_id === null && r.has_account === false));

// Les écrans qui montent la base (cache, envoi) suivent les deux vues.
await db.exec(`BEGIN; SELECT public.contact_build_rows(NULL, '${O1}'); DROP TABLE IF EXISTS s_cr; CREATE TABLE s_cr AS SELECT * FROM _cr; COMMIT;`);
await db.exec(`BEGIN; SELECT public.contact_build_rows(NULL, '${O1}', 'crm'); DROP TABLE IF EXISTS c_cr; CREATE TABLE c_cr AS SELECT * FROM _cr; COMMIT;`);
check('O1 · contact_build_rows (cache) : les deux bases sont celles des deux vues',
  emails(await q('SELECT email FROM s_cr')) === emails(suite) && emails(await q('SELECT email FROM c_cr')) === emails(crm));
const ok = (rows, e) => rows.find((r) => r.email === e)?.email_ok;
const sCr = await q('SELECT email, email_ok FROM s_cr'); const cCr = await q('SELECT email, email_ok FROM c_cr');
check('O1 · email_ok : Billetterie a, k, h, i oui ; CRM b, f, j, h, i oui', ok(sCr, 'a@x.test') && ok(sCr, 'k@x.test') && ok(sCr, 'h@x.test') && ok(cCr, 'b@x.test') && ok(cCr, 'f@x.test') && ok(cCr, 'j@x.test') && ok(cCr, 'h@x.test'));
check('O1 · email_ok : jamais un accord de l\'autre produit', !ok(sCr, 'b@x.test') && !ok(sCr, 'f@x.test') && !ok(sCr, 'j@x.test') && !ok(cCr, 'a@x.test'));

// Les écritures d'un produit ne touchent pas l'autre.
const regCount = async (prod) => (await q(`SELECT count(*)::int AS n FROM public.newsletter_subscriptions WHERE organizer_user_id = $1 AND product IS NOT DISTINCT FROM $2`, [O1, prod]))[0].n;
const nSuite = await regCount(null); const nCrm = await regCount('crm');
check('O1 · le registre a des lignes dans CHAQUE produit', nSuite > 0 && nCrm > 0, `Billetterie ${nSuite} · CRM ${nCrm}`);
const dupTok = (await q(`SELECT count(*)::int AS n FROM (SELECT unsubscribe_token FROM public.newsletter_subscriptions GROUP BY 1 HAVING count(*) > 1) x`))[0].n;
check('registre : aucun jeton de désinscription en double (les copies ont les leurs)', dupTok === 0);
const dupKey = (await q(`SELECT count(*)::int AS n FROM (SELECT lower(email), organizer_user_id, product FROM public.newsletter_subscriptions WHERE organizer_user_id IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1) x`))[0].n;
check('registre : une ligne par (adresse, portée, produit)', dupKey === 0);
const o2AllCrm = (await q(`SELECT count(*)::int AS n FROM public.newsletter_subscriptions WHERE organizer_user_id = $1 AND product IS DISTINCT FROM 'crm'`, [O2]))[0].n;
check('O2 (CRM pur) : tout son registre est du produit CRM', o2AllCrm === 0, String(o2AllCrm));
const o3NoCrm = (await q(`SELECT count(*)::int AS n FROM public.newsletter_subscriptions WHERE organizer_user_id = $1 AND product IS NOT NULL`, [O3]))[0].n;
check('O3 (Billetterie pure) : aucune ligne du produit CRM', o3NoCrm === 0, String(o3NoCrm));


// ── Triggers de la migration : le produit d'une ligne née chez un compte à un seul produit ───────────
await db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source) VALUES ($1, 'nouveau-o2@x.test', true, 'manual'), ($2, 'nouveau-o3@x.test', true, 'manual')`, [O2, O3]);
const prodOf = async (org, e) => (await q(`SELECT product FROM public.newsletter_subscriptions WHERE organizer_user_id = $1 AND email = $2`, [org, e]))[0]?.product ?? null;
check('compte CRM pur : une ligne insérée sans produit devient du CRM', (await prodOf(O2, 'nouveau-o2@x.test')) === 'crm');
check('compte Billetterie pur : une ligne insérée reste de la Billetterie', (await prodOf(O3, 'nouveau-o3@x.test')) === null);
await db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, product) VALUES ($1, 'x3@x.test', true, 'ticket_purchase', 'crm')`, [O3]);
check('compte Billetterie pur : un produit « crm » demandé par un écrivain est ramené à la Billetterie', (await prodOf(O3, 'x3@x.test')) === null);

// ── Désinscription : un stop vaut pour les deux outils d'un même pro ─────────────────────────────────
await db.query(`INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, product) VALUES ($1, 'stop@x.test', true, 'ticket_purchase', NULL), ($1, 'stop@x.test', true, 'signup_page:p1', 'crm'), ($1, 'voisin@x.test', true, 'ticket_purchase', NULL), ($1, 'voisin@x.test', true, 'signup_page:p1', 'crm')`, [O1]);
const tok = (await q(`SELECT unsubscribe_token FROM public.newsletter_subscriptions WHERE organizer_user_id = $1 AND email = 'stop@x.test' AND product IS NULL`, [O1]))[0].unsubscribe_token;
const r = (await q(`SELECT * FROM public.unsubscribe_by_token($1)`, [tok]))[0];
check('stop par le lien d\'un e-mail de la Billetterie : réussi', r?.success === true, JSON.stringify(r));
const optIn = async (e) => (await q(`SELECT product, opted_in FROM public.newsletter_subscriptions WHERE organizer_user_id = $1 AND email = $2 ORDER BY product NULLS FIRST`, [O1, e])).map((x) => x.opted_in);
check('stop : les lignes des DEUX outils de cette adresse sont désabonnées', (await optIn('stop@x.test')).every((v) => v === false), JSON.stringify(await optIn('stop@x.test')));
check('stop : une adresse voisine ou une autre portée n\'est pas touchée', (await optIn('voisin@x.test')).every((v) => v === true));

// ── SMS : le produit d'une campagne est dérivé, jamais déclaré par un client ───────────────────────
await db.query(`INSERT INTO public.sms_campaigns (id, organizer_id, created_by, name, body_template, status, segment_filters) VALUES ($2, $1, $1, 'sms crm', 'x', 'draft', '{"type":"crm"}'::jsonb), ($3, $1, $1, 'sms suite', 'x', 'draft', '{}'::jsonb)`, [O1, U(901), U(902)]);
const smsProd = async (id) => (await q(`SELECT product FROM public.sms_campaigns WHERE id = $1`, [id]))[0]?.product ?? null;
check('SMS : une campagne du CRM est du produit CRM, celle de la Billetterie NULL (compte à deux produits)', (await smsProd(U(901))) === 'crm' && (await smsProd(U(902))) === null);


// ── Coût : crm_campaign_is_crm est appelée par ligne de campagne dans les lecteurs du CRM ────────────
await db.query(`INSERT INTO public.email_campaigns (id, organizer_user_id, name, subject, status, product) VALUES ($2, $1, 'c1', 's', 'sent', 'crm'), ($3, $1, 'c2', 's', 'sent', NULL), ($4, $5, 'c3', 's', 'sent', NULL)`, [O1, U(911), U(912), U(913), O2]);
for (const [label, id] of [['deux produits, campagne CRM', U(911)], ['deux produits, campagne Billetterie', U(912)], ['CRM pur', U(913)]]) {
  const t0 = Date.now();
  await db.query(`SELECT count(*) FROM generate_series(1, 5000) g WHERE public.crm_campaign_is_crm(CASE WHEN g > 0 THEN $1::uuid END)`, [id]);
  console.log(`INFO crm_campaign_is_crm · ${label} : ${((Date.now() - t0) / 5).toFixed(2)} ms pour 1 000 appels (PGlite)`);
}

// Droits
const acl = (await q(`SELECT has_function_privilege('anon', 'public.contact_rows(text, uuid, text)', 'EXECUTE') AS a,
                             has_function_privilege('authenticated', 'public.contact_build_rows(text, uuid, text)', 'EXECUTE') AS b,
                             has_function_privilege('service_role', 'public.contact_scope_customers(text, uuid, text)', 'EXECUTE') AS c`))[0];
check('droits : ni anon ni authenticated sur le noyau, service_role oui', !acl.a && !acl.b && acl.c, JSON.stringify(acl));

console.log(failed ? `\n${failed} ÉCHEC(S)` : '\ntout est vérifié');
process.exit(failed ? 1 : 0);
