#!/usr/bin/env node
// La prod est-elle identique au dépôt pour ces fonctions ? À lancer AVANT de
// réécrire une fonction dans une migration.
//
//   node scripts/crm-bench/same-as-prod.mjs _crm_an_load crm_score_compute
//   node scripts/crm-bench/same-as-prod.mjs --before 20261013100000 _crm_an_load
//     (avant d'appliquer : comparer à la version d'AVANT les migrations à venir)
//
// Compare le corps (`prosrc`) de chaque surcharge en prod au corps du DERNIER
// fichier de migration du dépôt qui la définit (entre `AS $tag$` et `$tag$;`).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prodQuery } from './prod.mjs';
import { ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const bi = argv.indexOf('--before');
const before = bi >= 0 ? argv[bi + 1] : null;
const names = bi >= 0 ? argv.filter((_, i) => i !== bi && i !== bi + 1) : argv;
if (!names.length) { console.error('usage: same-as-prod.mjs <fonction> [...]'); process.exit(2); }

const dir = join(ROOT, 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql') && (!before || f < before)).sort();
const norm = (s) => s.replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();

function lastDefinition(name) {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, 'gi');
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(join(dir, files[i]), 'utf8');
    let m;
    let last = null;
    while ((m = re.exec(sql))) last = m.index;
    if (last === null) continue;
    const tag = sql.slice(last).match(/\bAS\s+(\$[A-Za-z_]*\$)/);
    if (!tag) continue;
    const start = last + tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], start);
    return { file: files[i], body: norm(sql.slice(start, end)) };
  }
  return null;
}

let bad = 0;
const rows = await prodQuery(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[${names.map((n) => `'${n}'`).join(',')}]::text[])`);
for (const name of names) {
  const repo = lastDefinition(name);
  const prod = rows.filter((r) => r.proname === name);
  if (!repo) { console.log(`✗ ${name} : aucune définition dans le dépôt`); bad++; continue; }
  if (!prod.length) { console.log(`✗ ${name} : absente de la prod (dépôt : ${repo.file})`); bad++; continue; }
  const hit = prod.find((r) => norm(r.prosrc) === repo.body);
  if (hit) console.log(`✓ ${name}(${hit.args}) = ${repo.file}`);
  else { console.log(`✗ ${name} : la prod DIFFÈRE de ${repo.file} (${prod.length} surcharge(s))`); bad++; }
}
process.exit(bad ? 1 : 0);
