#!/usr/bin/env node
// Lecture de la prod par l'API de gestion Supabase, en LECTURE SEULE.
//
//   node scripts/crm-bench/prod.mjs "SELECT 1"
//   node scripts/crm-bench/prod.mjs -f requete.sql
//   node scripts/crm-bench/prod.mjs --activity     # pg_stat_activity, à lancer AVANT toute requête lourde
//
// La requête part dans une transaction READ ONLY : une écriture lève une
// erreur au lieu de toucher la base. Appliquer une migration ne passe JAMAIS
// par ce script (voir README, « Mettre en ligne »).
//
// Jeton : SUPABASE_ACCESS_TOKEN lu dans .env.local (jamais affiché).

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REF = 'fulawxvdlwtdlpkycixe';

function token() {
  for (const p of ['.env.local', '../../.env.local']) {
    const f = resolve(process.cwd(), p);
    if (!existsSync(f)) continue;
    const m = readFileSync(f, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  throw new Error('SUPABASE_ACCESS_TOKEN introuvable (.env.local)');
}

const ACTIVITY = `
SELECT pid, usename, application_name, state,
       round(extract(epoch FROM now() - query_start)::numeric, 1) AS secs,
       left(regexp_replace(query, '\\s+', ' ', 'g'), 120) AS query
  FROM pg_stat_activity
 WHERE state <> 'idle' AND pid <> pg_backend_pid()
 ORDER BY query_start`;

export async function prodQuery(sql) {
  // Plusieurs instructions = une transaction implicite : SET TRANSACTION la
  // passe en lecture seule sans toucher la connexion (partagée) de l'API.
  const body = `SET TRANSACTION READ ONLY;\n${sql}`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 2000)}`);
  return JSON.parse(text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let sql;
  if (args[0] === '--activity') sql = ACTIVITY;
  else if (args[0] === '-f') sql = readFileSync(args[1], 'utf8');
  else sql = args.join(' ');
  if (!sql) { console.error('usage: prod.mjs "<sql>" | -f fichier.sql | --activity'); process.exit(2); }
  prodQuery(sql)
    .then((rows) => console.log(JSON.stringify(rows, null, 1)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
