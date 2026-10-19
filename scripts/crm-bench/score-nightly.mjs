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
//   node score-nightly.mjs run amoris-warm --nightly [m.sql …]   # par crm_score_nightly (la passe du cron)
//   node score-nightly.mjs overrun amoris-warm m.sql …    # PERF-02 : une portée qui ne tient pas dans le temps
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
// --nightly : les deux calculs passent par crm_score_nightly (la passe du cron,
// qui choisit la portée et attrape les dépassements) au lieu de
// crm_score_compute.
//
// `overrun` (PERF-02) rejoue des passes de nuit, chacune dans sa transaction
// comme en prod, sur deux portées : le compte (lent) en tête de file et une
// petite portée vide derrière. Budget abaissé (score.budget_s), puis délai de
// l'instruction simulé (PGlite n'a pas de minuteur : le journal est remplacé
// par une fonction qui lève query_canceled, comme le minuteur de la prod le
// 18/10 pendant l'INSERT de crm_prediction_people), puis annulation à la main
// (même erreur, bien avant le délai). Vérifié à chaque passe : la portée lente
// garde ses chances d'hier à l'identique (six tables, ligne à ligne), cède la
// passe, la suivante est notée, l'alerte ne part qu'une fois par nuit, la nuit
// suivante la portée lente ne passe plus en premier, et une fois le temps
// rendu le calcul repart normalement.
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
const NIGHTLY = args.includes('--nightly');
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
  // La passe du cron ne prend qu'une portée pas encore notée aujourd'hui : le
  // modèle d'une base « -warm » (calculé le jour même au banc) passe à hier.
  if (NIGHTLY) await db.exec(`UPDATE public.crm_score_model SET trained_at = LEAST(trained_at, date_trunc('day', now()) - interval '1 hour')`);
  const call = NIGHTLY ? ['SELECT crm_score_nightly() AS r', []] : ['SELECT crm_score_compute(NULL, $1) AS r', [org]];
  for (const t of OUT) await db.exec(`CREATE TEMP TABLE bench_s0_${t} AS SELECT * FROM public.${t}`);
  const before = await profiled(db, 'AVANT', call[0], call[1], 15);
  for (const t of OUT) await db.exec(`CREATE TEMP TABLE bench_a_${t} AS SELECT * FROM public.${t}`);
  for (const t of OUT) await db.exec(`DELETE FROM public.${t}; INSERT INTO public.${t} SELECT * FROM bench_s0_${t}`);
  for (const f of migrations) await execFile(db, f, f.split('/').pop());
  const after = await profiled(db, 'APRÈS', call[0], call[1], 15);
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
} else if (cmd === 'overrun') {
  await overrun();
} else {
  console.error('usage: node score-nightly.mjs dump | gen <profil> | warm <profil> | run <profil>[-warm] [--nightly] [migration.sql …] | overrun <profil>[-warm] migration.sql …');
  process.exit(2);
}

