#!/usr/bin/env node
// Le calcul de nuit du score « Chances de venir » (cron crm-score-nightly) sur
// les définitions de la PROD, à la taille d'un vrai compte.
//
//   node prod.mjs --activity                       # rien de lourd ne tourne ?
//   node score-nightly.mjs dump                    # instantané des définitions de la prod (lecture seule)
//   node score-nightly.mjs gen amoris              # compte synthétique + analyse complète
//   node score-nightly.mjs warm amoris [--open]    # un premier calcul (le modèle « d'hier ») → amoris-warm
//   node score-nightly.mjs run amoris [--open] [m.sql …]   # calcul AVANT, puis APRÈS les migrations, comparés
//   node score-nightly.mjs run amoris-warm [m.sql …]
//
// --open abaisse les portes du score dans la base du banc : le compte
// synthétique est « weak », Amoris est « ok » ; sans les portes ouvertes, la
// note des soirées à venir et le journal ne tournent pas.
//
// Le schéma vient de la prod (dump-base.mjs en mode instantané, comme
// isolation.mjs) : on mesure ce qui tourne, pas la dernière migration du
// dépôt (quatre fonctions du score y diffèrent depuis les colonnes typées des
// billets, 18/10). Les déclencheurs ne sont pas copiés : les colonnes typées
// des billets générés sont remplies ici, comme le ferait
// trg_external_tickets_typed_fields.
//
// `run` joue les deux calculs dans UNE transaction : même now(), même état de
// départ (modèle d'hier, journal) rétabli entre les deux, puis annulée. Les
// tables écrites par le score sont comparées ligne à ligne, par leur clé
// (horodatages et durées ignorés ; tout exact, coefficients du modèle
// compris, sauf les real à 1e-5 près, voir plus bas) : c'est la preuve qu'une
// optimisation ne change ni les chances, ni les étiquettes, ni le journal.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, openSaved, save, execFile, profiled, HERE, ROOT, DATA } from './lib.mjs';
import { generate } from './gen.mjs';
import { profile } from './profiles.mjs';
import { prodQuery } from './prod.mjs';

const SNAP = join(DATA, 'snapshot-score.sql');
const ROOTS = join(DATA, 'score-roots.txt');
const RULES = join(DATA, 'score-rules.json');
const POSTAL = join(ROOT, 'supabase', 'migrations', '20261010105000_crm_postal_codes_fr.sql');
// Ce que le score écrit (et que le journal relit le lendemain).
const OUT = ['crm_score_model', 'crm_score_night', 'crm_person_night_score',
  'crm_prediction_nights', 'crm_prediction_people', 'crm_prediction_results'];
const VOLATILE = ['trained_at', 'snapshot_at', 'settled_at', 'created_at', 'updated_at'];

const [cmd, name, ...args] = process.argv.slice(2);
// --open : portes du score abaissées DANS LA BASE DU BANC (le compte synthétique
// est « weak ») pour que la note et le journal tournent, comme sur Amoris (« ok »).
const OPEN = args.includes('--open');
const rest = args.filter((a) => !a.startsWith('--'));
const openGates = (db) => db.exec(`UPDATE public.crm_analysis_rules SET config = jsonb_set(jsonb_set(jsonb_set(config,
  '{score,auc_gain}', '-1'), '{score,auc_min}', '0'), '{score,ece_max}', '1')`);
