# Audit — un revenu affiché n'inclut jamais l'argent de Yuno (2026-09-29)

Règle : tout chiffre présenté à un club, un organisateur, une agence ou un
promoteur comme CA, revenu, gain ou « ce que tu touches » est le **CA club** de
`src/utils/fees.ts` :

| Pilier | CA club |
|---|---|
| Billets | `total_price − service_fee − insurance_fee` |
| Tables | `total_price − service_fee − (fee_absorbed ? management_fee : 0)` |
| Boissons | `total − service_fee` |

Remboursement déduit (plafonné à la part du club). Statuts comptés : billets
`paid/used`, tables `paid/confirmed`, commandes `paid/served`.

La **dépense client** (CRM, RFM, panier, seuil de panier) est une autre
grandeur : ce que le client a payé, frais compris. Sa formule est bonne pour
segmenter, mais son libellé doit dire « dépense ».

Méthode : SQL lu dans l'état LIVE (`pg_get_functiondef` des 103 fonctions qui
touchent un montant, et les vues `analytics_wh`), edge et front lus dans le
code. Chaque correction SQL a été jouée dans une transaction annulée, avant
puis après, sur des ventes démo.

## 1. SQL (état live)

| Fonction / vue | Formule avant | Frais Yuno inclus ? | Classe | Verdict |
|---|---|---|---|---|
| `get_tracked_link_stats` (liens suivis : club, orga, promoteur, DJ) | `Σ total_price` / `Σ total` ; statuts billets `paid/served` (le statut `used` n'était jamais compté), tables `paid/served` | **oui** | (a) | **Corrigé** (`20260929230000`) |
| `get_dj_audience` (même bloc de conversions) | idem | **oui** | (a) | **Corrigé** |
| `get_sms_campaign_report` → `sales.*_revenue` | `Σ total_price` | **oui** | (a) | **Corrigé** |
| `get_my_meta_ads` → `attributed.*_revenue_cents` (« Chiffre attribué ») | `Σ total_price` / `Σ total`, remboursés compris | **oui** | (a) | **Corrigé** (les chiffres Meta de `insights` ne changent pas) |
| `get_guest_list_analytics` → « CA généré », bar / VIP, repère « billet payant » | `Σ o.total`, `Σ r.total_price` | **oui** (bar) | (a) | **Corrigé** ; tables `paid/confirmed` |
| `analytics_wh.table_reservations.club_revenue` | retire `management_fee` même non absorbé | sous-estimé | (a) | **Corrigé** (`CASE WHEN fee_absorbed`) |
| `get_live_view`, `get_events_sales_summary`, `get_event_report`, `get_events_pnl`, `get_sales_overview`, `get_purchase_behavior`, `get_push_campaigns`, `get_promo_codes`, `get_audience_revenue`, `get_vip_table_analytics`, `night_recap_data`, `get_event_party_links`, `_coorg_yuno_legs`, `collab_night_yuno_figures` | CA club (réécrites par `20260929170000`) | non | ok | — |
| `get_email_campaign_attribution`, `get_audience_push_attribution`, `audience_weekly_recap_data`, `email_automation_weekly_digest` | CA club **− Stripe** (CA net) | non | ok | Voir la question ouverte n° 1 |
| `_venue_customer_rfm`, `get_organizer_customer_segments`, `contact_scope_customers`, `_admin_customer_activity`, `count_campaign_recipients_org` (`spent`), `get_vip_guest_profile`, `get_customer_timeline` | dépense client (brut, ou CA club selon la fonction) | oui | (b) | Formule légitime ; libellés front corrigés (§ 3) |
| `admin_cockpit`, `admin_platform_analytics`, `admin_orders_list`, `admin_activity_feed`, `admin_venue_overview`, `get_platform_traffic` | GMV brut + revenu Yuno séparé | oui (GMV) | (c) | ok, libellés « Volume de ventes / GMV » et « Revenu Yuno » |
| `get_vip_consumption_analytics`, `get_vip_host_leaderboard` | `Σ vip_consumptions.total_price` | non (aucun frais Yuno sur une conso servie) | ok | — |
| `record_promoter_conversion` (base de commission) | `unit_price × qty` ; table `total_price + remise` | non | (d) | Base payée = base affichée (valeur faciale **avant remise**, hors frais Yuno) |
| `get_agency_*_full_stats`, `settle_club_to_agency` | `Σ agency_conversions.gross_amount` = commission promoteur + marge agence | — | (d) | Commissions, pas des ventes (libellés corrigés, § 2 et § 3) |

Vérification (transaction annulée, womber, lien suivi démo avec 6 billets,
3 tables et 4 commandes rattachés) : `get_tracked_link_stats` passe de
**1 324,72 €** (brut client) à **1 313 €** = 168 + 1 050 + 95, la référence
`fees.ts`. Rapport SMS : billets 174,72 € → 168 €. Pubs Meta : commandes
100 € → 95 €, billets 174,72 € → 168 €. Analyse guest list (2 commandes,
1 table absorbée) : 534 € → 512,30 € (32,30 € + 480 €).

## 2. Edge functions

| Fonction | Écart | Classe | Verdict |
|---|---|---|---|
| `owner-assistant` `calc*Revenue` + outils `get_venue_stats`, `get_revenue_breakdown`, `get_tonight_stats`, `get_event_details`, `get_event_revenue`, `get_top_drinks` | frais Yuno bien exclus, mais `.eq("status","paid")` excluait **toutes les commandes servies** et les tables `confirmed` ; remboursement non déduit | (a) | **Corrigé** : statuts de la compta, `refund_amount` lu et déduit comme `fees.ts` |
| `owner-assistant` `get_customer_insights` | clé `total_revenue` = Σ `venue_customers.total_spent` (brut client) | (b) | **Renommé** `total_customer_spend` / `average_customer_spend`, et le prompt dit « dépense client, jamais CA » |
| `owner-assistant` prompt et article `fee-structure` | définition du CA club incomplète (sans frais de gestion absorbés ni remboursements) | — | **Corrigé** |
| `agency-assistant` `get_agency_overview.gross_volume_eur`, `get_top_promoters.gross_eur` | commission due présentée comme « volume de ventes (brut) » | (d) | **Renommé** `commissions_billed_to_clubs_eur` / `commissions_generated_eur` |
| `_shared/live-ops-alerts.ts` `liveops_revenue_goal` | CA club du **bar seul** annoncé comme « CA de ce soir » | libellé | **Corrigé** (« CA bar ») — en ligne au prochain déploiement de `process-scheduled-campaigns` (voir § 5) |
| `_shared/posthog.ts` `clubRevenue` | identique à `fees.ts` | (c) | ok |
| Notifications in-app « Nouveau billet vendu — X € », « Nouvelle commande — X € », « Vente via promoteur » (`verify-ticket-payment`, `verify-payment`) | montant brut client | oui | Question ouverte n° 3 |
| Valeur `Purchase` envoyée au pixel / CAPI Meta | `session.amount_total` (frais compris) | oui | Question ouverte n° 2 |

Aucun PDF, CSV ni Excel pro n'est produit côté edge (`pdf-documents.ts` ne sert
qu'aux reçus client).

## 3. Front

| Écran | fichier | Avant | Classe | Verdict |
|---|---|---|---|---|
| Accueil Console Organisateur (tuile, courbe, top soirées) | `OrgAppDashboard.tsx` | `Σ tickets.total_price` sous « CA brut » | (a) | **Corrigé** : `ticketRevenue` − remboursement, libellé « CA billets, hors frais Yuno » (3 langues), montants au format de la langue |
| Rapport de soirée › Hype (CA 24 h, comparaison) | `useHypeScore.tsx` | `Σ orders.total`, `Σ tickets.total_price` | (a) | **Corrigé** (`orderRevenue` / `ticketRevenue`) ; libellé « CA bar (24h) » |
| App Barman › Recette | `ShiftStats.tsx` | `Σ orders.total` | (a) | **Corrigé** |
| Accueil Console Club (ventes nettes, courbe, répartition) | `OwnerDashboard.tsx` | tables = acompte, frais de gestion absorbés jamais retirés | (a) | **Corrigé** |
| Live Night / module Live | `useLiveNightData.ts` | idem | (a) | **Corrigé** |
| Service VIP › vue d'ensemble (club et orga) | `VipOverviewTab.tsx`, `useOwnerVipData`, `useOrganizerVipData` | idem | (a) | **Corrigé** (la dépense par client reste l'acompte + conso) |
| Co-soirée « Ma part » (repli sans `revenue_distributions`) | `useEventNetGain.ts` | frais de gestion absorbés non retirés | (a) | **Corrigé** |
| Analytics orga « Gain net » (repli) | `OrgAppAnalytics.tsx` | frais Yuno **estimés** à max(0,99 ; 4 %), assurance jamais retirée | (a) | **Corrigé** : frais lus sur la vente, remboursement déduit |
| Comptabilité (club et orga) + Factures de la soirée | `OwnerAccounting.tsx`, `EventInvoicesModule.tsx`, `coEventSplit.ts` | billets et boissons : frais **estimés** (assurance jamais retirée) ; tables : frais de gestion retirés même non absorbés | (a) | **Corrigé** : `storedYunoFee()` lit service + assurance + frais de gestion absorbés sur chaque vente |
| Analytics › Remboursements | `useAnalyticsData.ts` | sans `refund_amount`, repli sur `total_price` (frais compris) | (a) | **Corrigé** : repli sur la part du club |
| Clients (club, orga) | i18n `customers.*` | « CA Total », « CA 30j », « Panier moyen » sur la dépense client | (b) | **Renommé** « Dépense clients », « Dépense 30 j », « Dépense moyenne » (3 langues) |
| Analytics orga › Communauté › paliers | `AudienceInsights.tsx` | « Tiers de clients » (Σ `total_price`) | (b) | **Renommé** « Paliers de dépense client (billets, frais compris) » |
| Super admin › Agences | i18n `adm.ag.col.gross` | « Ventes brutes » sur Σ `gross_amount` | (c)/(d) | **Renommé** « Commissions facturées » |
| Super admin cockpit, revenus, fiche club, CRM | — | GMV / revenu Yuno / CA clubs séparés | (c) | ok |
| Promoteurs (club, orga, app promoteur, agence) | `usePromoterAnalytics`, `PromoterDataContext`, `OwnerPromoter*`, `Agency*` | `Σ promoter_conversions.amount` | (d) | Base affichée = base payée, hors frais Yuno. **Signalé** : valeur faciale avant remise, conversions `cancelled` comptées, libellés « CA » |
| Analytics, Rapport, bande Événements, Live View, liens suivis, push, email, SMS, Pubs, promo, guest list | RPC | CA club | ok | — |

