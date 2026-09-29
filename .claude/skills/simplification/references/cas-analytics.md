# Cas d'école — la refonte d'Analytics (24-25 septembre 2026)

Surfaces : `/owner/analytics` (Console Club) et `/organizer-app/analytics`
(Console Organisateur). Plan : `docs/designs/SHOTGUN_COMPETITIVE_PLAN.md`.
Commits : `518093b` (lots A-B), `39c80db` (C), `c8ffaf5` (D), `07b57c9` (E),
`3e82662` (F), `1932dec` (G), puis la reprise `7b1be95`, `5814ae7`, `f2e4fdc`,
`c9c425c`.

## Le point de départ

Yuno mesurait PLUS que Shotgun (trois piliers, P&L par soirée, verdict, live,
comportement d'achat, attribution email/push) mais l'analyse était éclatée :
un onglet « Global » à 15 zones empilées, des onglets Événement / Achats / En
direct, et à côté des pages Audience, Hype Score, fiche co-soirée, Clients.
Le pro avait tout, et ne trouvait rien.

Shotgun gagnait sur la **grammaire**, pas sur les données :
1. une page = une question ;
2. trois familles fixes ;
3. un sélecteur de soirée toujours au même endroit ;
4. « +N aujourd'hui » sous chaque total ;
5. « Comparer avec » une autre soirée ;
6. peu de blocs, gros chiffres ;
7. il dit d'où vient le chiffre (ⓘ, « Mis à jour à », « connu pour N ») ;
8. des mots de pro.

## Ce qui a été fait, dans l'ordre

| Lot | Geste de simplification | Fichiers clés |
|---|---|---|
| A | **Un kit commun avant toute page** : la grammaire devient des composants, pour que tous les écrans se lisent pareil | `src/components/analytics/kit.tsx`, `kitFormat.ts`, clés `ak.*` / `gl.*`, `useEventParam` |
| B | **Le chiffre qui compte là où on regarde déjà** : bande de ventes sur chaque carte soirée, « Vos prochaines soirées » en colonnes fixes à l'accueil | `get_events_sales_summary`, `EventSalesStrip`, `UpcomingEventsBoard`, `EventMetricsGrid`, `src/lib/eventsSales.ts` |
| C | **Une soirée = un rapport en cinq questions**, ordre fixe, verdict en tête une fois passée, comparaison au même J-N | `get_event_report`, `src/components/event-report/*`, `buildCurve` |
| D | Combler un trou plutôt qu'ajouter un écran : la page Push existante sert aussi l'organisateur | `OwnerPush`, `get_push_campaigns` |
| E | **Quatre familles** (Ventes · Trafic · Communauté · En direct), chaque zone de l'ancien Global rangée, anciennes pages redirigées, lexique réécrit | `src/lib/analyticsNav.ts`, `AnalyticsFamilyNav`, `useAnalyticsRoute`, `get_community_overview`, `get_page_traffic` |
| F-G | Nouvelles données rangées DANS les familles (codes promo, goûts du réseau), jamais à côté | `CommunityTastesView`, `PromoCodes` |

Table de destination de l'ancien Global (lot E) : promoteurs → Ventes ›
Partenaires ; fidélité → Communauté ; âge/sexe → Communauté › Public ; trafic
web → Trafic › Sources ; Audience → Communauté › Abonnés ; Hype Score → slot
`forecast` du Rapport de soirée ; Night Report IA → sous le verdict.

## Ce qui a raté, et la règle qui en est sortie

La reprise du 25/09 (« rien ne marche ») est la partie la plus instructive :

| Constat | Cause | Règle |
|---|---|---|
| 404 sur Trafic, Communauté, Goûts, Codes promo | migrations et edge functions jamais appliquées | Étape 7 : jouer contre la vraie base avant de dire « fini » |
| Analytics orga bloquée sur un spinner, 6-25 s pour ouvrir Trafic | toutes les vues attendaient ~70 requêtes de Ventes | Étape 6 : `enabled` par vue, jamais de verrou de page |
| Soirées démo à venir à zéro partout | aucune vente semée | Données de démo vivantes (`seed-upcoming-sales.sql`) |
| « 7 jours » tenait dans une barre « 20 h » | série horaire sur une longue période | Granularité selon la période (`buildSalesSeries`, testé) |
| Verdict de 3 000 px avant la première question | bilan complet déplié en tête | Résumé en tête (`layout="summary"`), détail replié |
| Hype Score répétait les ventes avec d'autres chiffres | deux sources pour la même notion | Une métrique = une source ; version `compact` |
| « 96 % de récurrence » sous « 54 % venus une fois » | zone Fidélité héritée, autre définition | Retirer le bloc qui contredit, garder le top clients |
| « rien aujourd'hui » et « 0 % » sous un total nul, formules à 0 d'un pilier éteint | zéros affichés mécaniquement | Zéros honnêtes (`showsRevenue`, pilier éteint masqué) |
| Deux titres empilés dans Abonnés et Achats | vue embarquée gardant son en-tête | Un titre par page (`embedded`) |
| « +3100 % » de fréquentation | pourcentage sur une base de 3 personnes | Seuil : se taire sous 10 de moyenne |
| Montants `€${n}`, heatmap en anglais en espagnol | formatage à la main | `useNumberFormat`, i18n ×3 |

## Ce qu'on n'a PAS copié de Shotgun

Une colonne revenu à 0 € sur une soirée gratuite (on montre les inscrits), la
pagination « 1 / 57 », les jours de la semaine sans l'heure, le violet.
