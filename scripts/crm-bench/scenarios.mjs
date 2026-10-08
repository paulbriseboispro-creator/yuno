#!/usr/bin/env node
// Scénarios (automatisations sur mesure) — banc. Plan :
// docs/designs/CRM_JOURNEYS_PLAN.md.
//
//   node scenarios.mjs conditions [base]   langage « et / ou » : cas partagés avec
//                                          le miroir TypeScript, puis effectifs
//                                          compilés contre _crm_filter_sql
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
} else {
  console.error(`commande inconnue : ${cmd}`);
  process.exit(2);
}
console.log(ok ? '\nTOUT EST BON' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
