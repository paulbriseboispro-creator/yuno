#!/usr/bin/env node
// Suite de l'audit du 18/10 — MAIL-08 : un e-mail de test ne part qu'à
// l'équipe de l'espace, 20 fois par jour (de Paris) au plus. Porte
// `email_test_send_allow` (migration 20261023120000), jouée au banc sur les
// tables d'équipe de la PROD (instantané : schéma seulement, aucune donnée).
//
//   node prod.mjs --activity
//   node audit-test-send.mjs dump   # instantané (lecture seule)
//   node audit-test-send.mjs        # test (code 1 si une assertion tombe)
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-test-send.sql');
const ROOTS = join(DATA, 'audit-test-send-roots.txt');
const FIX = join(ROOT, 'supabase', 'migrations', '20261023120000_mail_test_send_team_only.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['venues', 'profiles', 'manager_permissions', 'org_members', 'user_roles'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-test-send.mjs dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
// Le banc n'a pas de contraintes d'intégrité vers auth.users : on les retire
// pour semer des comptes fictifs.
await db.exec(`DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conrelid::regclass AS t, conname FROM pg_constraint
            WHERE contype = 'f' AND conrelid::regclass::text IN ('profiles', 'venues', 'manager_permissions', 'org_members', 'user_roles') LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname);
  END LOOP;
  -- Colonnes obligatoires sans rapport avec le test (invited_by, slug…) : libérées.
  FOR r IN SELECT a.attrelid::regclass AS t, a.attname FROM pg_attribute a
            WHERE a.attrelid::regclass::text IN ('profiles', 'venues', 'manager_permissions', 'org_members', 'user_roles')
              AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND a.atthasdef = false AND a.attname <> 'id' LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.t, r.attname);
  END LOOP; END $$;`);
await execFile(db, FIX, '20261023120000_mail_test_send_team_only.sql');
await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })]);

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ORG = U(1); const EDITOR = U(2); const SCANNER = U(3); const OWNER = U(4); const MANAGER = U(5); const STRANGER = U(6); const ADMIN = U(7);
for (const [id, email] of [[ORG, 'Orga@Asso.fr'], [EDITOR, 'editeur@asso.fr'], [SCANNER, 'scan@asso.fr'], [OWNER, 'patron@club.fr'],
  [MANAGER, 'gerant@club.fr'], [STRANGER, 'inconnu@gmail.com'], [ADMIN, 'paul@yunoapp.eu']]) {
  await db.query(`INSERT INTO public.profiles (id, email) VALUES ($1, $2)`, [id, email]);
}
await db.query(`INSERT INTO public.org_members (organizer_user_id, member_user_id, member_email, role, invitation_status) VALUES
  ($1, $2, 'editeur@asso.fr', 'editor', 'accepted'), ($1, $3, 'scan@asso.fr', 'scanner', 'accepted'),
  ($1, NULL, 'invite@asso.fr', 'editor', 'pending')`, [ORG, EDITOR, SCANNER]);
await db.query(`INSERT INTO public.venues (id, name, owner_id) VALUES ('club-1', 'Club', $1)`, [OWNER]);
await db.query(`INSERT INTO public.manager_permissions (venue_id, user_id) VALUES ('club-1', $1)`, [MANAGER]);
await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);

const allow = async (venue, org, caller, emails) => (await db.query(
  `SELECT public.email_test_send_allow($1, $2, $3, $4) AS r`, [venue, org, caller, emails])).rows[0].r;

// Organisation
let r = await allow(null, ORG, EDITOR, ['orga@asso.fr', 'inconnu@gmail.com', 'scan@asso.fr', 'invite@asso.fr', 'EDITEUR@asso.fr']);
check('orga : la personne qui clique reçoit toujours le test', r.ok && r.allowed[0] === 'editeur@asso.fr');
check('orga : le titulaire (équipe) reçoit, en minuscules', r.allowed.includes('orga@asso.fr'));
check('orga : une adresse libre est écartée', r.refused.includes('inconnu@gmail.com') && !r.allowed.includes('inconnu@gmail.com'));
check('orga : un scanner et une invitation en attente ne sont pas l\'équipe (comme Compte › Équipe)',
  r.refused.includes('scan@asso.fr') && r.refused.includes('invite@asso.fr'));
check('orga : pas de doublon de la personne qui clique', r.allowed.filter((e) => e === 'editeur@asso.fr').length === 1, r.allowed.join(', '));

// Club
r = await allow('club-1', null, MANAGER, ['patron@club.fr', 'orga@asso.fr']);
check('club : gérant + titulaire reçoivent ; l\'équipe d\'un AUTRE espace est écartée',
  r.allowed.join(',') === 'gerant@club.fr,patron@club.fr' && r.refused.join(',') === 'orga@asso.fr', JSON.stringify(r));

// Yuno (portée plateforme)
r = await allow(null, null, ADMIN, ['patron@club.fr']);
check('Yuno : les super admins sont l\'équipe ; un pro ne l\'est pas', r.ok && r.allowed.join(',') === 'paul@yunoapp.eu' && r.refused.join(',') === 'patron@club.fr');

// Plafond : 20 envois de test par jour et par espace (l'orga en a déjà fait 1).
let last;
for (let i = 0; i < 25; i++) last = await allow(null, ORG, ORG, []);
const n = (await db.query(`SELECT n FROM public.email_test_sends WHERE scope_key = $1`, [`org:${ORG}`])).rows[0].n;
check('plafond : le 21e test du jour est refusé (test_limit)', last.ok === false && last.error === 'test_limit' && n === 20, JSON.stringify(last));
r = await allow('club-1', null, OWNER, []);
check('plafond : par espace (le club n\'est pas touché)', r.ok && r.used === 2);
await db.query(`UPDATE public.email_test_sends SET day = day - 1`);
r = await allow(null, ORG, ORG, []);
check('plafond : remis à zéro le jour suivant (jour de Paris)', r.ok && r.used === 1);
const parisDay = (await db.query(`SELECT day = (now() AT TIME ZONE 'Europe/Paris')::date AS ok FROM public.email_test_sends WHERE scope_key = $1 ORDER BY day DESC LIMIT 1`, [`org:${ORG}`])).rows[0].ok;
check('plafond : compté au jour de Paris', parisDay === true);

// Rien à qui envoyer : la personne qui clique n'a pas d'adresse, la liste est hors équipe.
r = await allow(null, ORG, U(99), ['inconnu@gmail.com']);
check('aucune adresse de l\'équipe : refus no_team_address', r.ok === false && r.error === 'no_team_address');

// Droits
const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.email_test_send_allow(text, uuid, uuid, text[], integer)', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.email_test_send_allow(text, uuid, uuid, text[], integer)', 'EXECUTE') AS b`)).rows[0];
check('droits : ni anon ni authenticated', !acl.a && !acl.b);
await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'authenticated', sub: ORG })]);
let refusedForClient = false;
try { await allow(null, ORG, ORG, []); } catch { refusedForClient = true; }
check('droits : refusée hors service_role même si EXECUTE était rendu', refusedForClient);

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