// ── PERF-02 : une portée qui ne tient pas dans le temps ─────────────────────
async function overrun() {
  const base = name.endsWith('-warm') ? name : `${name}-score`;
  const db = await openSaved(base);
  const org = await orgOf(db);
  const A = `org:${org}`;
  const orgB = '00000000-0000-4000-8000-0000000000b2';
  const B = `org:${orgB}`;
  for (const f of rest.map((x) => resolve(process.cwd(), x))) await execFile(db, f, f.split('/').pop());
  await openGates(db);
  // Une deuxième portée branchée, sans billet (calcul « insufficient » en un
  // instant), notée l'avant-veille ; le compte, notée il y a trois jours (ou
  // jamais) : il est en tête de file.
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'orga-b@bench.test') ON CONFLICT DO NOTHING`, [orgB]);
  await db.query(`INSERT INTO public.organizer_profiles (user_id, display_name, product) VALUES ($1, 'Banc B', 'crm')`, [orgB]);
  await db.query(`INSERT INTO public.ticketing_connections (id, organizer_user_id, provider, external_org_id, status, initial_import_done_at)
                  VALUES (gen_random_uuid(), $1, 'shotgun', 'bench-b', 'active', now())`, [orgB]);
  await db.query(`INSERT INTO public.crm_analysis_state (scope_key, organizer_user_id, full_at, computed_at) VALUES ($1, $2, now(), now())`, [B, orgB]);
  await db.query(`INSERT INTO public.crm_score_model (scope_key, organizer_user_id, status, metrics, trained_at)
                  VALUES ($1, $2, 'insufficient', '{}', now() - interval '2 days')`, [B, orgB]);
  await db.query(`UPDATE public.crm_score_model SET trained_at = now() - interval '3 days' WHERE scope_key = $1`, [A]);

  // Empreinte exacte (toutes colonnes, horodatages compris) de ce que le score
  // a écrit pour le compte : « rien n'a bougé » se prouve ligne à ligne.
  const prints = async () => {
    const o = {};
    for (const t of OUT) {
      o[t] = (await db.query(`SELECT count(*)::int AS n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h
                                FROM public.${t} x WHERE x.scope_key = $1`, [A])).rows[0];
    }
    return o;
  };
  const same = (a, b) => OUT.every((t) => a[t].n === b[t].n && a[t].h === b[t].h);
  const state = async (k) => (await db.query(`SELECT st.score_overrun_at, st.score_overrun, m.status, m.trained_at,
                                                     m.trained_at >= date_trunc('day', now()) AS today
                                                FROM public.crm_analysis_state st LEFT JOIN public.crm_score_model m USING (scope_key)
                                               WHERE st.scope_key = $1`, [k])).rows[0];
  const alerts = async () => (await db.query(`SELECT count(*)::int AS n FROM public.admin_notifications
                                               WHERE dedup_key LIKE 'crm_score_overrun:' || $1 || ':%'`, [A])).rows[0].n;
  let ok = true;
  const check = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) ok = false; };
  const pass = async (label) => {
    const t0 = Date.now();
    try {
      const r = (await db.query(`SELECT crm_score_nightly() AS r`)).rows[0].r;
      console.log(`\n■ ${label} : ${Date.now() - t0} ms → ${JSON.stringify(r)}`);
      return r;
    } catch (e) {
      console.log(`\n■ ${label} : ${Date.now() - t0} ms → ERREUR ${e.code} ${e.message}`);
      return { error: e.code };
    }
  };
  const setBudget = (v) => db.query(`UPDATE public.crm_analysis_rules SET config = CASE WHEN $1::text IS NULL
      THEN config #- '{score,budget_s}' ELSE jsonb_set(config, '{score,budget_s}', to_jsonb($1::numeric)) END`, [v]);
  const ms = (r) => Number(r.ms || 0);

  const y = await prints();
  console.log(`hier, pour le compte : ${OUT.map((t) => `${t} ${y[t].n}`).join(', ')}`);

  // 1. Budget abaissé à 3 s : le compte cède la passe, la petite portée est
  //    notée, le compte est retenté sur la passe restée libre.
  await setBudget(3);
  let r = await pass('passe 1 (budget 3 s)');
  check(r.scope === A && r.overrun === 'budget' && r.phase, 'le compte s\'arrête sur son budget, à une étape nommée');
  check(same(y, await prints()), 'ses chances, étiquettes, modèle et journal d\'hier sont intacts');
  let sa = await state(A);
  check(sa.score_overrun_at && sa.score_overrun?.kind === 'budget' && !sa.today, 'la trace du dépassement est écrite, le modèle reste celui d\'hier');
  check(await alerts() === 1, 'une alerte super admin');
  r = await pass('passe 2');
  const sb = await state(B);
  check(r.scope === B && r.status === 'insufficient' && sb.today, 'la portée suivante est notée');
  r = await pass('passe 3 (passe libre)');
  check(r.scope === A && r.overrun === 'budget', 'le compte est retenté sur la passe restée libre');
  check(await alerts() === 1, 'toujours une seule alerte cette nuit');

  // 2. La nuit suivante : le compte ne prend plus la première passe.
  await db.exec(`UPDATE public.crm_score_model SET trained_at = trained_at - interval '1 day';
                 UPDATE public.crm_analysis_state SET score_overrun_at = score_overrun_at - interval '1 day';
                 UPDATE public.admin_notifications SET dedup_key = dedup_key || ':hier' WHERE dedup_key LIKE 'crm_score_overrun:%'`);
  r = await pass('nuit suivante, passe 1');
  check(r.scope === B, 'la nuit suivante, la petite portée passe la première');
  r = await pass('nuit suivante, passe 2');
  check(r.scope === A && r.overrun === 'budget', 'puis le compte');

  // 3. Délai de l'instruction (sans budget) : le minuteur de la prod lève
  //    query_canceled ; PGlite n'en a pas, le journal le lève à sa place, à la
  //    même étape que le 18/10. statement_timeout = 2 s (que PGlite n'applique
  //    pas) : l'instruction l'a largement dépassé quand l'erreur arrive.
  await setBudget(null);
  const { d: journalDef, res } = (await db.query(`SELECT pg_get_functiondef(o) AS d, pg_get_function_result(o) AS res
      FROM (SELECT 'public._crm_score_journal(text,text,uuid)'::regprocedure AS o) z`)).rows[0];
  await db.exec(`CREATE OR REPLACE FUNCTION public._crm_score_journal(p_scope text, p_venue_id text, p_organizer_user_id uuid)
                 RETURNS ${res} LANGUAGE plpgsql AS $$ BEGIN
                   RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled';
                 END $$`);
  await db.exec(`SET statement_timeout = '2s'`);
  const y2 = await prints();
  r = await pass('délai dépassé pendant le journal');
  check(r.scope === A && r.overrun === 'timeout' && r.phase === '_crm_score_journal', 'le délai dépassé est attrapé, l\'étape est nommée');
  check(same(y2, await prints()), 'les chances d\'hier sont intactes (la note du jour est annulée avec le journal)');
  sa = await state(A);
  check(sa.score_overrun?.kind === 'timeout' && !sa.today, 'la trace dit « délai »');
  const trace = JSON.stringify(sa.score_overrun);

  // 4. Annulation à la main (même erreur, bien avant le délai de 10 min) :
  //    elle remonte, comme avant, et la passe n'écrit rien.
  await db.exec(`SET statement_timeout = '10min'`);
  r = await pass('annulation à la main');
  check(r.error === '57014', 'une annulation à la main n\'est pas prise pour un délai : elle remonte');
  check(same(y2, await prints()) && JSON.stringify((await state(A)).score_overrun) === trace, 'et ne change rien');

  // 5. Le temps rendu : le calcul repart normalement.
  await db.exec(`SET statement_timeout = 0`);
  await db.exec(journalDef);
  r = await pass('le temps rendu');
  sa = await state(A);
  check(r.scope === A && r.status && !r.overrun && !r.error && sa.today, `le compte est noté (${r.status}, ${r.scored} chances)`);
  check(!same(y2, await prints()), 'ses chances sont celles du jour');
  r = await pass('plus rien en file');
  check(r.scopes === 0, 'la file est vide');
  console.log(ok ? '\nPERF-02 : tout est conforme' : '\nPERF-02 : ÉCART');
  process.exit(ok ? 0 : 1);
}

function report(o) {
  const r = o.rows[0]?.r || {};
  console.log(`\n■ ${o.label} : ${o.ms} ms — statut ${r.status}, notés ${r.scored}, journal ${JSON.stringify(r.journal)}`);
  for (const s of o.slow || []) console.log(`   ${String(s.ms).padStart(7)} ms ×${String(s.calls).padEnd(4)} ${s.stmt}`);
}

process.exit(0);
