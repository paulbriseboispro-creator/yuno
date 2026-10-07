import type { AdminDict } from './types';

// Admin CRM — analyse client (« Ce qui fait venir ») : tiroir d'un compte
// (couverture, statuts, calcul) et Réglages › Analyse client (apprentissage
// commun, versions de règles). Agrégats seulement. [EN, FR, ES].
const dict: AdminDict = {
  'adm.crm.an.t': ['Customer analysis', 'Analyse client', 'Análisis de clientes'],
  'adm.crm.an.none': ['Not computed yet for this account.', 'Pas encore calculée pour ce compte.', 'Aún no calculado para esta cuenta.'],
  'adm.crm.an.state': [
    'Full run {date} · {n} profiles · {ms} ms · rules v{v}',
    'Calcul complet {date} · {n} profils · {ms} ms · règles v{v}',
    'Cálculo completo {date} · {n} perfiles · {ms} ms · reglas v{v}',
  ],
  'adm.crm.an.dirty': ['{n} contacts waiting for recompute', '{n} contacts en attente de recalcul', '{n} contactos esperando recálculo'],
  'adm.crm.an.error': ['Last error: {e}', 'Dernière erreur : {e}', 'Último error: {e}'],
  'adm.crm.an.cov': ['Coverage', 'Couverture', 'Cobertura'],
  'adm.crm.an.cov.artists': ['Nights with line-up', 'Soirées avec line-up', 'Noches con line-up'],
  'adm.crm.an.cov.genres': ['Nights with genres', 'Soirées avec genres', 'Noches con géneros'],
  'adm.crm.an.cov.place': ['Nights with place type', 'Soirées avec type de lieu', 'Noches con tipo de lugar'],
  'adm.crm.an.cov.launch': ['Nights with sales opening', 'Soirées avec mise en vente', 'Noches con apertura de venta'],
  'adm.crm.an.cov.zip': ['Sales with postal code', 'Ventes avec code postal', 'Ventas con código postal'],
  'adm.crm.an.cov.multi': ['Orders with several tickets', 'Commandes de plusieurs billets', 'Pedidos con varias entradas'],
  'adm.crm.an.cov.holders': ['…with different holders', '…à détenteurs différents', '…con titulares distintos'],
  'adm.crm.an.cov.promo': ['Promoter-only rates', 'Tarifs réservés aux promoteurs', 'Tarifas solo para promotores'],
  'adm.crm.an.cov.scan': ['Tickets scanned', 'Billets scannés', 'Entradas escaneadas'],
  'adm.crm.an.cov.places': ['Place types seen: {list}', 'Types de lieu vus : {list}', 'Tipos de lugar vistos: {list}'],
  'adm.crm.an.fams': ['Families on this account', 'Familles sur ce compte', 'Familias en esta cuenta'],
  'adm.crm.an.learn': [
    'Anonymous statistics: global {g} · account {a} · {c} cells sent',
    'Statistiques anonymes : global {g} · compte {a} · {c} cellules envoyées',
    'Estadísticas anónimas: global {g} · cuenta {a} · {c} celdas enviadas',
  ],
  'adm.crm.an.on': ['on', 'activé', 'activado'],
  'adm.crm.an.off': ['off', 'éteint', 'desactivado'],
  'adm.crm.an.demo': ['demo, never', 'démo, jamais', 'demo, nunca'],

  // Réglages › Analyse client
  'adm.crm.se.t.analysis': ['Customer analysis', 'Analyse client', 'Análisis de clientes'],
  'adm.crm.an.learnT': ['Shared lessons (anonymous)', 'Leçons communes (anonymes)', 'Lecciones comunes (anónimas)'],
  'adm.crm.an.learnS': [
    'Only aggregate counts leave an account (cells under 10 removed at source). A lesson is published from 5 accounts, none weighing more than half. Keep it OFF until a lawyer has validated the “anonymous statistics” clause of the terms and DPA.',
    'Seuls des comptages agrégés sortent d’un compte (cellules sous 10 supprimées à la source). Une leçon se publie à partir de 5 comptes, aucun ne pesant plus de la moitié. Laisser ÉTEINT tant qu’un juriste n’a pas validé la clause « statistiques anonymes » des conditions et du DPA.',
    'Solo salen recuentos agregados de una cuenta (celdas por debajo de 10 suprimidas en origen). Una lección se publica a partir de 5 cuentas, ninguna con más de la mitad del peso. Dejar DESACTIVADO hasta que un abogado valide la cláusula de «estadísticas anónimas» de las condiciones y del DPA.',
  ],
  'adm.crm.an.global': ['Collect anonymous statistics (all accounts)', 'Collecter les statistiques anonymes (tous les comptes)', 'Recoger estadísticas anónimas (todas las cuentas)'],
  'adm.crm.an.contributors': ['{n} contributing accounts', '{n} comptes contributeurs', '{n} cuentas contribuyentes'],
  'adm.crm.an.priors': ['Published lessons', 'Leçons publiées', 'Lecciones publicadas'],
  'adm.crm.an.prior': ['{family} {variant} · {k} accounts · gain ×{g}', '{family} {variant} · {k} comptes · gain ×{g}', '{family} {variant} · {k} cuentas · ganancia ×{g}'],
  'adm.crm.an.noPriors': ['No lesson published yet (5 accounts needed).', 'Aucune leçon publiée (5 comptes nécessaires).', 'Ninguna lección publicada (hacen falta 5 cuentas).'],
  'adm.crm.an.rules': ['Rule versions', 'Versions des règles', 'Versiones de las reglas'],
  'adm.crm.an.rulesS': [
    'A proposal is computed on aggregates by leaving each account out in turn; it never applies on its own.',
    'Une proposition se calcule sur les agrégats en laissant chaque compte de côté à tour de rôle ; elle ne s’applique jamais seule.',
    'Una propuesta se calcula con agregados dejando fuera cada cuenta por turnos; nunca se aplica sola.',
  ],
  'adm.crm.an.ver': ['Version {v}', 'Version {v}', 'Versión {v}'],
  'adm.crm.an.active': ['active', 'active', 'activa'],
  'adm.crm.an.proposal': ['proposal', 'proposition', 'propuesta'],
  'adm.crm.an.change': ['{param}: {a} → {b} ({votes}/{k} accounts left out, z {z})', '{param} : {a} → {b} ({votes}/{k} comptes laissés de côté, z {z})', '{param}: {a} → {b} ({votes}/{k} cuentas dejadas fuera, z {z})'],
  'adm.crm.an.approve': ['Validate this version', 'Valider cette version', 'Validar esta versión'],
  'adm.crm.an.reason': ['Reason (required)', 'Motif (obligatoire)', 'Motivo (obligatorio)'],
  'adm.crm.an.confirm': ['Confirm', 'Confirmer', 'Confirmar'],
  'adm.crm.an.cancel': ['Cancel', 'Annuler', 'Cancelar'],
  'adm.crm.an.saved': ['Saved and logged', 'Enregistré et journalisé', 'Guardado y registrado'],
  'adm.crm.an.err': ['Refused: {e}', 'Refusé : {e}', 'Rechazado: {e}'],

  'adm.crm.an.sc.t': ['Chance of coming (prediction)', 'Chances de venir (prédiction)', 'Probabilidad de venir (predicción)'],
  'adm.crm.an.sc.st.ok': ['Validated model · trained {date}', 'Modèle validé · entraîné le {date}', 'Modelo validado · entrenado el {date}'],
  'adm.crm.an.sc.st.weak': [
    'Model trained {date} but not validated (doesn’t beat recency alone, or not calibrated): hidden from the pro.',
    'Modèle entraîné le {date} mais non validé (pas meilleur que la récence seule, ou mal calibré) : caché au pro.',
    'Modelo entrenado el {date} pero no validado (no supera la recencia sola, o mal calibrado): oculto al pro.',
  ],
  'adm.crm.an.sc.st.insufficient': ['Not enough history to train ({date}): hidden from the pro.', 'Pas assez d’historique pour entraîner ({date}) : caché au pro.', 'No hay suficiente historial para entrenar ({date}): oculto al pro.'],
  'adm.crm.an.sc.st.failed': ['Training failed · {date}', 'Entraînement en échec · {date}', 'Entrenamiento fallido · {date}'],
  'adm.crm.an.sc.m': [
    'Held-out nights: AUC {auc} (recency only {base}) · active customers {act} ({actb}) · calibration gap {ece} pts · {pos} purchases learned, {vpos} checked',
    'Soirées tenues à l’écart : AUC {auc} (récence seule {base}) · clients actifs {act} ({actb}) · écart de calibration {ece} pts · {pos} achats appris, {vpos} vérifiés',
    'Noches apartadas: AUC {auc} (solo recencia {base}) · clientes activos {act} ({actb}) · desvío de calibración {ece} pts · {pos} compras aprendidas, {vpos} verificadas',
  ],
  'adm.crm.an.sc.proj': [
    'Fill projection (super admin only): sold + known customers expected ± margin + newcomers, share of purchases still to come',
    'Projection de remplissage (super admin seulement) : vendues + clients connus attendus ± marge + nouveaux, part des achats encore à venir',
    'Proyección de aforo (solo super admin): vendidas + clientes conocidos esperados ± margen + nuevos, parte de las compras aún por venir',
  ],
  'adm.crm.an.sc.row': ['{sold} sold + {k} ±{b} + {nw} new · {r} to come', '{sold} vendues + {k} ±{b} + {nw} nouveaux · {r} à venir', '{sold} vendidas + {k} ±{b} + {nw} nuevos · {r} por venir'],
};

export default dict;
