#!/usr/bin/env node
// DATA-08 (audit du 18/10) : la règle DATA-02 dans le moteur d'analyse client,
// mesurée au banc sur les définitions de la PROD.
//
// Le schéma du banc (run.mjs build) rejoue les migrations de l'analyse depuis un
// base.sql du 08/10 : il ne connaît ni les colonnes typées des billets, ni la
// porte mesurée. Ce script part donc d'un INSTANTANÉ de la prod (fonctions de
// l'analyse et du score, leur fermeture, les tables, les triggers des billets,
// la règle d'analyse active et les codes postaux), puis :
//   avant = instantané + migrations 20261022100000 → 130000 (lot « données »)
//   après = avant + 20261022140000 (cette mise au point)
// Un même compte synthétique (gen.mjs) est généré UNE fois, puis calculé de
// chaque côté (crm_analysis_compute complet + crm_score_compute).
//
//   node prod.mjs --activity
//   node audit-analysis.mjs dump            # instantané (lecture seule de la prod)
//   node audit-analysis.mjs <profil>        # demo | grand | petit | hasard | gratuit
//   node diff.mjs <profil>-d08-before-computed <profil>-d08-after-computed
//
// Sortie : la table des venues comparée à l'ancienne dans la MÊME transaction
// (preuve exacte, sans dérive d'horloge), puis les chiffres qui en sortent
// (personnes, soirées, venus une fois, familles, score) avant / après.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, openSaved, save, execFile, timed, HERE, DATA, ROOT } from './lib.mjs';
import { prodQuery } from './prod.mjs';
import { generate } from './gen.mjs';
import { profile } from './profiles.mjs';

const SNAP = join(DATA, 'snapshot-audit-analysis.sql');
const TRIG = join(DATA, 'snapshot-audit-analysis-triggers.sql');
const REF = join(DATA, 'snapshot-audit-analysis-data.sql');
const ROOTS = join(DATA, 'audit-analysis-roots.txt');
const MIG = (f) => join(ROOT, 'supabase', 'migrations', f);
const BEFORE = ['20261022100000_crm_free_entry_needs_scan.sql', '20261022110000_crm_customer_spend_sales_only.sql',
  '20261022120000_ticketing_cohosted_toggle.sql', '20261022130000_ticketing_ticket_guards.sql'].map(MIG);
const AFTER = MIG('20261022140000_crm_analysis_free_entry_needs_scan.sql');
const log = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 1));

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, [
    // Le calcul de nuit et le score, ce qu'ils appellent, ce qu'ils écrivent.
    'crm_analysis_compute', 'crm_score_compute', 'crm_analysis_config', 'crm_analysis_rules',
    'crm_night_targets', '_crm_night_target_set', 'crm_analysis_overview',
    // Ce que le générateur écrit.
    'external_tickets', 'external_events', 'events', 'ticketing_connections', 'organizer_profiles',
    'newsletter_subscriptions', 'venue_sms_contacts', 'crm_yunit_lots', 'crm_subscriptions', 'crm_postal_codes_fr',
    // Les triggers des billets (colonnes typées, effacement, changement d'adresse).
    'external_tickets_typed_fields', 'external_tickets_note_provider_erasure', 'external_tickets_note_email_move',
    'ticketing_minimize_raw', 'ticketing_erasures', 'ticketing_email_moves',
    // Ce que réécrivent les migrations 20261022100000 → 130000.
    '_crm_people_build', 'crm_client__core', '_crm_activity_build', 'crm_rules_preview', 'crm_home__core',
    'crm_night_detail__core', 'contact_scope_customers', 'crm_ticketing_set_cohosted', '_crm_erase_contacts',
    'crm_retention_sweep', 'marketing_consent_events', 'crm_prediction_people', 'crm_person_night_score',
    'contact_base_cache_state', 'contact_base_scope_key', 'crm_profile_optouts', 'crm_analysis_dirty', 'crm_person_profile',
  ].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  const trg = await prodQuery(`SELECT pg_get_triggerdef(t.oid) AS d FROM pg_trigger t
    WHERE t.tgrelid = 'public.external_tickets'::regclass AND NOT t.tgisinternal ORDER BY t.tgname`);
  writeFileSync(TRIG, trg.map((r) => `${r.d};`).join('\n') + '\n');
  // Données de référence (aucune donnée personnelle) : la règle active, les codes postaux.
  const rules = await prodQuery(`SELECT to_jsonb(r) AS j FROM public.crm_analysis_rules r WHERE r.active`);
  const cps = await prodQuery(`SELECT json_agg(c) AS j FROM public.crm_postal_codes_fr c`);
  const lit = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  writeFileSync(REF, [
    ...rules.map((r) => `INSERT INTO public.crm_analysis_rules SELECT * FROM jsonb_populate_record(NULL::public.crm_analysis_rules, ${lit(r.j)});`),
    `INSERT INTO public.crm_postal_codes_fr SELECT * FROM jsonb_populate_recordset(NULL::public.crm_postal_codes_fr, ${lit(cps[0].j)});`,
  ].join('\n') + '\n');
  console.log(`${trg.length} triggers, ${rules.length} règle(s), ${cps[0].j.length} codes postaux → ${DATA}`);
  process.exit(0);
}

