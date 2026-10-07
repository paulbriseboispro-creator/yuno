#!/usr/bin/env node
// Répéter des migrations sur la PROD sans rien laisser : les fichiers puis un
// smoke, dans UNE transaction implicite qui finit par RAISE EXCEPTION
// 'SMOKE_OK …' — l'exception annule tout (tables, fonctions, cron, données).
//
//   node scripts/crm-bench/rehearse.mjs smoke/lot01.sql 2026101310*.sql …
//
// Refuse un fichier qui porte BEGIN / COMMIT / ROLLBACK (il casserait
// l'annulation) et un smoke qui ne lève pas SMOKE_OK. Regarder
// `prod.mjs --activity` avant : une seule répétition à la fois, jamais
// pendant la migration d'une autre session.
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ROOT } from './lib.mjs';

const REF = 'fulawxvdlwtdlpkycixe';
const [smokeFile, ...migs] = process.argv.slice(2);
// Sans migration : mesure de référence de l'état actuel (toujours annulée).
if (!smokeFile) { console.error('usage: rehearse.mjs <smoke.sql> [<migration.sql> …]'); process.exit(2); }
const smoke = readFileSync(smokeFile, 'utf8');
if (!/RAISE EXCEPTION 'SMOKE_OK/.test(smoke)) { console.error('le smoke doit finir par RAISE EXCEPTION \'SMOKE_OK …\''); process.exit(2); }
const parts = migs.map((m) => {
  const f = m.includes('/') ? m : join(ROOT, 'supabase', 'migrations', m);
  const sql = readFileSync(f, 'utf8');
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql)) { console.error(`${basename(f)} : BEGIN/COMMIT au niveau du fichier, refusé`); process.exit(2); }
  return `-- ═══ ${basename(f)}\n${sql}`;
});
const token = (readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!token) { console.error('SUPABASE_ACCESS_TOKEN introuvable'); process.exit(2); }

const t0 = Date.now();
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `${parts.join('\n')}\n-- ═══ smoke\n${smoke}` }),
});
const text = await res.text();
const ms = Date.now() - t0;
let msg = text;
try { msg = JSON.parse(text).message ?? text; } catch { /* texte brut */ }
if (msg.includes('SMOKE_OK')) {
  console.log(`répétition annulée en ${ms} ms — SMOKE_OK\n${msg.slice(msg.indexOf('SMOKE_OK') + 8).trim()}`);
} else {
  console.log(`ÉCHEC (${res.status}, ${ms} ms) — rien n'est appliqué :\n${msg.slice(0, 3000)}`);
  process.exit(1);
}
