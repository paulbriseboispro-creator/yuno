#!/usr/bin/env node
// Banc d'essai de l'analyse client Yuno CRM. Voir README.md.
//
//   node run.mjs build                 schéma (prelude + base + migrations du dépôt)
//   node run.mjs gen <profil>          compte synthétique (demo | grand | petit | hasard)
//   node run.mjs compute <profil>      analyse complète + score, temps et résultats
//   node run.mjs bench <profil>        temps des fonctions lourdes et des lectures d'écran
import { build, openSaved, save, timed, profiled } from './lib.mjs';
import { generate } from './gen.mjs';
import { profile } from './profiles.mjs';

const [cmd, name, ...rest] = process.argv.slice(2);
// PGlite joint son code minifié à chaque erreur : on n'affiche que l'utile.
process.on('uncaughtException', (e) => {
  console.error(`ERREUR ${e.code || ''} : ${e.message}${e.where ? `\n  où : ${e.where}` : ''}${e.hint ? `\n  indice : ${e.hint}` : ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (e) => { throw e; });
const log = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 1));

if (cmd === 'build') {
  const t0 = Date.now();
  const db = await build();
  await save(db, process.env.BENCH_UNTIL ? `schema-before-${process.env.BENCH_UNTIL}` : 'schema');
  log(`schéma construit en ${Date.now() - t0} ms → .data/${process.env.BENCH_UNTIL ? `schema-before-${process.env.BENCH_UNTIL}` : 'schema'}.tar.gz`);
} else if (cmd === 'gen') {
  const p = profile(name);
  const sch = process.env.BENCH_UNTIL ? `schema-before-${process.env.BENCH_UNTIL}` : 'schema';
  const db = await openSaved(sch);
  const t0 = Date.now();
  const stats = await generate(db, p);
  await save(db, process.env.BENCH_UNTIL ? `${name}-before-${process.env.BENCH_UNTIL}` : name);
  log({ ...stats, ms: Date.now() - t0 });
} else if (cmd === 'compute') {
  const p = profile(name);
  const tag = process.env.BENCH_UNTIL ? `${name}-before-${process.env.BENCH_UNTIL}` : name;
  const db = await openSaved(tag);
  const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
  const a = await timed(db, `SELECT crm_analysis_compute(NULL, $1, true, 0) AS r`, [org]);
  const s = await timed(db, `SELECT crm_score_compute(NULL, $1) AS r`, [org]);
  const fam = await db.query(`SELECT family, status, n, round(o::numeric, 1) o, round(e::numeric, 1) e, round(z::numeric, 2) z
                                FROM crm_family_status WHERE scope_key = $1 ORDER BY family`, [`org:${org}`]);
  await save(db, `${tag}-computed`);
  log({ profile: p.name, analysis_ms: a.ms, score_ms: s.ms, analysis: a.rows[0].r, score: s.rows[0].r });
  console.table(fam.rows);
} else if (cmd === 'bench') {
  // Sur le compte GÉNÉRÉ (jamais calculé) : un calcul de nuit complet, puis les
  // lectures d'écran telles que le pro les appelle (session du titulaire).
  const db = await openSaved(name);
  const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
  const out = [];
  out.push(await profiled(db, 'crm_analysis_compute (complet)', `SELECT crm_analysis_compute(NULL, $1, true, 0) AS r`, [org]));
  out.push(await profiled(db, 'crm_score_compute', `SELECT crm_score_compute(NULL, $1) AS r`, [org]));
  const up = (await db.query(`SELECT event_id FROM external_events WHERE organizer_user_id = $1 AND start_at > now() ORDER BY start_at LIMIT 1`, [org])).rows[0].event_id;
  const past = (await db.query(`SELECT event_id FROM external_events WHERE organizer_user_id = $1 AND start_at < now() ORDER BY start_at DESC LIMIT 1`, [org])).rows[0].event_id;
  const em = (await db.query(`SELECT email FROM crm_person_profile ORDER BY email LIMIT 1`)).rows[0]?.email;
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: org, role: 'authenticated' })]);
  const reads = [
    ['crm_analysis_overview', `SELECT crm_analysis_overview(NULL, $1) AS r`, [org]],
    ['crm_night_targets (à venir)', `SELECT crm_night_targets(NULL, $1, $2) AS r`, [org, up]],
    ['crm_night_analysis (passée)', `SELECT crm_night_analysis(NULL, $1, $2) AS r`, [org, past]],
    ['crm_client_analysis', `SELECT crm_client_analysis(NULL, $1, $2) AS r`, [org, em]],
    ['crm_artists_analysis', `SELECT crm_artists_analysis(NULL, $1) AS r`, [org]],
    ['crm_automations', `SELECT crm_automations(NULL, $1, '30d') AS r`, [org]],
  ];
  for (const [label, sql, params] of reads) {
    try { out.push(await profiled(db, label, sql, params, 4)); }
    catch (e) { out.push({ label, error: e.message }); }
  }
  for (const o of out) {
    console.log(`\n■ ${o.label} : ${o.error ? 'ERREUR ' + o.error : o.ms + ' ms'}`);
    for (const s of o.slow || []) console.log(`   ${String(s.ms).padStart(7)} ms ×${s.calls}  ${s.stmt}`);
  }
} else if (cmd === 'journal') {
  // Journal prévu / réel : on note les soirées à venir, on rejoue les achats
  // futurs (bench_future), puis on règle « 70 jours plus tard ».
  // BANC SEULEMENT : les portes du score sont abaissées pour qu'il note.
  const db = await openSaved(name);
  const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
  await db.exec(`UPDATE crm_analysis_rules SET config = jsonb_set(jsonb_set(config, '{score,auc_gain}', '-1'), '{score,auc_min}', '0')`);
  await db.query(`SELECT crm_analysis_compute(NULL, $1, true, 0)`, [org]);
  const sc = (await db.query(`SELECT crm_score_compute(NULL, $1) AS r`, [org])).rows[0].r;
  log({ score: sc.status, scored: sc.scored, journal: sc.journal });
  await db.query(`
    INSERT INTO external_tickets (connection_id, organizer_user_id, provider, external_id, external_event_id, event_id,
                                  buyer_email, holder_email, status, price, raw, purchased_at, first_seen_at)
    SELECT c.id, f.organizer_user_id, 'shotgun', 'future-' || row_number() OVER (), f.external_event_id, e.event_id,
           f.email, f.email, 'valid', 15, '{"deal_channel":"online"}'::jsonb, f.purchased_at, f.purchased_at
      FROM bench_future f
      JOIN external_events e ON e.external_id = f.external_event_id AND e.organizer_user_id = f.organizer_user_id
      JOIN ticketing_connections c ON c.organizer_user_id = f.organizer_user_id`);
  const t = await timed(db, `SELECT _crm_score_settle($1, NULL, $2, now() + interval '70 days') AS n`, [`org:${org}`, org]);
  const res = (await db.query(`SELECT title, horizon, metrics FROM crm_prediction_results ORDER BY start_at, horizon`)).rows;
  log(`règlement : ${t.rows[0].n} soirées en ${t.ms} ms ; lignes par personne restantes : ${
    (await db.query(`SELECT count(*)::int AS n FROM crm_prediction_people`)).rows[0].n}`);
  console.table(res.map((r) => ({
    soiree: r.title, moment: r.horizon, n: r.metrics.n, achats: r.metrics.buyers, attendus: r.metrics.expected,
    auc: r.metrics.auc, ece: r.metrics.ece, prevu: r.metrics.projection?.predicted, reel: r.metrics.projection?.actual,
    ecart: r.metrics.projection?.err })));
  const aud = res.filter((r) => r.horizon === 'first').flatMap((r) => Object.entries(r.metrics.audiences || {})
    .map(([k, v]) => ({ soiree: r.title, audience: k, n: v.n, attendus: v.p, reels: v.y })));
  console.table(aud);
  log({ gate: (await db.query(`SELECT _crm_projection_gate($1) AS g`, [`org:${org}`])).rows[0].g });
  await save(db, `${name}-journal`);
} else if (cmd === 'holdout') {
  // « 10 % non contactés » : un envoi « Qui cibler » mis en file comme le ferait
  // le service, puis la mesure. Au banc, un envoi ne change aucun achat (ils
  // sont tirés d'avance) : la mesure doit trouver un gain NUL (test A/A).
  const db = await openSaved(name);
  const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
  await db.query(`SELECT crm_analysis_compute(NULL, $1, true, 0)`, [org]);
  const ev = (await db.query(`SELECT event_id FROM external_events WHERE organizer_user_id = $1 AND start_at > now() ORDER BY start_at LIMIT 1`, [org])).rows[0].event_id;
  const aud = JSON.stringify([{ kind: 'crm', def: { seg: 'all', f: { ntgt: { e: ev, a: 'lineup' } } }, label: 'Qui cibler' }]);
  const cid = (await db.query(`INSERT INTO email_campaigns (organizer_user_id, name, subject, status, event_id, audiences_json, product, blocks_version)
                                VALUES ($1, 'Banc · line-up', 'Banc', 'draft', $2, $3::jsonb, 'crm', 2) RETURNING id`, [org, ev, aud])).rows[0].id;
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const enq = (await db.query(`SELECT enqueue_campaign_recipients($1) AS r`, [cid])).rows[0].r;
  const st = (await db.query(`SELECT status, error_message, count(*)::int n FROM email_campaign_recipients WHERE campaign_id = $1 GROUP BY 1, 2 ORDER BY 3 DESC`, [cid])).rows;
  const camp = (await db.query(`SELECT total_recipients, holdout_count FROM email_campaigns WHERE id = $1`, [cid])).rows[0];
  log({ enqueue: enq, campaign: camp });
  console.table(st);
  // Le même envoi par SMS.
  // La base de contacts (cache que lit _cp) est construite par un cron en prod.
  await db.query(`SELECT _contact_base_cache_build(contact_base_scope_key(NULL, $1), NULL, $1, false)`, [org]);
  const sid = (await db.query(`INSERT INTO sms_campaigns (organizer_id, created_by, name, body_template, segment_filters, event_id, status)
                                VALUES ($1, $1, 'Banc · line-up SMS', 'Banc', $2::jsonb, $3, 'draft') RETURNING id`,
    [org, JSON.stringify({ type: 'crm', audiences: JSON.parse(aud) }), ev])).rows[0].id;
  const senq = (await db.query(`SELECT _enqueue_crm_sms_recipients($1) AS r`, [sid])).rows[0].r;
  const sst = (await db.query(`SELECT status, error_code, count(*)::int n, count(email)::int with_email FROM sms_campaign_recipients WHERE campaign_id = $1 GROUP BY 1, 2`, [sid])).rows;
  log({ sms_enqueue: senq, sms_campaign: (await db.query(`SELECT total_recipients, holdout_count FROM sms_campaigns WHERE id = $1`, [sid])).rows[0] });
  console.table(sst);
  // Les achats futurs arrivent ; la mesure se lit en tant que titulaire.
  await db.query(`
    INSERT INTO external_tickets (connection_id, organizer_user_id, provider, external_id, external_event_id, event_id,
                                  buyer_email, holder_email, status, price, raw, purchased_at, first_seen_at)
    SELECT c.id, f.organizer_user_id, 'shotgun', 'future-' || row_number() OVER (), f.external_event_id, e.event_id,
           f.email, f.email, 'valid', 15, '{"deal_channel":"online"}'::jsonb, f.purchased_at, f.purchased_at
      FROM bench_future f
      JOIN external_events e ON e.external_id = f.external_event_id AND e.organizer_user_id = f.organizer_user_id
      JOIN ticketing_connections c ON c.organizer_user_id = f.organizer_user_id`);
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: org, role: 'authenticated' })]);
  log((await db.query(`SELECT crm_holdout_overview(NULL, $1) AS r`, [org])).rows[0].r);
} else {
  console.error('usage: node run.mjs build | gen <profil> | compute <profil> | bench <profil>');
  process.exit(2);
}

process.exit(0);
