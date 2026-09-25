# Yuno face à Shotgun — analyse et plan (2026-09-24)

Version lisible (SWOT, face à face, décisions) : artefact « Yuno face à Shotgun »
publié le 24/09. Ce fichier garde l'essentiel pour les sessions de code.

## Source

11 captures du Smartboard Shotgun d'un compte organisateur (Woh Effect) :
accueil Événements, Marketing › Campagnes (push « Publication »), Analyse ›
Ventes, Trafic (par évènement, Ma page), Communauté (vue d'ensemble, croissance
par soirée, comportement d'achat, socio-démographie, goûts musicaux), Codes promo.

## Le constat

Yuno mesure PLUS que Shotgun (trois piliers, P&L par soirée, verdict, live,
comportement d'achat, attribution email/push) mais l'analyse est éclatée
(Analytics Global à 15 zones, onglets Événement / Achats / En direct, Audience,
Hype Score, fiche co-soirée, Clients). Shotgun gagne sur la GRAMMAIRE :

1. une page = une question (« Est-ce qu'on voit votre évènement ? ») ;
2. trois familles fixes : Ventes, Trafic, Communauté ;
3. un sélecteur de soirée toujours au même endroit ;
4. « +N aujourd'hui » sous chaque total ;
5. « Comparer avec » une autre soirée ;
6. peu de blocs, gros chiffres, rien de replié ;
7. il dit d'où vient le chiffre (ⓘ, « Mis à jour à », « connu pour N contacts ») ;
8. des mots de pro, pas de jargon (RFM, CTR, Funnel, Settlement).

Deux trous nets : l'organisateur n'a ni page push ni stats de ses push (le push
« nouvelle soirée » part pourtant vers ses abonnés) ; pas de rapport complet
d'UNE soirée pendant la vente.

## Décisions de Paul (24/09)

Oui aux quatre : Audience et Hype Score rejoignent Analytics ; l'organisateur
voit PUIS envoie ses push ; codes promo autonomes (en dernier, chantier argent) ;
goûts « du réseau » préparés, allumés seulement au-dessus du seuil (≥ 10 / ligne,
mention CGU). Tout le plan est à faire.

## Les lots

| Lot | Contenu | État |
|---|---|---|
| A | Kit commun : `kit.tsx` (TodayDelta, UpdatedAt, MetricHint, CoverageNote, FillBar), `kitFormat.ts`, clés `ak.*` / `gl.*`, soirée dans l'URL (`useEventParam`, `?event=`) | Livré 24/09 |
| B | `get_events_sales_summary` + bande de ventes sur chaque carte soirée + bloc « Vos prochaines soirées » des deux dashboards | Livré 24/09 |
| C | Rapport de soirée : `get_event_report` + `EventReportView` (ventes + détail par ligne, courbe « Comparer avec » alignée sur J-N, trafic, nouveaux contacts, canaux / liens / emails & push de la soirée, verdict en tête après la soirée) | Livré 24/09 |
| D | Push : historique complet (`get_push_campaigns`, fin de la limite à 20), « Publication – soirée », page push organisateur `/organizer-app/push` (lecture ET envoi), attribution organisateur, bandeau abonnés + lien / QR | Livré 24/09 |
| E | Analytics en quatre familles (Ventes / Trafic / Communauté / En direct, `analyticsNav.ts`), Global réparti, Audience + Hype absorbés (redirections), Communauté · Vue d'ensemble (`get_community_overview`), Trafic · Ma page + Par soirée (`get_page_traffic`), lexique appliqué ; + politique client des push manuels | Livré 24/09 |
| F | Codes promo par soirée (`promo_codes`, `claim_promo_code` sous verrou + usage retenu 30 min, checkouts billets et tables, champ client, page `PromoCodes` club + orga, stats par code) ; ligne Stripe des billets remisée corrigée | Livré 24/09 |
| G | Goûts du réseau (`get_community_tastes`, Communauté → Goûts, ≥ 10 / ligne, opt-out, politique de confidentialité), accusés de réception push (serveur + colonne « Reçus » ; extension iOS à livrer avec le prochain binaire), outils de lecture de l'Assistant Console (rapport de soirée, communauté, push). « Ma page » livrée au lot E | Livré 24/09 (sauf extension iOS) |

## Reprise du 25/09 (joué contre la vraie base)

Paul a ouvert la démo : « rien ne marche ». Causes : migrations 190000→220000
jamais appliquées, edge functions de la branche jamais déployées, Analytics
orga bloquée sur un spinner (toutes les vues attendaient le gros calcul de
Ventes), soirées démo à venir sans aucune vente. Repris lot par lot avec le
compte démo : migrations appliquées, 7 edge functions déployées, chargement
par vue, Vue d'ensemble relue (ventes par jour, détail replié), rapport de
soirée resserré (verdict compact, Hype sans doublon), titres doublés retirés,
démo semée (`scripts/demo/seed-upcoming-sales.sql`), codes promo et push
orga joués en vrai. Détail des règles dans CLAUDE.md.

## Ce qu'on NE copie pas

Une colonne revenu à 0 € sur une soirée gratuite (on montre les inscrits) ;
la pagination « 1 / 57 » ; les jours de la semaine sans l'heure ; le violet.

## Reste à faire hors code web

- **Notification Service Extension (app client iOS)** : nouvelle cible Xcode
  dans `ios/App`, `didReceive(_:withContentHandler:)` lit `yr.c` / `yr.s` du
  payload, appelle `POST <SUPABASE_URL>/rest/v1/rpc/ack_push_delivery`
  (`apikey` = clé anon, corps `{"p_campaign_id": c, "p_subscription_id": s}`),
  puis rend le contenu inchangé (même en cas d'échec réseau). Livrée avec le
  prochain binaire App Store : l'OTA ne transporte pas de code natif.
