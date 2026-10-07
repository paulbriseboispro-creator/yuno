#!/usr/bin/env node
// Les tables calculées de deux bases sont-elles identiques ? Pour prouver
// qu'une optimisation ne change rien à ce qui est calculé.
//
//   node diff.mjs <base-avant> <base-après>
//
// Ignore les horodatages, les durées (« ms ») et les flottants au-delà de la
// 6e décimale ; rend, table par table, identique / nombre de lignes qui diffèrent.
import { createHash } from 'node:crypto';
import { openSaved } from './lib.mjs';

const TABLES = [
  'crm_analysis_state', 'crm_night_profile', 'crm_person_profile', 'crm_artist_stats',
  'crm_family_status', 'crm_score_model', 'crm_score_night', 'crm_person_night_score',
];
const VOLATILE = new Set(['computed_at', 'updated_at', 'trained_at', 'created_at', 'marked_at', 'full_at',
  'dirty_at', 'duration_ms', 'ms', 'computed_on', 'first_seen_at', 'last_error_at', 'status_since']);

function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const k of Object.keys(v).sort()) if (!VOLATILE.has(k)) o[k] = clean(v[k]);
    return o;
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 1e6) / 1e6;
  if (typeof v === 'string' && /^-?\d+\.\d{7,}$/.test(v)) return String(Math.round(Number(v) * 1e6) / 1e6);
  return v;
}

async function rowsOf(db, table) {
  const exists = (await db.query(`SELECT to_regclass('public.' || $1) IS NOT NULL AS ok`, [table])).rows[0].ok;
  if (!exists) return null;
  return (await db.query(`SELECT * FROM public.${table}`)).rows.map((r) => JSON.stringify(clean(r))).sort();
}

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: node diff.mjs <base-avant> <base-après>'); process.exit(2); }
const [da, db] = [await openSaved(a), await openSaved(b)];
let same = true;
for (const t of TABLES) {
  const [ra, rb] = [await rowsOf(da, t), await rowsOf(db, t)];
  if (!ra || !rb) { console.log(`  ${t} : absente d'un côté`); continue; }
  const h = (x) => createHash('md5').update(x.join('\n')).digest('hex').slice(0, 10);
  if (h(ra) === h(rb)) { console.log(`✓ ${t} : identique (${ra.length} lignes)`); continue; }
  same = false;
  const sa = new Set(ra);
  const sb = new Set(rb);
  const onlyA = ra.filter((x) => !sb.has(x));
  const onlyB = rb.filter((x) => !sa.has(x));
  console.log(`✗ ${t} : ${ra.length} → ${rb.length} lignes, ${onlyA.length} seulement avant, ${onlyB.length} seulement après`);
  if (onlyA[0]) console.log(`    avant : ${onlyA[0].slice(0, 300)}`);
  if (onlyB[0]) console.log(`    après : ${onlyB[0].slice(0, 300)}`);
}
process.exit(same ? 0 : 1);