## 4. Même soirée, même CA

Tous les appels ont été joués sous RLS avec le jeton du propriétaire
(`owner@womber.fr`) ou de l'organisateur (`organizer@womber.fr`).

| Soirée | Référence `fees.ts` | Rapport de soirée | Bilan par soirée (`get_events_pnl`) | Bande Événements | Brut client |
|---|---|---|---|---|---|
| Yuno Reggaeton Party, 05/09 (club) | 11 983,45 € | 11 983,45 € | 11 983,45 € | (passée) | 12 493,80 € |
| The Revival, 01/10 (club) | 1 532 € | 1 532 € | 1 532 € | 1 532 € | 1 561,28 € |
| Yuno Rooftop Sunset (orga) | 9 228 € | 9 228 € | 9 228 € | (passée) | 9 597,12 € |
| Rooftop Session, 17/10 (orga, tables sans club) | 310 € | 310 € | 310 € | 310 € | 312,40 € |
| Disco Sundae, 04/10 (orga chez womber) | 190 € | 190 € | 190 € | 190 € | 197,60 € |

Écarts restants, expliqués :

- **Live View** : ventes du jour seulement, remboursement partiel **non**
  déduit (CA club avant remboursement).
- **Liens suivis, « Qui fait vendre », push, email, SMS, pubs** : périmètre
  attribué (les ventes passées par CE lien ou ce clic), jamais la soirée entière.
