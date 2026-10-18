#!/usr/bin/env node
// Suite de l'audit du 18/10 — MAIL-09 : une clé de filtre inconnue ne garde
// personne. Compare `_crm_filter_sql` de la PROD (instantané) et celui de la
// migration 20261023110000, sur des filtres valides (sortie identique au
// caractère près) et sur des filtres illisibles (faux).
//
//   node prod.mjs --activity
//   node audit-filter.mjs dump    # instantané (lecture seule)
//   node audit-filter.mjs         # test (code 1 si une assertion tombe)
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-filter.sql');
const ROOTS = join(DATA, 'audit-filter-roots.txt');
const FIX = join(ROOT, 'supabase', 'migrations', '20261023110000_crm_filter_unknown_key_false.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['_crm_filter_sql', '_crm_area_key', 'unaccent_safe'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-filter.mjs dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot');
const compile = async (def) => (await db.query(`SELECT public._crm_filter_sql($1::jsonb, 'p') AS s`, [def === undefined ? null : JSON.stringify(def)])).rows[0].s;

const EV = '11111111-1111-4111-8111-111111111111';
// Des filtres valides : la sortie ne doit pas bouger d'un caractère.
const VALID = [
  {}, { seg: 'all', f: {} }, { seg: 'hab' }, { seg: 'zzz' }, { q: '  ' }, { q: 'Léa 0612' },
  // Les 6 formes des segments de la prod (18/10).
  { seg: 'all', f: { last_gt_days: 60 } }, { f: { last: '0-30' } }, { f: { msg: 'never_clicked' } }, { f: { nb: '3-5' } },
  { f: { rc: ['mail'] } }, { f: { sp: '200+' } },
  // Une valeur pour chaque clé.
  { f: { ev: [EV, 'T'] } }, { f: { src: ['shotgun', 'nope'] } }, { f: { tags: ['vip'] } }, { f: { emails: ['a@x.test'] } },
  { f: { gl: 'only' } }, { f: { glev: [EV] } }, { f: { nb_min: 2, nb_max: '5' } }, { f: { last_lt_days: 30 } },
  { f: { sp_min: 50, basket_min: '20.5', paid_min: 1 } }, { f: { age_min: 18, age_max: 25, gender: 'female' } },
  { f: { area: ['Paris'], country: ['fr'], country_not: 'FR' } }, { f: { up: 'yes', click_lt_days: 7, ch: 'both' } },
  { f: { hyp: ['lineup'], artist: ['name:Malaa'], genre: ['techno'], fmt: ['club'], series: ['amoris'] } },
  { f: { buy: ['early'], grp: 'group', arr: ['ys', 'em'], dist_min: 10, dist_max: 500, pass: 'no' } },
  { f: { ntgt: { e: EV, a: 'likely' } } }, { f: { ntgt: { e: 'x', a: 'likely' } } },
  // Neutres : vide, nul, liste vide.
  { f: { nb: '', ev: [], last: null } }, { f: null }, { seg: null, q: null },
];
const BAD = [
  [{ f: { nope: 1 } }, 'clé inconnue seule'],
  [{ f: { nb: '1', nope: 'x' } }, 'clé inconnue à côté d\'une clé connue'],
  [{ foo: 1 }, 'clé inconnue au premier niveau'],
  [{ seg: 'all', f: { ev: EV } }, 'liste attendue, chaîne reçue'],
  [{ f: { rc: 'mail' } }, 'liste attendue, chaîne reçue (canaux)'],
  [{ f: { nb: ['1'] } }, 'valeur simple attendue, liste reçue'],
  [{ f: { up: true } }, 'booléen là où le texte est attendu'],
  [{ f: { ntgt: 'likely' } }, '« Qui cibler » sans objet'],
  [{ f: [] }, '`f` qui n\'est pas un objet'],
  [{ seg: ['hab'] }, '`seg` qui n\'est pas un texte'],
  [{ q: 3 }, '`q` qui n\'est pas un texte'],
  [[], 'définition qui n\'est pas un objet'],
];

// ── Avant : la définition de la prod ────────────────────────────────────────
const before = new Map();
for (const d of VALID) before.set(JSON.stringify(d), await compile(d));
const beforeBad = [];
for (const [d] of BAD) beforeBad.push(await compile(d));
check('avant : un segment fait seulement de clés inconnues vise toute la base (faille reproduite)',
  (await compile({ f: { nope: 1 } })) === 'true' && (await compile({ foo: 1 })) === 'true');
check('avant : une liste reçue en chaîne fait disparaître la condition (faille reproduite)',
  (await compile({ seg: 'all', f: { ev: EV } })) === 'true');

// ── Après la migration ──────────────────────────────────────────────────────
await execFile(db, FIX, '20261023110000_crm_filter_unknown_key_false.sql');
let same = 0;
for (const d of VALID) {
  const a = await compile(d);
  if (a === before.get(JSON.stringify(d))) same++;
  else check(`après : sortie inchangée pour ${JSON.stringify(d)}`, false, `${before.get(JSON.stringify(d))} → ${a}`);
}
check(`après : ${VALID.length} filtres valides compilés à l'identique`, same === VALID.length, `${same}/${VALID.length}`);
check('après : filtre vide et NULL restent « tout le monde »', (await compile({})) === 'true' && (await compile(undefined)) === 'true' && (await compile({ seg: 'all', f: {} })) === 'true');
for (const [i, [d, label]] of BAD.entries()) {
  check(`après : ${label} ⇒ personne`, (await compile(d)) === 'false', `avant ${beforeBad[i]}`);
}

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);
