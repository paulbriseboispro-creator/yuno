#!/usr/bin/env node
// OPS-04 : quelles fonctions de la prod ont un texte qu'une reconstruction
// depuis le dépôt ne redonnerait pas ? Et la migration de RÉFÉRENCE qui les
// fige, générée depuis pg_get_functiondef (LECTURE SEULE sur la prod).
//
//   node prod.mjs --activity                         # rien de lourd ne tourne ?
//   node prod-functions-reference.mjs scan           # lit la prod (3 lectures), écrit .data/prod-functions.json
//   node prod-functions-reference.mjs report <md> <sql>
//
// Méthode (voir l'en-tête du fichier SQL généré) :
//   - on ne lit que les fichiers de migration dont la version est APPLIQUÉE en
//     prod (supabase_migrations.schema_migrations) : un fichier pas encore joué
//     n'est pas une divergence ;
//   - chaque `CREATE [OR REPLACE] FUNCTION` d'un schéma applicatif est relevé
//     dans l'ordre des fichiers, avec la liste de ses types d'entrée (noms,
//     modes OUT et valeurs par défaut retirés, alias de types ramenés au nom
//     canonique de format_type) ;
//   - une fonction de la prod est « identique » si son corps (`prosrc`) est
//     celui de la DERNIÈRE définition du dépôt pour le même nom et les mêmes
//     types d'entrée ; sinon « plus ancienne » (elle vaut une définition
//     antérieure du dépôt), « réécrite » (aucune définition du dépôt), ou
//     « absente » (le dépôt ne la crée nulle part).
//   Comparaison exacte, puis tolérante (fins de ligne, espaces en fin de ligne,
//   bords) : seule la seconde compte pour le verdict.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { prodQuery } from './prod.mjs';
import { ROOT, DATA } from './lib.mjs';

const SCHEMAS = ['public', 'private', 'analytics_wh', 'analytics_wh_private'];
const OUT = join(DATA, 'prod-functions.json');
const MIG = join(ROOT, 'supabase', 'migrations');
const md5 = (s) => createHash('md5').update(s).digest('hex');
const norm = (s) => s.replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();

const cmd = process.argv[2];

if (cmd === 'scan') {
  mkdirSync(DATA, { recursive: true });
  const versions = (await prodQuery(`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`));
  const fns = [];
  for (const part of [0, 1]) {
    const rows = await prodQuery(`
      SELECT n.nspname AS schema, p.proname AS name, p.oid::int AS oid,
             oidvectortypes(p.proargtypes) AS argtypes,
             pg_get_function_identity_arguments(p.oid) AS args,
             p.prokind AS kind, l.lanname AS lang, p.prosrc AS src
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
       WHERE n.nspname = ANY(ARRAY['${SCHEMAS.join("','")}'])
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
         AND p.oid::int % 2 = ${part}`);
    fns.push(...rows);
  }
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), versions, fns }));
  console.log(`${versions.length} migrations appliquées, ${fns.length} fonctions → ${OUT}`);
  process.exit(0);
}

if (cmd !== 'report' && cmd !== 'list') {
  console.error('usage: prod-functions-reference.mjs scan | report <rapport.md> <reference.sql> | list');
  process.exit(2);
}

// ── Relevé du dépôt ──────────────────────────────────────────────────────────
const snap = JSON.parse(readFileSync(OUT, 'utf8'));
const applied = new Set(snap.versions.map((v) => v.version));
const allFiles = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const files = allFiles.filter((f) => applied.has(f.split('_')[0]));
const notApplied = allFiles.filter((f) => !applied.has(f.split('_')[0]));
const repoVersions = new Set(allFiles.map((f) => f.split('_')[0]));
const prodOnly = snap.versions.filter((v) => !repoVersions.has(v.version));

const ALIAS = {
  int: 'integer', int4: 'integer', int8: 'bigint', int2: 'smallint', bool: 'boolean',
  float8: 'double precision', float4: 'real', float: 'double precision', decimal: 'numeric',
  timestamptz: 'timestamp with time zone', timestamp: 'timestamp without time zone',
  timetz: 'time with time zone', time: 'time without time zone', varchar: 'character varying',
  char: 'character', 'character varying': 'character varying', 'double precision': 'double precision',
};
const MULTI = ['double precision', 'character varying', 'timestamp with time zone', 'timestamp without time zone',
  'time with time zone', 'time without time zone', 'bit varying'];

