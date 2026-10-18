#!/usr/bin/env node
// Suite de l'audit du 18/10 — MAIL-15 : l'adresse d'expédition d'un espace
// vient d'un registre (migration 20261023170000), plus seulement de son nom.
// Joué au banc sur les tables de la PROD (schéma seulement) ; le slug SQL est
// comparé au slug de l'envoi (slugifyVenueName, _shared/campaign-html.ts).
//
//   node prod.mjs --activity
//   node audit-sender.mjs dump    # instantané (lecture seule)
//   node audit-sender.mjs         # test
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-sender.sql');
const ROOTS = join(DATA, 'audit-sender-roots.txt');
const FIX = join(ROOT, 'supabase', 'migrations', '20261023170000_mail_sender_local_registry.sql');
const { slugifyVenueName } = await import(join(ROOT, 'supabase', 'functions', '_shared', 'campaign-html.ts'));

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['email_campaigns', 'venues', 'profiles', 'crm_email_settings'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-sender.mjs dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
await db.exec(`DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conrelid::regclass AS t, conname FROM pg_constraint WHERE contype IN ('f', 'c') AND conrelid::regclass::text IN ('email_campaigns', 'venues', 'profiles') LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname); END LOOP;
  FOR r IN SELECT a.attrelid::regclass AS t, a.attname FROM pg_attribute a WHERE a.attrelid::regclass::text IN ('email_campaigns', 'venues', 'profiles')
            AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef AND a.attname <> 'id' LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.t, r.attname); END LOOP;
  FOR r IN SELECT tgname, tgrelid::regclass AS t FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('email_campaigns', 'venues', 'profiles') LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.t); END LOOP; END $$;`);

// Deux espaces ont déjà envoyé, sous le même nom (« WOH ») : le plus ancien garde woh@.
const ORG1 = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ORG2 = 'bbbbbbbb-0000-4000-8000-00000000000b';
await db.query(`INSERT INTO public.profiles (id, organization_name) VALUES ($1, 'WOH'), ($2, 'WOH')`, [ORG1, ORG2]);
await db.query(`INSERT INTO public.email_campaigns (id, organizer_user_id, name, subject, status, sent_at) VALUES
  (gen_random_uuid(), $1, 'a', 'a', 'sent', now() - interval '30 days'), (gen_random_uuid(), $2, 'b', 'b', 'sent', now() - interval '3 days')`, [ORG1, ORG2]);
await execFile(db, FIX, '20261023170000_mail_sender_local_registry.sql');
await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })]);

const reg = async (k) => (await db.query(`SELECT local_part FROM public.email_sender_locals WHERE scope_key = $1`, [k])).rows[0]?.local_part;
const claim = async (k, name) => (await db.query(`SELECT public.email_sender_local_claim($1, $2) AS l`, [k, name])).rows[0].l;
const preview = async (k, name) => (await db.query(`SELECT public.email_sender_local_preview($1, $2) AS l`, [k, name])).rows[0].l;

check('reprise : l\'espace qui a envoyé le premier garde son adresse d\'aujourd\'hui', (await reg(`org:${ORG1}`)) === 'woh');
check('reprise : l\'homonyme plus récent reçoit un suffixe tiré de son espace', /^woh-[0-9a-f]{6}$/.test(await reg(`org:${ORG2}`) ?? ''), await reg(`org:${ORG2}`));
check('reprise : Yuno garde yuno@', (await reg('yuno')) === 'yuno');

check('nouvel espace au nom libre : le slug de son nom', (await claim('org:new-1', 'Rex Club')) === 'rex-club');
check('un homonyme : suffixe, jamais la même adresse', /^rex-club-[0-9a-f]{6}$/.test(await claim('org:new-2', 'Rex Club')));
check('nom réservé (« Support ») : suffixe', /^support-[0-9a-f]{6}$/.test(await claim('org:new-3', 'Support')));
check('nom réservé (« Yuno ») : suffixe', /^yuno-[0-9a-f]{6}$/.test(await claim('org:new-4', 'Yuno')));
check('attribuée une fois : un renommage ne la change pas', (await claim('org:new-1', 'Rex Club Paris')) === 'rex-club');
check('l\'aperçu (Réglages › Envoi) montre l\'adresse qui partira', (await preview('org:new-1', 'Autre nom')) === 'rex-club');
check('l\'aperçu n\'attribue rien', (await preview('org:new-9', 'Nouveau')) === 'nouveau' && (await reg('org:new-9')) === undefined);
const dup = (await db.query(`SELECT count(*)::int AS n FROM (SELECT local_part FROM public.email_sender_locals GROUP BY 1 HAVING count(*) > 1) d`)).rows[0].n;
check('aucune adresse partagée par deux espaces', dup === 0);

// Slug SQL = slug de l'envoi, au caractère près.
const NAMES = ['WOH', 'Rex  Club !!', 'Le Baron', 'Société Générale des Nuits', 'Ñandú', 'L’Amour & la Nuit', '🔥 Fire 🔥', '', '   ',
  'a'.repeat(80), 'Club-Sonore', 'Amoris'];
let same = 0;
for (const n of NAMES) {
  const sql = (await db.query(`SELECT public._email_local_slug($1) AS s`, [n])).rows[0].s;
  if (sql === slugifyVenueName(n)) same++; else console.log(`   écart « ${n} » : SQL ${sql} / TS ${slugifyVenueName(n)}`);
}
check(`slug SQL = slug de l'envoi (${NAMES.length} noms)`, same === NAMES.length, `${same}/${NAMES.length}`);
let refused = false;
await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'authenticated' })]);
try { await claim('org:x', 'X'); } catch { refused = true; }
check('attribution réservée au serveur', refused);

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