process.on('uncaughtException', (e) => {
  console.error(`ERREUR ${e.code || ''} : ${e.message}${e.where ? `\n  où : ${e.where}` : ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (e) => { throw e; });

async function orgOf(db) {
  return (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
}

if (cmd === 'dump') {
  // Le calcul de nuit, l'analyse qui le précède et ce qu'écrit gen.mjs.
  writeFileSync(ROOTS, [
    'crm_score_nightly', 'crm_score_compute', 'crm_analysis_compute', 'crm_analysis_config',
    'organizer_profiles', 'ticketing_connections', 'events', 'external_events', 'external_tickets',
    'newsletter_subscriptions', 'venue_sms_contacts', 'crm_yunit_lots', 'crm_subscriptions',
    'crm_postal_codes_fr', 'crm_analysis_rules', 'crm_profile_optouts',
  ].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  // Les seuils actifs du moteur (réglage, aucune donnée personnelle).
  writeFileSync(RULES, JSON.stringify(await prodQuery(`SELECT * FROM public.crm_analysis_rules`)));
  console.log(`instantané → ${SNAP}, règles → ${RULES}`);
} else if (cmd === 'gen') {
  if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node score-nightly.mjs dump »');
  const p = profile(name);
  const db = await openFresh();
  await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
  await execFile(db, SNAP, 'snapshot-score.sql');
  await execFile(db, POSTAL, 'crm_postal_codes_fr');
  await db.query(`INSERT INTO public.crm_analysis_rules SELECT * FROM jsonb_populate_recordset(NULL::public.crm_analysis_rules, $1::jsonb)`,
    [readFileSync(RULES, 'utf8')]);
  const t0 = Date.now();
  const stats = await generate(db, p);
  // trg_external_tickets_typed_fields (prod) : le canal vient du billet.
  await db.exec(`UPDATE public.external_tickets SET deal_channel = raw->>'deal_channel' WHERE deal_channel IS NULL`);
  const org = await orgOf(db);
  const t1 = Date.now();
  const a = (await db.query(`SELECT crm_analysis_compute(NULL, $1, true, 0) AS r`, [org])).rows[0].r;
  await save(db, `${name}-score`);
  console.log(JSON.stringify({ ...stats, gen_ms: t1 - t0, analysis_ms: Date.now() - t1, analysis: a }, null, 1));
} else if (cmd === 'warm') {
  // Le lendemain du premier calcul : le modèle d'hier existe (départ à chaud),
  // le journal a déjà la « première chance » de chacun.
  const db = await openSaved(`${name}-score`);
  const org = await orgOf(db);
  if (OPEN) await openGates(db);
  const r = await profiled(db, 'crm_score_compute (à froid)', `SELECT crm_score_compute(NULL, $1) AS r`, [org], 12);
  await save(db, `${name}-warm`);
  report(r);
} else if (cmd === 'run') {
  const base = name.endsWith('-warm') ? name : `${name}-score`;
  const db = await openSaved(base);
  const org = await orgOf(db);
  const migrations = rest.map((f) => resolve(process.cwd(), f));
  await db.exec('BEGIN');
  if (OPEN) await openGates(db);
  for (const t of OUT) await db.exec(`CREATE TEMP TABLE bench_s0_${t} AS SELECT * FROM public.${t}`);
  const before = await profiled(db, 'AVANT', `SELECT crm_score_compute(NULL, $1) AS r`, [org], 15);
  for (const t of OUT) await db.exec(`CREATE TEMP TABLE bench_a_${t} AS SELECT * FROM public.${t}`);
  for (const t of OUT) await db.exec(`DELETE FROM public.${t}; INSERT INTO public.${t} SELECT * FROM bench_s0_${t}`);
  for (const f of migrations) await execFile(db, f, f.split('/').pop());
  const after = await profiled(db, 'APRÈS', `SELECT crm_score_compute(NULL, $1) AS r`, [org], 15);
  for (const t of OUT) await db.exec(`CREATE TEMP TABLE bench_b_${t} AS SELECT * FROM public.${t}`);
  report(before);
  report(after);
  let same = true;
  for (const t of OUT) {
    // Jointure par la clé de la table ; tout est comparé exactement (tableaux
    // de coefficients compris), sauf les flottants sur 4 octets (real) : une
    // somme de real dépend de l'ordre de lecture des lignes, qui varie entre
    // deux passages dans la même base (lignes mortes du premier). Ils sont
    // comparés à 1e-5 près (relatif), et l'écart maximal est affiché.
    const key = (await db.query(`
      SELECT array_agg(a.attname::text ORDER BY k.o) AS cols
        FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, o)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE i.indrelid = ('public.' || $1)::regclass AND i.indisunique AND ic.relname = $1 || '_pkey'`, [t])).rows[0].cols;
    const cols = (await db.query(`
      SELECT column_name AS c, data_type AS ty FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND NOT (column_name = ANY ($2)) ORDER BY ordinal_position`, [t, VOLATILE])).rows
      .filter((x) => !key.includes(x.c));
    const on = key.map((k) => `a.${k} = b.${k}`).join(' AND ');
    const jx = (x) => `CASE WHEN jsonb_typeof(${x}) = 'object' THEN ${x} - 'ms' ELSE ${x} END`;
    const differs = cols.map(({ c, ty }) => ty === 'real'
      ? `NOT (a.${c} IS NOT DISTINCT FROM b.${c} OR abs(a.${c} - b.${c}) <= 1e-5 * greatest(1, abs(a.${c})))`
      : ty === 'jsonb' ? `${jx(`a.${c}`)} IS DISTINCT FROM ${jx(`b.${c}`)}`
        : `a.${c} IS DISTINCT FROM b.${c}`);
    const reals = cols.filter((x) => x.ty === 'real').map(({ c }) => `max(abs(a.${c} - b.${c}) / greatest(1, abs(a.${c})))`);
    const r = (await db.query(`
      SELECT (SELECT count(*) FROM bench_a_${t})::int AS n,
             count(*) FILTER (WHERE b.${key[0]} IS NULL)::int AS only_a,
             count(*) FILTER (WHERE a.${key[0]} IS NULL)::int AS only_b,
             count(*) FILTER (WHERE a.${key[0]} IS NOT NULL AND b.${key[0]} IS NOT NULL
                                AND (${differs.join(' OR ') || 'false'}))::int AS diff,
             ${reals.length ? `GREATEST(${reals.join(', ')})` : 'NULL::float8'} AS real_gap
        FROM bench_a_${t} a FULL JOIN bench_b_${t} b ON ${on}`)).rows[0];
    const gap = r.real_gap ? `, real à ${Number(r.real_gap).toExponential(1)} près` : '';
    if (!r.only_a && !r.only_b && !r.diff) console.log(`✓ ${t} : identique (${r.n} lignes${gap})`);
    else {
      same = false;
      console.log(`✗ ${t} : ${r.only_a} lignes seulement avant, ${r.only_b} seulement après, ${r.diff} différentes (${r.n} avant)`);
    }
  }
  await db.exec('ROLLBACK');
  process.exit(same ? 0 : 1);
} else {
  console.error('usage: node score-nightly.mjs dump | gen <profil> | warm <profil> | run <profil>[-warm] [migration.sql …]');
  process.exit(2);
}

function report(o) {
  const r = o.rows[0]?.r || {};
  console.log(`\n■ ${o.label} : ${o.ms} ms — statut ${r.status}, notés ${r.scored}, journal ${JSON.stringify(r.journal)}`);
  for (const s of o.slow || []) console.log(`   ${String(s.ms).padStart(7)} ms ×${String(s.calls).padEnd(4)} ${s.stmt}`);
}

process.exit(0);