function splitTop(s) {
  const out = []; let depth = 0; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function canonType(t) {
  let s = t.toLowerCase().replace(/"/g, '').replace(/\s+/g, ' ').trim();
  const arr = (s.match(/(\[\s*\])+$/) || [''])[0].replace(/\s/g, '');
  s = s.replace(/(\[\s*\])+$/, '').trim();
  s = s.replace(/\(.*\)$/, '').trim();               // varchar(255), numeric(10,2)
  s = s.replace(/^(public|extensions|pg_catalog)\./, '');
  if (/ with time zone$| without time zone$/.test(s) && /^timestamp|^time/.test(s)) s = s.replace(/\(\d+\)/, '');
  s = ALIAS[s] ?? s;
  return s + arr;
}
function paramTypes(list) {
  const types = [];
  for (let p of splitTop(list)) {
    p = p.replace(/\s+/g, ' ').trim();
    if (!p) continue;
    p = p.replace(/\s+(DEFAULT\s+[\s\S]*|=\s*[\s\S]*)$/i, '').trim();
    const mode = p.match(/^(IN|OUT|INOUT|VARIADIC)\s+/i);
    if (mode) p = p.slice(mode[0].length).trim();
    if (mode && /^OUT$/i.test(mode[1])) continue;
    const low = p.toLowerCase().replace(/"/g, '');
    let type;
    if (MULTI.some((m) => low.startsWith(m)) || !low.includes(' ')) type = p;
    else type = p.slice(p.indexOf(' ') + 1);
    if (/%type$/i.test(type)) return null;        // non résoluble sans la base
    types.push(canonType(type));
  }
  return types.join(', ');
}
function findClose(sql, open) {
  let depth = 0; let q = null;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === "'") { q = c; continue; }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const defs = new Map(); // "schema.name" → [{file, sig, body}]
const RE = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:"?([A-Za-z_][\w]*)"?\s*\.\s*)?"?([A-Za-z_][\w]*)"?\s*\(/gi;
// ALTER FUNCTION x(args) RENAME TO y : la définition courante de x devient y.
const REN = /ALTER\s+(?:FUNCTION|PROCEDURE)\s+(?:"?([A-Za-z_][\w]*)"?\s*\.\s*)?"?([A-Za-z_][\w]*)"?\s*\(/gi;
function parseInto(defs, sql, f) {
  let m;
  const events = [];
  RE.lastIndex = 0;
  while ((m = RE.exec(sql))) events.push({ kind: 'create', m });
  REN.lastIndex = 0;
  while ((m = REN.exec(sql))) events.push({ kind: 'rename', m });
  events.sort((a, b) => a.m.index - b.m.index);
  for (const { kind, m: ev } of events) {
    m = ev;
    const schema = (m[1] || 'public').toLowerCase();
    if (!SCHEMAS.includes(schema)) continue;
    const name = m[2].toLowerCase();
    const open = m.index + m[0].length - 1;
    const close = findClose(sql, open);
    if (close < 0) continue;
    const sig = paramTypes(sql.slice(open + 1, close));
    if (kind === 'rename') {
      const to = sql.slice(close + 1, close + 200).match(/^\s*RENAME\s+TO\s+"?([A-Za-z_][\w]*)"?/i);
      if (!to) continue;
      const from = defs.get(`${schema}.${name}`) ?? [];
      const hit = [...from].reverse().find((d) => d.sig === sig) ?? from[from.length - 1];
      if (!hit) continue;
      const key = `${schema}.${to[1].toLowerCase()}`;
      if (!defs.has(key)) defs.set(key, []);
      defs.get(key).push({ ...hit, file: `${f} (renommée depuis ${name})` });
      continue;
    }
    const rest = sql.slice(close);
    const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/i);
    const sq = rest.match(/\bAS\s+'/i);
    let body = null;
    if (tag && (!sq || tag.index < sq.index)) {
      const start = close + tag.index + tag[0].length;
      const end = sql.indexOf(tag[1], start);
      if (end > 0) body = sql.slice(start, end);
    } else if (sq) {
      // corps entre apostrophes (ancien style) : '' = une apostrophe
      let i = close + sq.index + sq[0].length; let b = '';
      while (i < sql.length) { if (sql[i] === "'" && sql[i + 1] === "'") { b += "'"; i += 2; continue; } if (sql[i] === "'") break; b += sql[i++]; }
      body = b;
    }
    if (body === null) continue;
    const key = `${schema}.${name}`;
    if (!defs.has(key)) defs.set(key, []);
    defs.get(key).push({ file: f, sig, raw: md5(body), norm: md5(norm(body)) });
  }
}

const texts = new Map();
const fileText = (f) => { if (!texts.has(f)) texts.set(f, readFileSync(join(MIG, f), 'utf8')); return texts.get(f); };
for (const f of files) parseInto(defs, fileText(f), f);

// Index des corps présents ailleurs dans git : fichiers de migration des autres
// branches (locales et distantes) absents de l'arbre courant. Sert à dire d'où
// vient une fonction « réécrite » ou « absente » (branche jamais fusionnée).
function branchIndex() {
  const here = new Set(execFileSync('git', ['ls-tree', '-r', '--format=%(objectname)', 'HEAD', '--', 'supabase/migrations'], { cwd: ROOT, encoding: 'utf8' }).split('\n'));
  const refs = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const blobs = new Map(); // sha → {path, refs}
  for (const ref of refs) {
    const out = execFileSync('git', ['ls-tree', '-r', '--format=%(objectname) %(path)', ref, '--', 'supabase/migrations'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const line of out.split('\n')) {
      const [sha, path] = line.split(' ');
      if (!sha || here.has(sha) || !path?.endsWith('.sql')) continue;
      if (!blobs.has(sha)) blobs.set(sha, { path, refs: [] });
      blobs.get(sha).refs.push(ref);
    }
  }
  const idx = new Map();
  for (const [sha, { path, refs: rs }] of blobs) {
    const sql = execFileSync('git', ['cat-file', 'blob', sha], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    const d = new Map();
    parseInto(d, sql, path.split('/').pop());
    for (const [key, list] of d) for (const x of list) {
      const k = `${key}|${x.norm}`;
      if (!idx.has(k)) idx.set(k, { file: x.file, refs: rs });
    }
  }
  return idx;
}

// ── Verdict par fonction de la prod ──────────────────────────────────────────
const res = [];
for (const fn of snap.fns) {
  const key = `${fn.schema}.${fn.name}`;
  const list = defs.get(key) ?? [];
  const sig = fn.argtypes.split(',').map((t) => canonType(t)).filter(Boolean).join(', ');
  const raw = md5(fn.src ?? ''); const nm = md5(norm(fn.src ?? ''));
  let status; let ref = null; let how = 'sig';
  if (!list.length) status = 'absent';
  else {
    let cand = list.filter((d) => d.sig === sig);
    if (!cand.length) { cand = list; how = 'nom'; }
    const last = cand[cand.length - 1];
    ref = last.file;
    if (last.norm === nm) status = last.raw === raw ? 'same' : 'same (espaces)';
    else {
      const older = [...cand].reverse().find((d) => d.norm === nm);
      if (older) { status = 'older'; ref = `${older.file} (dernière : ${last.file})`; }
      else status = 'rewritten';
    }
    // Repli : surcharge mal appariée par le relevé des types, mais corps identique
    // à la dernière définition d'un autre jeu de types du même nom.
    if (status !== 'same' && how === 'sig' && list[list.length - 1].norm === nm) { status = 'same'; how = 'nom'; }
  }
  res.push({ ...fn, sig, status, ref, how, nm, key });
}
const divergentAll = res.filter((r) => !/^same/.test(r.status));
// Fonctions qu'une reconstruction depuis le dépôt créerait et que la prod n'a
// pas (par nom) : créées par un fichier appliqué, jamais supprimées ensuite.
const prodNames = new Set(snap.fns.map((f) => `${f.schema}.${f.name}`));
const DROP = /DROP\s+(?:FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?([^;]+);/gi;
const dropped = new Map();
for (const f of files) {
  let m; DROP.lastIndex = 0;
  while ((m = DROP.exec(fileText(f)))) for (const part of m[1].split(/,(?![^(]*\))/)) {
    const n = part.trim().match(/^(?:"?([A-Za-z_]\w*)"?\.)?"?([A-Za-z_]\w*)"?/);
    if (n) dropped.set(`${(n[1] || 'public').toLowerCase()}.${n[2].toLowerCase()}`, f);
  }
}
const repoOnly = [...defs.entries()].filter(([k, list]) => !prodNames.has(k) && !(dropped.get(k) >= list[list.length - 1].file.split(' ')[0])).map(([k, list]) => ({ key: k, file: list[list.length - 1].file }));
if (divergentAll.length) {
  const idx = branchIndex();
  for (const r of divergentAll) {
    const o = idx.get(`${r.key}|${r.nm}`);
    if (o) r.origin = `${o.file} sur ${o.refs.slice(0, 2).join(', ')}${o.refs.length > 2 ? ` (+${o.refs.length - 2})` : ''}`;
    // Réécriture en place probable : un fichier appliqué APRÈS la dernière
    // définition, qui nomme la fonction et réécrit des définitions par EXECUTE.
    const after = r.ref ? r.ref.split(' ')[0] : '';
    const sus = files.filter((f) => f > after && /pg_get_functiondef|EXECUTE\s+(format|replace|v_def|v_sql|def)/i.test(fileText(f)) && new RegExp(`\\b${r.name}\\b`).test(fileText(f)));
    if (sus.length) r.suspect = sus.slice(-2).join(', ');
  }
}

const tally = {};
for (const r of res) tally[r.status] = (tally[r.status] ?? 0) + 1;
if (cmd === 'list') {
  console.log(tally, 'repoOnly', repoOnly.length);
  for (const r of repoOnly) console.log(`repo-only  ${r.key} | ${r.file}`);
  for (const r of divergentAll) console.log(`${r.status.padEnd(10)} ${r.schema}.${r.name}(${r.args.slice(0, 50)}) | dépôt ${r.ref ?? '—'} | ${r.origin ? 'git : ' + r.origin : 'nulle part dans git'}${r.suspect ? ' | réécrite par ? ' + r.suspect : ''}`);
  process.exit(0);
}

const divergent = divergentAll;
const [mdPath, sqlPath] = [process.argv[3], process.argv[4]];
if (!mdPath || !sqlPath) { console.error('report <rapport.md> <reference.sql>'); process.exit(2); }

// pg_get_functiondef + droits, par lots, seulement pour les fonctions divergentes.
const oids = divergent.map((r) => r.oid);
const full = [];
for (let i = 0; i < oids.length; i += 150) {
  const rows = await prodQuery(`
    SELECT p.oid::int AS oid, pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl,
           pg_get_userbyid(p.proowner) AS owner,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS ident
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.oid = ANY(ARRAY[${oids.slice(i, i + 150).join(',')}]::oid[])`);
  full.push(...rows);
}
const byOid = new Map(full.map((r) => [r.oid, r]));

function aclStatements(ident, acl, owner) {
  // proacl NULL = droits par défaut (EXECUTE à PUBLIC) : on l'écrit tel quel.
  const out = [`REVOKE ALL ON FUNCTION ${ident} FROM PUBLIC, anon, authenticated, service_role;`];
  if (!acl) { out.push(`GRANT EXECUTE ON FUNCTION ${ident} TO PUBLIC;`); return out; }
  const items = acl.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
  const grantees = new Set();
  for (const it of items) {
    const [who, rest] = it.split('=');
    if (!rest || !rest.split('/')[0].includes('X')) continue;
    const g = who === '' ? 'PUBLIC' : who;
    if (g === owner) continue;
    grantees.add(g);
  }
  for (const g of grantees) out.push(`GRANT EXECUTE ON FUNCTION ${ident} TO ${g === 'PUBLIC' ? 'PUBLIC' : `"${g}"`};`);
  return out;
}

const lastApplied = snap.versions[snap.versions.length - 1].version;
const sql = [
  `-- Référence : fonctions de la prod dont le texte diffère du dépôt (OPS-04).`,
  `-- Lu en LECTURE SEULE sur fulawxvdlwtdlpkycixe le ${snap.at.slice(0, 16)}Z (pg_get_functiondef + proacl),`,
  `-- dernière migration appliquée : ${lastApplied}. ${divergent.length} fonctions.`,
  `--`,
  `-- Ce fichier N'EST PAS dans supabase/migrations : \`supabase db push\` ne le joue pas.`,
  `-- Usage : reconstruction de secours. Après avoir rejoué les migrations du dépôt`,
  `-- jusqu'à ${lastApplied} inclus, le jouer pour retrouver le texte exact des`,
  `-- fonctions de la prod à cette date. Le jouer sur la prod aujourd'hui serait sans`,
  `-- effet ; le jouer APRÈS de nouvelles migrations les annulerait : ne jamais le`,
  `-- déplacer tel quel dans supabase/migrations.`,
  `--`,
  `-- Statuts (rapport : docs/audit/2026-10-18-crm-readiness/ops04-functions.md) :`,
  `--   rewritten  aucun fichier du dépôt ne porte ce texte (bloc DO, migration hors dépôt, SQL à la main)`,
  `--   older      la prod porte une définition antérieure à la dernière du dépôt`,
  `--   absent     le dépôt ne crée cette fonction nulle part`,
  `-- Les droits (EXECUTE) reproduisent proacl à l'identique.`,
  '',
  'BEGIN;',
  '',
];
for (const r of divergent.sort((a, b) => `${a.schema}.${a.name}.${a.args}`.localeCompare(`${b.schema}.${b.name}.${b.args}`))) {
  const f = byOid.get(r.oid);
  if (!f) continue;
  sql.push(`-- ${r.status} · ${f.ident}${r.ref ? ` · dépôt : ${r.ref}` : ''}`);
  sql.push(f.def.trimEnd() + ';');
  sql.push(...aclStatements(f.ident, f.acl, f.owner));
  sql.push('');
}
sql.push('COMMIT;', '');
writeFileSync(sqlPath, sql.join('\n'));

const groups = {};
for (const r of divergent) (groups[r.status] ??= []).push(r);
const md = [
  `# OPS-04 — fonctions de la prod ≠ dépôt (${snap.at.slice(0, 16)}Z)`,
  '',
  `Lecture seule de la prod (\`pg_proc\`, schémas ${SCHEMAS.join(', ')}, hors extensions), comparée aux`,
  `${files.length} fichiers de migration du dépôt dont la version est appliquée en prod`,
  `(${snap.versions.length} versions en prod, dernière ${lastApplied}). Méthode : en-tête de`,
  '`scripts/crm-bench/prod-functions-reference.mjs`.',
  '',
  '| Statut | Fonctions |', '|---|---|',
  ...Object.entries(tally).sort().map(([k, v]) => `| ${k} | ${v} |`),
  `| **total** | ${res.length} |`,
  '',
  `Versions appliquées en prod absentes du dépôt : ${prodOnly.length ? prodOnly.map((v) => `\`${v.version}\` (${v.name ?? '?'})`).join(', ') : 'aucune'}.`,
  '',
  `Fichiers du dépôt pas encore appliqués en prod (ignorés) : ${notApplied.length ? notApplied.map((f) => `\`${f}\``).join(', ') : 'aucun'}.`,
  '',
  `Migration de référence : \`supabase/reference/${sqlPath.split('/').pop()}\` (${divergent.length} fonctions).`,
  '',
];
for (const [k, list] of Object.entries(groups).sort()) {
  md.push(`## ${k} (${list.length})`, '', '| Fonction | Dernière définition du dépôt | Texte de la prod trouvé dans git | Réécrite en place par (probable) |', '|---|---|---|---|');
  for (const r of list.sort((a, b) => a.name.localeCompare(b.name))) md.push(`| \`${r.schema}.${r.name}(${r.args.replace(/\|/g, '/').slice(0, 70)})\` | ${r.ref ?? '—'} | ${r.origin ?? 'nulle part'} | ${r.suspect ?? '—'} |`);
  md.push('');
}
md.push(`## Créées par le dépôt, absentes de la prod (${repoOnly.length})`, '',
  'Une reconstruction depuis le dépôt les créerait ; la prod ne les a pas (supprimées hors migration, ou relevé imparfait : à lire avant d\'en tirer quoi que ce soit).', '');
for (const r of repoOnly.sort((a, b) => a.key.localeCompare(b.key))) md.push(`- \`${r.key}\` — ${r.file}`);
md.push('');
writeFileSync(mdPath, md.join('\n'));
console.log(tally, `→ ${mdPath}, ${sqlPath}`);
