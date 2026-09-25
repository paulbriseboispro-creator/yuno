#!/usr/bin/env node
/**
 * Dashboard PostHog « Yuno — Pilotage » — construit ENTIÈREMENT par ce script
 * (le dashboard est du code : on le rejoue, on ne le bricole pas à la main).
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_… node scripts/posthog/pilotage.mjs [--warehouse <prefix>]
 *
 * - Idempotent : le dashboard du même nom est vidé (ses insights marqués
 *   `pilotage` sont supprimés) puis reconstruit, avec le même id.
 * - Pose les filtres « comptes de test » du projet (is_demo = true, surface =
 *   admin) : chaque insight a `filterTestAccounts` — la démo n'est jamais un
 *   chiffre, le super admin non plus.
 * - Épingle le dashboard comme accueil du projet (`primary_dashboard`).
 * - `--warehouse <préfixe>` : tables de l'entrepôt Supabase (schéma
 *   `analytics_wh`, migration 20260925235000) — préfixe des tables PostHog,
 *   ex. `yuno_postgres_`. Sans lui, la section Offre garde des tuiles texte.
 *
 * Grammaire (CLAUDE.md « Grammaire de l'analyse ») : une section = une
 * question, annoncée par une tuile texte ; chiffres en tuiles de 2 colonnes
 * (6 par ligne) comparées à la période précédente ; une phrase de définition
 * par tuile ; piliers toujours dans l'ordre billets, tables, guest list,
 * boissons.
 */

const HOST = (process.env.POSTHOG_API_HOST || 'https://eu.posthog.com').replace(/\/+$/, '');
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const NAME = 'Yuno — Pilotage';
const TAG = 'pilotage';
if (!KEY) {
  console.error('POSTHOG_PERSONAL_API_KEY manquant');
  process.exit(1);
}
const argv = process.argv.slice(2);
const whIdx = argv.indexOf('--warehouse');
const WH = whIdx >= 0 ? argv[whIdx + 1] : null;

async function api(method, path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

// ── Vocabulaire ────────────────────────────────────────────────────────────
const PAID = 'order_paid_server';

const ev = (event, extra = {}) => ({ kind: 'EventsNode', event, name: event, ...extra });
const p = (key, value, operator = 'exact', type = 'event') => ({
  key,
  value: Array.isArray(value) ? value : [value],
  operator,
  type,
});
const props = (list) => (list?.length ? { type: 'AND', values: [{ type: 'AND', values: list }] } : undefined);
const notGuestList = p('pillar', 'guest_list', 'is_not');
const euro = { aggregationAxisFormat: 'numeric', aggregationAxisPostfix: ' €', decimalPlaces: 0 };
const range = { date_from: '-30d' };

function trend({ series, interval = 'week', display = 'ActionsLineGraph', breakdown, formula, compare = false, filters, trendsFilter = {} }) {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      series,
      interval,
      dateRange: range,
      filterTestAccounts: true,
      ...(filters ? { properties: props(filters) } : {}),
      ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: 'event', breakdown_limit: 10 } } : {}),
      ...(compare ? { compareFilter: { compare: true } } : {}),
      trendsFilter: { display, ...(formula ? { formula } : {}), ...trendsFilter },
    },
  };
}
const number = (series, opts = {}) => trend({ series, display: 'BoldNumber', compare: true, interval: 'day', ...opts });

function funnel({ steps, breakdown, windowDays = 14 }) {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'FunnelsQuery',
      series: steps,
      dateRange: range,
      filterTestAccounts: true,
      funnelsFilter: { funnelVizType: 'steps', funnelOrderType: 'ordered', funnelWindowInterval: windowDays, funnelWindowIntervalUnit: 'day' },
      ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: 'event' } } : {}),
    },
  };
}

function retention({ target, returning, period = 'Week', total = 13, firstTime = true, breakdown }) {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'RetentionQuery',
      dateRange: { date_from: period === 'Month' ? '-6m' : '-90d' },
      filterTestAccounts: true,
      retentionFilter: {
        targetEntity: { id: target, name: target, type: 'events' },
        returningEntity: { id: returning, name: returning, type: 'events' },
        retentionType: firstTime ? 'retention_first_time' : 'retention_recurring',
        totalIntervals: total,
        period,
      },
      ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: 'event' } } : {}),
    },
  };
}

