#!/usr/bin/env node
// Scénarios (automatisations sur mesure) — banc. Plan :
// docs/designs/CRM_JOURNEYS_PLAN.md.
//
//   node scenarios.mjs conditions [base]   langage « et / ou » : cas partagés avec
//                                          le miroir TypeScript, puis effectifs
//                                          compilés contre _crm_filter_sql
//   node scenarios.mjs crud [base]         lot J2 : brouillon, publication,
//                                          versions, rôles, accès assisté, recette
//   node scenarios.mjs engine [base]       lot J3 : le moteur de bout en bout
//   node scenarios.mjs editor [base]       lot J4 : effectifs en direct, aperçu
//   node scenarios.mjs seed [base]         lot J5 : le semis démo, rejoué deux fois
//   node scenarios.mjs plan [base]         lot A1 : plan de soirée, audience « target » d'un brouillon d'IA
//   node scenarios.mjs review [base]       lot A3 : bilan de la semaine
//   node scenarios.mjs daily [base]        lot A5 : bilan du jour de la plateforme, alerte, audits prêts
//
// La base (défaut : demo-computed, déjà analysée) reçoit les migrations des
// Scénarios (20261016100000 et suivantes) avant les essais : c'est la même
// base que celle du lot d'optimisation, plus nos fichiers.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openSaved, execFile, ROOT } from './lib.mjs';
import { SCENARIO_FIRST } from './config.mjs';