for (const f of [SNAP, TRIG, REF]) if (!existsSync(f)) throw new Error('lancer d\'abord « node audit-analysis.mjs dump »');
const name = process.argv[2];
if (!name) { console.error('usage: node audit-analysis.mjs dump | <profil>'); process.exit(2); }
const p = profile(name);

// ── Génération, une fois, sur le schéma « avant » ───────────────────────────
const db0 = await openFresh();
await execFile(db0, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db0, SNAP, 'snapshot');
await execFile(db0, TRIG, 'triggers');
await execFile(db0, REF, 'données de référence');
for (const m of BEFORE) await execFile(db0, m, m.split('/').pop());
const stats = await generate(db0, p);
await save(db0, `${name}-d08`);
await db0.close();
log({ generated: stats });
const org = stats.organizer_user_id;

// ── La table des venues : nouvelle contre ancienne, même transaction ────────
// L'ancienne _crm_an_load (prod) est gardée sous un autre nom ; les deux
// tournent sur la même date, sans dérive d'horloge.
{
  const db = await openSaved(`${name}-d08`);
  await db.exec(`ALTER FUNCTION public._crm_an_load(text, uuid, timestamptz, jsonb) RENAME TO _crm_an_load_prod`);
  await execFile(db, AFTER, AFTER.split('/').pop());
  const at = (await db.query(`SELECT now() AS t`)).rows[0].t;
  const r = await db.transaction(async (tx) => {
    const cfg = `public.crm_analysis_config()`;
    await tx.query(`SELECT public._crm_an_load_prod(NULL, $1, $2, ${cfg})`, [org, at]);
    await tx.exec(`CREATE TEMP TABLE _old_ana AS SELECT * FROM _ana; CREATE TEMP TABLE _old_ant AS SELECT * FROM _ant`);
    await tx.query(`SELECT public._crm_an_load(NULL, $1, $2, ${cfg})`, [org, at]);
    await tx.query(`SELECT public._crm_an_load_bought()`);
    const one = async (sql) => (await tx.query(sql)).rows[0];
    return {
      // Billets gratuits non scannés de soirées à porte mesurée : les seuls que la règle écarte.
      tickets_free_noshow_measured: (await one(`SELECT count(*)::int n FROM _ant WHERE sale AND NOT night`)).n,
      venues_before: (await one(`SELECT count(*)::int n FROM _old_ana`)).n,
      venues_after: (await one(`SELECT count(*)::int n FROM _ana`)).n,
      people_before: (await one(`SELECT count(DISTINCT em)::int n FROM _old_ana`)).n,
      people_after: (await one(`SELECT count(DISTINCT em)::int n FROM _ana`)).n,
      once_before: (await one(`SELECT count(*)::int n FROM (SELECT em FROM _old_ana GROUP BY em HAVING count(*) = 1) z`)).n,
      once_after: (await one(`SELECT count(*)::int n FROM (SELECT em FROM _ana GROUP BY em HAVING count(*) = 1) z`)).n,
      // _ana nouvelle = ancienne, ligne pour ligne, tant qu'aucun billet n'est écarté ?
      ana_rows_only_before: (await one(`SELECT count(*)::int n FROM (SELECT * FROM _old_ana EXCEPT SELECT * FROM _ana) z`)).n,
      ana_rows_only_after: (await one(`SELECT count(*)::int n FROM (SELECT * FROM _ana EXCEPT SELECT * FROM _old_ana) z`)).n,
      // _anbought = l'ancienne _ana sur ce que le score lit, toujours.
      bought_diff: (await one(`SELECT count(*)::int n FROM (
          (SELECT em, nid, start_at, has_sale, lead_h, k FROM _old_ana EXCEPT SELECT em, nid, start_at, has_sale, lead_h, k FROM _anbought)
          UNION ALL
          (SELECT em, nid, start_at, has_sale, lead_h, k FROM _anbought EXCEPT SELECT em, nid, start_at, has_sale, lead_h, k FROM _old_ana)) z`)).n,
      // _ant inchangée hors la nouvelle colonne.
      ant_diff: (await one(`SELECT count(*)::int n FROM (
          (SELECT id, em, nid, sale, inv, scanned, price FROM _old_ant EXCEPT SELECT id, em, nid, sale, inv, scanned, price FROM _ant)
          UNION ALL
          (SELECT id, em, nid, sale, inv, scanned, price FROM _ant EXCEPT SELECT id, em, nid, sale, inv, scanned, price FROM _old_ant)) z`)).n,
    };
  });
  await db.close();
  log({ venues: r });
}

