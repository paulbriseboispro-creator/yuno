import type { AdminDict } from './types';

/**
 * Textes des écrans réécrits au kit : Pilotage › Produit (Signaux, IA, CRM),
 * Pilotage › Acquisition (page publique CRM), Système › Offre et tarifs,
 * Système › Connecteurs (plan d'une soirée). Les libellés déjà écrits pour les
 * anciens écrans (`adm.product.*`, `adm.ai.*`, `adm.mcp.*`, `adm.crm.*`)
 * sont réutilisés tels quels ; seuls les mots nouveaux sont ici.
 */
const pilotSystem: AdminDict = {
  // Mots communs aux tableaux
  'adm.pl.sig.date': ['Date', 'Date', 'Fecha'],
  'adm.pl.sig.status': ['Status', 'Statut', 'Estado'],
  'adm.pl.sig.rate': ['Rate', 'Taux', 'Tasa'],
  'adm.pl.sig.clicks': ['Clicks', 'Clics', 'Clics'],
  'adm.sys.col.status': ['Status', 'Statut', 'Estado'],

  // Produit › Signaux
  'adm.pl.sig.k.views': ['Page views', 'Pages vues', 'Páginas vistas'],
  'adm.pl.sig.k.viewsHint': ['All page views of the platform over the period, every group of pages together.', 'Toutes les pages vues de la plateforme sur la période, tous groupes de pages réunis.', 'Todas las páginas vistas de la plataforma en el periodo, todos los grupos de páginas juntos.'],
  'adm.pl.sig.k.push': ['Push-reachable users', 'Joignables en push', 'Alcanzables por push'],
  'adm.pl.sig.k.pushHint': ['Accounts with at least one active push subscription.', 'Comptes avec au moins un abonnement push actif.', 'Cuentas con al menos una suscripción push activa.'],
  'adm.pl.sig.k.feedback': ['Open feedback', 'Retours ouverts', 'Comentarios abiertos'],
  'adm.pl.sig.eventsSub': ['The nights people looked at most, with what they led to.', 'Les soirées les plus regardées, et ce qu’elles ont donné.', 'Las noches más vistas y lo que han generado.'],
  'adm.pl.sig.period': ['Period', 'Période', 'Periodo'],
  'adm.pl.sig.total': ['Total', 'Total', 'Total'],
  'adm.pl.sig.follows': ['Follows', 'Abonnements', 'Seguimientos'],
  'adm.pl.sig.unfollows': ['Unfollows', 'Désabonnements', 'Bajas'],
  'adm.pl.sig.favs': ['Favorites', 'Favoris', 'Favoritos'],
  'adm.pl.sig.conv': ['Conversion by pillar', 'Conversion par pilier', 'Conversión por pilar'],
  'adm.pl.sig.convHint': ['Entries, scanned at the door', 'Entrées, scannées à la porte', 'Entradas, escaneadas en la puerta'],
  'adm.pl.sig.pillar': ['Pillar', 'Pilier', 'Pilar'],
  'adm.pl.sig.sold': ['Sold or signed up', 'Vendus ou inscrits', 'Vendidas o inscritos'],
  'adm.pl.sig.scanned': ['Scanned', 'Scannés', 'Escaneados'],
  'adm.pl.sig.rule1': ['1 rule', '1 règle', '1 regla'],
  'adm.pl.sig.rules': ['{n} rules', '{n} règles', '{n} reglas'],
  'adm.pl.sig.platforms': ['Platforms', 'Plateformes', 'Plataformas'],
  'adm.pl.sig.assistants': ['What people ask the assistants', 'Ce qu’on demande aux assistants', 'Lo que se pregunta a los asistentes'],
  'adm.pl.sig.assistantsHint': ['Latest questions, clients and pros', 'Dernières questions, clients et pros', 'Últimas preguntas, clientes y pros'],
  'adm.pl.sig.feedbackTitle': ['Feedback', 'Retour', 'Comentario'],
  'adm.pl.sig.category': ['Category', 'Catégorie', 'Categoría'],
  'adm.pl.sig.priority': ['Priority', 'Priorité', 'Prioridad'],
  'adm.pl.sig.taste': ['Tastes and audience', 'Goûts et audience', 'Gustos y audiencia'],

  // Produit › IA
  'adm.pl.ai.callsDay': ['Calls per day', 'Appels par jour', 'Llamadas por día'],
  'adm.pl.ai.costDay': ['Cost per day (USD)', 'Coût par jour (USD)', 'Coste por día (USD)'],
  'adm.pl.ai.question': ['Question', 'Question', 'Pregunta'],
  'adm.pl.ai.unknown': ['Unknown', 'Inconnu', 'Desconocido'],
  'adm.pl.ai.detail': ['Detail', 'Détail', 'Detalle'],
  'adm.pl.ai.tool': ['Tool', 'Outil', 'Herramienta'],
  'adm.pl.ai.mcpDetail': ['MCP detail', 'Détail du connecteur', 'Detalle del conector'],
  'adm.pl.ai.mcpDetailHint': ['{n} tools called', '{n} outils appelés', '{n} herramientas llamadas'],

  // Produit › CRM
  'adm.pl.crm.step': ['Step', 'Étape', 'Paso'],
  'adm.pl.crm.accounts': ['Accounts', 'Comptes', 'Cuentas'],
  'adm.pl.crm.share': ['Share', 'Part', 'Parte'],
  'adm.pl.crm.milestone': ['Milestone', 'Jalon', 'Hito'],
  'adm.pl.crm.median': ['Median delay', 'Délai médian', 'Plazo mediano'],
  'adm.pl.crm.group': ['Group', 'Groupe', 'Grupo'],
  'adm.pl.crm.recipe': ['Automation', 'Automatisation', 'Automatización'],
  'adm.pl.crm.request': ['Request', 'Demande', 'Solicitud'],
  'adm.pl.crm.account': ['Account', 'Compte', 'Cuenta'],
  'adm.pl.crm.score': ['Score', 'Note', 'Nota'],
  'adm.pl.crm.feature': ['Feature', 'Fonction', 'Función'],
  'adm.pl.crm.people': ['People', 'Personnes', 'Personas'],
  'adm.pl.crm.save': ['Save status', 'Enregistrer le statut', 'Guardar el estado'],

  // Acquisition › page publique CRM
  'adm.pl.acq.landingKeys': ['The numbers', 'Les chiffres', 'Las cifras'],
  'adm.pl.acq.reached': ['Reached', 'Atteinte', 'Alcanzada'],

  // Système › Offre et tarifs
  'adm.sys.pr.history': ['Price changes', 'Changements de prix', 'Cambios de precio'],
  'adm.sys.pr.changed': ['What changed', 'Ce qui a changé', 'Qué cambió'],
  'adm.sys.pr.reason': ['Reason', 'Motif', 'Motivo'],
  'adm.sys.pr.changes': ['You are about to change: {list}. This does not touch existing subscriptions or Stripe.', 'Vous allez modifier : {list}. Cela ne touche ni les abonnements existants ni Stripe.', 'Va a modificar: {list}. Esto no afecta a las suscripciones existentes ni a Stripe.'],
  'adm.sys.pr.lc.email': ['E-mail', 'E-mail', 'E-mail'],
  'adm.sys.pr.lc.on': ['On', 'Allumé', 'Activado'],
  'adm.sys.pr.lc.account': ['Account', 'Compte', 'Cuenta'],
  'adm.sys.pr.an.lesson': ['Lesson', 'Leçon', 'Lección'],
  'adm.sys.pr.an.version': ['Version', 'Version', 'Versión'],
  'adm.sys.pr.an.contributors': ['Contributing accounts', 'Comptes contributeurs', 'Cuentas contribuyentes'],
  'adm.sys.pr.an.onDesc': ['Shared learning will start counting accounts that opted in.', 'L’apprentissage commun comptera les comptes qui y participent.', 'El aprendizaje común empezará a contar las cuentas que participan.'],
  'adm.sys.pr.an.offDesc': ['Shared learning stops. Lessons already published stay.', 'L’apprentissage commun s’arrête. Les leçons déjà publiées restent.', 'El aprendizaje común se detiene. Las lecciones ya publicadas se mantienen.'],
  'adm.sys.pr.cb.eligible': ['Eligible', 'Éligibles', 'Elegibles'],
  'adm.sys.pr.cb.objected': ['Objected', 'Opposés', 'Opuestos'],
  'adm.sys.pr.cb.ramp': ['Daily cap', 'Plafond du jour', 'Tope del día'],

  // Système › Connecteurs › plan d'une soirée
  'adm.sys.np.title': ['Night plan', 'Plan de soirée', 'Plan de la noche'],
  'adm.sys.np.sub': ['Read-only: the plan a prospect would see, before the call.', 'Lecture seule : le plan que verrait un prospect, avant l’appel.', 'Solo lectura: el plan que vería un prospecto, antes de la llamada.'],
  'adm.sys.np.back': ['Back', 'Retour', 'Volver'],
};

export default pilotSystem;
