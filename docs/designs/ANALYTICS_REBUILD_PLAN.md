# Analytics v3 — audit, mapping et plan de reconstruction (2026-09-30)

Brief : reconstruire l'onglet Analytics de la Console (club + organisateur)
selon la spec « Analytics Yuno » (7 sous-onglets, comparatif sur chaque
chiffre, pacing J-n, tunnel, RFM, mode Ce soir, digests). État constaté :
l'onglet existe (plan Shotgun 24/09, simplification 25/09, périodes 30/09)
mais il est jugé illisible et souvent vide. Ce document est l'audit, le
mapping concept → table, et le plan. **Rien n'est codé tant que la phase 1
n'est pas validée.**

---

## 0. Verdict en dix lignes

1. **Rien n'est perdu.** `src/pages/OwnerAnalytics.tsx` (28 Ko), 30 composants
   dans `src/components/analytics/`, 20 hooks, 30 RPC SQL, 9 fichiers de
   tests. Tout est sur `main`, déployé, et répond (vérifié le 30/09 :
   `get_sales_overview`, `get_traffic_period`, `get_community_period`,
   `get_analytics_event_rail`, `get_purchase_behavior`, `get_live_view`
   rendent 200 sur la base liée).
2. **La donnée existe.** Base liée au 30/09 : 36 431 `visitor_sessions`
   (14 965 depuis le 1er sept.), 57 755 `event_funnel_events` (25 504 depuis
   le 1er sept.), 9 220 billets, 7 634 commandes bar, 3 077 inscrits guest
   list, 1 773 clics de liens suivis, 138 conversions promoteur, 117 841
   événements email. Le tunnel de la phase 2 de la spec est **déjà mesuré**.
3. **Le problème est la présentation, pas la plomberie.** Ce que la capture
   du 30/09 montre : rouge de marque utilisé comme couleur de donnée, deux
   décimales partout (« 50 633,00 € »), vert/rouge pour les deltas, un
   « vs les 9 d'avant » qui compare 9 soirées à 9 soirées quelles qu'elles
   soient (un mercredi à un samedi), une colonne « vs préc. » qui compare
   chaque soirée à la précédente dans le temps, 0 entrée affiché comme un
   chiffre alors que la soirée n'a pas été scannée, aucune sparkline,
   aucune valeur de référence à côté du delta, aucun insight, aucune action.
4. **Ce que la spec demande et qui manque vraiment** : comparaison par soirée
   COMPARABLE (même jour de semaine / même format), pacing J-n avec bande de
   prévision, statut vert/jaune/rouge, heatmap jour × heure (existe dans
   « Achats », mal placée), part last-minute, courbe d'arrivées par 15 min,
   présence par type, funnel horizontal par étape, attribution figée SUR la
   commande, revenu par visiteur, encart « ce que Yuno t'a apporté », clics
   sortants des clubs en redirection, leaderboard promoteurs avec présence et
   nouveaux clients, RFM en langage club avec bouton campagne, cohortes,
   insights par règles, export CSV, mode Ce soir mobile, filtres globaux
   (soirée / période / comparer à / canal), sous-onglets nommés par la spec.
5. **Ce qui existe déjà et se réutilise tel quel** : le kit
   (`KpiTile`, `DeltaBadge`, `AnswerLine`, `Takeaways`, `RankedList`,
   `BulletBar`, `EmptyAnswer`, `MoreDetail`), le dictionnaire de métriques
   `src/lib/metrics.ts` (testé), la règle de CA `fees.ts`, `_door_headcount`,
   `_venue_customer_rfm`, `get_email_campaign_attribution`,
   `get_audience_push_attribution`, `get_tracked_link_stats`,
   `get_live_view`, `night_recap_data` (le récap du lendemain de la spec §4.9
   existe déjà en cloche + push), le moteur de rail `get_analytics_event_rail`.
6. **Nuit 12:00 → 11:59** : la règle existe pour les soirées externes
   (`affiliate_night_date`, `currentNightDate`) et pour Paris
   (`paris_night_date`), mais les RPC d'analyse groupent par `start_at` de la
   soirée, pas par nuit. Une vente à 2 h du matin est bien rattachée à la
   soirée (elle porte `event_id`), donc la règle est respectée DE FAIT pour
   tout ce qui est event-scopé. Elle manque pour les commandes bar sans
   soirée (`orders.event_id` NULL) et pour les heatmaps « jour × heure ».
