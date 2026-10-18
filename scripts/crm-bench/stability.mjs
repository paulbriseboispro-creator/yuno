#!/usr/bin/env node
// Statuts des familles « Ce qui fait venir » : correction des tests multiples,
// confirmation sur 2 jours de calcul, stabilité quand on retire 10 % des
// clients au hasard.
//
//   node stability.mjs demo [grand …]
//
// Sur une base GÉNÉRÉE (`run.mjs gen`) : deux calculs complets « à un jour
// d'intervalle » (la date du premier est reculée d'un jour), une fois avec
// toutes les données, une fois sans 10 % des clients (tirés par empreinte de
// leur adresse, toujours les mêmes). Rend les statuts côte à côte et les
// familles qui changent.
import { openSaved } from './lib.mjs';

process.on('uncaughtException', (e) => {
  console.error(`ERREUR ${e.code || ''} : ${e.message}${e.where ? `\n  où : ${e.where}` : ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (e) => { throw e; });

async function statuses(name, drop) {
  const db = await openSaved(name);
  const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
  if (drop) {
    // 10 % des clients, choisis par empreinte (reproductible).
    await db.exec(`DELETE FROM external_tickets WHERE abs(hashtext('banc:' || lower(buyer_email))) % 10 = 0`);
  }
  await db.query(`SELECT crm_analysis_compute(NULL, $1, true, 0)`, [org]);
  await db.exec(`UPDATE crm_family_status SET computed_at = computed_at - interval '1 day'`);
  await db.query(`SELECT crm_analysis_compute(NULL, $1, true, 0)`, [org]);
  const rows = (await db.query(`
    SELECT family, status, supported_runs AS runs, n, round(o::numeric, 1) o, round(e::numeric, 1) e,
           round(z::numeric, 2) z, (detail->>'p')::numeric AS p, (detail->>'bh')::boolean AS bh
      FROM crm_family_status WHERE variant = '' ORDER BY family`)).rows;
  await db.close();
  return rows;
}

for (const name of process.argv.slice(2)) {
  const full = await statuses(name, false);
  const part = await statuses(name, true);
  const byFam = new Map(part.map((r) => [r.family, r]));
  const out = full.map((r) => {
    const q = byFam.get(r.family) || {};
    return {
      famille: r.family, statut: r.status, jours: r.runs, n: r.n, o: r.o, e: r.e, z: r.z,
      p: r.p === null ? null : Number(Number(r.p).toPrecision(2)), bh: r.bh,
      'statut (−10 %)': q.status, change: q.status !== r.status ? '◀' : '',
    };
  });
  console.log(`\n■ ${name}`);
  console.table(out);
  const changed = out.filter((r) => r.change).length;
  const conf = out.filter((r) => r.statut === 'supported').length;
  console.log(`${conf} confirmées ; ${changed} statut(s) changent sans 10 % des clients, sur ${out.length} familles.`);
}
process.exit(0);
