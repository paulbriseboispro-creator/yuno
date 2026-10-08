#!/usr/bin/env node
// Scénarios (automatisations sur mesure) — banc. Plan :
// docs/designs/CRM_JOURNEYS_PLAN.md.
//
//   node scenarios.mjs conditions [base]   langage « et / ou » : cas partagés avec
//                                          le miroir TypeScript, puis effectifs
//                                          compilés contre _crm_filter_sql
//   node scenarios.mjs crud [base]         lot J2 : brouillon, publication,
//                                          versions, rôles, accès assisté, recette
//
// La base (défaut : demo-computed, déjà analysée) reçoit les migrations des
// Scénarios (20261016100000 et suivantes) avant les essais : c'est la même
// base que celle du lot d'optimisation, plus nos fichiers.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openSaved, execFile, ROOT } from './lib.mjs';

process.on('uncaughtException', (e) => {
  console.error(`ERREUR ${e.code || ''} : ${e.message}${e.where ? `\n  où : ${e.where}` : ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (e) => { throw e; });

export const SCENARIO_FIRST = '20261016100000';
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
                   SELECT '${scope}'::text AS scope_key, '${ev}'::uuid AS event_id, p.email, '-infinity'::timestamptz AS entered_at,
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
} else {
  console.error(`commande inconnue : ${cmd}`);
  process.exit(2);
}
console.log(ok ? '\nTOUT EST BON' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