function lifecycle(event) {
  return {
    kind: 'InsightVizNode',
    source: { kind: 'LifecycleQuery', series: [ev(event)], interval: 'week', dateRange: { date_from: '-90d' }, filterTestAccounts: true },
  };
}

function sql(query, display = 'ActionsTable') {
  return { kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery', query }, display };
}

// ── Définition du dashboard ────────────────────────────────────────────────
// Chaque entrée : { text } (tuile texte pleine largeur) ou
// { name, description, query, w, h }. Le placement suit l'ordre, sur 12 colonnes.
const ONLY_AFTER_DEPLOY = ' Se remplit après la mise en ligne du tracking (web : prochain déploiement Cloudflare ; apps iPhone : prochaine OTA).';

function sections() {
  const S = [];
  const H = (title, line) => S.push({ text: `## ${title}\n${line}`, w: 12, h: 2 });
  const T = (name, description, query, w = 6, h = 7) => S.push({ name, description, query, w, h });
  const N = (name, description, query) => T(name, description, query, 2, 5);

  S.push({
    text: [
      '## 0 · Comment lire ce dashboard',
      '**Filtres** (en haut) : période (30 derniers jours, comparés aux 30 précédents) ; pour un **pays**, ajoutez le filtre `market_country` (pays de la soirée — FR, ES…) ou `$geoip_country_code` (pays du visiteur) ; pour une **surface**, ajoutez `surface` (ios_app, web_app, pwa, console, ios_pro, landing).',
      "**D'où viennent les chiffres** : l'argent vient du SERVEUR (`order_paid_server`, capturé au moment où le paiement est confirmé — il fait foi) ; le comportement vient du navigateur et des apps, **seulement pour les visiteurs qui ont accepté la mesure d'audience** (les apps iPhone : tout le monde). L'offre (soirées, clubs, capacité) vient de la base Yuno, copiée chaque jour.",
      '**La démo est exclue** partout (comptes @womber.fr, club démo), le super admin aussi. Couleurs des piliers, toujours dans cet ordre : billets, tables, guest list, boissons.',
    ].join('\n\n'),
    w: 12,
    h: 4,
  });

  // 1 · En un coup d'œil
  H("1 · En un coup d'œil — comment va Yuno ?", 'Les douze chiffres à regarder chaque lundi. Chacun est comparé à la période précédente.');
  N("Chiffre d'affaires", "Montant brut des commandes payées (billets, tables à leur prix total, boissons), serveur. Le « GMV ».", number([ev(PAID, { math: 'sum', math_property: 'value' })], { trendsFilter: euro }));
  N('CA club', 'Ce que touchent les clubs et organisateurs : brut − frais de service Yuno − assurance / gestion (formules de fees.ts).', number([ev(PAID, { math: 'sum', math_property: 'club_revenue' })], { trendsFilter: euro }));
  N('Commandes', 'Commandes payées ou confirmées (billets, tables, boissons). Les inscriptions guest list sont comptées à part.', number([ev(PAID)], { filters: [notGuestList] }));
  N('Acheteurs uniques', "Personnes distinctes ayant payé. Partiel : sans consentement mesure d'audience, chaque commande compte pour une personne.", number([ev(PAID, { math: 'dau' })], { filters: [notGuestList] }));
  N('Panier moyen', 'CA ÷ commandes payées (guest list exclue).', number([ev(PAID, { math: 'sum', math_property: 'value' }), ev(PAID)], { formula: 'A / B', filters: [notGuestList], trendsFilter: { ...euro, decimalPlaces: 2 } }));
  N('Visiteurs uniques', "Personnes distinctes sur l'app, le web et la landing. Partiel : visiteurs ayant accepté la mesure d'audience.", number([ev('$pageview', { math: 'dau' })]));
  N('Soirées publiées', 'Soirées passées en ligne dans la période (Console club + organisateur).' + ONLY_AFTER_DEPLOY, number([ev('pro_event_published')]));
  N('Clubs actifs', 'Clubs ayant eu au moins une commande ou inscription dans la période.', number([ev(PAID, { math: 'hogql', math_hogql: 'count(distinct properties.venue_id)' })]));
  N('Organisateurs actifs', 'Organisateurs ayant eu au moins une commande ou inscription dans la période.', number([ev(PAID, { math: 'hogql', math_hogql: 'count(distinct properties.organizer_user_id)' })]));
  N('Nouveaux comptes clients', 'Comptes créés sur Yuno (app ou web), hors pros. Partiel : navigateurs ayant accepté la mesure.', number([ev('user_signed_up')], { filters: [p('is_pro', 'true', 'is_not', 'person')] }));
  N('Nouveaux pros', 'Comptes pro créés en libre-service depuis la landing (club ou organisateur).', number([ev('pro_signup_account_created')]));
  N("Part des achats dans l'app", "Commandes payées depuis l'app iPhone Yuno ÷ toutes les commandes, en %.", number([ev(PAID, { properties: [p('surface', 'ios_app')] }), ev(PAID)], { formula: 'A / B * 100', filters: [notGuestList], trendsFilter: { aggregationAxisFormat: 'numeric', aggregationAxisPostfix: ' %', decimalPlaces: 0 } }));

  // 2 · Ventes
  H('2 · Ventes — combien vend la marketplace ?', "Où va l'argent : par pilier, par pays, par ville, par soirée. Décide où pousser l'effort commercial.");
  T("CA par semaine, par pilier", "Chiffre d'affaires hebdomadaire empilé : billets, tables, guest list (0 €), boissons.", trend({ series: [ev(PAID, { math: 'sum', math_property: 'value' })], breakdown: 'pillar', display: 'ActionsBar', trendsFilter: { ...euro } }), 8, 7);
  T('Répartition par pilier', 'Part de chaque pilier dans le CA de la période.', trend({ series: [ev(PAID, { math: 'sum', math_property: 'value' })], breakdown: 'pillar', display: 'ActionsPie', trendsFilter: { ...euro } }), 4, 7);
  T('France vs Espagne', 'CA hebdomadaire par pays de la soirée (market_country : fuseau de la soirée, ville en repli).', trend({ series: [ev(PAID, { math: 'sum', math_property: 'value' })], breakdown: 'market_country', trendsFilter: { ...euro } }));
  T('Panier moyen par pays', 'CA ÷ commandes payées, par pays de la soirée.', trend({ series: [ev(PAID, { math: 'sum', math_property: 'value' }), ev(PAID)], formula: 'A / B', breakdown: 'market_country', display: 'ActionsBarValue', filters: [notGuestList], trendsFilter: { ...euro, decimalPlaces: 2 } }));
  T('Top villes', 'CA de la période par ville de la soirée, du plus grand au plus petit.', trend({ series: [ev(PAID, { math: 'sum', math_property: 'value' }), ev(PAID)], breakdown: 'market_city', display: 'ActionsTable', trendsFilter: { ...euro } }));
  T('Top soirées', 'CA de la période par soirée (titre public).', trend({ series: [ev(PAID, { math: 'sum', math_property: 'value' }), ev(PAID)], breakdown: 'event_title', display: 'ActionsTable', trendsFilter: { ...euro } }));

  // 3 · Tunnel
  H("3 · Tunnel d'achat — où perd-on les acheteurs ?", "De la découverte au paiement, par surface. Décide quel écran corriger en premier. Partiel : visiteurs ayant accepté la mesure d'audience." );
  T('Tunnel explore → soirée → paiement → payé', 'Part des visiteurs qui passent chaque étape en 14 jours, par surface.' + ONLY_AFTER_DEPLOY, funnel({ steps: [ev('explore_viewed'), ev('event_viewed'), ev('checkout_started'), ev(PAID)], breakdown: 'surface' }), 8, 8);
  T('Abandon dans le paiement', 'Paiement commencé → coordonnées → carte → payé : où les acheteurs décrochent.' + ONLY_AFTER_DEPLOY, funnel({ steps: [ev('checkout_started'), ev('checkout_step_completed', { properties: [p('step', 'details')] }), ev('checkout_step_completed', { properties: [p('step', 'payment')] }), ev(PAID)], windowDays: 1 }), 4, 8);
  T('Soirée vue → achat, par pilier', "Part des visiteurs d'une soirée qui paient, pilier par pilier.", funnel({ steps: [ev('event_viewed'), ev('checkout_started'), ev(PAID)], breakdown: 'pillar' }));
  T('Soirée vue → achat, par pays', "Même tunnel, par pays de la soirée.", funnel({ steps: [ev('event_viewed'), ev('checkout_started'), ev(PAID)], breakdown: 'market_country' }));

  // 4 · Surfaces
  H('4 · Surfaces — app Yuno, web app ou landing ?', "Qui utilise quoi, et où l'on achète. Décide où investir : app, web ou landing.");
  T('Utilisateurs actifs par surface', 'Personnes actives sur 7 jours glissants, par surface (app iPhone, web app, PWA, landing, Console, app Pro).', trend({ series: [ev('$pageview', { math: 'weekly_active' })], breakdown: 'surface', interval: 'day' }));
  T('Achats et CA par surface', "Où l'argent est dépensé : web app, PWA ou app iPhone.", trend({ series: [ev(PAID, { math: 'sum', math_property: 'value' }), ev(PAID)], breakdown: 'surface', display: 'ActionsTable', trendsFilter: { ...euro } }));
  T('Rétention selon la surface', "Part des nouveaux visiteurs qui reviennent la semaine N, selon la surface de leur première visite.", retention({ target: '$pageview', returning: '$pageview', period: 'Week', total: 13, breakdown: 'surface' }), 12, 8);
  T('Parcours landing → app', "Landing vue → web app → clic App Store → app ouverte. Partiel : la landing est sans cookie, le parcours ne se relie qu'une fois la personne connectée.", funnel({ steps: [ev('$pageview', { properties: [p('surface', 'landing')] }), ev('$pageview', { properties: [p('surface', 'web_app')] }), ev('app_store_clicked'), ev('app_opened')], windowDays: 30 }), 12, 7);
  T('App iPhone : ouvertures par version', "Ouvertures de l'app (icône, notification, lien) par version en circulation." + ONLY_AFTER_DEPLOY, trend({ series: [ev('app_opened')], breakdown: 'app_version', display: 'ActionsBar', interval: 'day' }));
  T('Landing : langue et clics', 'Visiteurs de la landing par langue, et CTA cliqués.', trend({ series: [ev('$pageview', { math: 'dau', properties: [p('surface', 'landing')] }), ev('landing_cta_clicked')], breakdown: 'landing_lang', display: 'ActionsBarValue' }));

  // 5 · Communauté
  H('5 · Communauté — les clients reviennent-ils ?', 'Nouveaux, revenants, fidélité après un premier achat. Décide des campagnes de rétention.');
  T('Nouveaux vs revenants', 'Acheteurs par semaine : nouveaux, revenants, de retour, perdus. Partiel : acheteurs ayant accepté la mesure.', lifecycle(PAID));
  T('Sorties par mois', "Nombre de soirées par acheteur et par mois, depuis la base (acheteurs uniques, invités compris)." , WH
    ? sql(`SELECT n AS soirees, count() AS acheteurs FROM (SELECT buyer_key, toStartOfMonth(paid_at) m, count(DISTINCT event_id) n FROM ${WH}tickets WHERE status = 'paid' AND paid_at >= now() - INTERVAL 180 DAY GROUP BY buyer_key, m) GROUP BY n ORDER BY n`)
    : trend({ series: [ev(PAID, { math: 'dau' })], interval: 'month', display: 'ActionsBar' }));
  T('Rétention après un 1er achat', 'Part des acheteurs qui achètent à nouveau le mois N après leur premier achat.', retention({ target: PAID, returning: PAID, period: 'Month', total: 7 }), 12, 8);
  T('Recherches sans résultat', 'Ce que les gens cherchent sans trouver (villes, clubs, artistes) : la demande sans offre.' + ONLY_AFTER_DEPLOY, trend({ series: [ev('search_performed')], breakdown: 'query', display: 'ActionsTable', filters: [p('has_results', 'false')] }));
  T('Favoris et suivis', 'Soirées ajoutées en favori, clubs / organisateurs suivis.' + ONLY_AFTER_DEPLOY, trend({ series: [ev('favorite_toggled', { properties: [p('favorited', 'true')] }), ev('follow_toggled', { properties: [p('following', 'true')] })], display: 'ActionsBar' }));

  // 6 · Offre
  H('6 · Offre — la marketplace grandit-elle ?', "Soirées, clubs, capacité et adoption des pros, lus dans la base Yuno (copiée chaque jour). Décide qui accompagner.");
  if (WH) {
    T('Soirées publiées par semaine et pays', 'Soirées mises en ligne (published_at) par semaine, par pays du lieu.', sql(`SELECT toStartOfWeek(published_at) AS semaine, coalesce(market_country, '?') AS pays, count() AS soirees FROM ${WH}events WHERE published_at >= now() - INTERVAL 180 DAY GROUP BY semaine, pays ORDER BY semaine`, 'ActionsBar'));
    T('Clubs et organisateurs actifs', 'Clubs et organisateurs ayant au moins une soirée publiée à venir ou dans les 30 derniers jours.', sql(`SELECT countIf(DISTINCT venue_id, venue_id IS NOT NULL) AS clubs, countIf(DISTINCT organizer_user_id, organizer_user_id IS NOT NULL) AS organisateurs FROM ${WH}events WHERE is_published AND start_at >= now() - INTERVAL 30 DAY`));
    T('Liquidité', 'Part des soirées publiées (passées, 90 j) avec au moins une vente ou inscription.', sql(`SELECT round(100 * countIf(s > 0) / count(), 1) AS pct_soirees_avec_vente, count() AS soirees FROM (SELECT e.event_id, (SELECT count() FROM ${WH}tickets t WHERE t.event_id = e.event_id AND t.status = 'paid') + (SELECT count() FROM ${WH}table_reservations r WHERE r.event_id = e.event_id AND r.status = 'paid') + (SELECT count() FROM ${WH}guest_list_entries g WHERE g.event_id = e.event_id) AS s FROM ${WH}events e WHERE e.is_published AND e.start_at < now() AND e.start_at >= now() - INTERVAL 90 DAY)`));
    T('Capacité mise en vente vs vendue', 'Billets mis en vente (paliers) et vendus, soirées des 90 derniers jours et à venir.', sql(`SELECT e.market_country AS pays, sum(r.max_tickets) AS mis_en_vente, sum(r.tickets_sold) AS vendus, round(100 * sum(r.tickets_sold) / nullIf(sum(r.max_tickets), 0), 1) AS pct FROM ${WH}ticket_rounds r JOIN ${WH}events e ON e.event_id = r.event_id WHERE e.start_at >= now() - INTERVAL 90 DAY GROUP BY pays`));
  } else {
    for (const n of ['Soirées publiées par semaine et pays', 'Clubs et organisateurs actifs', 'Liquidité', 'Capacité mise en vente vs vendue']) {
      S.push({ text: `**${n}**\n\nSe remplira quand l'entrepôt (base Yuno → PostHog) sera branché.`, w: 6, h: 5 });
    }
  }
  T('Tunnel pro', "Inscription landing → compte → Console → Stripe → 1re soirée publiée, avec le délai médian entre étapes.", funnel({ steps: [ev('pro_signup_opened'), ev('pro_signup_account_created'), ev('$pageview', { properties: [p('surface', 'console')] }), ev('stripe_connect_completed'), ev('pro_event_published')], windowDays: 60 }), 12, 8);
  T('Adoption des fonctionnalités', 'Pros qui ont utilisé chaque outil dans la période.' + ONLY_AFTER_DEPLOY, trend({ series: [
    ev('pillar_toggled', { math: 'dau', name: 'Piliers activés', properties: [p('enabled', 'true')] }),
    ev('promo_code_created', { math: 'dau' }),
    ev('email_campaign_sent', { math: 'dau' }),
    ev('email_automation_toggled', { math: 'dau', properties: [p('enabled', 'true')] }),
    ev('push_campaign_sent', { math: 'dau' }),
    ev('sms_campaign_sent', { math: 'dau' }),
  ], display: 'ActionsBarValue' }));
  if (WH) {
    T('Pros à risque', "Clubs et organisateurs sans soirée publiée depuis 30 jours (et aucune à venir).", sql(`SELECT 'club' AS type, v.venue_id AS id, v.market_city AS ville FROM ${WH}venues v WHERE v.is_live AND v.venue_id NOT IN (SELECT venue_id FROM ${WH}events WHERE is_published AND start_at >= now() - INTERVAL 30 DAY AND venue_id IS NOT NULL) UNION ALL SELECT 'organisateur', toString(o.organizer_user_id), o.market_city FROM ${WH}organizers o WHERE o.organizer_user_id NOT IN (SELECT organizer_user_id FROM ${WH}events WHERE is_published AND start_at >= now() - INTERVAL 30 DAY AND organizer_user_id IS NOT NULL)`));
  } else {
    S.push({ text: "**Pros à risque**\n\nSe remplira quand l'entrepôt (base Yuno → PostHog) sera branché.", w: 6, h: 5 });
  }
  T('Console web vs app Pro', 'Pros actifs sur 7 jours glissants : Console (web) et app Yuno Pro.', trend({ series: [ev('$pageview', { math: 'weekly_active' })], breakdown: 'surface', interval: 'day', filters: [p('surface', ['console', 'ios_pro'])] }));
  T('Messages envoyés par les pros', 'Campagnes email, push et SMS envoyées depuis la Console.', trend({ series: [ev('email_campaign_sent'), ev('push_campaign_sent'), ev('sms_campaign_sent')], display: 'ActionsBar' }));

  // 7 · Acquisition
  H("7 · Acquisition — d'où viennent-ils ?", 'Sources, liens promoteurs, notifications, App Store, Instagram. Décide où dépenser.');
  T('Sources par surface', 'Visiteurs par site d’origine (Instagram, Google, direct…).', trend({ series: [ev('$pageview', { math: 'dau' })], breakdown: '$referring_domain', display: 'ActionsTable' }));
  T('Landing par langue', 'Visiteurs de la landing par langue (en / fr / es).', trend({ series: [ev('$pageview', { math: 'dau', properties: [p('surface', 'landing')] })], breakdown: 'landing_lang', interval: 'day' }));
  T('Ventes via promoteurs et affiliés', "CA des commandes attribuées à un promoteur, contre le reste.", trend({ series: [ev(PAID, { math: 'sum', math_property: 'value' }), ev(PAID)], breakdown: 'has_promoter', display: 'ActionsTable', trendsFilter: { ...euro } }));
  T('Notification ouverte → achat', 'Part des notifications ouvertes suivies d’un achat sous 3 jours.', funnel({ steps: [ev('push_opened'), ev(PAID)], windowDays: 3 }));
  T('Web → App Store', 'Bandeau « Télécharger l’app » vu, cliqué, et clics vers l’App Store.' + ONLY_AFTER_DEPLOY, trend({ series: [ev('install_banner_viewed', { math: 'dau' }), ev('install_banner_clicked'), ev('app_store_clicked')], display: 'ActionsBarValue' }));
  T('Instagram /links', 'Visiteurs de la page de bio Instagram (/links) et d’où ils viennent.', trend({ series: [ev('$pageview', { math: 'dau', properties: [p('$pathname', '/links')] })], breakdown: 'utm_source', interval: 'day' }));

  // 8 · Santé
  H("8 · Santé — qu'est-ce qui casse ?", 'Paiements refusés, erreurs, pages quittées. Décide ce qu’on répare cette semaine.');
  T('Paiements en échec, par pilier', 'Checkouts qui ont échoué avant Stripe (code court de l’erreur).' + ONLY_AFTER_DEPLOY, trend({ series: [ev('checkout_failed')], breakdown: 'pillar', display: 'ActionsBar', interval: 'day' }));
  T('Erreurs JS par surface et version', "Erreurs JavaScript captées (app, web, Console), par surface et version d'app." + ONLY_AFTER_DEPLOY, trend({ series: [ev('$exception')], breakdown: 'surface', display: 'ActionsBar', interval: 'day' }));
  T('Pages les plus quittées', 'Pages où la visite se termine le plus souvent.', trend({ series: [ev('$pageleave')], breakdown: '$pathname', display: 'ActionsTable' }));
  S.push({
    text: [
      '**Replays des paiements abandonnés**',
      "Dans PostHog → Session replay, filtrez : événement `checkout_started` ET pas d'événement `order_paid_server`, surface ∈ web_app / pwa / ios_app. Les replays ne sont JAMAIS enregistrés sur la Console, l'app Pro ni le super admin, et tous les champs de saisie sont masqués.",
    ].join('\n\n'),
    w: 6,
    h: 7,
  });
  return S;
}

// ── Construction ───────────────────────────────────────────────────────────
async function main() {
  const me = await api('GET', '/api/users/@me/');
  const projectId = me.team?.id ?? me.team?.project_id;
  if (!projectId) throw new Error('Projet PostHog introuvable');
  console.log(`Projet ${me.team?.name} (${projectId})`);

  // Comptes « de test » = démo + super admin : exclus de chaque insight.
  await api('PATCH', `/api/projects/${projectId}/`, {
    test_account_filters: [
      { key: 'is_demo', value: ['true'], operator: 'is_not', type: 'event' },
      { key: 'surface', value: ['admin'], operator: 'is_not', type: 'event' },
    ],
    test_account_filters_default_checked: true,
  });

  const list = await api('GET', `/api/projects/${projectId}/dashboards/?limit=200`);
  let dash = (list.results ?? []).find((d) => d.name === NAME && !d.deleted);
  const description = 'Produit ET marketplace, par pays et par surface. Une section = une question. Argent = serveur ; comportement = navigateur / app (avec consentement) ; démo exclue.';
  if (!dash) {
    dash = await api('POST', `/api/projects/${projectId}/dashboards/`, { name: NAME, description, pinned: true, filters: { date_from: '-30d' }, tags: [TAG] });
  } else {
    // Vider : insights du script supprimés, tuiles texte retirées.
    const full = await api('GET', `/api/projects/${projectId}/dashboards/${dash.id}/`);
    for (const tile of full.tiles ?? []) {
      if (tile.insight?.id) await api('PATCH', `/api/projects/${projectId}/insights/${tile.insight.id}/`, { deleted: true });
    }
    await api('PATCH', `/api/projects/${projectId}/dashboards/${dash.id}/`, {
      description,
      pinned: true,
      filters: { date_from: '-30d' },
      tiles: (full.tiles ?? []).filter((t) => t.text).map((t) => ({ id: t.id, deleted: true })),
    });
  }
  console.log(`Dashboard ${dash.id}`);

  // Placement sur 12 colonnes, ligne par ligne, hauteur de ligne = tuile la plus haute.
  const items = sections();
  let x = 0;
  let y = 0;
  let rowH = 0;
  const placed = items.map((it) => {
    if (x + it.w > 12) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    const layout = { x, y, w: it.w, h: it.h };
    x += it.w;
    rowH = Math.max(rowH, it.h);
    return { ...it, layout };
  });
  // Deux tuiles côte à côte ont la même hauteur : on aligne chaque ligne.
  const rows = new Map();
  for (const it of placed) rows.set(it.layout.y, Math.max(rows.get(it.layout.y) ?? 0, it.layout.h));
  for (const it of placed) it.layout.h = rows.get(it.layout.y);

  const layouts = [];
  let failures = 0;
  for (const it of placed) {
    if (it.text) {
      const d = await api('PATCH', `/api/projects/${projectId}/dashboards/${dash.id}/`, { tiles: [{ text: { body: it.text }, layouts: {} }] });
      const tile = [...d.tiles].reverse().find((t) => t.text?.body === it.text);
      layouts.push({ id: tile.id, layouts: { sm: it.layout, xs: { x: 0, y: it.layout.y, w: 1, h: it.layout.h } } });
      continue;
    }
    try {
      const ins = await api('POST', `/api/projects/${projectId}/insights/`, {
        name: it.name,
        description: it.description,
        query: it.query,
        dashboards: [dash.id],
        tags: [TAG],
      });
      const d = await api('GET', `/api/projects/${projectId}/dashboards/${dash.id}/`);
      const tile = d.tiles.find((t) => t.insight?.id === ins.id);
      layouts.push({ id: tile.id, layouts: { sm: it.layout, xs: { x: 0, y: it.layout.y, w: 1, h: it.layout.h } } });
      console.log(`  ✓ ${it.name}`);
    } catch (e) {
      failures += 1;
      console.error(`  ✗ ${it.name}: ${e.message}`);
    }
  }
  await api('PATCH', `/api/projects/${projectId}/dashboards/${dash.id}/`, { tiles: layouts });

  // Accueil du projet.
  await api('PATCH', `/api/projects/${projectId}/`, { primary_dashboard: dash.id });
  console.log(`\n${HOST}/project/${projectId}/dashboard/${dash.id}${failures ? `  (${failures} tuile(s) en échec)` : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
