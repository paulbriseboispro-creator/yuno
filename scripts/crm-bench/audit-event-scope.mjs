#!/usr/bin/env node
// Suite de l'audit du 18/10 — MAIL-14 : les soirées d'un espace pour les blocs
// d'e-mail (`email_scope_event_ids`, migration 20261023160000), jouées au banc
// sur les tables `events` / `event_cohosts` de la PROD (schéma seulement).
//
//   node prod.mjs --activity
//   node audit-event-scope.mjs dump  # instantané (lecture seule)
//   node audit-event-scope.mjs       # test
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-event-scope.sql');
const ROOTS = join(DATA, 'audit-event-scope-roots.txt');
const FIX = join(ROOT, 'supabase', 'migrations', '20261023160000_mail_block_event_scope.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['events', 'event_cohosts'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-event-scope.mjs dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
// Banc : ni triggers ni contraintes étrangères ni colonnes obligatoires hors sujet.
await db.exec(`DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conrelid::regclass AS t, conname FROM pg_constraint WHERE contype IN ('f', 'c') AND conrelid::regclass::text IN ('events', 'event_cohosts') LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname); END LOOP;
  FOR r IN SELECT a.attrelid::regclass AS t, a.attname FROM pg_attribute a WHERE a.attrelid::regclass::text IN ('events', 'event_cohosts')
            AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef AND a.attname <> 'id' LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.t, r.attname); END LOOP;
  FOR r IN SELECT tgname, tgrelid::regclass AS t FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('events', 'event_cohosts') LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.t); END LOOP; END $$;`);
await execFile(db, FIX, '20261023160000_mail_block_event_scope.sql');

const E = (n) => `eeeeeeee-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ORG = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER = 'bbbbbbbb-0000-4000-8000-00000000000b';
const COHOST = 'cccccccc-0000-4000-8000-00000000000c';
await db.query(`INSERT INTO public.events (id, title, organizer_user_id) VALUES ($1, 'Mienne', $4), ($2, 'D''un autre', $5), ($3, 'Co-organisée', $5)`,
  [E(1), E(2), E(3), ORG, OTHER]);
await db.query(`INSERT INTO public.events (id, title, venue_id, partner_organizer_id) VALUES ($1, 'Au club, avec moi', 'club-1', $2)`, [E(4), ORG]);
await db.query(`INSERT INTO public.event_cohosts (event_id, organizer_user_id, status) VALUES ($1, $2, 'accepted'), ($3, $2, 'pending')`, [E(3), COHOST, E(2)]);

const ids = async (venue, org, list) => (await db.query(`SELECT public.email_scope_event_ids($1, $2, $3) AS a`, [venue, org, list])).rows[0].a.sort();
const ALL = [E(1), E(2), E(3), E(4)];
check('organisateur : ses soirées et celles où il est partenaire', (await ids(null, ORG, ALL)).join(',') === [E(1), E(4)].sort().join(','));
check('co-hôte accepté : la soirée co-organisée ; invitation en attente : non', (await ids(null, COHOST, ALL)).join(',') === E(3));
check('club : la soirée qu\'il accueille', (await ids('club-1', null, ALL)).join(',') === E(4));
check('Yuno : toutes les soirées', (await ids(null, null, ALL)).length === 4);
check('soirée inconnue : rien', (await ids(null, ORG, ['eeeeeeee-0000-4000-8000-000000000099'])).length === 0);
const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.email_scope_event_ids(text, uuid, uuid[])', 'EXECUTE') AS a,
  has_function_privilege('anon', 'public.email_scope_event_ids(text, uuid, uuid[])', 'EXECUTE') AS b`)).rows[0];
check('droits : serveur seul', !acl.a && !acl.b);
console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