- **Attribution email / push de la page Audience** : CA **net** (Stripe déduit).
  L'historique Push et le Rapport de soirée affichent le CA club. Voir la question
  ouverte n° 1.
- **Accueil Club, Live Night, Service VIP** : tables comptées à l'**acompte
  encaissé**, alors que les autres écrans comptent le prix de la table
  (`total_price`). Pour une résa à acompte partiel, l'accueil montre donc moins.
- **Assistant** : même formule que `fees.ts`, sur la période demandée ; les
  tables sont filtrées par zones du club (`zone_id`).
- **Promoteurs** : valeur faciale avant remise (base de la commission),
  différente du CA club après remise.

## 5. Questions ouvertes (non tranchées)

1. **Faut-il déduire Stripe (1,5 % + 0,25 €) pour parler de « net » ?**
   Aujourd'hui, l'attribution email / push et le récap hebdo retirent Stripe
   (« CA net »), mais pas l'historique Push, le Rapport de soirée ni les liens
   suivis (« CA club »). Recommandation : garder le **CA club (avant Stripe)**
   comme chiffre partout, et n'afficher le net que là où il est libellé « net »
   (Ventes › « Ce que tu touches », « Net versé »). Il faudrait alors réécrire
   les quatre RPC d'attribution pour qu'elles rendent le CA club.
