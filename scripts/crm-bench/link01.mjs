#!/usr/bin/env node
// LINK-01 au banc : `crm_link_create` avec la capture d'une story, AVANT (la
// prod du 18/10) et APRÈS la migration 20261024100100. Aucune écriture sur la prod.
//
//   node prod.mjs --activity         # rien de lourd ne tourne ?
//   node link01.mjs scan             # lecture seule : tout quantificateur {n,m} > 255
//                                    # dans les fonctions, contraintes, policies, domaines
//   node link01.mjs dump             # instantané de crm_link_create et de tracked_links
//   node link01.mjs run [rapport.md] # avant / après ; code de sortie 1 si un attendu manque
//
// Les portes d'accès de la fonction (crm_scope_writable, _crm_link_event_ok,
// _crm_link_creatable) sont remplacées au banc par `true` : on teste ici
// l'expression de la capture, la séparation entre espaces l'est par isolation.mjs.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';
import { prodQuery } from './prod.mjs';

const DIR = join(DATA, 'link01');
const ROOTS = join(DIR, 'roots.txt');
const SNAP = join(DIR, 'snapshot.sql');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261024100100_crm_link_create_image_regex.sql');
const BIG = '\\{[0-9]*,?[0-9]{3,}\\}'; // un quantificateur à 3 chiffres ou plus ; le tri > 255 se fait ici

const cmd = process.argv[2];

if (cmd === 'scan') {
  const hits = (src) => [...src.matchAll(/\{(\d*)(,(\d*))?\}/g)]
    .filter((m) => Number(m[1] || 0) > 255 || Number(m[3] || 0) > 255)
    .map((m) => src.slice(Math.max(0, m.index - 50), m.index + m[0].length + 10).replace(/\s+/g, ' '));
  const fns = await prodQuery(`
    SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name, p.prosrc AS src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ~ '${BIG}'`);
  const others = await prodQuery(`
    SELECT 'contrainte ' || c.conrelid::regclass::text || '.' || c.conname AS name, pg_get_constraintdef(c.oid) AS src
      FROM pg_constraint c WHERE c.conrelid <> 0 AND pg_get_constraintdef(c.oid) ~ '${BIG}'
    UNION ALL
    SELECT 'policy ' || tablename || '.' || policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '')
      FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '${BIG}'
    UNION ALL
    SELECT 'domaine ' || t.typname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c JOIN pg_type t ON t.oid = c.contypid WHERE c.contypid <> 0 AND pg_get_constraintdef(c.oid) ~ '${BIG}'`);
  console.log(`${fns.length} fonction(s) et ${others.length} autre(s) objet(s) avec un quantificateur à 3 chiffres ou plus`);
  let n = 0;
  for (const o of [...fns, ...others]) {
    const h = hits(o.src);
    if (!h.length) continue;
    n++;
    console.log(`> 255 : ${o.name}`);
    for (const x of h) console.log(`    …${x}…`);
  }
  console.log(n ? `${n} objet(s) au-delà de 255` : 'aucun quantificateur au-delà de 255');
  process.exit(0);
}