process.on('uncaughtException', (e) => {
  console.error(`ERREUR ${e.code || ''} : ${e.message}${e.where ? `\n  où : ${e.where}` : ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (e) => { throw e; });

const MIG = join(ROOT, 'supabase', 'migrations');

/** Applique les migrations des Scénarios à une base sauvée. */
export async function withScenarios(name) {
  const db = await openSaved(name);
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql') && x >= SCENARIO_FIRST).sort()) {
    await execFile(db, join(MIG, f), f);
  }
  return db;
}

const [cmd = 'conditions', base = 'demo-computed'] = process.argv.slice(2);
let ok = true;
const check = (label, cond, got) => {
  console.log(`${cond ? '✓' : '✗'} ${label}${got !== undefined ? ` (${typeof got === 'string' ? got : JSON.stringify(got)})` : ''}`);
  if (!cond) ok = false;
};

if (cmd === 'conditions') {
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];

  // ── 1. Les cas partagés avec condErrors (TypeScript) ──────────────────────
  const fx = JSON.parse(readFileSync(join(ROOT, 'src/crm/lib/__tests__/fixtures/scenario-conditions.json'), 'utf8'));
  let same = 0;
  for (const c of fx.cases) {
    const got = (await one(`SELECT public._crm_cond_errors($1::jsonb, $2) AS e`, [JSON.stringify(c.tree), c.ctx])).e;
    if (JSON.stringify(got) === JSON.stringify(c.errors)) same += 1;
    else check(`cas « ${c.name} »`, false, { attendu: c.errors, sql: got });
  }
  check(`${same} / ${fx.cases.length} cas : le SQL rend les mêmes erreurs que le TypeScript`, same === fx.cases.length);

  // ── 1 bis. Les graphes (graphErrors ⇄ _crm_scenario_graph_errors) ─────────
  const gx = JSON.parse(readFileSync(join(ROOT, 'src/crm/lib/__tests__/fixtures/scenario-graphs.json'), 'utf8'));
  let gsame = 0;
  for (const c of gx.cases) {
    const got = (await one(`SELECT public._crm_scenario_graph_errors($1::jsonb) AS r`, [JSON.stringify(c.graph)])).r;
    const okErr = JSON.stringify(got.errors) === JSON.stringify(c.errors);
    // jsonb range ses clés à sa façon : on compare champ par champ.
    const okStats = !c.stats || Object.keys(c.stats).every((k) => got.stats[k] === c.stats[k]);
    if (okErr && okStats) gsame += 1;
    else check(`graphe « ${c.name} »`, false, { attendu: c.errors, sql: got.errors, stats: c.stats, sqlStats: got.stats });
  }
  check(`${gsame} / ${gx.cases.length} graphes : le SQL rend les mêmes erreurs et chiffres que le TypeScript`, gsame === gx.cases.length);

  // ── 2. Compiler, puis compter sur la base du compte ───────────────────────
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  const scope = `org:${org}`;
  await db.exec('BEGIN');
  const total = (await one(`SELECT public._crm_people_build(NULL, $1::uuid) AS n`, [org])).n;
  console.log(`base du compte : ${total} personnes`);
  const ev = (await one(`SELECT e.id FROM events e WHERE e.organizer_user_id = $1 AND e.external_source IS NOT NULL
                          AND e.start_at < now() ORDER BY e.start_at DESC LIMIT 1`, [org])).id;
  // La ligne d'inscription fictive : scope, soirée, entrée il y a longtemps.
  await db.exec(`CREATE TEMP TABLE _bench_r ON COMMIT DROP AS
                   SELECT gen_random_uuid() AS id, '${scope}'::text AS scope_key, '${ev}'::uuid AS event_id, p.email, '-infinity'::timestamptz AS entered_at,
                          NULL::uuid AS version_id FROM _cp p`);
  const countTree = async (tree, event = null) => {
    const resolved = (await one(`SELECT public._crm_cond_resolve($1, $2::jsonb, $3::uuid) AS t`, [scope, JSON.stringify(tree), event])).t;
    const sql = (await one(`SELECT public._crm_cond_sql($1::jsonb, 'p', 'r') AS s`, [JSON.stringify(resolved)])).s;
    return { n: Number((await one(`SELECT count(*) AS n FROM _cp p JOIN _bench_r r ON r.email = p.email WHERE ${sql}`)).n), sql };
  };
  const countDef = async (def) => {
    const sql = (await one(`SELECT public._crm_filter_sql($1::jsonb, 'p') AS s`, [JSON.stringify(def)])).s;
    return Number((await one(`SELECT count(*) AS n FROM _cp p WHERE ${sql}`)).n);
  };
  const L = (k, v) => ({ k, v });

  // Le banc n'a pas de genre : on croise soirées et canal joignable.
  let a = await countTree({ op: 'and', items: [L('nb_min', 2), L('rc', ['mail'])] });
  let b = await countDef({ f: { nb_min: 2, rc: ['mail'] } });
  check('« et » = le filtre de la liste Clients', a.n === b && b > 0, `${a.n} = ${b}`);

  const hab = await countDef({ seg: 'hab' });
  const one1 = await countDef({ f: { nb: '1' } });
  a = await countTree({ op: 'or', items: [L('seg', 'hab'), L('nb', '1')] });
  check('« ou » = l’union (deux ensembles disjoints)', a.n === hab + one1, `${a.n} = ${hab} + ${one1}`);

  const two = await countDef({ f: { nb_min: 2 } });
  a = await countTree({ op: 'and', items: [{ op: 'and', not: true, items: [L('nb_min', 2)] }] });
  check('« non » = le complément', a.n === total - two, `${a.n} = ${total} − ${two}`);

  a = await countTree({ op: 'and', items: [{ op: 'or', not: true, items: [L('nb_min', 2), L('pas_une_cle', 1)] }] });
  check('une clé inconnue sous un « non » rend l’arbre entier faux', a.n === 0 && a.sql === 'false', a.sql);

  a = await countTree({ op: 'and', items: [L('area', ['zzzz-ville-inconnue-zzzz'])] });
  check('une ville illisible ne garde personne', a.n === 0, a.n);

  // Un segment enregistré, remplacé par sa définition.
  const seg = (await one(`INSERT INTO crm_segments (scope_key, organizer_user_id, name, definition)
                          VALUES ($1, $2, 'Banc · habitués', '{"seg":"hab","f":{"nb_min":3}}') RETURNING id`, [scope, org])).id;
  a = await countTree({ op: 'and', items: [L('segment', seg)] });
  b = await countDef({ seg: 'hab', f: { nb_min: 3 } });
  check('un segment enregistré = sa définition', a.n === b && b > 0, `${a.n} = ${b}`);
  a = await countTree({ op: 'and', items: [L('segment', '00000000-0000-4000-8000-000000000000')] });
  check('un segment absent ne garde personne', a.n === 0 && a.sql === 'false', a.sql);
  const other = (await one(`INSERT INTO crm_segments (scope_key, organizer_user_id, name, definition)
                            VALUES ('org:00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Autre compte', '{}') RETURNING id`)).id;
  a = await countTree({ op: 'and', items: [L('segment', other)] });
  check("le segment d'un autre compte ne garde personne", a.n === 0, a.sql);

  // « $event » : la soirée du scénario.
  a = await countTree({ op: 'and', items: [L('ev', ['$event'])] }, ev);
  b = await countDef({ f: { ev: [ev] } });
  check('« $event » = la soirée du scénario', a.n === b && b > 0, `${a.n} = ${b}`);
  a = await countTree({ op: 'and', items: [L('ev', ['$event'])] }, null);
  check('« $event » sans soirée ne garde personne', a.n === 0 && a.sql === 'false', a.sql);

  // Feuilles « scénario ».
  const buyers = Number((await one(`SELECT count(DISTINCT p.email) AS n FROM _cp p JOIN external_tickets t
                                     ON lower(t.buyer_email) = p.email AND t.event_id = $1
                                    WHERE public._crm_ticket_is_sale(t.status, t.raw)`, [ev])).n);
  a = await countTree({ op: 'and', items: [L('sc_bought', true)] });
  check('« a acheté pour la soirée du scénario »', a.n === buyers && buyers > 0, `${a.n} = ${buyers}`);
  a = await countTree({ op: 'and', items: [L('sc_bought', false)] });
  check('… et son contraire', a.n === total - buyers, `${a.n} = ${total} − ${buyers}`);
  const came = Number((await one(`SELECT count(DISTINCT p.email) AS n FROM _cp p JOIN external_tickets t
                                   ON lower(t.buyer_email) = p.email AND t.event_id = $1 WHERE t.scanned_at IS NOT NULL`, [ev])).n);
  a = await countTree({ op: 'and', items: [L('sc_entered', true)] });
  check('« est entré à la porte »', a.n === came, `${a.n} = ${came}`);

  // Un seul calcul ne confirme rien (il en faut deux, à un jour d'écart) : on
  // confirme « artist » dans la transaction annulée si besoin.
  if (!(await q(`SELECT 1 FROM crm_family_status WHERE scope_key = $1 AND status = 'supported' AND variant = '' AND kind <> 'return'`, [scope])).length) {
    await db.query(`UPDATE crm_family_status SET status = 'supported' WHERE scope_key = $1 AND family = 'artist' AND variant = ''`, [scope]);
  }
  const fam = await q(`SELECT family FROM crm_family_status WHERE scope_key = $1 AND variant = '' AND status = 'supported'
                         AND availability NOT IN ('unavailable', 'uniform') AND kind <> 'return' ORDER BY family LIMIT 1`, [scope]);
  if (fam.length) {
    const f = fam[0].family;
    const carriers = Number((await one(`SELECT count(*) AS n FROM _cp p WHERE $1 = ANY (p.an_tags)`, [`h:${f}`])).n);
    a = await countTree({ op: 'and', items: [L('sc_family', f)] });
    check(`famille confirmée « ${f} » portée par la personne`, a.n === carriers && carriers > 0, `${a.n} = ${carriers}`);
  } else {
    check('aucune famille confirmée sur cette base : essai sauté', true);
  }
  const notConf = await q(`SELECT family FROM crm_family_status WHERE scope_key = $1 AND variant = '' AND status <> 'supported'
                             AND kind <> 'return' ORDER BY family LIMIT 1`, [scope]);
  if (notConf.length) {
    a = await countTree({ op: 'and', items: [L('sc_family', notConf[0].family)] });
    check(`famille non confirmée « ${notConf[0].family} » : personne`, a.n === 0, a.n);
  }
  a = await countTree({ op: 'and', items: [L('sc_chance', ['high'])] });
  const scored = Number((await one(`SELECT count(*) AS n FROM crm_person_night_score WHERE scope_key = $1 AND event_id = $2 AND label = 'high'`, [scope, ev])).n);
  check('« chances élevées » = les étiquettes du score', a.n === scored, `${a.n} = ${scored}`);
  await db.exec('ROLLBACK');
} else if (cmd === 'crud') {
  // Lot J2 : brouillon, publication, versions, pause, archive, recette copiée,
  // matrice de rôles et accès assisté, sur un compte du banc.
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  const scope = `org:${org}`;
  const editor = '22222222-2222-4222-8222-222222222222';
  const viewer = '33333333-3333-4333-8333-333333333333';
  const other = '44444444-4444-4444-8444-444444444444';
  const sess = '55555555-5555-4555-8555-555555555555';
  const asUser = async (claims) => db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  const owner = { sub: org, role: 'authenticated' };
  const call = async (claims, sql, p = []) => {
    await asUser(claims);
    try { return { ok: true, r: (await one(sql, p)).r }; } catch (e) { return { ok: false, err: e.message }; }
  };
  await asUser({ role: 'service_role' });
  await db.query(`INSERT INTO org_members (organizer_user_id, member_user_id, member_email, role, invited_by, invitation_status)
                  VALUES ($1, $2, 'e@banc.test', 'editor', $1, 'accepted'), ($1, $3, 'v@banc.test', 'viewer', $1, 'accepted')`, [org, editor, viewer]);
  const tpl = (await one(`INSERT INTO email_campaign_templates (organizer_user_id, name) VALUES ($1, 'Banc · relance') RETURNING id`, [org])).id;
  const ev = (await one(`SELECT e.id FROM events e WHERE e.organizer_user_id = $1 AND e.external_source IS NOT NULL
                          AND e.start_at > now() ORDER BY e.start_at LIMIT 1`, [org])).id;
  const gx = JSON.parse(readFileSync(join(ROOT, 'src/crm/lib/__tests__/fixtures/scenario-graphs.json'), 'utf8'));
  const graph = JSON.parse(JSON.stringify(gx.cases[0].graph));
  graph.nodes.e1.template_id = '00000000-0000-4000-8000-0000000000aa';

  // Un brouillon, un modèle inconnu : la publication refuse en disant pourquoi.
  let r = await call(owner, `SELECT crm_scenario_save(NULL, $1, NULL, 'Banc · J-3', $2::jsonb) AS r`, [org, JSON.stringify(graph)]);
  check('le titulaire crée un brouillon', r.ok, r.err);
  const id = r.r.id;
  r = await call(owner, `SELECT crm_scenario_publish(NULL, $1, $2) AS r`, [org, id]);
  const codes = (r.r?.errors || []).map((e) => `${e.code}:${e.node ?? ''}`);
  check('modèle inconnu et identité SMS manquante : refusé', r.ok && r.r.ok === false
    && codes.includes('unknown_template:e1') && codes.includes('sms_identity:'), codes);
  await asUser({ role: 'service_role' });
  await db.query(`UPDATE organizer_profiles SET legal_name = 'Banc SAS', siret = '12345678900011' WHERE user_id = $1`, [org]);
  graph.nodes.e1.template_id = tpl;
  r = await call(owner, `SELECT crm_scenario_save(NULL, $1, $2, NULL, $3::jsonb) AS r`, [org, id, JSON.stringify(graph)]);
  const stamp = r.r.draft_updated_at;
  r = await call(owner, `SELECT crm_scenario_save(NULL, $1, $2, NULL, $3::jsonb, '2000-01-01') AS r`, [org, id, JSON.stringify(graph)]);
  check('une écriture sur une version périmée est refusée', !r.ok && /draft_changed/.test(r.err), r.err);
  r = await call(owner, `SELECT crm_scenario_publish(NULL, $1, $2, $3::timestamptz) AS r`, [org, id, stamp]);
  check('publié : version 1', r.ok && r.r.ok === true && r.r.version === 1, r.r ?? r.err);
  await asUser({ role: 'service_role' });
  let e = null;
  try { await db.query(`UPDATE crm_scenario_versions SET graph = '{}'::jsonb WHERE scenario_id = $1`, [id]); } catch (x) { e = x.message; }
  check('une version publiée ne change plus', /scenario_version_immutable/.test(e || ''), e);
  graph.nodes.w2.hours = 30;
  await call(owner, `SELECT crm_scenario_save(NULL, $1, $2, NULL, $3::jsonb) AS r`, [org, id, JSON.stringify(graph)]);
  r = await call(owner, `SELECT crm_scenarios(NULL, $1) AS r`, [org]);
  const row = r.r.scenarios.find((x) => x.id === id);
  check('modifier un scénario en ligne = un brouillon de version', row?.has_changes === true && row.version === 1 && row.state === 'active', row);
  r = await call(owner, `SELECT crm_scenario_publish(NULL, $1, $2) AS r`, [org, id]);
  check('republié : version 2, la 1 reste', r.r?.version === 2
    && Number((await one(`SELECT count(*) AS n FROM crm_scenario_versions WHERE scenario_id = $1`, [id])).n) === 2, r.r);

  // Rôles.
  r = await call({ sub: viewer, role: 'authenticated' }, `SELECT crm_scenarios(NULL, $1) AS r`, [org]);
  check('un lecteur lit', r.ok && r.r.can_edit === false, r.err);
  r = await call({ sub: viewer, role: 'authenticated' }, `SELECT crm_scenario_save(NULL, $1, NULL, 'x', $2::jsonb) AS r`, [org, JSON.stringify(graph)]);
  check("un lecteur n'écrit pas", !r.ok && /forbidden/.test(r.err), r.err);
  r = await call({ sub: viewer, role: 'authenticated' }, `SELECT crm_scenario_publish(NULL, $1, $2) AS r`, [org, id]);
  check('un lecteur ne publie pas', !r.ok && /forbidden/.test(r.err), r.err);
  r = await call({ sub: editor, role: 'authenticated' }, `SELECT crm_scenario_set_status(NULL, $1, $2, 'paused') AS r`, [org, id]);
  check('un éditeur met en pause (comme une recette)', r.ok && r.r.status === 'paused', r.err);
  r = await call({ sub: editor, role: 'authenticated' }, `SELECT crm_scenario_set_status(NULL, $1, $2, 'active') AS r`, [org, id]);
  check('un éditeur reprend (décision 4)', r.ok && r.r.status === 'active', r.err);
  r = await call({ sub: other, role: 'authenticated' }, `SELECT crm_scenarios(NULL, $1) AS r`, [org]);
  check("un autre compte ne lit rien", !r.ok && /forbidden/.test(r.err), r.err);
  r = await call({}, `SELECT crm_scenarios(NULL, $1) AS r`, [org]);
  check('sans session : refusé', !r.ok && /forbidden/.test(r.err), r.err);
  r = await call({ sub: other, role: 'authenticated' }, `SELECT crm_scenario(NULL, $1, $2) AS r`, [org, id]);
  check("un autre compte ne lit pas un scénario", !r.ok && /forbidden/.test(r.err), r.err);
  for (const f of ['crm_scenarios(text, uuid)', 'crm_scenario_publish(text, uuid, uuid, timestamptz)', 'crm_scenario_report(text, uuid, uuid)',
    '_crm_scenario_content(text, uuid, jsonb)', '_crm_cond_sql(jsonb, text, text)', '_crm_scenario_graph_errors(jsonb)']) {
    const p = await one(`SELECT has_function_privilege('anon', 'public.${f}', 'EXECUTE') a, has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') u`);
    const internal = f.startsWith('_');
    check(`droits de ${f}`, p.a === false && p.u === !internal, p);
  }

  // Accès assisté : on lit, on écrit un brouillon, on met en pause ; on ne publie pas, on ne reprend pas.
  await asUser({ role: 'service_role' });
  await db.query(`INSERT INTO admin_support_sessions (grant_id, admin_id, target_user_id, auth_session_id, status)
                  VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, 'active')`, [org, sess]);
  const sup = { sub: org, role: 'authenticated', session_id: sess };
  r = await call(sup, `SELECT crm_scenarios(NULL, $1) AS r`, [org]);
  check('accès assisté : lecture', r.ok && r.r.can_publish === false, r.err ?? r.r?.can_publish);
  r = await call(sup, `SELECT crm_scenario_save(NULL, $1, $2, NULL, $3::jsonb) AS r`, [org, id, JSON.stringify(graph)]);
  check('accès assisté : brouillon permis', r.ok, r.err);
  r = await call(sup, `SELECT crm_scenario_publish(NULL, $1, $2) AS r`, [org, id]);
  check('accès assisté : publier refusé', !r.ok && /support_session/.test(r.err), r.err);
  r = await call(sup, `SELECT crm_scenario_set_status(NULL, $1, $2, 'paused') AS r`, [org, id]);
  check('accès assisté : mettre en pause permis', r.ok, r.err);
  r = await call(sup, `SELECT crm_scenario_set_status(NULL, $1, $2, 'active') AS r`, [org, id]);
  check('accès assisté : reprendre refusé', !r.ok && /support_session/.test(r.err), r.err);
  await call(owner, `SELECT crm_scenario_set_status(NULL, $1, $2, 'active') AS r`, [org, id]);

  // Gel d'envoi : en pause, jamais en erreur.
  await asUser({ role: 'service_role' });
  await db.query(`INSERT INTO crm_settings (scope_key, organizer_user_id, sending_frozen_at) VALUES ($1, $2, now())
                  ON CONFLICT (scope_key) DO UPDATE SET sending_frozen_at = now()`, [scope, org]);
  r = await call(owner, `SELECT crm_scenario(NULL, $1, $2) AS r`, [org, id]);
  check('envoi gelé : le scénario est « en pause (gel) »', r.r?.state === 'frozen' && r.r?.status === 'active', r.err ?? r.r?.state);
  await asUser({ role: 'service_role' });
  await db.query(`UPDATE crm_settings SET sending_frozen_at = NULL WHERE scope_key = $1`, [scope]);

  // Suppression et copie.
  r = await call(owner, `SELECT crm_scenario_delete(NULL, $1, $2) AS r`, [org, id]);
  check('un scénario publié ne se supprime pas (on l’archive)', !r.ok && /published/.test(r.err), r.err);
  r = await call(owner, `SELECT crm_scenario_duplicate(NULL, $1, $2) AS r`, [org, id]);
  const copy = r.r?.id;
  r = await call(owner, `SELECT crm_scenario_delete(NULL, $1, $2) AS r`, [org, copy]);
  check('une copie jamais publiée se supprime', r.ok && r.r.deleted === true, r.err);

  // « Personnaliser » une recette : publier l'éteint, elle ne se rallume pas tant que le scénario vit.
  await asUser({ role: 'service_role' });
  const auto = (await one(`INSERT INTO email_automations (organizer_user_id, kind, enabled, enabled_at, template_id)
                           VALUES ($1, 'last_call', true, now(), $2) RETURNING id`, [org, tpl])).id;
  r = await call(owner, `SELECT crm_scenario_save(NULL, $1, NULL, 'Dernier appel, sur mesure', $2::jsonb, NULL, 'last_call') AS r`, [org, JSON.stringify(graph)]);
  const fromRecipe = r.r.id;
  r = await call(owner, `SELECT crm_scenario_publish(NULL, $1, $2) AS r`, [org, fromRecipe]);
  const off = (await one(`SELECT enabled FROM email_automations WHERE id = $1`, [auto])).enabled;
  check('publier le scénario éteint la recette copiée', r.r?.ok === true && off === false, { pub: r.r, off });
  e = null;
  try { await db.query(`UPDATE email_automations SET enabled = true WHERE id = $1`, [auto]); } catch (x) { e = x.message; }
  check('la recette ne se rallume pas tant que le scénario vit', /scenario_covers_recipe/.test(e || ''), e);
  await call(owner, `SELECT crm_scenario_set_status(NULL, $1, $2, 'archived') AS r`, [org, fromRecipe]);
  await asUser({ role: 'service_role' });
  e = null;
  try { await db.query(`UPDATE email_automations SET enabled = true WHERE id = $1`, [auto]); } catch (x) { e = x.message; }
  check('scénario archivé : la recette se rallume', e === null, e);

  // Contrôles de la base : page sans soirée, segment inconnu, famille non confirmée.
  const page = (await one(`INSERT INTO crm_signup_pages (organizer_user_id, kind, slug, title)
                           VALUES ($1, 'communaute', 'banc-scn', 'Banc') RETURNING id`, [org]).catch?.(() => null)) ?? null;
  const g2 = JSON.parse(JSON.stringify(graph));
  g2.nodes.b1.cond = { op: 'and', items: [{ k: 'segment', v: '00000000-0000-4000-8000-0000000000bb' }, { k: 'sc_family', v: 'weekday' }] };
  r = await call(owner, `SELECT _crm_scenario_content(NULL, $1, $2::jsonb) AS r`, [org, JSON.stringify(g2)]);
  await asUser({ role: 'service_role' });
  r = await call({ role: 'service_role' }, `SELECT _crm_scenario_content(NULL, $1, $2::jsonb) AS r`, [org, JSON.stringify(g2)]);
  const ecodes = (r.r?.errors || []).map((x) => x.code);
  const wcodes = (r.r?.warnings || []).map((x) => x.code);
  check('segment inconnu refusé, famille non confirmée signalée', ecodes.includes('unknown_segment') && wcodes.includes('family_not_confirmed'), r.r ?? r.err);
  if (page) {
    const g3 = JSON.parse(JSON.stringify(graph));
    g3.trigger = { type: 'signup_confirmed', page_id: page.id };
    r = await call({ role: 'service_role' }, `SELECT _crm_scenario_content(NULL, $1, $2::jsonb) AS r`, [org, JSON.stringify(g3)]);
    check('page sans soirée pour un scénario qui lit la soirée : refusé', (r.r?.errors || []).some((x) => x.code === 'page_without_event'), r.r ?? r.err);
  }

  // Le rapport se lit même vide.
  r = await call(owner, `SELECT crm_scenario_report(NULL, $1, $2) AS r`, [org, id]);
  check('rapport vide lisible', r.ok && r.r.holdout?.contacted?.n === 0, r.err ?? r.r);
} else if (cmd === 'engine') {
  // Lot J3 : le moteur, de bout en bout (smoke du prompt §5).
  const setup = async ({ demo = false } = {}) => {
    const db = await withScenarios(base);
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    const one = async (sql, p = []) => (await q(sql, p))[0];
    const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
    await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
    await db.query(`UPDATE organizer_profiles SET legal_name = 'Banc SAS', siret = '12345678900011' WHERE user_id = $1`, [org]);
    // Le banc n'a pas de profil pour le compte : on en pose un, au courriel de démo.
    if (demo) await db.query(`INSERT INTO profiles (id, email) VALUES ($1, 'banc@womber.fr')
                              ON CONFLICT (id) DO UPDATE SET email = 'banc@womber.fr'`, [org]);
    const tpl = (await one(`INSERT INTO email_campaign_templates (organizer_user_id, name, subject, blocks_json)
                            VALUES ($1, 'Banc · J-3', 'On vous attend', '[]') RETURNING id`, [org])).id;
    // La deuxième soirée à venir (Goya #5 sur « demo »).
    const goya = (await one(`SELECT id, start_at FROM events WHERE organizer_user_id = $1 AND start_at > now() ORDER BY start_at OFFSET 1 LIMIT 1`, [org]));
    const days = Number((await one(`SELECT (($1::timestamptz AT TIME ZONE 'Europe/Paris')::date - (now() AT TIME ZONE 'Europe/Paris')::date) AS d`, [goya.start_at])).d);
    const graph = {
      v: 1, trigger: { type: 'before_event', days },
      entry: { filter: { op: 'and', items: [{ k: 'nb_min', v: 1 }, { op: 'and', not: true, items: [{ k: 'ev', v: ['$event'] }] }] },
               reentry: { mode: 'per_event' }, holdout: true },
      goal: { type: 'bought_event' }, start: 'b1',
      nodes: {
        b1: { type: 'branch', cond: { op: 'or', items: [{ k: 'nb_min', v: 3 }, { k: 'hyp', v: ['artist'] }] }, yes: 'e1', no: 'x' },
        e1: { type: 'email', template_id: tpl, subject: 'Goya #5 approche', event: 'scenario', next: 'w2' },
        w2: { type: 'wait', mode: 'duration', hours: 24, next: 's1' },
        s1: { type: 'sms', body: 'Goya #5 : on vous attend {{lien}}', event: 'scenario', next: 'x' },
        x: { type: 'end' },
      },
    };
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: org, role: 'authenticated' })]);
    const id = (await one(`SELECT crm_scenario_save(NULL, $1, NULL, 'Banc · Goya', $2::jsonb) AS r`, [org, JSON.stringify(graph)])).r.id;
    const pub = (await one(`SELECT crm_scenario_publish(NULL, $1, $2) AS r`, [org, id])).r;
    await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
    const tick = async () => {
      await db.exec('BEGIN');
      try { const r = (await one(`SELECT crm_scenario_tick() AS r`)).r; await db.exec('COMMIT'); return r; }
      catch (e) { await db.exec('ROLLBACK'); throw e; }
    };
    return { db, q, one, org, id, pub, tick, goya, tpl, scope: `org:${org}` };
  };

  const A = await setup();
  check('publié (identité SMS posée)', A.pub.ok === true, A.pub);
  // Attendus : la base (consentie ou non), déjà venus, sans place pour Goya.
  await A.db.exec('BEGIN');
  await A.one(`SELECT public._crm_people_build(NULL, $1::uuid) AS n`, [A.org]);
  const expect = Number((await A.one(`SELECT count(*) AS n FROM _cp p WHERE (p.email_ok OR p.phone_ok) AND p.nights >= 1
                                        AND NOT ($1::uuid = ANY (p.events))`, [A.goya.id])).n);
  const expectYes = Number((await A.one(`SELECT count(*) AS n FROM _cp p WHERE (p.email_ok OR p.phone_ok) AND p.nights >= 1
                                           AND NOT ($1::uuid = ANY (p.events)) AND (p.nights >= 3 OR 'h:artist' = ANY (p.an_tags))`, [A.goya.id])).n);
  await A.db.exec('ROLLBACK');
  // Le moteur plafonne les entrées à 3 000 par passage : on passe jusqu'à ce que tout soit entré.
  let r;
  for (let i = 1; i <= 6; i += 1) {
    const t0 = Date.now();
    r = await A.tick();
    const enter = r.scopes?.[0]?.advance;
    console.log(`passage ${i} : ${Date.now() - t0} ms (moteur ${r.ms} ms)`, JSON.stringify(enter));
    if (!enter || (enter.moved === 0 && enter.sent === 0)) break;
  }
  const last = await A.one(`SELECT last_result FROM crm_scenario_scope_state WHERE scope_key = $1`, [A.scope]);
  console.log('  dernier passage :', JSON.stringify(last.last_result?.enter));
  const runs = await A.one(`SELECT count(*) AS n, count(*) FILTER (WHERE holdout) AS h FROM crm_scenario_runs WHERE scenario_id = $1`, [A.id]);
  check('entrée : la base filtrée (déjà venus, sans place)', Number(runs.n) === expect && expect > 0, `${runs.n} = ${expect}`);
  check('témoin ≈ 10 %', Number(runs.h) > 0 && Number(runs.h) < Number(runs.n) * 0.2, `${runs.h} / ${runs.n}`);
  const b1 = await A.q(`SELECT r.node_id, count(*) AS n FROM crm_scenario_runs r WHERE r.scenario_id = $1 GROUP BY 1 ORDER BY 1`, [A.id]);
  const atW2 = Number(b1.find((x) => x.node_id === 'w2')?.n || 0);
  const done = Number((await A.one(`SELECT count(*) AS n FROM crm_scenario_runs WHERE scenario_id = $1 AND status = 'done'`, [A.id])).n);
  check('embranchement « ou » : oui → e-mail, non → fin', atW2 + Number((await A.one(`SELECT count(*) AS n FROM crm_scenario_steps WHERE scenario_id = $1 AND node_id = 'e1' AND status = 'expired'`, [A.id])).n) === expectYes
    && done === expect - expectYes, { atW2, done, expectYes, expect });
  const st = await A.q(`SELECT status, reason, count(*) AS n FROM crm_scenario_steps WHERE scenario_id = $1 AND node_id = 'e1' GROUP BY 1, 2 ORDER BY 1, 2`, [A.id]);
  console.log('  étape e1 :', JSON.stringify(st));
  const sent = Number(st.filter((x) => x.status === 'sent').reduce((a, x) => a + Number(x.n), 0));
  const camp = await A.one(`SELECT c.id, c.child_kind, c.status, c.event_id, (SELECT count(*) FROM email_campaign_recipients q WHERE q.campaign_id = c.id) AS n
                              FROM crm_scenario_messages m JOIN email_campaigns c ON c.id = m.campaign_id
                              JOIN crm_scenario_versions v ON v.id = m.version_id WHERE v.scenario_id = $1`, [A.id]);
  check('e-mail : une campagne enfant « scenario », un destinataire par envoi', camp?.child_kind === 'scenario' && Number(camp.n) === sent && sent > 0
    && camp.event_id === A.goya.id, { camp, sent });
  check('le témoin ne reçoit rien', Number(st.find((x) => x.status === 'holdout')?.n || 0) > 0
    && Number((await A.one(`SELECT count(*) AS n FROM email_campaign_recipients q JOIN crm_scenario_runs r ON r.email = lower(q.email)
                             WHERE q.campaign_id = $1 AND r.scenario_id = $2 AND r.holdout`, [camp.id, A.id])).n) === 0);
  r = await A.tick();
  const runs2 = await A.one(`SELECT count(*) AS n FROM crm_scenario_runs WHERE scenario_id = $1`, [A.id]);
  const n2 = Number((await A.one(`SELECT count(*) AS n FROM email_campaign_recipients WHERE campaign_id = $1`, [camp.id])).n);
  check('deuxième passage : rien de neuf (idempotent)', Number(runs2.n) === Number(runs.n) && n2 === sent, { runs: runs2.n, n2 });

  check('e-mail : sa propre mère, produit CRM (hors des listes Campagnes)',
    (await A.one(`SELECT parent_campaign_id = id AS self, product FROM email_campaigns WHERE id = $1`, [camp.id])).self === true, camp.id);
  // Objectif : un achat pour Goya sort la personne, à l'heure de l'achat.
  const goalRun = await A.one(`SELECT r.id, r.email FROM crm_scenario_runs r WHERE r.scenario_id = $1 AND r.status = 'active' AND r.node_id = 'w2' LIMIT 1`, [A.id]);
  if (goalRun) {
    await A.db.query(`INSERT INTO external_tickets (connection_id, organizer_user_id, provider, external_id, event_id, buyer_email, status, price, purchased_at, first_seen_at, raw)
                       SELECT connection_id, organizer_user_id, provider, 'banc-goal-1', $2, $3, 'valid', 20, now(), now(), '{}'::jsonb
                         FROM external_tickets WHERE organizer_user_id = $1 LIMIT 1`, [A.org, A.goya.id, goalRun.email]);
    await A.db.query(`UPDATE crm_scenario_runs SET due_at = now() - interval '1 minute' WHERE id = $1`, [goalRun.id]);
    await A.tick();
    const g = await A.one(`SELECT status, exit_reason, goal_at FROM crm_scenario_runs WHERE id = $1`, [goalRun.id]);
    check('objectif atteint : sortie « goal », heure de l’achat', g.status === 'exited' && g.exit_reason === 'goal' && g.goal_at, g);
  }
  // STOP : sortie forcée.
  const stopRun = await A.one(`SELECT r.id, vc.phone_e164 FROM crm_scenario_runs r
                                 JOIN venue_sms_contacts vc ON lower(vc.email) = r.email AND vc.organizer_user_id = $2
                                WHERE r.scenario_id = $1 AND r.status = 'active' AND r.node_id = 'w2' LIMIT 1`, [A.id, A.org]);
  if (stopRun) {
    await A.db.query(`INSERT INTO sms_stop_list (phone_e164, scope_key) VALUES ($1, $2)`, [stopRun.phone_e164, A.scope]);
    await A.db.query(`UPDATE crm_scenario_runs SET due_at = now() - interval '1 minute' WHERE id = $1`, [stopRun.id]);
    await A.tick();
    const g = await A.one(`SELECT status, exit_reason FROM crm_scenario_runs WHERE id = $1`, [stopRun.id]);
    check('STOP : sortie forcée', g.status === 'exited' && g.exit_reason === 'stop', g);
  } else check('STOP : une inscription active avec un numéro', false);

  // L'attente de 24 h, puis le SMS : trop tôt après l'e-mail → reporté (20 h).
  await A.db.query(`UPDATE crm_scenario_runs SET node_since = node_since - interval '25 hours', due_at = now() - interval '1 minute'
                     WHERE scenario_id = $1 AND node_id = 'w2'`, [A.id]);
  r = await A.tick();
  const s1 = await A.q(`SELECT status, reason, count(*) AS n FROM crm_scenario_steps WHERE scenario_id = $1 AND node_id = 's1' GROUP BY 1, 2 ORDER BY 1, 2`, [A.id]);
  console.log('  étape s1 (même jour que l’e-mail) :', JSON.stringify(s1));
  check('SMS trop tôt après l’e-mail : reporté « 20 h »', s1.some((x) => x.status === 'held' && x.reason === 'spacing'), s1);
  // 21 h plus tard : le SMS part (numéro consenti), sinon « pas d'accord ».
  await A.db.query(`UPDATE crm_scenario_steps SET done_at = done_at - interval '21 hours' WHERE scenario_id = $1 AND node_id = 'e1'`, [A.id]);
  await A.db.query(`UPDATE crm_scenario_runs SET last_message_at = last_message_at - interval '21 hours', due_at = now() - interval '1 minute'
                     WHERE scenario_id = $1 AND node_id = 's1'`, [A.id]);
  r = await A.tick();
  const s2 = await A.q(`SELECT status, reason, count(*) AS n FROM crm_scenario_steps WHERE scenario_id = $1 AND node_id = 's1' GROUP BY 1, 2 ORDER BY 1, 2`, [A.id]);
  console.log('  étape s1 (21 h après) :', JSON.stringify(s2));
  const sms = await A.one(`SELECT c.status, c.event_id, (SELECT count(*) FROM sms_campaign_recipients q WHERE q.campaign_id = c.id) AS n
                             FROM crm_scenario_messages m JOIN sms_campaigns c ON c.id = m.sms_campaign_id
                             JOIN crm_scenario_versions v ON v.id = m.version_id WHERE v.scenario_id = $1`, [A.id]);
  const smsSent = Number(s2.find((x) => x.status === 'sent')?.n || 0);
  check('SMS : une campagne CRM programmée, un numéro par envoi', sms?.status === 'scheduled' && Number(sms.n) === smsSent && smsSent > 0, { sms, smsSent });

  // Un SMS retombé en brouillon faute de Yunits : reporté, puis il repart seul.
  await A.db.query(`UPDATE sms_campaigns SET status = 'draft', error_message = 'crm_yunits_insufficient' WHERE id IN (
                      SELECT m.sms_campaign_id FROM crm_scenario_messages m JOIN crm_scenario_versions v ON v.id = m.version_id
                       WHERE v.scenario_id = $1 AND m.channel = 'sms')`, [A.id]);
  r = await A.tick();
  const retry = await A.one(`SELECT c.status, (SELECT count(*) FROM crm_scenario_steps st WHERE st.sms_campaign_id = c.id AND st.status = 'sent') AS sent
                               FROM crm_scenario_messages m JOIN sms_campaigns c ON c.id = m.sms_campaign_id
                               JOIN crm_scenario_versions v ON v.id = m.version_id WHERE v.scenario_id = $1`, [A.id]);
  check('SMS retombé faute de Yunits : reprogrammé quand le solde couvre', retry.status === 'scheduled' && Number(retry.sent) === smsSent, retry);
  // Effacer un contact : ses inscriptions restent comptées, sans adresse ; en route, il sort.
  const er = await A.one(`SELECT r.email FROM crm_scenario_runs r WHERE r.scenario_id = $1 ORDER BY r.email LIMIT 1`, [A.id]);
  const before = Number((await A.one(`SELECT count(*) AS n FROM crm_scenario_runs WHERE scenario_id = $1`, [A.id])).n);
  await A.one(`SELECT public._crm_erase_contacts(NULL, $1::uuid, ARRAY[$2]) AS n`, [A.org, er.email]);
  const after = await A.one(`SELECT count(*) AS n, count(*) FILTER (WHERE email = $2) AS still FROM crm_scenario_runs WHERE scenario_id = $1`, [A.id, er.email]);
  check('effacer un contact : plus d’adresse, le compte reste juste', Number(after.n) === before && Number(after.still) === 0, after);
  // Rapport : les chiffres du nœud et le témoin se lisent.
  await A.db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: A.org, role: 'authenticated' })]);
  const rep = (await A.one(`SELECT crm_scenario_report(NULL, $1, $2) AS r`, [A.org, A.id])).r;
  check('rapport : e1 envoyés = registre', rep.nodes?.e1?.sent === sent, rep.nodes?.e1);
  await A.db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);

  // Pression : un e-mail promotionnel reçu il y a 2 h → reporté, puis expiré à la fin de la fenêtre.
  const P = await setup();
  const victim = (await P.one(`SELECT lower(n.email) AS em FROM newsletter_subscriptions n
                                WHERE n.organizer_user_id = $1 AND n.opted_in
                                  AND EXISTS (SELECT 1 FROM crm_person_profile pp WHERE pp.email = lower(n.email) AND 'h:artist' = ANY (pp.tags))
                                  AND NOT EXISTS (SELECT 1 FROM external_tickets t WHERE lower(t.buyer_email) = lower(n.email) AND t.event_id = $2)
                                LIMIT 1`, [P.org, P.goya.id])).em;
  const other = (await P.one(`INSERT INTO email_campaigns (organizer_user_id, name, subject, status, sent_at, type) VALUES ($1, 'Autre', 'x', 'sent', now(), 'promotional') RETURNING id`, [P.org])).id;
  await P.db.query(`INSERT INTO email_campaign_recipients (campaign_id, email, status, sent_at) VALUES ($1, $2, 'sent', now() - interval '2 hours')`, [other, victim]);
  await P.tick();
  let vs = await P.one(`SELECT st.status, st.reason FROM crm_scenario_steps st JOIN crm_scenario_runs r ON r.id = st.run_id
                         WHERE r.scenario_id = $1 AND r.email = $2 AND st.node_id = 'e1'`, [P.id, victim]);
  const hold = vs?.status;
  check('pression : un e-mail reçu il y a 2 h → reporté (1 / 24 h)', vs?.status === 'held' && vs.reason === 'pressure_24h'
    || (await P.one(`SELECT holdout FROM crm_scenario_runs WHERE scenario_id = $1 AND email = $2`, [P.id, victim]))?.holdout === true, vs);
  if (hold === 'held') {
    await P.db.query(`UPDATE crm_scenario_steps st SET window_end = now() - interval '1 minute' FROM crm_scenario_runs r
                       WHERE r.id = st.run_id AND r.scenario_id = $1 AND r.email = $2 AND st.node_id = 'e1'`, [P.id, victim]);
    await P.db.query(`UPDATE crm_scenario_runs SET due_at = now() - interval '1 minute' WHERE scenario_id = $1 AND email = $2`, [P.id, victim]);
    await P.tick();
    vs = await P.one(`SELECT st.status, st.reason FROM crm_scenario_steps st JOIN crm_scenario_runs r ON r.id = st.run_id
                       WHERE r.scenario_id = $1 AND r.email = $2 AND st.node_id = 'e1'`, [P.id, victim]);
    check('fenêtre passée : expiré, avec sa raison', vs?.status === 'expired' && vs.reason === 'pressure_24h', vs);
  }

  // Gel d'envoi : rien n'entre, rien ne part, rien n'est perdu.
  const G = await setup();
  await G.db.query(`INSERT INTO crm_settings (scope_key, organizer_user_id, sending_frozen_at) VALUES ($1, $2, now())
                    ON CONFLICT (scope_key) DO UPDATE SET sending_frozen_at = now()`, [G.scope, G.org]);
  await G.tick();
  check('gel : aucune entrée', Number((await G.one(`SELECT count(*) AS n FROM crm_scenario_runs WHERE scenario_id = $1`, [G.id])).n) === 0);

  // Démo : le moteur inscrit, avance, et n'envoie rien.
  const D = await setup({ demo: true });
  await D.tick();
  const dst = await D.q(`SELECT status, count(*) AS n FROM crm_scenario_steps WHERE scenario_id = $1 AND node_id = 'e1' GROUP BY 1`, [D.id]);
  const dmsg = Number((await D.one(`SELECT count(*) AS n FROM crm_scenario_messages m JOIN crm_scenario_versions v ON v.id = m.version_id WHERE v.scenario_id = $1`, [D.id])).n);
  check('démo : « aurait envoyé », aucune campagne', dst.some((x) => x.status === 'would_send') && !dst.some((x) => x.status === 'sent') && dmsg === 0, dst);
} else if (cmd === 'editor') {
  // Lot J4 : les lectures de l'éditeur (effectifs en direct, « Avant de publier »).
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  const owner = JSON.stringify({ sub: org, role: 'authenticated' });
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [owner]);
  const tree = { op: 'and', items: [{ k: 'nb_min', v: 1 }, { op: 'or', items: [{ k: 'nb_min', v: 3 }, { k: 'hyp', v: ['artist'] }] },
                                    { op: 'and', items: [{ k: 'sc_bought', v: false }] }] };
  let t0 = Date.now();
  const c = (await one(`SELECT crm_scenario_counts(NULL, $1, $2::jsonb, NULL, 'step') AS r`, [org, JSON.stringify(tree)])).r;
  console.log(`effectifs : ${Date.now() - t0} ms`, JSON.stringify(c));
  await db.exec('BEGIN');
  await one(`SELECT public._crm_people_build(NULL, $1::uuid) AS n`, [org]);
  const exp = await one(`SELECT count(*) FILTER (WHERE nights >= 1) AS root1, count(*) FILTER (WHERE nights >= 3 OR 'h:artist' = ANY (an_tags)) AS g1
                           FROM _cp WHERE email_ok OR phone_ok`);
  await db.exec('ROLLBACK');
  check('groupe « ou » : même chiffre que le filtre', c.groups['1'] === Number(exp.g1), `${c.groups['1']} = ${exp.g1}`);
  check('groupe d’inscription : « au lancement » (null)', c.groups['2'] === null, c.groups['2']);
  check('racine avec une feuille d’inscription : null', c.groups[''] === null, c.groups['']);
  const gx = JSON.parse(readFileSync(join(ROOT, 'src/crm/lib/__tests__/fixtures/scenario-graphs.json'), 'utf8'));
  const graph = JSON.parse(JSON.stringify(gx.cases[0].graph));
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await db.query(`UPDATE organizer_profiles SET legal_name = 'Banc SAS', siret = '12345678900011' WHERE user_id = $1`, [org]);
  graph.nodes.e1.template_id = (await one(`INSERT INTO email_campaign_templates (organizer_user_id, name) VALUES ($1, 'Banc') RETURNING id`, [org])).id;
  const up = await q(`SELECT id, start_at FROM events WHERE organizer_user_id = $1 AND start_at > now() ORDER BY start_at`, [org]);
  graph.trigger.days = Number((await one(`SELECT (($1::timestamptz AT TIME ZONE 'Europe/Paris')::date - (now() AT TIME ZONE 'Europe/Paris')::date) AS d`, [up[1].start_at])).d);
  graph.entry.filter = { op: 'and', items: [{ k: 'nb_min', v: 1 }] };
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [owner]);
  const id = (await one(`SELECT crm_scenario_save(NULL, $1, NULL, 'Banc', $2::jsonb) AS r`, [org, JSON.stringify(graph)])).r.id;
  t0 = Date.now();
  const p = (await one(`SELECT crm_scenario_preview(NULL, $1, $2) AS r`, [org, id])).r;
  console.log(`aperçu : ${Date.now() - t0} ms`, JSON.stringify({ now: p.now, week: p.week, cost: p.cost, errors: p.errors }));
  check('aperçu : qui entrerait aujourd’hui, sans rien écrire', p.now?.entered > 0
    && Number((await one(`SELECT count(*) AS n FROM crm_scenario_runs`)).n) === 0, p.now);
  check('aperçu : estimation par semaine', p.week?.estimate > 0 && p.week.basis === 'events', p.week);
  check('aperçu : plafond de Yunits (e-mail + SMS)', p.cost?.max_fr === 1 + p.cost.sms_segments * p.cost.sms_fr && p.cost.max_intl > p.cost.max_fr, p.cost);
  check('lectures permises en aperçu démo', (await one(`SELECT public.demo_preview_writable_rpc('crm_scenario_preview') AND public.demo_preview_writable_rpc('crm_night_targets') AS ok`)).ok === true);
} else if (cmd === 'feed') {
  // Lot J5 : l'étape « Me prévenir » dans le fil de notifications. Le banc ne
  // porte pas le centre de notifications : on le charge (versions du dépôt =
  // prod), puis on rejoue la migration du lot pour avoir la dernière version.
  const db = await withScenarios(base);
  for (const f of ['20261004231000_crm_account_team_prefs.sql', '20261004235000_crm_notifications.sql',
                   '20261007251000_crm_unreachable_scope_key.sql', '20261016150000_crm_scenario_feed.sql']) {
    await execFile(db, join(MIG, f), f);
  }
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  const owner = JSON.stringify({ sub: org, role: 'authenticated' });
  const gx = JSON.parse(readFileSync(join(ROOT, 'src/crm/lib/__tests__/fixtures/scenario-graphs.json'), 'utf8'));
  const graph = JSON.parse(JSON.stringify(gx.cases[0].graph));
  graph.nodes.n9 = { type: 'notify', label: 'Un habitué est revenu', next: graph.nodes.e1.next };
  graph.nodes.e1.next = 'n9';
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [owner]);
  const id = (await one(`SELECT crm_scenario_save(NULL, $1, NULL, 'Banc fil', $2::jsonb) AS r`, [org, JSON.stringify(graph)])).r.id;
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await db.query(`INSERT INTO crm_scenario_notify_daily (scenario_id, node_id, day, n) VALUES
                    ($1, 'n9', (now() AT TIME ZONE 'Europe/Paris')::date, 4),
                    ($1, 'n9', (now() AT TIME ZONE 'Europe/Paris')::date - 3, 7),
                    ($1, 'n9', (now() AT TIME ZONE 'Europe/Paris')::date - 40, 9)`, [id]);
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [owner]);
  const list = (await one(`SELECT get_crm_notifications(NULL, $1) AS r`, [org])).r;
  const mine = list.filter((x) => x.kind === 'scenario_notify');
  check('fil : une entrée par jour (30 derniers jours seulement)', mine.length === 2, mine.length);
  const today = mine.find((x) => x.params.today === true);
  check('fil : libellé, compteur, scénario', today?.params.label === 'Un habitué est revenu' && today.params.n === 4 && today.params.scenario_id === id, today?.params);
  check('fil : identifiant stable (lu / archivé)', /^scenario_notify:[0-9a-f-]{36}:n9:\d{8}$/.test(today?.id ?? ''), today?.id);
  await db.query(`SELECT crm_notifications_mark(NULL, $1, ARRAY[$2], 'read')`, [org, today.id]);
  const again = (await one(`SELECT get_crm_notifications(NULL, $1) AS r`, [org])).r.find((x) => x.id === today.id);
  check('fil : marquée lue', again?.read === true, again?.read);
  // Plan de soirée prêt (lot A1) : seulement un compte EN ESSAI, premier import fait, analyse calculée.
  const planItem = async () => (await one(`SELECT get_crm_notifications(NULL, $1) AS r`, [org])).r.filter((x) => x.kind === 'night_plan_ready');
  check('fil : pas de plan annoncé hors essai', (await planItem()).length === 0);
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await db.query(`INSERT INTO crm_subscriptions (scope_key, organizer_user_id, plan, status, trial_ends_at)
                  VALUES ($1, $2, 'pro', 'trialing', now() + interval '10 days')
                  ON CONFLICT (scope_key) DO UPDATE SET status = 'trialing', trial_ends_at = now() + interval '10 days'`, [`org:${org}`, org]);
  await db.query(`UPDATE ticketing_connections SET initial_import_done_at = COALESCE(initial_import_done_at, now() - interval '2 days') WHERE organizer_user_id = $1`, [org]);
  await db.query(`UPDATE crm_analysis_state SET computed_at = COALESCE(computed_at, now() - interval '1 day') WHERE scope_key = $1`, [`org:${org}`]);
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [owner]);
  const pi = await planItem();
  const nextNight = (await one(`SELECT id FROM events WHERE organizer_user_id = $1 AND external_source IS NOT NULL AND cancelled_at IS NULL
                                 AND start_at > now() + interval '24 hours' ORDER BY start_at LIMIT 1`, [org])).id;
  check('fil : « plan de soirée prêt » pour la prochaine soirée d\'un compte en essai', pi.length === 1 && pi[0].params.event_id === nextNight
    && pi[0].id === `night_plan_ready:${nextNight}`, pi.map((x) => x.id));
  // Bilan de la semaine (lot A3) : une entrée par semaine écoulée, le lundi dès 8 h.
  const wk = (await one(`SELECT get_crm_notifications(NULL, $1) AS r`, [org])).r.filter((x) => x.kind === 'weekly_review');
  check('fil : « bilan de la semaine » (soirée dans les 3 semaines)', wk.length === 1 && /^weekly_review:\d{6}$/.test(wk[0].id), wk.map((x) => x.id));
} else if (cmd === 'mcp') {
  // Lot J5 : le connecteur IA. Lecture pour toute connexion d'un espace CRM ;
  // brouillons derrière can_scenarios ; jamais de publication.
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  // Colonnes d'auth.users / profiles que le banc ne copie pas (lues par _mcp_access).
  await db.exec(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamptz;
                 ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
                 ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_suspended boolean DEFAULT false;`);
  if (!(await one(`SELECT to_regprocedure('public.crm_campaign_is_crm(uuid)') IS NOT NULL AS ok`)).ok) {
    await db.exec(`CREATE FUNCTION public.crm_campaign_is_crm(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;`);
  }
  // Le banc ne porte pas la première version de _mcp_needs_temp (outils de la Suite) :
  // aucune ne sert ici.
  if (!(await one(`SELECT to_regprocedure('public._mcp_needs_temp(text)') IS NOT NULL AS ok`)).ok) {
    await db.exec(`CREATE FUNCTION public._mcp_needs_temp(p_tool text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;`);
  }
  // Les autres écritures de mcp_write (e-mails, images, pages) ne sont pas au
  // banc : le CASE les planifie toutes, on pose des bouchons qui ne servent pas.
  for (const [sig, def] of [
    ['_mcp_email_image_add(text, text, text, jsonb, uuid, uuid)', `(a text, b text, c text, d jsonb, e uuid, f uuid)`],
    ['_mcp_signup_write(text, text, text, text, jsonb, uuid, uuid, text)', `(a text, b text, c text, d text, e jsonb, f uuid, g uuid, h text)`],
    ['_mcp_email_write(text, text, text, text, jsonb, uuid, uuid, text)', `(a text, b text, c text, d text, e jsonb, f uuid, g uuid, h text)`],
  ]) {
    if (!(await one(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [`public.${sig}`])).ok) {
      await db.exec(`CREATE FUNCTION public.${sig.split('(')[0]}${def} RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":false,"error":"stub"}'::jsonb $$;`);
    }
  }
  const grant = (await one(`INSERT INTO mcp_grants (user_id, client_id, client_name, spaces, level, can_draft, can_pages)
                              VALUES ($1::uuid, 'banc', 'Claude', ARRAY[$2::text], 'analytics', false, false) RETURNING id`, [org, `org:${org}`])).id;
  await db.query(`INSERT INTO mcp_tokens (token_hash, kind, grant_id, client_id, expires_at)
                  VALUES ('banc-jeton-hache', 'access', $1, 'banc', now() + interval '1 hour')`, [grant]);
  // Le banc n'a pas pgcrypto : le « hachage » n'est qu'une clé de jointure ici.
  const hash = 'banc-jeton-hache';
  const call = async (tool, args = {}) => (await one(`SELECT mcp_call($1, $2, $3::jsonb) AS r`, [hash, tool, JSON.stringify(args)])).r;
  const write = async (tool, args = {}) => (await one(`SELECT mcp_write($1, $2, $3::jsonb) AS r`, [hash, tool, JSON.stringify(args)])).r;

  const sess = (await one(`SELECT mcp_session($1) AS r`, [hash])).r;
  check('session : le droit aux scénarios est éteint par défaut', sess.ok && sess.scenarios === false, sess.scenarios);
  const l0 = await call('list_scenarios');
  if (!l0.ok) console.log('journal :', JSON.stringify(await q(`SELECT tool, status, error FROM mcp_tool_calls ORDER BY id DESC LIMIT 3`)));
  check('lecture : list_scenarios sans droit d’écriture', l0.ok && Array.isArray(l0.result?.scenarios), l0.result?.error ?? l0.error);
  // Plan de soirée (lot A1) : lecture pour toute connexion CRM, tables temporaires permises, chiffres du serveur.
  const pl = await call('get_night_plan', { event: 'next' });
  check('lecture : get_night_plan (prochaine soirée), étapes et lien Console', pl.ok && Array.isArray(pl.result?.steps)
    && /\/crm\/nights\/[0-9a-f-]{36}\/plan$/.test(pl.result?.console_url ?? ''), pl.result?.error ?? pl.error);
  const plBad = await call('get_night_plan', { event: 'soirée qui n’existe pas' });
  check('lecture : get_night_plan, soirée introuvable dite telle', plBad.result?.error === 'event_not_found', plBad.result?.error);
  const wr = await call('get_weekly_review');
  check('lecture : get_weekly_review (semaine écoulée, lien Console)', wr.ok && wr.result?.ok === true && Array.isArray(wr.result?.actions)
    && wr.result?.console_url === 'https://crm.yunoapp.eu/crm/review', wr.result?.error ?? wr.error);
  const gx = JSON.parse(readFileSync(join(ROOT, 'src/crm/lib/__tests__/fixtures/scenario-graphs.json'), 'utf8'));
  const graph = JSON.parse(JSON.stringify(gx.cases[0].graph));
  const denied = await write('create_scenario_draft', { name: 'IA', graph });
  check('écriture refusée sans can_scenarios', denied.ok === false && denied.error === 'scenarios_not_allowed', denied.error);
  await db.query(`UPDATE mcp_grants SET can_scenarios = true WHERE id = $1`, [grant]);
  const kit = await call('get_scenario_kit');
  check('kit : modèles, segments, soirées, familles confirmées', kit.ok && Array.isArray(kit.result?.email_templates) && Array.isArray(kit.result?.confirmed_families)
    && typeof kit.result?.holdout_pct === 'number', Object.keys(kit.result ?? {}));
  const c = await write('create_scenario_draft', { name: 'Préparé par l’IA', graph });
  if (!c.result?.ok) console.log('journal :', JSON.stringify(await q(`SELECT tool, status, error FROM mcp_tool_calls ORDER BY id DESC LIMIT 2`)));
  check('brouillon créé, au nom de la personne', c.ok && c.result?.ok && c.result.status === 'draft' && Array.isArray(c.result.errors), c.result ?? c.error);
  const row = await one(`SELECT status, version_no, ai_author, mcp_grant_id, created_by FROM crm_scenarios WHERE id = $1`, [c.result?.scenario_id]);
  check('brouillon : signé par l’IA, jamais publié', row?.ai_author === 'Claude' && row.mcp_grant_id === grant && row.version_no === 0 && row.status === 'draft', row);
  const bad = await write('create_scenario_draft', { name: 'x', graph: { v: 2 } });
  check('graphe illisible refusé', bad.result?.error === 'invalid_graph', bad.result?.error ?? bad.error);
  const u = await write('update_scenario_draft', { scenario: 'Préparé', name: 'Préparé par l’IA (v2)' });
  check('modification par le nom, toujours un brouillon', u.ok && u.result?.name === 'Préparé par l’IA (v2)' && u.result.status === 'draft', u.result ?? u.error);
  const rep = await call('get_scenario_report', { scenario: c.result.scenario_id });
  check('rapport : le brouillon, ses erreurs, pas de chiffres avant publication', rep.ok && rep.result?.scenario?.draft?.v === 1 && rep.result.report === null, rep.result?.error ?? rep.error);
  const pub = await write('publish_scenario', { scenario: c.result.scenario_id });
  check('aucun outil de publication', pub.ok === false && pub.error === 'unknown_tool', pub.error);
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: org, role: 'authenticated' })]);
  const mine = (await one(`SELECT mcp_my_connections() AS r`)).r.connections.find((x) => x.id === grant);
  check('Réglages : droit et brouillons créés', mine?.can_scenarios === true && Number(mine.scenarios_created) === 1, mine && { can: mine.can_scenarios, n: mine.scenarios_created });
  const log = await q(`SELECT tool, status, error, args FROM mcp_tool_calls WHERE grant_id = $1 ORDER BY id`, [grant]);
  check('journal : un résumé, jamais le graphe entier', log.every((x) => !JSON.stringify(x.args ?? {}).includes('"nodes"')), log.map((x) => `${x.tool}:${x.status}`).join(' '));
} else if (cmd === 'admin') {
  // Lot J5 : Admin CRM › Plateforme › Scénarios (agrégats par compte).
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  // Le banc n'a pas les fonctions de l'Admin CRM : la porte et la ligne de compte
  // sont simulées (un compte, le nôtre).
  if (!(await one(`SELECT to_regprocedure('public._crm_admin_gate()') IS NOT NULL AS ok`)).ok) {
    await db.exec(`CREATE FUNCTION public._crm_admin_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;`);
  }
  if (!(await one(`SELECT to_regprocedure('public._crm_admin_rows(boolean)') IS NOT NULL AS ok`)).ok) {
    await db.exec(`CREATE FUNCTION public._crm_admin_rows(p boolean) RETURNS jsonb LANGUAGE sql AS $$
      SELECT jsonb_build_array(jsonb_build_object('id', 'org:' || '${org}', 'name', 'Banc', 'city', 'Paris', 'kind', 'organizer')) $$;`);
  }
  const owner = JSON.stringify({ sub: org, role: 'authenticated' });
  const gx = JSON.parse(readFileSync(join(ROOT, 'src/crm/lib/__tests__/fixtures/scenario-graphs.json'), 'utf8'));
  const graph = JSON.parse(JSON.stringify(gx.cases[0].graph));
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await db.query(`UPDATE organizer_profiles SET legal_name = 'Banc SAS', siret = '12345678900011' WHERE user_id = $1`, [org]);
  const tpl = (await one(`INSERT INTO email_campaign_templates (organizer_user_id, name) VALUES ($1, 'Banc') RETURNING id`, [org])).id;
  graph.nodes.e1.template_id = tpl;
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [owner]);
  const id = (await one(`SELECT crm_scenario_save(NULL, $1, NULL, 'Banc admin', $2::jsonb) AS r`, [org, JSON.stringify(graph)])).r.id;
  const pub = (await one(`SELECT crm_scenario_publish(NULL, $1, $2) AS r`, [org, id])).r;
  check('publié pour le test', pub.ok === true, pub);
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const run = (await one(`INSERT INTO crm_scenario_runs (scenario_id, version_id, scope_key, email, trigger_key, node_id, status)
                            SELECT s.id, s.live_version_id, s.scope_key, 'a@banc.test', 'k', 'e1', 'active' FROM crm_scenarios s WHERE s.id = $1 RETURNING id`, [id])).id;
  await db.query(`INSERT INTO crm_scenario_steps (run_id, node_id, scenario_id, version_id, status, reason, due_at)
                  SELECT $1, 'e1', s.id, s.live_version_id, 'held', 'yunits', now() FROM crm_scenarios s WHERE s.id = $2`, [run, id]);
  let r = (await one(`SELECT crm_admin_scenarios(false) AS r`)).r;
  const acc = r.accounts[0];
  check('admin : un compte, un scénario en ligne, une personne en route', r.totals.active === 1 && acc?.on_their_way === 1 && acc.entered7 === 1, r.totals);
  check('admin : message reporté et sa raison', acc?.held_now === 1 && acc.held_reason === 'yunits' && r.held.yunits === 1, { held: acc?.held_now, why: acc?.held_reason });
  check('admin : version en ligne saine', acc?.broken === 0, acc?.broken);
  await db.query(`DELETE FROM email_campaign_templates WHERE id = $1`, [tpl]);
  r = (await one(`SELECT crm_admin_scenarios(false) AS r`)).r;
  check('admin : modèle supprimé → scénario en ligne signalé', r.accounts[0]?.broken === 1 && r.totals.broken === 1, r.accounts[0]?.broken);
} else if (cmd === 'seed') {
  // Lot J5 : le semis démo (scripts/demo/seed-crm-journeys.sql) joué sur le banc,
  // deux fois (rejouable), puis lu par les écrans (liste, rapport, admin).
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  // Le banc devient « le compte démo » : courriel, connexion démo, porte démo, recettes et leurs modèles.
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'crm@womber.fr') ON CONFLICT (id) DO UPDATE SET email = 'crm@womber.fr'`, [org]);
  await db.query(`UPDATE ticketing_connections SET external_org_id = 'demo-crm' WHERE organizer_user_id = $1`, [org]);
  await db.exec(`CREATE OR REPLACE FUNCTION public.is_demo_marketing_scope(p_venue_id text, p_organizer_user_id uuid) RETURNS boolean
                 LANGUAGE sql STABLE AS $$ SELECT p_organizer_user_id = '${org}'::uuid $$;`);
  await db.query(`UPDATE organizer_profiles SET legal_name = 'Banc SAS', siret = '12345678900011' WHERE user_id = $1`, [org]);
  // La porte « la soirée a été scannée » (guest list, 08/10) n'est pas dans la base du banc : on la prend dans sa migration.
  if (!(await one(`SELECT to_regprocedure('public._crm_event_scan_known(uuid)') IS NOT NULL AS ok`)).ok) {
    const src = readFileSync(join(MIG, '20261008100000_crm_guest_list.sql'), 'utf8');
    const at = src.indexOf('CREATE OR REPLACE FUNCTION public._crm_event_scan_known');
    await db.exec(src.slice(at, src.indexOf('$$;', src.indexOf('AS $$', at)) + 3));
  }
  for (const kind of ['new_event', 'last_call', 'win_back', 'post_event_thanks']) {
    const tpl = (await one(`INSERT INTO email_campaign_templates (organizer_user_id, name, subject, blocks_json, theme_json)
                            VALUES ($1, $2, 'Banc', '[]', '{"seed":"crm-automations"}') RETURNING id`, [org, `Recette ${kind}`])).id;
    await db.query(`INSERT INTO email_automations (organizer_user_id, kind, enabled, template_id) VALUES ($1, $2, true, $3)
                    ON CONFLICT (organizer_user_id, kind) WHERE organizer_user_id IS NOT NULL DO UPDATE SET template_id = EXCLUDED.template_id`, [org, kind, tpl]);
  }
  // Le calendrier de la démo : seed-crm-demo.sql ancre la dernière soirée passée à J-4 (23 h) au jour du
  // semis. Le banc, généré une fois, vieillit : on le décale pour que sa dernière soirée scannée tombe là.
  const d = (await one(`SELECT ((date_trunc('day', now()) - interval '4 days' + interval '21 hours') - max(x.start_at))::text AS d
                          FROM external_events x WHERE x.start_at < now()
                           AND EXISTS (SELECT 1 FROM external_tickets t WHERE t.external_event_id = x.external_id AND t.scanned_at IS NOT NULL)`)).d;
  await db.query(`UPDATE external_events SET start_at = start_at + $1::interval, end_at = end_at + $1::interval`, [d]);
  await db.query(`UPDATE events SET start_at = start_at + $1::interval, end_at = end_at + $1::interval WHERE external_source IS NOT NULL`, [d]);
  await db.query(`UPDATE external_tickets SET purchased_at = purchased_at + $1::interval, scanned_at = scanned_at + $1::interval,
                                              first_seen_at = first_seen_at + $1::interval`, [d]);
  console.log(`calendrier du banc décalé de ${d}`);
  const play = async () => {
    const t0 = Date.now();
    await execFile(db, join(ROOT, 'scripts/demo/seed-crm-journeys.sql'), 'seed-crm-journeys.sql');
    return Date.now() - t0;
  };
  const ms1 = await play();
  const count = async () => one(`SELECT (SELECT count(*) FROM crm_scenarios WHERE scope_key = $1)::int AS scn,
                                        (SELECT count(*) FROM crm_scenario_runs WHERE scope_key = $1)::int AS runs,
                                        (SELECT count(*) FROM crm_scenario_steps st JOIN crm_scenarios s ON s.id = st.scenario_id WHERE s.scope_key = $1)::int AS steps,
                                        (SELECT count(*) FROM email_campaign_templates WHERE organizer_user_id = $2 AND theme_json->>'seed' = 'crm-journeys')::int AS tpl`,
                                 [`org:${org}`, org]);
  const c1 = await count();
  const ms2 = await play();
  const c2 = await count();
  console.log(`semis : ${ms1} ms, rejoué : ${ms2} ms`, JSON.stringify(c2));
  check('rejouable : mêmes lignes au deuxième passage', c1.scn === c2.scn && c1.tpl === c2.tpl && c1.tpl === 4 && Math.abs(c1.runs - c2.runs) <= c1.runs * 0.2, { c1, c2 });
  const st = await q(`SELECT name, status, version_no, live_version_id IS NOT NULL AS live FROM crm_scenarios WHERE scope_key = $1 ORDER BY name`, [`org:${org}`]);
  check('quatre scénarios : 2 en ligne, 1 en pause, 1 brouillon', st.filter((x) => x.status === 'active').length === 2
    && st.filter((x) => x.status === 'paused').length === 1 && st.filter((x) => x.status === 'draft' && !x.live).length === 1, st.map((x) => `${x.name}: ${x.status}`));
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: org, role: 'authenticated' })]);
  const list = (await one(`SELECT crm_scenarios(NULL, $1) AS r`, [org])).r.scenarios;
  const by = Object.fromEntries(list.map((x) => [x.template, x]));
  console.log(list.map((x) => `  ${x.name} · ${x.state} · entrés ${x.entered} · en route ${x.active} · objectif ${x.goal}`).join('\n'));
  check('« Fidèles sans place » : des entrées, des personnes en route, des objectifs atteints', by.loyal_no_ticket?.entered > 0 && by.loyal_no_ticket.goal > 0, by.loyal_no_ticket);
  const rep = async (id) => (await one(`SELECT crm_scenario_report(NULL, $1, $2) AS r`, [org, id])).r;
  const rl = await rep(by.loyal_no_ticket.id);
  check('rapport des fidèles : l\'annonce « aurait été envoyée » (démo), le témoin compté',
    rl.nodes.e1?.would_send > 0 && rl.nodes.e1.holdout > 0 && rl.nodes.e1.sent === 0, rl.nodes.e1);
  const ra = await rep(by.absent_buyers.id);
  check('absents : le SMS est retenu faute de Yunits', ra.nodes.s1?.held > 0 && (ra.nodes.s1.reasons['held:yunits'] ?? 0) > 0, ra.nodes.s1);
  const rw = await rep(by.winback_2.id);
  check('reconquête : en pause, rien d\'écrit après la pause', rw.state === 'paused', { state: rw.state, e1: rw.nodes.e1 });
  const late = (await one(`SELECT count(*)::int AS n FROM crm_scenario_steps st JOIN crm_scenarios s ON s.id = st.scenario_id
                            WHERE s.template = 'winback_2' AND s.scope_key = $1 AND st.created_at > s.paused_at`, [`org:${org}`])).n;
  check('reconquête : aucune étape datée après la pause', late === 0, late);
  // Cohérence avec le moteur : une personne déjà sortie par l'objectif n'a plus d'étape après son achat.
  const after = (await one(`SELECT count(*)::int AS n FROM crm_scenario_steps st JOIN crm_scenario_runs r ON r.id = st.run_id
                             WHERE r.scope_key = $1 AND r.goal_at IS NOT NULL AND st.created_at >= r.goal_at`, [`org:${org}`])).n;
  check('aucune étape après l\'objectif atteint', after === 0, after);
  const fut = (await one(`SELECT count(*)::int AS n FROM crm_scenario_steps st JOIN crm_scenarios s ON s.id = st.scenario_id
                           WHERE s.scope_key = $1 AND st.created_at > now()`, [`org:${org}`])).n;
  check('aucune étape dans le futur', fut === 0, fut);
  const v = (await one(`SELECT crm_scenario(NULL, $1, $2) AS r`, [org, by.loyal_no_ticket.id])).r;
  check('version en ligne valide (aucune erreur de contenu)', (v.errors ?? []).length === 0, v.errors);
  // Le vrai moteur passe par-dessus le semis (compte démo : rien ne part) : il ne doit ni tomber, ni
  // relâcher les SMS retenus avant la fin de leur fenêtre, ni faire entrer deux fois la même personne.
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const heldBefore = (await one(`SELECT count(*)::int AS n FROM crm_scenario_steps WHERE status = 'held' AND reason = 'yunits'`)).n;
  await db.exec('BEGIN');
  let tick;
  try { tick = (await one(`SELECT crm_scenario_tick() AS r`)).r; await db.exec('COMMIT'); } catch (e) { await db.exec('ROLLBACK'); throw e; }
  const adv = tick.scopes?.find((x) => x.scope === `org:${org}` || x.scope_key === `org:${org}`) ?? tick.scopes?.[0];
  console.log('passage du moteur :', JSON.stringify(adv ?? tick).slice(0, 300));
  const heldAfter = (await one(`SELECT count(*)::int AS n FROM crm_scenario_steps WHERE status = 'held' AND reason = 'yunits'`)).n;
  check('moteur : les SMS retenus le restent jusqu\'à la fin de leur fenêtre', heldAfter === heldBefore && heldBefore > 0, { heldBefore, heldAfter });
  const dup = (await one(`SELECT count(*)::int AS n FROM (SELECT scenario_id, email FROM crm_scenario_runs WHERE status = 'active'
                           GROUP BY 1, 2 HAVING count(*) > 1) x`)).n;
  check('moteur : personne en route deux fois dans un même scénario', dup === 0, dup);
  const sent = (await one(`SELECT count(*)::int AS n FROM crm_scenario_steps WHERE status = 'sent'`)).n;
  check('moteur : compte démo, aucun message réellement parti', sent === 0, sent);
  // Le smoke de la répétition en prod (smoke/journeys.sql) doit d'abord passer ici : il lit chaque écran
  // en titulaire démo, fait tourner le moteur et le bilan quotidien, et finit en SMOKE_OK.
  // Ce que la prod a et que le banc n'a pas : le centre de notifications (chargé comme dans « feed ») et
  // la ligne de compte de l'Admin CRM (simulée).
  for (const f of ['20261004231000_crm_account_team_prefs.sql', '20261004235000_crm_notifications.sql',
                   '20261007251000_crm_unreachable_scope_key.sql', '20261016150000_crm_scenario_feed.sql']) {
    await execFile(db, join(MIG, f), f);
  }
  if (!(await one(`SELECT to_regprocedure('public._crm_admin_rows(boolean)') IS NOT NULL AS ok`)).ok) {
    await db.exec(`CREATE FUNCTION public._crm_admin_rows(p boolean) RETURNS jsonb LANGUAGE sql AS $$
      SELECT jsonb_build_array(jsonb_build_object('id', 'org:${org}', 'name', 'Banc', 'state', 'trial', 'venue_id', NULL,
        'organizer_user_id', '${org}', 'trial_ends_at', (now() + interval '9 days')::text)) $$;`);
  }
  let smoke = '';
  try { await db.exec(readFileSync(join(ROOT, 'scripts/crm-bench/smoke/journeys.sql'), 'utf8')); } catch (e) { smoke = String(e.message ?? e); }
  console.log(smoke.slice(0, 1500));
  check('smoke de la répétition : SMOKE_OK sur le banc', smoke.includes('SMOKE_OK'), smoke.includes('SMOKE_OK') ? undefined : smoke.slice(0, 400));
} else if (cmd === 'plan') {
  // Agents, lot A1 : le plan de soirée (crm_night_plan) et l'audience « target » d'un brouillon d'IA.
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await db.query(`UPDATE organizer_profiles SET legal_name = 'Banc SAS', siret = '12345678900011' WHERE user_id = $1`, [org]);
  const asOwner = () => db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: org, role: 'authenticated' })]);
  await asOwner();
  const t0 = Date.now();
  await db.exec('BEGIN');
  const plan = (await one(`SELECT crm_night_plan(NULL, $1, NULL) AS r`, [org])).r;
  await db.exec('ROLLBACK');
  console.log(`plan : ${Date.now() - t0} ms`, JSON.stringify({ event: plan.event?.title, days: plan.days_left, totals: plan.totals, pace: plan.pace }));
  check('plan de la prochaine soirée', plan.ok === true && Array.isArray(plan.steps), plan.error);
  const next = (await one(`SELECT id FROM events WHERE organizer_user_id = $1 AND external_source IS NOT NULL AND cancelled_at IS NULL
                            AND coalesce(end_at, start_at + interval '6 hours') > now() ORDER BY start_at LIMIT 1`, [org])).id;
  check('sans soirée désignée : la prochaine', plan.event?.id === next, plan.event?.id);
  const auds = plan.steps.flatMap((x) => x.audiences);
  const sumPeople = plan.steps.reduce((a, x) => a + x.people, 0);
  check('chaque personne comptée une fois : étapes = union', sumPeople === plan.union.n && plan.totals.people === plan.union.n, { sumPeople, union: plan.union.n });
  check('premier passage ≤ audience', auds.every((a) => a.first_n <= a.n && a.first_email <= a.email && a.first_sms <= a.sms));
  check('étapes dans l\'ordre des moments', plan.steps.map((x) => ['now', 'week', 'eve'].indexOf(x.moment)).every((v, i, arr) => i === 0 || arr[i - 1] < v), plan.steps.map((x) => x.moment));
  check('coûts = joignables × tarif', plan.steps.every((x) => x.cost_email === x.email * plan.rates.email && x.cost_sms === x.sms * plan.rates.sms));
  const cost = plan.steps.reduce((a, x) => a + (x.channel === 'sms' ? x.cost_sms : x.cost_email), 0);
  check('total = canal conseillé de chaque étape', plan.totals.cost === cost && plan.totals.enough === (plan.totals.balance >= cost), { cost, totals: plan.totals });
  check('la veille passe en SMS seulement si l\'identité est prête', plan.steps.every((x) => x.channel === 'email' || (x.moment === 'eve' && plan.sms_ready)));
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const sold = Number((await one(`SELECT COALESCE(sum(COALESCE(quantity, 1)), 0) AS n FROM external_tickets WHERE event_id = $1 AND public._crm_ticket_is_sale(status, raw)`, [next])).n);
  check('rythme : billets vendus de la soirée', plan.pace.sold === sold, { plan: plan.pace.sold, sold });
  check('rythme : une édition précédente, vendue au même moment ≤ total', !plan.pace.prev || plan.pace.prev.sold_same <= plan.pace.prev.total, plan.pace.prev);
  check('l\'aperçu démo laisse passer le plan (tables temporaires)', (await one(`SELECT demo_preview_writable_rpc('crm_night_plan') AS ok`)).ok === true);

  // L'audience « target:<soirée>:<audience> » d'un brouillon = celle du plan.
  const a0 = auds.find((a) => a.n > 0);
  const aud = (await one(`SELECT _mcp_email_audience($1, 'crm', NULL, $2, 'fr') AS r`, [a0.audience_id, org])).r;
  check('audience d\'IA : filtre « Qui cibler » de la soirée', aud?.[0]?.def?.f?.ntgt?.e === next && aud[0].def.f.ntgt.a === a0.key && /·/.test(aud[0].label), aud);
  await asOwner();
  await db.exec('BEGIN');
  // Le compilateur de l'envoi (_crm_filter_sql sur `_cp`), comme crm_audience_count.
  await db.query(`SELECT public._crm_people_build(NULL, $1::uuid)`, [org]);
  const where = (await one(`SELECT public._crm_filter_sql($1::jsonb, 'p') AS w`, [JSON.stringify(aud[0].def)])).w;
  const cnt = Number((await one(`SELECT count(*) AS n FROM _cp p WHERE ${where}`)).n);
  await db.exec('ROLLBACK');
  check('même effectif que le plan', cnt === a0.n, { count: cnt, plan: a0.n });
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const other = (await one(`SELECT _mcp_email_audience($1, 'crm', NULL, gen_random_uuid(), 'fr') AS r`, [a0.audience_id])).r;
  check('audience d\'IA : soirée d\'un autre compte refusée', other === null, other);
  const past = (await one(`SELECT id FROM events WHERE organizer_user_id = $1 AND external_source IS NOT NULL AND start_at < now() - interval '2 days' LIMIT 1`, [org])).id;
  const old = (await one(`SELECT _mcp_email_audience($1, 'crm', NULL, $2, 'fr') AS r`, [`target:${past}:concept`, org])).r;
  check('audience d\'IA : soirée passée refusée', old === null, old);
  const bad = (await one(`SELECT _mcp_email_audience($1, 'crm', NULL, $2, 'fr') AS r`, [`target:${next}:everyone`, org])).r;
  check('audience d\'IA : audience inconnue refusée', bad === null, bad);
  // Porte : un inconnu ne lit pas le plan.
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000aa', role: 'authenticated' })]);
  let refused = false;
  await db.exec('BEGIN');
  try { await one(`SELECT crm_night_plan(NULL, $1, NULL) AS r`, [org]); } catch (e) { refused = /forbidden/.test(e.message); }
  await db.exec('ROLLBACK');
  check('porte : un inconnu est refusé', refused);
} else if (cmd === 'review') {
  // Agents, lot A3 : le bilan de la semaine (crm_weekly_review), calculé à la lecture.
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  for (const f of ['crm_campaign_is_crm(uuid)', 'crm_holdout_overview(text, uuid, integer)']) {
    if (!(await one(`SELECT to_regprocedure('public.${f}') IS NOT NULL AS ok`)).ok) console.log(`(banc) ${f} absente`);
  }
  // Le banc n'a pas crm_campaign_is_crm (cohabitation des produits) : le compte du banc est CRM pur.
  if (!(await one(`SELECT to_regprocedure('public.crm_campaign_is_crm(uuid)') IS NOT NULL AS ok`)).ok) {
    await db.exec(`CREATE FUNCTION public.crm_campaign_is_crm(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;`);
  }
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const owner = JSON.stringify({ sub: org, role: 'authenticated' });
  const read = async () => {
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [owner]);
    const r = (await one(`SELECT crm_weekly_review(NULL, $1) AS r`, [org])).r;
    await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
    return r;
  };
  const t0 = Date.now();
  const r0 = await read();
  console.log(`bilan : ${Date.now() - t0} ms`, JSON.stringify({ activity: r0.activity, drift: r0.drift.map((d) => d.kind), actions: r0.actions.map((a) => a.kind) }));
  check('bilan : la semaine écoulée, lundi → dimanche', r0.ok === true && new Date(r0.to) - new Date(r0.from) > 6.9 * 86400_000 && new Date(r0.to) < new Date(), { from: r0.from, to: r0.to });
  // Une campagne de la semaine aux bounces trop nombreux, une part protégée trop grande.
  const lastWeek = (await one(`SELECT ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '3 days') AT TIME ZONE 'Europe/Paris')::text AS t`)).t;
  await db.query(`INSERT INTO email_campaigns (organizer_user_id, name, subject, status, sent_at, recipients_count, bounced_count, complained_count, policy_skipped_count, created_at)
                  VALUES ($1, 'Banc · semaine', 'Banc', 'sent', $2::timestamptz, 1000, 50, 2, 400, $2::timestamptz)`, [org, lastWeek]);
  const r1 = await read();
  check('bilan : e-mails de la semaine comptés', r1.activity.emails >= 1000 && r1.activity.email_campaigns >= 1, r1.activity);
  check('bilan : délivrabilité et part protégée signalées', r1.drift.some((d) => d.kind === 'deliverability') && r1.drift.some((d) => d.kind === 'protected'), r1.drift.map((d) => d.kind));
  check('bilan : 3 actions au plus, l’une pour la base', r1.actions.length <= 3 && r1.actions.some((a) => a.kind === 'base'), r1.actions.map((a) => a.kind));
  const next = await one(`SELECT id FROM events WHERE organizer_user_id = $1 AND external_source IS NOT NULL AND cancelled_at IS NULL
                           AND start_at > now() AND start_at < now() + interval '14 days' ORDER BY start_at LIMIT 1`, [org]);
  check('bilan : la prochaine soirée proche a son plan à préparer', !next || r1.actions.some((a) => a.kind === 'plan' && a.event_id === next.id) || r1.actions.length === 3, { next: next?.id, actions: r1.actions });
  check('bilan : rien n’est mesuré sans 10 personnes de chaque côté', r1.measured.every((m) => m.contacted.n >= 10 && m.control.n >= 10));
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000aa', role: 'authenticated' })]);
  let refused = false;
  try { await one(`SELECT crm_weekly_review(NULL, $1) AS r`, [org]); } catch (e) { refused = /forbidden/.test(e.message); }
  check('porte : un inconnu est refusé', refused);
} else if (cmd === 'daily') {
  // Agents, lot A5 : le bilan du jour de la plateforme et son alerte (super admin).
  const db = await withScenarios(base);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const org = (await one(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).organizer_user_id;
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  // Le banc n'a ni la ligne de compte de l'Admin CRM ni le flux d'alertes : un compte en essai, et un journal des alertes.
  await db.exec(`CREATE OR REPLACE FUNCTION public._crm_admin_rows(p boolean) RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_array(jsonb_build_object('id', 'org:${org}', 'name', 'Banc', 'state', 'trial', 'venue_id', NULL,
      'organizer_user_id', '${org}', 'sync', 'error', 'sync_error', 'Jeton invalide', 'trial_ends_at', (now() + interval '2 days')::text)) $$;`);
  if (!(await one(`SELECT to_regprocedure('public._crm_admin_gate()') IS NOT NULL AS ok`)).ok) {
    await db.exec(`CREATE FUNCTION public._crm_admin_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;`);
  }
  await db.exec(`CREATE TABLE IF NOT EXISTS bench_admin_alerts (type text, title text, message text, priority text, dedup text, meta jsonb);
    CREATE OR REPLACE FUNCTION public.emit_admin_notification(p_type text, p_title text, p_message text, p_priority text DEFAULT 'normal',
      p_reference_type text DEFAULT NULL, p_reference_id text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb, p_dedup_key text DEFAULT NULL, p_event_id uuid DEFAULT NULL)
    RETURNS uuid LANGUAGE plpgsql AS $f$ BEGIN
      IF p_dedup_key IS NOT NULL AND EXISTS (SELECT 1 FROM bench_admin_alerts WHERE dedup = p_dedup_key) THEN RETURN NULL; END IF;
      INSERT INTO bench_admin_alerts VALUES (p_type, p_title, p_message, p_priority, p_dedup_key, p_metadata); RETURN gen_random_uuid(); END $f$;`);
  await db.query(`UPDATE ticketing_connections SET initial_import_done_at = COALESCE(initial_import_done_at, now() - interval '3 days') WHERE organizer_user_id = $1`, [org]);
  await db.query(`UPDATE crm_analysis_state SET computed_at = COALESCE(computed_at, now() - interval '1 day') WHERE scope_key = $1`, [`org:${org}`]);
  await db.exec('BEGIN');
  const d = (await one(`SELECT crm_admin_daily(false) AS r`)).r;
  await db.exec('COMMIT');
  console.log('bilan du jour :', JSON.stringify(d.counts));
  check('bilan du jour : synchro en erreur, essai qui finit, compte sans envoi', d.counts.sync_errors === 1 && d.counts.trials_ending === 1 && d.counts.silent === 1, d.counts);
  const next = await one(`SELECT id FROM events WHERE organizer_user_id = $1 AND external_source IS NOT NULL AND cancelled_at IS NULL
                           AND start_at > now() AND start_at < now() + interval '21 days' ORDER BY start_at LIMIT 1`, [org]);
  check('audit de prospect prêt : sa prochaine soirée', !next || (d.audits.length === 1 && d.audits[0].event_id === next.id), d.audits);
  for (let i = 0; i < 2; i += 1) {
    await db.exec('BEGIN');
    await one(`SELECT crm_admin_daily_notify() AS r`);
    await db.exec('COMMIT');
  }
  const alerts = await q(`SELECT type, message, priority, dedup FROM bench_admin_alerts`);
  check('une alerte par jour, même passée deux fois (dedup_key)', alerts.length === 1 && alerts[0].type === 'admin_crm_daily' && alerts[0].priority === 'high', alerts);
  check('l’alerte dit ce qui se passe, en chiffres', /1 synchro\(s\) en erreur/.test(alerts[0]?.message ?? '') && /essai\(s\) finissent/.test(alerts[0]?.message ?? ''), alerts[0]?.message);
  // Au banc, la session est toujours postgres : la protection réelle est le droit EXECUTE (service_role seul).
  const priv = await one(`SELECT has_function_privilege('authenticated', 'public.crm_admin_daily_notify()', 'execute') AS notify,
                                 has_function_privilege('anon', 'public.crm_admin_daily(boolean)', 'execute') AS anon_read,
                                 has_function_privilege('authenticated', 'public._crm_admin_daily_core(boolean)', 'execute') AS core`);
  check('droits : alerte et calcul brut fermés aux sessions, lecture fermée aux anonymes', !priv.notify && !priv.anon_read && !priv.core, priv);
} else {
  console.error(`commande inconnue : ${cmd}`);
  process.exit(2);
}
console.log(ok ? '\nTOUT EST BON' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