7. **Fuseau** : `events.timezone` et `venues.timezone` existent ; les RPC
   récentes (`get_events_sales_summary`, `get_event_report`) les lisent.
8. **RGPD** : mesure d'audience sans consentement = `visitor_sessions` et
   `event_funnel_events` sont gatés par le consentement analytics du CMP
   (`hasAnalyticsConsent`), donc PLUS strict que la spec §8. Le `user_id`
   n'est écrit sur les sessions que si connecté. À décider : ouvrir la
   mesure d'audience agrégée à l'exemption CNIL (sans `user_id`, 13 mois,
   25 mois) pour que le tunnel voie 100 % des visites au lieu des seuls
   consentants.
9. **Redirection externe** : `affiliate_events` + `affiliate_clicks`
   (96 lignes) portent vues et clics ; les vues sont dans `visitor_sessions`
   (`entry_page_type`). Aucun revenu inventé aujourd'hui : ces clubs ne sont
   pas des `venues`, ils n'ont pas de Console club. L'analyse « vues → clics
   → CTR » vit dans `/affiliate/*`, hors Analytics.
10. **Pourquoi « aucune donnée »** — vérifié sur Amoris le 1er octobre : 2
    soirées, 0 vente, 16 visites de page (dont une moitié de robots Meta
    depuis des villes américaines), 0 événement de tunnel. L'écran était vide
    parce qu'il n'y avait rien à montrer, et il ne le disait pas. Le v3 le dit
    (état vide pédagogique par carte). Les autres raisons restent vraies : (a) Ventes ne compte que les soirées
    TERMINÉES (une soirée à venir n'y est pas), (b) Trafic et Communauté ne
    comptent que les visites CONSENTIES, (c) `get_sales_overview` compare au
    même nombre de soirées d'avant et se tait sans historique, (d) plusieurs
    vues chargent ~70 requêtes en série. Le nouvel écran doit dire POURQUOI
    c'est vide et ce qui va apparaître (spec §3.10) au lieu d'un tiret.

---

## 1. Audit de la stack

| Sujet | Constat |
|---|---|
| Front | Vite 8 + React 18 + TS + shadcn/ui + Tailwind, SPA. Routing `react-router-dom` 6. `@tanstack/react-query` 5 présent mais Analytics tourne surtout sur des hooks maison (`useAnalyticsData` 50 Ko, en série). |
| Charts | `recharts` 2.15.4 partout. Aucun `PieChart` / `RadialBar` dans Analytics (bon). Animations actives (à couper pour les captures et la lisibilité). |
| Thème | Dashboards pro = sombre par défaut ET clair (`pro-theme.css`, tokens `--ink`, `--sf-*`, `--acc-*`). La spec dit « dark-first » ; le clair reste obligatoire (décision du 24/09). |
| Backend | Supabase (Postgres + RLS + 106 edge functions). Cap edge atteint (402) : **aucune nouvelle fonction edge**, tout en SQL/RPC + crons existants. |
| Auth / rôles | `user_roles` (13 rôles). Analytics : `/owner/analytics` (`PlanGuard analytics_basic`), `/manager/analytics`, `/organizer-app/analytics` (`requires="viewInsights"`), `/agency-app/analytics`, `/affiliate/analytics`, `/dj/analytics`, promoteur `PromoterEventAnalysis`. Portes SQL : `analytics_scope_gate(venue, org)`, `event_analytics_scope(event)`, argent par `tracked_link_team_sees_money` / `coorg_sees_event_money`. |
| URL | `?tab=sales\|traffic\|community\|live&view=…&period=…&event=<id>` (`analyticsNav.ts`, `analyticsPeriod.ts`, testés). Anciennes adresses traduites. **À garder** : liens déjà émis dans des alertes, emails, aide. |
| i18n | `owner.an.*`, `so.*`, `er.*`, `pb.*`, `gl.*`, `m.*`, `lv.*` dans `src/i18n/data.ts` (3 langues). |
| Tests | `metrics`, `analyticsNav`, `analyticsPeriod`, `eventReport`, `eventFunnel`, `purchaseBehavior`, `communityAnalytics`, `eventCommunity`, `shortPeriods`. |
| Démo | `scripts/demo/seed-past-nights.sql`, `seed-upcoming-sales.sql`, `seed-event-funnel.sql` (rejouables). Le seed de la spec §10 existe. |
| Docs | `docs/designs/SHOTGUN_COMPETITIVE_PLAN.md`, `ANALYTICS_SIMPLIFICATION_PLAN.md` (inventaire des 150 blocs et des 13 noms de CA — à lire, il explique l'état actuel). |

---

## 2. Mapping concept → table.colonne

Vérifié dans `src/integrations/supabase/types.ts` et `supabase/migrations/`.
Statuts « payé » de la compta : billets `paid/used`, tables `paid/confirmed`,
bar `paid/served`. CA club = `fees.ts` (billets `total_price − service_fee −
insurance_fee`, tables `total_price − service_fee − (fee_absorbed ?
management_fee : 0)`, bar `total − service_fee`, remboursement déduit).

| Concept (spec) | Table.colonne | Notes / manque |
|---|---|---|
| Club | `venues` (`id, timezone, owner_id, is_hidden, stripe_*`) | Capacité du club : **absente** (pas de colonne `capacity`). |
| Orga | `organizer_profiles.user_id` ; portée = `useActingOrganizer()` | |
| Soirée | `events` (`start_at, end_at, timezone, max_tickets, entry_target, venue_id, organizer_user_id, partner_*, published_at, ticket_selling_mode`) | Jauge = `max_tickets` (NULL = illimitée) + `ticket_rounds.max_tickets` par palier. « Format » de soirée pour les comparables : `event_type`, `music_genres`, `recurring_template_id`, jour de semaine de `start_at` (local). |
| Type de billet / palier | `ticket_rounds` (`price, max_tickets, tickets_sold, is_active, sale_starts_at, sale_ends_at, position, hidden, ticket_type, is_group`) | « Temps pour épuiser » : pas de `sold_out_at` ; se calcule au `paid_at` du dernier billet du palier. |
| Commande billets | `tickets` (`status, paid_at, created_at, total_price, unit_price, quantity, service_fee, insurance_fee, refund_amount, refunded_at, ticket_round_id, user_id, user_email, is_guest, purchase_source, tracked_link_id, promo_code_id, entry_scanned, entry_scanned_at, used, used_at`) | Une ligne = une commande de N places (`quantity`). Pas de table `orders` pour les billets. |
| Tables VIP | `table_reservations` (`status, paid_at, deposit, total_price, minimum_spend, guest_count, pack_id, zone_id, table_id, checked_in_at, entry_scanned_at, placed_at, finished_at, placement_status, refund_amount, payment_mode, tracked_link_id, purchase_source`) + `table_packs` + `table_zones` | Acompte = `deposit` ; solde encaissé sur place : **absent** (pas de colonne « solde payé »). Dépense réelle de la table = `vip_table_orders.total_amount` (commandes servies à table) — couverture partielle. |
| Bar | `orders` (`status, paid_at, total, service_fee, items jsonb, venue_id, event_id NULL possible, served_at, refund_amount, purchase_source, tracked_link_id`) | Pas d'`order_items` : les lignes sont dans `items` jsonb. Rattachement à la nuit : par `event_id`, sinon par `paid_at` avec la règle 12:00 → 11:59 (à créer). |
| Guest list | `guest_lists` + `guest_list_entries` (`status, entry_scanned, entry_scanned_at, entry_type, promoter_id, tracked_link_id, user_id, email, gender`) | |
| Scans | `tickets.entry_scanned_at`, `table_reservations.entry_scanned_at / checked_in_at`, `guest_list_entries.entry_scanned_at` ; comptage `_door_headcount(event)` | Aucune table `scans` : le scan est un horodatage sur la vente. Courbe d'arrivées par 15 min = `date_trunc` sur ces trois colonnes. |
| Clients / CRM | `venue_customers` (club : `first_visit_at, last_visit_at, ticket_count, table_count, order_count, total_spent, customer_segment`) ; base vivante `contact_rows` (import ∪ Yuno) ; RFM = `_venue_customer_rfm` (club) et `get_organizer_customer_segments` (orga) | « Nouveau client » = première vente / premier scan dans la portée (déjà la définition de `get_community_overview`). Âge : `orders.age_declaration_birth_date`, `imported_contacts.age`, `profiles` (quiz) — couverture faible. Genre : `guest_list_entries.gender` seulement. Ville : `visitor_sessions.city`, `imported_contacts.city`. |
| Promoteurs | `promoters`, `promoter_conversions` (`promoter_id, ticket_id, table_reservation_id, order_id, guest_list_entry_id, amount, commission, status, conversion_type`), `tracked_links.promoter_id` | Présence des clients d'un promoteur = joindre la conversion à la vente scannée (faisable). Commission due = `promoter_conversions.commission` par statut. |
| Liens / UTM | `tracked_links` (`code, utm_source/medium/campaign, promoter_id, event_id, owner_kind`), `tracked_link_clicks` (`clicked_at, visitor_id, device_type, referrer`) | |
| Sessions / visites | `visitor_sessions` (`session_id, visitor_id, visited_at, entry_page_type, event_id, venue_id, organizer_user_id, referrer_category, referrer_domain, utm_*, device_type, city, country_code, proceeded_to_checkout, completed_order, order_id, is_returning`) | **Consentement requis** (CMP). Pas de dédup 30 min explicite ; `visit_number` porte la récurrence. |
| Tunnel | `event_funnel_events` (`session_id, event_id, step ∈ viewed/selected/checkout/details/payment/purchased/failed/waitlist/shared/followed, pillar, amount_cents, device, source, created_at`) écrit par `track_event_funnel` via `capturePosthog` | Pas de `page_view` club ni marketplace (le tunnel commence à la page soirée). `purchased` = retour navigateur après paiement, PAS le webhook. |
| Attribution sur la vente | `tickets/table_reservations/orders.purchase_source` (`direct`, `manual`, `manual_open`, …), `tracked_link_id`, `promo_code_id`, `promoter_conversions` | **Manque** : `attribution_source` + `attribution_ref` figés au paiement avec la priorité de la spec §5 (promoteur > lien/UTM > email > marketplace > référent > direct). Aujourd'hui l'attribution est recalculée à la lecture (`get_event_party_links`, `get_email_campaign_attribution` : clic → achat < 72 h). |
| Campagnes email | `email_campaigns` (`sent_at, recipients_count, delivered_count, clicks_count, clickers_count, opens_count, event_id`), `email_campaign_recipients`, `email_campaign_events` (`event_type, metadata.click.link`) ; attribution `get_email_campaign_attribution` | Ouvertures déjà comptées par Resend (pixel) : à masquer / marquer « partiel ». |
| Push | `push_campaigns`, `push_campaign_events`, `get_push_center` | |
| Redirection externe | `affiliate_events` (`external_ticket_url, event_date`), `affiliate_clicks` (`clicked_at, browser_id`), vues dans `visitor_sessions` | Hors Console club (les clubs de Madrid ne sont pas des `venues`). |
| Argent Stripe | `revenue_distributions` (`gross_amount_cents, yuno_fee_cents, stripe_fee_real_cents, item_type`) | Sert au test « au centime vs Stripe » de la spec §10. |
| Rollups | **Aucun** (pas de `analytics_daily_event_stats`, ni `analytics_hourly_scans`, ni `customer_club_stats`). Tout est calculé à la volée dans des RPC STABLE. Il existe des vues `analytics_wh.*` (PostHog, hors Console). | Volume actuel (< 60 k lignes de tunnel, < 10 k ventes) : les RPC tiennent. Rollups en phase 2 pour la courbe J-n et la heatmap seulement. |
| Nuit 12:00 → 11:59 | `affiliate_night_date()`, `paris_night_date()`, `currentNightDate()` | Pas de fonction générique `night_date(ts, tz)`. À créer. |
| Take-rate Yuno | `service_fee` sur chaque vente ; `_shared/commission.ts` | La spec dit max(0,99 € ; 4 %) : à confirmer contre `commission.ts` avant tout affichage « hors take-rate ». |

**Absent et à créer** : `night_date(ts, tz)`, `attribution_source/ref` figés,
`event.comparable_key` (jour de semaine + format), rollups J-n, capacité
club, solde de table encaissé, `page_view` club / marketplace.

---

## 3. Ce que la spec demande, onglet par onglet, contre l'existant

| Sous-onglet spec | Existant | Manque |
|---|---|---|
| Vue d'ensemble | `SalesOverviewView` : phrase-réponse, 4 KPI + delta, CA par soirée, « D'où vient le CA », tableau des soirées. | Comparaison par soirée COMPARABLE et sa valeur de référence ; sparklines ; taper une KPI change le graphe ; sell-through avec jauge ; conversion ; part de nouveaux ; bandeau d'insights ; courbe J-n courante vs médiane + bande ; breakdowns en drawer ; export CSV. |
| Ventes | Rapport de soirée (`get_event_report` : courbe J-n, référence = soirée précédente, repères, objectif, rythme). Heatmap dans Communauté › Achats. | Statut vert/jaune/rouge à J-n ; prévision de fin min–max ; temps pour épuiser chaque palier ; part last-minute (7 j / 48 h / J) ; heatmap ici ; small multiples des soirées passées. |
| Sources | `TrafficView` / `TrafficLens` : sources de la page, tunnel par soirée, fuites. | Funnel horizontal par étape avec chute ; tableau par source avec revenu par visiteur ; encart « ce que Yuno t'a apporté » ; page club et marketplace dans le tunnel ; clubs en redirection. |
| Audience | `CommunityOverviewView`, `AudienceDashboard`, `EventAudienceDemographics`, RFM (`get_venue_customer_segments`). | RFM en langage club (Piliers, Fidèles…) avec bouton « Créer une campagne » ; cohortes ; k-anonymat < 10 partout ; top villes. |
| Porte & tables | `get_door_counters`, `_door_headcount`, `VipTablesPillar`, `VipConsumptionSection`, guest list analytics (43 Ko). | Courbe d'arrivées par 15 min ; présence par type ; guest list → achat 90 j ; revenu par personne présente ; dépense vs minimum par zone. |
| Promoteurs | `usePromoterAnalytics`, Ventes › Partenaires, `VipHostLeaderboard`. | Présence de leurs clients, part de nouveaux, tri par revenu, vue affiliée filtrée. |
| Campagnes | Rapport par campagne dans `/campaigns`, `get_email_campaign_attribution`, `get_push_center`. | Vue consolidée dans Analytics ; fenêtre 3 j / 7 j ; ouvertures « partielles ». |
| Ce soir | `LiveView` (globe Mapbox, 4 s) + `get_staff_night_pulse`. | Grands chiffres mobile-first, alertes (table non honorée, pic à la porte). |
| Digests | `night_recap` (cloche + push, 11 h → 20 h), `audience_weekly_recap`. | Email du lendemain et hebdo du lundi avec segment actionnable. |

---

## 4. Direction de design

Références relevées le 30/09 : Stripe (tables d'abord, un chiffre par carte,
comparatif sous la valeur), Plausible (une page, six chiffres, une courbe,
listes classées), Linear / Vercel (dark-first, monochrome, la couleur = un
sens), Mercury / Ramp (confiance : chiffres tabulaires, peu de couleur),
efferd.com/blocks (rangée KPI + grille 2-3 cartes + tableau en dessous,
barre d'outils contextuelle). La capture Dribbble fournie (Fundora / Spendly)
donne la même grammaire en clair : sidebar sobre, 3-4 tuiles, une grande
courbe, un tableau.

Ce que ça donne pour Yuno, en respectant `docs/DESIGN_SYSTEM.md` (thème
sombre ET clair, tokens `--ink` / `--sf-*` / `--acc-*`) :

- **Une seule couleur de série** : `--acc-*` désaturé (à choisir : le bleu
  froid `#6E9BFF` en sombre, `#2F5FE0` en clair — jamais le rouge `#E8192C`
  de la marque pour une donnée). Comparaison en gris `rgb(var(--ink)/.35)`.
  Statuts bon / attention / critique en teintes séparées de l'accent. Delta
  positif = bleu, négatif = orange, polarité par métrique
  (`metrics.ts` porte déjà `direction`).
- **Chiffres** : `tabular-nums`, abrégés (« 50,6 k € », « 12,8 k »),
  entiers par défaut, une décimale sous 10, jamais « ,00 ». Cela contredit
  la décision du 29/09 « tout montant à deux décimales » dans les dashboards :
  **à trancher** (proposition : deux décimales dans la Compta et les listes
  de commandes, abrégé dans l'Analyse).
- **Carte KPI** = libellé · valeur · delta + référence (« ▲ +18 % · vs 212
  sam. dernier ») · sparkline 32 px (courante en accent, référence en gris).
  Base < 20 : delta absolu.
- **Graphe principal** 320 px, cartes 180 px, 3 par ligne max, aucun < 200 px.
  Barres horizontales pour tout classement, courbes pour le temps, heatmap
  monochrome. Interdits : donuts, jauges, aires empilées, camembert > 3 parts.
  La barre empilée Billets/Tables de la capture devient deux barres côte à
  côte OU une barre + un chiffre.
- **Deux niveaux** : vue → drawer (tableau complet + export). Pas de
  sous-page.
- **États** : chargement (skeleton même hauteur), vide pédagogique (pourquoi,
  quand, bouton), erreur, rempli. Chaque carte charge seule.
- **Mobile 375 px** : 1 colonne, KPI 2×2, graphe principal dans le premier
  écran, tables en cartes, tooltips au tap, 44 px.
- **Titres = conclusions** ; `AnswerLine` existe, à généraliser à chaque
  carte.

---

## 5. Plan en 3 phases (adapté à ce qui existe)

Principe : **on reconstruit l'écran, on garde les RPC qui sont justes, on
ajoute des RPC là où la spec demande une lecture que personne ne calcule**.
Nouveau code sous `src/components/analytics/v3/` (shell, filtres, cartes) +
`src/lib/analytics/` (règles pures, testées), livré derrière
`?v=3` puis basculé par défaut ; les anciennes vues sont supprimées quand v3
couvre leur question (jamais deux écrans qui se contredisent). Le contrat
d'URL `?tab=&view=&event=&period=` reste, étendu à `&compare=&channel=`.

### Phase 1 — Données existantes, écran neuf (aucun nouveau tracking)

SQL (une migration par fonction, `db lint --linked` après chaque) :
1. `night_date(ts timestamptz, tz text)` (12:00 → 11:59) + miroir
   `src/lib/analytics/night.ts` testé ; `event_comparable_key(event)` = jour
   de semaine local + `event_type` + `recurring_template_id` si présent.
2. `get_analytics_overview(scope, period, compare, event)` : les 6 KPI de la
   spec avec valeur, référence, delta, sparkline (série par soirée ou par
   jour), selon `compare ∈ comparable | median5 | yoy | none`. Formules de
   `fees.ts` / `metrics.ts`, statuts de la compta, remboursements déduits.
3. `get_analytics_pacing(event, compare)` : cumul J-n de la soirée, médiane
   et min–max des comparables, statut (≥ 95 % vert, 80–95 jaune, < 80 rouge),
   repères (publication, paliers, emails, push). Reprend la série de
   `get_event_report`.
4. `get_analytics_sales(scope, period, event)` : paliers (quantité, CA,
   sell-through, temps pour épuiser), part last-minute (7 j / 48 h / J),
   heatmap jour × heure en nuit locale, small multiples.
5. `get_analytics_door(scope, event)` : arrivées par 15 min (les trois
   colonnes `entry_scanned_at`), présence / no-show par type (billet, guest
   list, table), guest list → achat payant 90 j, revenu par personne présente,
   tables : occupation par zone, demandes → acomptes, revenu par table,
   dépense réelle vs minimum (`vip_table_orders`), no-show de tables.
6. `get_analytics_promoters(scope, period, event)` : leaderboard avec clics,
   commandes, billets, CA, conversion, présence de leurs clients, part de
   nouveaux, commission due ; filtre affilié.
7. `get_analytics_audience(scope, period)` : nouveaux vs récurrents par
   soirée, taux de retour 90 j, top clients (portée club seulement), âge par
   tranches et villes avec k-anonymat < 10 (« < 10 »).
8. Test SQL « au centime » : `scripts/demo/smoke-analytics-cents.sql` (DO
   annulé) compare `get_analytics_overview` à `revenue_distributions` et aux
   tables de vente sur 3 soirées démo. Test RLS : un promoteur ne lit pas les
   lignes d'un autre.

Front :
9. Shell v3 : barre de filtres sticky (Soirée · Période · Comparer à ·
   Canal · Exporter CSV), chips actifs, sous-onglets `Vue d'ensemble ·
   Ventes · Sources · Audience · Porte & tables · Promoteurs · Campagnes` +
   bouton `Ce soir`. Sources et Campagnes affichent en phase 1 l'état
   « arrive avec le tunnel » (pas un onglet vide).
10. Cartes : `KpiCard` (sparkline, delta + référence, polarité), `PacingChart`
    (bande, repères, pointillés pour l'incomplet), `HBarList`, `Heatmap`,
    `ArrivalsCurve`, `SmallMultiples`, `Drawer` (tableau + export), 4 états
    par carte, hauteurs fixes, skeletons. Chaque carte = une requête.
11. Export CSV par onglet (client, depuis les données déjà chargées ; `;` +
    BOM comme `rosterExport`).
12. Mobile 375 px vérifié par banc Chrome headless + captures démo
    (`scripts/demo/drive.mjs`).
13. i18n `an3.*` (3 langues), aide `ohelp.pg.analytics.*` mise à jour,
    article assistant, redirections des anciennes vues.

Livrable phase 1 : Vue d'ensemble, Ventes, Porte & tables, Promoteurs,
Audience de base, filtres, comparaison, export, états vides, mobile — club
ET organisateur (même écran, portée par `useVenueContext`).

### Phase 2 — Tunnel et attribution

1. Attribution figée SUR la vente : colonnes `attribution_source`,
   `attribution_ref` sur `tickets`, `table_reservations`, `orders`,
   `guest_list_entries`, posées par un trigger au passage `paid` (priorité
   promoteur > lien/UTM > email > marketplace > référent > direct, lue dans
   `tracked_link_id`, `promo_code_id`, `promoter_conversions`, la session
   `visitor_sessions` et le `yc=` de l'email). Backfill des 9 k ventes.
2. Tunnel complet : ajouter `page_view` club / marketplace à
   `event_funnel_events` (même `capturePosthog`, `src/lib/eventFunnel.ts`),
   débounce 30 min par page et session, exclusion staff / preview / bots.
   Décision RGPD : mesure d'audience agrégée SANS `user_id` sous l'exemption
   CNIL (13 mois, 25 mois, pas de croisement), consentement gardé pour tout
   rattachement à une personne.
3. Rollups : `analytics_daily_event_stats(event_id, day, source, views,
   uniques, checkouts, purchases, revenue)` et `analytics_hourly_scans`
   rafraîchis par `pg_cron` (5 min pour les soirées actives, nuit pour le
   reste) — seulement si les RPC dépassent 300 ms ; mesuré avant.
4. `get_analytics_sources(scope, period, event)` : funnel horizontal
   (club → soirée → sélection → checkout → payé → scanné), tableau par
   source avec revenu par visiteur, encart « Ce que Yuno t'a apporté »
   (ventes attribuées à la marketplace + nouveaux clients découverts par
   Yuno).
5. Clubs en redirection : vues → clics sortants → CTR + bandeau, dans
   `/affiliate/analytics` (leur Console) et dans une carte de la Console du
   club partenaire s'il en a une.
6. Campagnes : `get_analytics_campaigns(scope, period)` — envoyés, délivrés,
   clics, commandes et CA attribués à 3 j et 7 j (`get_email_campaign_
   attribution` étendu), ouvertures affichées « partiel » ou masquées.

### Phase 3 — Intelligence

1. Insights par règles en SQL (`get_analytics_insights` : les 8 règles de
   la spec §7, seuil ≥ 20 observations, ≥ 3 comparables pour le pacing, max 3
   triés par impact, lien vers la carte preuve). Reprend `Takeaways`.
2. Prévision de fin (cumul ÷ part médiane vendue à J-n, fourchette min–max).
3. RFM en langage club : renommer les segments de `_venue_customer_rfm`
   (Piliers, Fidèles, Gros dépensiers occasionnels, Nouveaux prometteurs, À
   risque, Perdus), Récence = jours depuis le dernier SCAN, bouton « Créer
   une campagne » → `/campaigns/new?segment=` (segment `contact_segments`
   créé à la volée). Cohortes mois × M1/M2/M3/M6.
4. Mode « Ce soir » mobile : grands chiffres (30 s), alertes table non
   honorée / pic à la porte, à partir de `get_live_view` +
   `get_staff_night_pulse`.
5. Digests email : récap du lendemain (11 h, `night_recap_data` déjà écrit,
   ajouter le builder `email-kit`) et hebdo du lundi avec un segment
   actionnable ; drainés par `process-scheduled-campaigns` (pas de nouvelle
   edge).
6. Benchmarks Yuno anonymisés (≥ 5 clubs contributeurs).

### Effort

| Phase | Équipe humaine | CC + gstack |
|---|---|---|
| 1 | 3-4 semaines | 2 jours (7 RPC + shell + 8 cartes + tests + captures) |
| 2 | 2-3 semaines | 1 jour |
| 3 | 3 semaines | 1,5 jour |

---

## 6. Décisions à prendre avant la phase 1

1. **Remplacer ou reconstruire à côté ?** Proposition : v3 derrière `?v=3`
   pendant la phase 1, bascule par défaut à la fin de la phase 1, suppression
   des anciennes vues à la phase 2. L'alternative « tout casser tout de
   suite » laisse la Console sans Analytics pendant deux jours.
2. **Rouge de marque dans les graphes** : non (accent bleu désaturé), comme
   la spec. Confirmer.
3. **Décimales** : abrégé dans l'Analyse, deux décimales dans la Compta.
   Confirmer (ça revient sur le 29/09).
4. **Comparable par défaut** = même jour de semaine + même format (type,
   série récurrente), sur les 5 dernières ; repli « soirée précédente » avec
   la mention « non comparable ».
5. **Mesure d'audience sans consentement** (exemption CNIL, sans `user_id`) :
   oui pour que le tunnel voie tout le monde ? Sans ça, Sources restera à
   « partiel ».
6. **Sur quel compte réel vérifier le « aucune donnée »** (Amoris ? WOH ?) :
   la phase 1 commence par un diagnostic dessus.
7. **Club d'abord, orga dans la foulée** (même écran, portée différente) ou
   les deux à chaque carte ? Proposition : les deux à chaque carte, la
   portée est déjà abstraite.

---

## 7. Phase 1 — livrée le 2026-10-01

**SQL** (migrations `20261001100000` → `150000`, appliquées sur la base liée) :
`night_date(ts, tz)`, `_an3_nights` (une ligne par soirée, porte unique des
chiffres v3 : formules de `fees.ts`, statuts de la compta, remboursements déduits,
entrées par `_door_headcount`), `_an3_comparables` (même jour de semaine + même
série ou même type, 5 dernières, repli « soirée d'avant »), `_an3_people`
(qui est venu, première soirée dans la portée), `_an3_aggregate`, `_an3_curve`
(cumul J-n), `_an3_subject_ids`, puis `get_analytics_overview`,
`get_analytics_pacing`, `get_analytics_sales`, `get_analytics_door`,
`get_analytics_promoters`, `get_analytics_audience`. Toutes STABLE, SECURITY
DEFINER, gardées par `analytics_scope_gate` / `event_analytics_scope`, REVOKE /
GRANT explicites. Mesuré sur la démo (100 soirées, 17 k ventes) : 0,2 à 2 s par
appel ; sur un compte réel (≤ 12 soirées / mois) bien en dessous.

**Front** : `src/components/analytics/v3/` (shell `AnalyticsV3`, `FilterBar`,
`TabsNav`, `KpiCard` + sparkline SVG, `A3Card` à 4 états, `PacingChart`,
`NightsBars`, `HBarList`, `Heatmap`, `ArrivalsCurve`, `SmallMultiples`,
`DetailDrawer` + export CSV, sept onglets), `src/hooks/useAn3.ts` (react-query,
une requête par carte), `src/lib/analytics/` (`night.ts`, `an3Nav.ts`,
`an3Format.ts`, `an3Types.ts`, `an3Csv.ts`, `an3Flag.ts`), `src/pages/
AnalyticsRouter.tsx` (aiguillage v3 / ancien écran par `?v=`), 289 clés
`an3.*` (3 langues). Tests : `night`, `an3Format`, `an3Nav`. Smoke SQL
« au centime » + portée : `scripts/demo/smoke-analytics-v3.sql`.

**Vérifié en vrai** (Chrome intégré, session démo, Console Club et Console
Organisateur) : les sept onglets, soirée et période, sombre et clair, 375 px
sans défilement horizontal, valeurs abrégées, deltas bleu / orange avec
référence, pacing avec statut et repères, arrivées par 15 min, tables par zone,
promoteurs, audience masquée sous 10.

**Décisions appliquées** : v3 par défaut (`ANALYTICS_V3_DEFAULT = true`,
`?v=2` rouvre l'ancien écran jusqu'à la phase 2), accent bleu, montants
abrégés dans l'Analyse, comparable = même jour + format, club et organisateur
sur le même écran.

**Reste pour la phase 2** : attribution figée sur la vente, tunnel complet et
exemption CNIL, Sources et Campagnes, rollups si besoin, suppression de l'ancien
écran. **Phase 3** : insights, RFM en langage club, cohortes, Ce soir mobile
(grands chiffres), digests email, benchmarks.
