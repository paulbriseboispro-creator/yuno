// Outils communs du banc : ouvrir une base, la sauver, rejouer les migrations.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_stat_statements } from '@electric-sql/pglite/contrib/pg_stat_statements';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_MIGRATION } from './config.mjs';

const EXT = { pgcrypto, pg_stat_statements };

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const DATA = join(HERE, '.data');
const MIG = join(ROOT, 'supabase', 'migrations');

export function analysisMigrations() {
  // BENCH_UNTIL=<version> : s'arrêter avant une migration (comparer avant / après).
  const until = process.env.BENCH_UNTIL;
  return readdirSync(MIG).filter((f) => f.endsWith('.sql') && f >= FIRST_MIGRATION && (!until || f < until)).sort();
}

async function session(db) {
  await db.exec(`SET check_function_bodies = off; SET client_min_messages = warning;`);
  return db;
}

export async function openFresh() {
  return session(await PGlite.create({ extensions: EXT }));
}

/** Ouvre une copie d'une base sauvée (`.data/<nom>.tar.gz`). */
export async function openSaved(name) {
  const f = join(DATA, `${name}.tar.gz`);
  if (!existsSync(f)) throw new Error(`base « ${name} » absente : lancer d'abord la commande qui la crée (README)`);
  const blob = new Blob([readFileSync(f)]);
  return session(await PGlite.create({ loadDataDir: blob, extensions: EXT }));
}

export async function save(db, name) {
  mkdirSync(DATA, { recursive: true });
  const dump = await db.dumpDataDir('gzip');
  writeFileSync(join(DATA, `${name}.tar.gz`), Buffer.from(await dump.arrayBuffer()));
}

/** Exécute un fichier SQL ; l'erreur dit le fichier et la ligne approximative. */
export async function execFile(db, path, label = path) {
  const sql = readFileSync(path, 'utf8');
  try {
    await db.exec(sql);
  } catch (e) {
    const pos = Number(e.position || 0);
    const line = pos ? sql.slice(0, pos).split('\n').length : '?';
    throw new Error(`${label} (ligne ~${line}) : ${e.message}`);
  }
}

export async function build() {
  const db = await openFresh();
  await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
  await execFile(db, join(HERE, 'schema', 'base.sql'), 'base.sql');
  for (const f of analysisMigrations()) await execFile(db, join(MIG, f), f);
  return db;
}

/** Durée d'une instruction, en millisecondes. */
export async function timed(db, sql, params) {
  const t0 = performance.now();
  const r = await db.query(sql, params);
  return { ms: Math.round(performance.now() - t0), rows: r.rows };
}

/** Mesure une instruction et rend les instructions imbriquées les plus lentes. */
export async function profiled(db, label, sql, params, top = 8) {
  await db.exec(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements; SET pg_stat_statements.track = 'all';`);
  await db.query(`SELECT pg_stat_statements_reset()`);
  const r = await timed(db, sql, params);
  const slow = (await db.query(`
    SELECT round(total_exec_time)::int AS ms, calls,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 110) AS stmt
      FROM pg_stat_statements
     WHERE query !~* '^\\s*(SELECT|CALL) (public\\.)?(crm_|pg_stat)' AND total_exec_time > 50
     ORDER BY total_exec_time DESC LIMIT $1`, [top])).rows;
  return { label, ms: r.ms, rows: r.rows, slow };
}
