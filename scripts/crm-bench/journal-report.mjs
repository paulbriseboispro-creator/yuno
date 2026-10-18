#!/usr/bin/env node
// Lit le journal prévu / réel d'une base du banc déjà passée par `run.mjs journal`
// et l'affiche en détail : justesse par personne (AUC, perte logarithmique,
// Brier, calibration), et la projection décomposée (déjà acheteurs, connus
// attendus contre réels, nouveaux estimés contre réels).
//
//   node journal-report.mjs demo-journal [grand-journal …]
import { openSaved } from './lib.mjs';

for (const name of process.argv.slice(2)) {
  const db = await openSaved(name);
  const res = (await db.query(`SELECT title, horizon, metrics m FROM crm_prediction_results ORDER BY start_at, horizon`)).rows;
  const model = (await db.query(`SELECT status, metrics FROM crm_score_model LIMIT 1`)).rows[0];
  console.log(`\n■ ${name} — modèle ${model.status} ; recalage ${JSON.stringify(model.metrics.calib ?? null)} ; ` +
    `rejeu J-7 ${JSON.stringify(model.metrics.backtest ?? null)} ; 1re venue pendant la vente ${JSON.stringify(model.metrics.recent ?? null)}`);
  console.table(res.map(({ title, horizon, m }) => ({
    soiree: title, moment: horizon, n: m.n, achats: m.buyers, attendus: m.expected,
    auc: m.auc, logloss: m.logloss, brier: m.brier, ece: m.ece,
  })));
  console.table(res.filter((r) => r.m.projection).map(({ title, horizon, m }) => {
    const p = m.projection;
    return {
      soiree: title, moment: horizon, j: p.days_left, deja: p.buyers_at, connus_att: p.expected_known, connus_reels: p.actual_known,
      nouv_att: p.newcomers_est, nouv_reels: p.actual_new, prevu: p.predicted, reel: p.actual, ecart: p.err,
    };
  }));
  const tot = res.reduce((a, { m }) => ({ n: a.n + m.n, y: a.y + m.buyers, e: a.e + m.expected, ll: a.ll + m.logloss * m.n }), { n: 0, y: 0, e: 0, ll: 0 });
  console.log(`total : ${tot.y} achats, ${tot.e.toFixed(1)} attendus (${(100 * (tot.e - tot.y) / tot.y).toFixed(1)} %), perte log moyenne ${(tot.ll / tot.n).toFixed(5)}`);
  await db.close();
}
process.exit(0);
