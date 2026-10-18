#!/usr/bin/env node
// Ablation du score « Chances de venir » : recalcule SEULEMENT le score d'un
// compte déjà analysé (`run.mjs compute`) avec un réglage donné, et rend la
// validation sur les soirées tenues à l'écart (AUC, AUC des clients actifs
// contre le modèle naïf, calibration, perte logarithmique).
//
//   node ablate.mjs demo-computed,grand-computed '{}' '{"off":[]}' '{"l2":10}'
//
// Chaque réglage part d'une copie fraîche de la base (rien ne s'accumule).
// Un réglage est fusionné dans config.score de la base du banc seulement.
import { openSaved } from './lib.mjs';

process.on('uncaughtException', (e) => {
  console.error(`ERREUR ${e.code || ''} : ${e.message}${e.where ? `\n  où : ${e.where}` : ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (e) => { throw e; });

const [bases, ...variants] = process.argv.slice(2);
if (!bases || !variants.length) {
  console.error("usage: node ablate.mjs <base>[,<base>…] '<réglage json>' […]");
  process.exit(2);
}

const rows = [];
for (const base of bases.split(',')) {
  for (const v of variants) {
    const db = await openSaved(base);
    const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
    await db.query(`UPDATE crm_analysis_rules SET config = jsonb_set(config, '{score}', config->'score' || $1::jsonb)`, [v]);
    // Pas de départ à chaud : chaque réglage apprend de zéro.
    await db.exec(`DELETE FROM crm_score_model`);
    const t0 = Date.now();
    const r = (await db.query(`SELECT crm_score_compute(NULL, $1) AS r`, [org])).rows[0].r;
    const m = (await db.query(`SELECT features, metrics FROM crm_score_model LIMIT 1`)).rows[0];
    const va = m.metrics.valid || {};
    const vb = m.metrics.baseline || {};
    rows.push({
      base, reglage: v, statut: r.status, ms: Date.now() - t0,
      auc: va.auc, auc_actifs: va.active?.auc, naif_actifs: vb.active?.auc,
      gain_actifs: va.active?.auc != null && vb.active?.auc != null ? +(va.active.auc - vb.active.auc).toFixed(4) : null,
      logloss: va.logloss, ll_actifs: va.active?.logloss, ece: va.ece, facteurs: m.features?.length,
    });
    await db.close();
  }
}
console.table(rows);
process.exit(0);