2. **Valeur `Purchase` envoyée à Meta** : aujourd'hui le montant payé, frais
   compris. C'est la convention Meta (ROAS d'Ads Manager), mais il diffère du
   « Chiffre attribué » de Yuno, désormais en CA club. Recommandation : garder le
   montant payé chez Meta (c'est ce que Meta attend) et libeller la valeur de la
   carte Meta « valeur transmise à Meta (montant payé) ».
3. **Notifications in-app de vente** (« Nouveau billet vendu — X € »,
   « Nouvelle commande — X € ») : montant brut client, écrit dans les fonctions
   `verify-*`. Recommandation : afficher le CA club. Non fait ici, car il faut
   toucher et redéployer ensemble les fonctions de paiement (hors périmètre
   demandé).
4. **Double déduction des remboursements** (Analytics › « Net versé ») : les
   ventes remboursées en totalité sont déjà exclues du brut (`status = 'paid'`),
   puis retirées une seconde fois. « Net versé » est donc sous-estimé. Le repli
   des frais est corrigé, pas ce modèle. Recommandation : compter les ventes
   remboursées dans le brut (et leur frais Stripe perdu), puis retirer tous les
   remboursements.
5. **Promoteurs** : les conversions `cancelled` entrent dans « CA généré » / « CA
   attribué », et les libellés disent « CA » pour une valeur faciale avant
   remise. Côté affichage seulement (code d'argent non touché).
   Recommandation : exclure `cancelled` et libeller « ventes attribuées ».
6. **Déploiement de `process-scheduled-campaigns`** : la version en ligne vient
   de la branche non fusionnée `claude/wizardly-dijkstra-prq5rv` (bilan de nuit).
   La redéployer depuis cette branche l'aurait fait régresser : le libellé
   « CA bar » de l'alerte live-ops partira avec son prochain déploiement.
7. **Hors règle, notés au passage** : totaux des pages Commandes calculés sur
   tous les statuts du filtre ; « panier moyen » du live = CA de tous les piliers
   ÷ commandes bar ; le Live compare le CA de tous les piliers au bar seul de la
   soirée de référence ; `AudienceInsights` recalcule un RFM en TypeScript.