// ── Le calcul de nuit et le score, de chaque côté ───────────────────────────
async function side(label, withMigration) {
  const db = await openSaved(`${name}-d08`);
  if (withMigration) await execFile(db, AFTER, AFTER.split('/').pop());
  const a = await timed(db, `SELECT crm_analysis_compute(NULL, $1, true, 0) AS r`, [org]);
  const s = await timed(db, `SELECT crm_score_compute(NULL, $1) AS r`, [org]);
  const key = `org:${org}`;
  const q = async (sql) => (await db.query(sql, [key])).rows;
  const out = {
    analysis_ms: a.ms, score_ms: s.ms,
    stats: (await q(`SELECT stats FROM crm_analysis_state WHERE scope_key = $1`))[0]?.stats,
    profiles: (await q(`SELECT count(*)::int n, sum(nights)::int nights, count(*) FILTER (WHERE nights = 1)::int once,
                               count(*) FILTER (WHERE 'loc' = ANY (tags) AND nights = 1)::int once_local
                          FROM crm_person_profile WHERE scope_key = $1`))[0],
    nights: (await q(`SELECT sum(entries)::int entries, sum(buyers)::int buyers, sum(new_people)::int new_people
                        FROM crm_night_profile WHERE scope_key = $1`))[0],
    artists: (await q(`SELECT sum(entries)::int entries, sum(fans)::int fans FROM crm_artist_stats WHERE scope_key = $1`))[0],
    families: await q(`SELECT family, status, n, round(o::numeric, 1) o, round(e::numeric, 1) e, round(z::numeric, 2) z
                         FROM crm_family_status WHERE scope_key = $1 AND variant = '' ORDER BY family`),
    score: s.rows[0].r,
  };
  await save(db, `${name}-d08-${label}-computed`);
  await db.close();
  return out;
}
const before = await side('before', false);
const after = await side('after', true);

log({ stats: { before: before.stats, after: after.stats } });
log({ profiles: { before: before.profiles, after: after.profiles } });
log({ nights: { before: before.nights, after: after.nights }, artists: { before: before.artists, after: after.artists } });
const pick = (sc) => ({ status: sc.status, scored: sc.scored, auc: sc.auc, auc_base: sc.auc_base, ece: sc.ece,
  auc_active: sc.auc_active, auc_active_base: sc.auc_active_base, backtest: sc.backtest });
log({ score: { before: pick(before.score), after: pick(after.score) } });
const fam = new Map();
for (const f of before.families) fam.set(f.family, { family: f.family, avant: f.status, n_avant: f.n, gain_avant: f.e > 0 ? Math.round((f.o / f.e) * 100) / 100 : null, z_avant: f.z });
for (const f of after.families) Object.assign(fam.get(f.family) ?? fam.set(f.family, { family: f.family }).get(f.family),
  { apres: f.status, n_apres: f.n, gain_apres: f.e > 0 ? Math.round((f.o / f.e) * 100) / 100 : null, z_apres: f.z });
console.table([...fam.values()].map((x) => ({ ...x, change: x.avant === x.apres ? '' : '◀' })));
log({ ms: { analysis: [before.analysis_ms, after.analysis_ms], score: [before.score_ms, after.score_ms] } });