if (cmd === 'dump') {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(ROOTS, ['crm_link_create', 'tracked_links', 'gen_tracked_link_code', 'events'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}

if (cmd !== 'run') {
  console.error('usage: node link01.mjs scan | dump | run [rapport.md]');
  process.exit(2);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node link01.mjs dump »');

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot.sql');
await db.exec(`
  DROP FUNCTION IF EXISTS public.crm_scope_writable(text, uuid);
  DROP FUNCTION IF EXISTS public._crm_link_event_ok(text, uuid, uuid);
  DROP FUNCTION IF EXISTS public._crm_link_creatable(text, text);
  CREATE FUNCTION public.crm_scope_writable(text, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
  CREATE FUNCTION public._crm_link_event_ok(text, uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
  CREATE FUNCTION public._crm_link_creatable(text, text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  GRANT authenticated TO authenticator;`);

const ORG = '0a000000-0000-4000-8000-0000000000a1';
const EVENT = 'eeeeeeee-0000-4000-8000-0000000000e1';
const STORAGE = 'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/email-assets/crm/links/story-line-up.jpg';
// L'URL telle que la règle l'entend : `https://` puis 1 à 480 caractères sans espace.
const intended = (s) => s !== null && s.startsWith('https://') && s.length >= 9 && s.length <= 488 && !/[ \t\n\r\f\v]/.test(s.slice(8));
const CASES = [
  ['sans capture (NULL)', null],
  ['capture du Storage Yuno', STORAGE],
  ['URL avec accents', 'https://exemple.fr/été/story.jpg'],
  ['488 caractères (limite)', `https://${'a'.repeat(480)}`],
  ['489 caractères', `https://${'a'.repeat(481)}`],
  ['http://', 'http://exemple.fr/story.jpg'],
  ['https:// seul', 'https://'],
  ['chaîne vide', ''],
  ['espace dans l’URL', 'https://exemple.fr/ma story.jpg'],
  ['espace devant', ' https://exemple.fr/story.jpg'],
  ['retour à la ligne', 'https://exemple.fr/a\nb.jpg'],
  ['tabulation', 'https://exemple.fr/a\tb.jpg'],
  ['HTTPS en capitales', 'HTTPS://exemple.fr/story.jpg'],
];

async function create(img) {
  await db.exec('BEGIN');
  try {
    await db.exec(`SET LOCAL ROLE NONE; SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE authenticated;`);
    await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: ORG, role: 'authenticated' }), ORG]);
    const r = await db.query(`SELECT public.crm_link_create(NULL::text, $1::uuid, $2::uuid, 'instagram', 'story', 'Story line-up', $3::text) AS j`, [ORG, EVENT, img]);
    const j = r.rows[0].j;
    return { ok: true, image: j.image_url ?? null };
  } catch (e) {
    return { ok: false, code: e.code ?? '', msg: String(e.message).split('\n')[0].slice(0, 80) };
  } finally {
    await db.exec('ROLLBACK').catch(() => undefined);
    // PGlite ne rend pas la session d'origine au ROLLBACK (vérifié, sec06.mjs).
    await db.exec(`SET SESSION AUTHORIZATION postgres; RESET ROLE;`);
  }
}
const show = (r) => (!r.ok ? `erreur ${r.code} (${r.msg})` : r.image === null ? 'créé, sans capture' : 'créé, capture gardée');

// Le compte démo CRM et une de ses soirées miroir, pour le smoke de répétition.
await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'crm@womber.fr')`, [ORG]);
{
  const cols = (await db.query(`SELECT column_name AS c, data_type AS dt FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND is_nullable = 'NO' AND column_default IS NULL`)).rows;
  const row = { id: EVENT, organizer_user_id: ORG, external_source: 'shotgun', start_at: new Date().toISOString(), title: 'Soirée du banc' };
  const fill = (dt) => (dt === 'uuid' ? crypto.randomUUID() : /int|numeric|double|real/.test(dt) ? 0 : dt === 'boolean' ? false
    : /timestamp|date/.test(dt) ? new Date().toISOString() : /json/.test(dt) ? '{}' : dt === 'ARRAY' ? '{}' : 'x');
  for (const c of cols) if (!(c.c in row)) row[c.c] = fill(c.dt);
  const keys = Object.keys(row);
  await db.query(`INSERT INTO public.events (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => row[k]));
}

const before = [];
for (const [, img] of CASES) before.push(await create(img));
await execFile(db, MIGRATION, relative(ROOT, MIGRATION));
const after = [];
for (const [, img] of CASES) after.push(await create(img));

// Le smoke de répétition sur la prod (smoke/link01.sql), joué ici d'abord.
let smoke;
await db.exec('BEGIN');
try { await db.exec(readFileSync(join(HERE, 'smoke', 'link01.sql'), 'utf8')); smoke = 'ÉCHEC : le smoke ne lève pas SMOKE_OK'; } catch (e) { smoke = String(e.message).split('\n')[0]; }
await db.exec('ROLLBACK').catch(() => undefined);
const smokeOk = /^SMOKE_OK/.test(smoke);

