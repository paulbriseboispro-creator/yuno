#!/usr/bin/env node
// Génère schema/base.sql : ce dont les migrations de l'analyse client ont
// besoin et qui existait AVANT elles (tables, types, fonctions), lu sur la
// prod en lecture seule. Les migrations elles-mêmes sont rejouées depuis le
// dépôt par run.mjs : base.sql n'en contient aucun objet.
//
//   node scripts/crm-bench/dump-base.mjs
//
// À relancer quand une migration plus ancienne change une fonction lue par
// l'analyse (le bench rejoue alors une base à jour). Une requête légère à la
// fois ; regarder `prod.mjs --activity` avant.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prodQuery } from './prod.mjs';
import { FIRST_MIGRATION, EXTRA_ROOTS } from './config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const migDir = join(root, 'supabase', 'migrations');

const files = readdirSync(migDir).filter((f) => f.endsWith('.sql') && f >= FIRST_MIGRATION).sort();
const text = files.map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');

const lower = (xs) => new Set([...xs].map((x) => x.toLowerCase()));
const defined = lower([
  ...[...text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)/gi)].map((m) => m[1]),
  ...[...text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi)].map((m) => m[1]),
]);
const refsOf = (s) => lower([...s.matchAll(/public\.(\w+)/g)].map((m) => m[1]));

const q = (names) => `ARRAY[${[...names].map((n) => `'${n}'`).join(',')}]::text[]`;

// Fermeture : ce que les migrations citent, puis ce que citent les fonctions
// citées, jusqu'au point fixe.
const tables = new Set();
const funcs = new Map(); // nom -> [définitions]
let frontier = new Set([...refsOf(text), ...EXTRA_ROOTS].filter((n) => !defined.has(n)));
const seen = new Set(frontier);
while (frontier.size) {
  const names = q(frontier);
  const rels = await prodQuery(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') AND c.relname = ANY(${names})`);
  for (const r of rels) tables.add(r.relname);
  const procs = await prodQuery(`
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY(${names})
     ORDER BY p.proname, p.oid`);
  const next = new Set();
  for (const p of procs) {
    if (!funcs.has(p.proname)) funcs.set(p.proname, []);
    funcs.get(p.proname).push(p.def);
    for (const r of refsOf(p.def)) if (!seen.has(r) && !defined.has(r)) { seen.add(r); next.add(r); }
  }
  frontier = next;
}

// Colonnes, défauts, clés primaires et index uniques (les ON CONFLICT en ont
// besoin) ; ni clés étrangères, ni CHECK, ni RLS : le banc mesure le calcul.
const cols = await prodQuery(`
  SELECT c.relname, c.relkind, a.attname, format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid) AS def, a.attgenerated
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relname = ANY(${q(tables)})
   ORDER BY c.relname, a.attnum`);
const idx = await prodQuery(`
  SELECT i.indexrelid::regclass::text AS name, pg_get_indexdef(i.indexrelid) AS def, c.relname
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY(${q(tables)}) AND (i.indisunique OR i.indisprimary)`);
const enums = await prodQuery(`
  SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE n.nspname = 'public' GROUP BY t.typname`);

const out = [
  '-- GÉNÉRÉ par scripts/crm-bench/dump-base.mjs — ne pas éditer à la main.',
  `-- Prod lue le ${new Date().toISOString()} ; ${tables.size} tables, ${funcs.size} fonctions.`,
  '',
];
for (const e of enums) {
  const labels = (Array.isArray(e.labels) ? e.labels : String(e.labels).replace(/^\{|\}$/g, '').split(','))
    .map((l) => `'${l.replace(/^"|"$/g, '').replace(/'/g, "''")}'`).join(', ');
  out.push(`DO $$ BEGIN CREATE TYPE public.${e.typname} AS ENUM (${labels}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
}
out.push('');
const byRel = new Map();
for (const c of cols) {
  if (!byRel.has(c.relname)) byRel.set(c.relname, []);
  byRel.get(c.relname).push(c);
}
for (const [rel, cs] of [...byRel].sort()) {
  // Une vue de la prod devient une table au banc : on y écrit les données.
  const lines = cs.map((c) => {
    // pgvector n'existe pas au banc ; les embeddings ne servent pas à l'analyse.
    let l = `  ${JSON.stringify(c.attname)} ${/^vector\b/.test(c.typ) ? 'text' : c.typ}`;
    if (c.def && !c.attgenerated && !/nextval\(/.test(c.def)) l += ` DEFAULT ${c.def}`;
    if (/nextval\(/.test(c.def || '')) l = `  ${JSON.stringify(c.attname)} bigint GENERATED BY DEFAULT AS IDENTITY`;
    if (c.attnotnull && !c.def) l += ' NOT NULL';
    return l;
  });
  out.push(`CREATE TABLE IF NOT EXISTS public.${rel} (\n${lines.join(',\n')}\n);`);
}
out.push('');
for (const i of idx) out.push(i.def.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ') + ';');
out.push('');
for (const [, defs] of [...funcs].sort()) {
  for (const d of defs) {
    if (/\bvector\b\s*(\(|,|\)|$)/m.test(d.split('AS $')[0])) continue; // signature en pgvector
    out.push(d.trimEnd() + ';\n');
  }
}

mkdirSync(join(here, 'schema'), { recursive: true });
writeFileSync(join(here, 'schema', 'base.sql'), out.join('\n'));
console.log(`base.sql : ${tables.size} tables, ${funcs.size} fonctions, ${idx.length} index uniques`);