let bad = 0;
const rows = CASES.map(([label, img], i) => {
  const b = before[i];
  const a = after[i];
  const want = intended(img) ? img : null;
  // Avant : toute capture non NULL lève 2201B, NULL passe. Après : la règle voulue.
  const okB = img === null ? b.ok && b.image === null : !b.ok && b.code === '2201B';
  const okA = a.ok && a.image === want;
  if (!okB || !okA) bad++;
  return { label, img, b, a, want, okB, okA };
});

// L'expression nouvelle contre la règle voulue, sur des chaînes tirées au hasard
// (alphabet avec espaces, tabulations, retours à la ligne, `https://` en tête ou non).
const ALPHA = ['a', 'Z', '0', '/', '.', '-', '_', '?', '=', '%', 'é', ' ', '\t', '\n'];
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const sample = [];
for (let i = 0; i < 400; i++) {
  const len = [0, 1, 5, 40, 470, 479, 480, 481, 490][rnd(9)];
  let body = '';
  for (let k = 0; k < len; k++) body += rnd(10) ? ALPHA[rnd(11)] : ALPHA[rnd(ALPHA.length)];
  sample.push((rnd(5) ? 'https://' : ['http://', 'https:/', ' https://', ''][rnd(4)]) + body);
}
const got = (await db.query(`SELECT s, (s ~ '^https://[^[:space:]]+$' AND length(s) <= 488) AS ok FROM unnest($1::text[]) AS s`, [sample])).rows;
const mismatch = got.filter((r) => Boolean(r.ok) !== intended(r.s));
const kept = got.filter((r) => r.ok).length;
let oldErr = '';
try { await db.query(`SELECT 'https://a' ~ '^https://[^[:space:]]{1,480}$'`); } catch (e) { oldErr = `${e.code} ${String(e.message).split('\n')[0]}`; }
let at255 = '';
try { at255 = String((await db.query(`SELECT 'https://a' ~ '^https://[^[:space:]]{1,255}$' AS ok`)).rows[0].ok); } catch (e) { at255 = `${e.code}`; }

const esc = (x) => String(x).replace(/\|/g, '/').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
const brief = (s) => (s === null ? 'NULL' : s.length > 60 ? `${esc(s.slice(0, 40))}… (${s.length} car.)` : `\`${esc(s)}\``);
const out = [
  `# LINK-01 — capture d'une story sur un lien de partage, au banc (${new Date().toISOString().slice(0, 16)}Z)`,
  '',
  "`crm_link_create` et `tracked_links` lus sur la prod (`node scripts/crm-bench/link01.mjs dump`, lecture seule) ; portes d'accès remplacées par `true` (la séparation entre espaces est l'affaire d'`isolation.mjs`). "
    + "« Avant » = la définition de la prod du 18/10 ; « Après » = `20261024100100_crm_link_create_image_regex.sql`.",
  '',
  `- L'expression d'avant, seule : \`${esc(oldErr || 'pas d’erreur')}\` (même erreur que sur la prod). Bornée à 255 : ${at255} (Postgres accepte jusqu'à 255).`,
  `- L'expression d'après contre la règle voulue (« \`https://\` puis 1 à 480 caractères sans espace ») sur ${sample.length} chaînes tirées au hasard : **${mismatch.length} écart(s)**, ${kept} gardées.`,
  '',
  `**${CASES.length - bad} / ${CASES.length} cas conformes à l'attendu, avant ET après.**`,
  '',
  `Smoke de répétition sur la prod (\`scripts/crm-bench/smoke/link01.sql\`), joué au banc sur la base « après » : ${smokeOk ? '✓' : '✗'} \`${esc(smoke)}\`.`,
  '',
  '| Cas | URL envoyée | Avant (prod) | Après (migration) |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${esc(r.label)} | ${brief(r.img)} | ${r.okB ? '' : '✗ '}${esc(show(r.b))} | ${r.okA ? '' : '✗ '}${esc(show(r.a))} |`),
  '',
];
if (mismatch.length) out.push('Écarts :', ...mismatch.slice(0, 10).map((r) => `- ${brief(r.s)} : SQL ${r.ok}, règle ${intended(r.s)}`), '');
const dest = process.argv[3];
if (dest) writeFileSync(dest, out.join('\n'));
console.log(out.join('\n'));
process.exit(bad || mismatch.length || !smokeOk ? 1 : 0);
