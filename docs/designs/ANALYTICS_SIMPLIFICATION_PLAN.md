# Analyse Yuno — le grand tri (2026-09-25)

Suite du plan Shotgun (`SHOTGUN_COMPETITIVE_PLAN.md`). La grammaire est posée
(quatre familles, une question par page, soirée dans l'URL, kit commun), mais
l'analyse reste difficile à lire pour un patron de club : trop de chiffres, les
mêmes chiffres à plusieurs endroits, et parfois des chiffres qui se
contredisent. Ce document est l'inventaire complet, le verdict ligne à ligne et
le plan de simplification.

Méthode : inventaire du code (Analytics club + orga, dashboards, pages
opérationnelles), captures du vrai front sur la démo (`drive.mjs`, front local
branché sur la base, 25/09), et relevé de ce que montrent Shopify, Stripe,
Shotgun, DICE, Eventbrite, Posh, Tixr, Fever, Xceed, Toast, Square, SevenRooms,
Plausible, Fathom, GA4, Klaviyo, Mailchimp, Linear (sources en fin de document).

---

## 1. Le constat en chiffres

| Problème | Mesure |
|---|---|
| Blocs affichés dans Analytics (club, toutes vues) | ≈ 150 cartes / tuiles / listes |
| Blocs de Ventes › Vue d'ensemble, Détail ouvert | ≈ 25 (dont 10 pour la seule guest list) |
| Le CA total sur UN écran (Ventes › Vue d'ensemble) | 4 fois : onglet pilier, tuile « Revenu brut », en-tête du graphique, « Volume brut » |
| Formules différentes pour « le CA » dans la Console | ≈ 9, sous 13 noms (« Ventes nettes », « CA », « CA brut », « Revenu Total », « Revenus Totaux », « CA généré », « CA TTC »…) |
| Endroits où apparaît la guest list (inscrits / entrés / taux) | 11 dans Analytics, 7 surfaces hors Analytics |
| Définitions de « Panier moyen » | 8 (dont une en ARTICLES par commande, pas en €) |
| Définitions de « nouveaux / habitués » | 6 |
| Endroits qui répondent « d'où viennent-ils ? » | 7 |
| Listes « soirée par soirée » | 8 |
| Taux de remplissage dans UN rapport de soirée | 5 fois, avec deux capacités différentes (650 et 313) |
| Rangées de 5 à 13 tuiles | 9 composants |

**Ce qu'un patron veut savoir** tient en cinq questions : *est-ce que je vais
remplir ?* (avant), *comment ça se passe ?* (pendant), *combien j'ai gagné et
est-ce mieux que d'habitude ?* (après), *d'où viennent mes clients ?*, *est-ce
qu'ils reviennent ?*. Tout le reste est du détail qui doit se mériter d'un clic.

## 2. Les contradictions vues sur la démo (25/09)

À corriger avant toute simplification : un écran simple qui ment est pire qu'un
écran chargé.

1. **L'IA dit « 0 billet vendu pour la soirée de demain »** (« À faire
   aujourd'hui ») pendant que le bloc juste en dessous affiche **84 / 650**
   pour cette même soirée. L'assistant ne lit pas les mêmes chiffres que l'écran.
2. **Rapport d'une soirée passée sans aucune vente : note « 0,5 / 10 — À
   améliorer »**, puis 5 tuiles à 0, puis 5 cartes « 0 / 650 », une table de 9
   lignes à 0, une courbe plate et 5 cartes vides. Une soirée sans donnée doit
   dire UNE phrase, pas noter.
3. **Rapport de la soirée de ce soir :** Hype « 3/10 — Hype basse » à côté de
   « Confiance : ÉLEVÉE » et « Sold out 1 % » ; remplissage « 14 % » (Hype),
   « 18 % » (prévision), « 27 % de la capacité » (anneau « Participants
   86 / 313 ») pour 92 billets sur 650. Trois pourcentages, deux capacités.
4. **Ventes › Vue d'ensemble, période « 7 jours » :** le « Bilan par soirée »
   liste des soirées du 1er et 2 octobre (futures) ; « 11 k€ net cumulé » en
   haut du bilan contre « 8 239 € net versé » juste au-dessus.
5. **Accueil club :** « 10798 € » sans séparateur, « +2810.8% », variation de
   la conversion en points affichée en « % », donut « Répartition des revenus »
   qui dessine un faux 33 / 34 / 33 quand il n'y a pas de revenu
   (`OwnerDashboard.tsx:284`).
6. **« Ventes nettes » (accueil, après frais Stripe, remboursements NON
   déduits, tables = acompte) et « CA » (bloc soirées juste en dessous, avant
   Stripe, remboursements déduits)** : deux chiffres d'argent, deux formules,
   sur le même écran, sans que rien ne le dise.
7. **Commandes › Billets et Commandes › VIP :** le filtre par défaut « Tous »
   compte les billets / réservations **annulés et remboursés** dans « Billets
   vendus » et « Revenu Total » (`OwnerTicketOrders.tsx:134, 179-193`,
   `OwnerVipOrders.tsx:132`).
8. **Guest list :** « Inscriptions » (Commandes) compte les annulés, « Inscrits »
   (page Guest list, bloc soirées) non ; `PartCard` compte comme « entré » un
   invité annulé puis scanné ; la fiche co-soirée compte les annulés dans
   « Participants ».
9. **« Entrées » veut dire trois choses** : la capacité (« Total Entrées »,
   Billetterie), les billets vendus (« Entrées Vendues », Analytics), les
   billets scannés (fiche co-soirée).
10. **Clients uniques additionnés** bar + billets dans la vue Essentiel
    (`AnalyticsEssentialView.tsx:47`) : une personne qui a acheté les deux
    compte deux fois.
11. **Comptabilité :** la tuile « − Frais Yuno » est affichée en soustraction
    alors qu'elle est déjà exclue du CA TTC.
12. **« Panier moyen » de `DrinkOpsInsights`** est un nombre d'articles, pas des
    euros ; « Panier moyen » de la page Clients est une dépense par client.
13. **« Commandes »** (Ventes › Vue d'ensemble, accueil) additionne des
    commandes bar, des BILLETS (unités) et des réservations ; le panier moyen
    qui en découle ne veut rien dire.

## 3. Ce que font les meilleurs (et qu'on copie)

Le détail est en annexe ; les dix règles retenues :

1. **Quatre chiffres au-dessus du pli, pas plus** (Toast : ventes nettes,
   couverts, top produits, main-d'œuvre ; Eventbrite : 3-4 cartes ; Plausible : 6).
2. **Chaque chiffre a son « par rapport à quoi »** : période précédente, même
   heure hier (Stripe), même semaine l'an dernier (Toast), **capacité**
   (Eventbrite : 312 / 450 + barre). Pour un club, la bonne référence est **la
   soirée comparable précédente au même J-N**, pas « les 7 derniers jours »
   qui chevauchent deux samedis.
3. **Une phrase avant les graphiques** : GA4 et Shopify affichent 0 à 3
   constats écrits (« Instagram a apporté 41 % des acheteurs »), qui
   expirent, et **rien plutôt qu'un constat faible** (Klaviyo laisse la carte
   vide sous son seuil).
4. **Un seul grand graphique par page, piloté par les chiffres** (Plausible :
   cliquer une tuile change la courbe). Pas six graphiques empilés.
5. **Tout chiffre est une porte** (Toast, Shopify, Linear) : on clique, on
   arrive sur le détail déjà filtré.
6. **Barres, pas camemberts** (Stephen Few, NN/g) : aucun des leaders n'a de
   donut en haut de page. Longueurs et positions se lisent, angles et aires non.
   Un anneau n'est acceptable que pour UN ratio (remplissage), une fois.
7. **Remplissage = jauge « vendu / capacité » avec un repère** (bullet graph :
   la barre, la capacité, un trait pour « la soirée précédente en était là »).
8. **La dépense par tête** (Toast « average check », SevenRooms « spend per
   cover ») : CA ÷ entrées. C'est LE chiffre qui résume billets + tables + bar,
   et un patron de club pense déjà comme ça.
9. **Objectif et rythme** (Shopify Targets) : « objectif 600 entrées — tu es en
   avance / en retard sur le rythme ». Répond à *est-ce que je vais remplir ?*
   mieux qu'un score abstrait.
10. **Le chiffre vient à toi** : récap du lendemain matin et hebdo (Shotgun,
    SevenRooms), widget téléphone (Square, Shopify). Le patron lit sur son
    téléphone à 11 h, pas dans un dashboard à 15 onglets.

Anti-modèles relevés ailleurs et présents chez nous : donuts à 4+ parts,
jauges circulaires décoratives, KPI sans comparaison, données partielles sans
le dire, constats « +2 % » en rafale, chiffres qui ne mènent nulle part,
opérationnel (ce soir) et analytique (ce mois) mélangés sur le même écran,
totaux à vie en haut de page.

---

## 4. La doctrine (règles pour tout écran d'analyse)

1. **Un dictionnaire de chiffres, une seule définition par nom.** Un nom =
   une formule = une RPC. Si deux écrans ont besoin de deux formules, ce sont
   deux noms. Dictionnaire en §5, code dans `src/lib/metrics.ts` + clés `gl.*`.
2. **Pyramide inversée, toujours dans cet ordre** : (a) la réponse en une
   phrase, (b) 4 chiffres maximum avec leur comparaison, (c) UN graphique
   principal, (d) une liste ou un tableau court, (e) le reste derrière un clic.
3. **Plafonds** : 4 tuiles par rangée, 6 blocs par vue, 7 lignes par liste
   avant « Voir tout », 5 colonnes par tableau. Tout composant qui dépasse est
   découpé ou replié.
4. **Formes imposées par type de question** :
   - évolution dans le temps → courbe (avec la soirée de référence en
     pointillé) ou barres par jour ;
   - comparer des catégories (canaux, formules, promoteurs, villes) → barres
     horizontales triées ;
   - vendu / capacité → jauge avec repère ;
   - un seul ratio mis en avant → anneau (un par écran, jamais décoratif :
     sans capacité, pas d'anneau) ;
   - jour × heure → carte de chaleur (un seul composant partagé) ;
   - répartition en 2-3 parts → barre empilée ; **jamais de donut au-delà de
     3 parts**.
5. **Chaque chiffre porte sa comparaison** (▲ / ▼ + signe, jamais la couleur
   seule, et vert/rouge inversés quand « moins » est bon : remboursements,
   absents) **et sa définition** (ⓘ `MetricHint`).
6. **Une vue sans donnée = une phrase et une action**, jamais dix cartes vides
   ni une note. Seuils de silence : pas de pourcentage sous 10 personnes, pas de
   score sans vente.
7. **Les périodes suivent le rythme d'un club** : « Dernière soirée / 4
   dernières soirées / Ce mois / Cette année » plutôt que 24 h / 48 h / 72 h.
   Une période ne montre jamais une soirée future.
8. **Opérationnel ≠ analytique** : « ce soir » vit sur l'accueil et En direct ;
   « comment ça s'est passé » vit dans Analytics. Une page de service (Service
   VIP, Guest list, Commandes) garde les chiffres DU SERVICE, pas un deuxième
   Analytics.
9. **Un chiffre, une maison** : chaque chiffre a une page de référence ; les
   autres écrans le résument et y renvoient par un lien.
10. **Tutoiement partout** (le lot E l'a posé pour `anf.*`, mais `er.*`, `pb.*`,
    `lv.*` vouvoient encore) et zéro anglais (« vs prev », « Mobile / Tablet /
    Desktop », « Top referrers », « Campaign / Medium »).

## 5. Le dictionnaire (les 14 chiffres de Yuno)

| Nom affiché | Définition unique | Maison |
|---|---|---|
| **CA** | Ce que le club/l'orga encaisse sur ses ventes : prix − frais de service Yuno − assurance / gestion, remboursements déduits (formules de `fees.ts`), statuts vendus (billets `paid`, tables `paid/confirmed`, bar `paid/served`). **Avant frais Stripe.** | Ventes |
| **Net versé** | CA − frais Stripe. Seulement dans Finance / Paiements. | Finance |
| **Billets vendus** | Σ quantité de billets vendus (annulés et remboursés exclus). | Ventes › Billets |
| **Tables réservées** | Réservations vendues, sur tables mises en vente. | Ventes › Tables |
| **Inscrits** | Entrées guest list non annulées. | Ventes › Guest list |
| **Entrées** | Personnes scannées à la porte, tous piliers (billets + guest list + convives de table). Plus jamais la capacité ni les billets vendus. | Rapport de soirée |
| **Présence** | Entrées ÷ (billets vendus + inscrits + convives). « Absents » = le complément. | Rapport de soirée |
| **Remplissage** | Vendus ÷ capacité, par pilier. UNE capacité : celle de la soirée. | Rapport de soirée |
| **Dépense par tête** | CA ÷ entrées (soirée terminée). Nouveau chiffre-phare. | Ventes |
| **Panier moyen** | CA ÷ commandes, **toujours par pilier** (« panier bar », « panier table »). Jamais tous piliers confondus. | Pilier |
| **Clients** | Personnes uniques (par email) ayant acheté ou été inscrites. Jamais additionnées d'un pilier à l'autre. | Communauté |
| **Nouveaux / habitués** | Nouveau = première soirée dans la portée ; habitué = 2 soirées ou plus. Une seule fonction SQL. | Communauté |
| **Visites** | Vues de page consenties (minimum, dit sous la carte). | Trafic |
| **Conversion** | Acheteurs ÷ visiteurs de la page, même période. | Trafic |

Noms retirés : « Revenu brut », « Revenu Total », « Revenus Totaux », « CA
généré », « Ventes nettes », « Revenu Net », « Entrées Vendues », « Total
Entrées » (→ « Capacité »), « Participants » (→ « Entrées »), « Venus »,
« No-show » (→ « Absents »), « Valeur Moy. Commande », « Attach boisson »,
« Upsell », « Rotation », « Superfans », « Hype Score » (→ « Prévision »).

---

## 6. Verdict écran par écran

Légende : **Garder** tel quel · **Simplifier** · **Fusionner** (où) · **Déplacer**
(où) · **Supprimer**.

### 6.1 Accueil club (`OwnerDashboard`) — ≈ 30 chiffres → 12

| Bloc | Verdict |
|---|---|
| Héros « Ce soir · 92 billets vendus » | **Simplifier** : devient la carte « Ce soir » (entrées / vendus / CA, lien En direct) — c'est aujourd'hui une redite de la 1re ligne du bloc soirées. |
| « À faire aujourd'hui » (IA, 3 actions) | **Garder, 1-2 actions max**, et **alimenter l'IA par les mêmes RPC que l'écran** (`get_events_sales_summary`) : fin de « 0 billet » contre 84. |
| 4 tuiles Ventes nettes / Commandes / Visiteurs / Conversion | **Simplifier** : CA (30 j, formule du dictionnaire) · Entrées (30 j) · Dépense par tête · Clients. Chacune cliquable vers Ventes. |
| Graphique « Revenus » 7/14/30 j | **Supprimer** (redite de Ventes › Vue d'ensemble, et « vs premier jour » ne veut rien dire). |
| « Vos prochaines soirées » | **Garder** (c'est le meilleur bloc) ; 5 colonnes → 4 (CA, Billets, Tables, Guest list), Visites passe en sous-ligne ; « aujourd'hui » seulement quand ≠ 0. |
| « Activité quotidienne » | **Supprimer**. |
| Donut « Répartition des revenus » | **Supprimer** (et son faux 33/34/33). |
| « Actions rapides » | **Garder**. |

### 6.2 Accueil organisateur (`OrgAppDashboard`)

« Mission Control » → « Accueil ». « CA brut » (frais Yuno INCLUS, billets seuls)
→ CA du dictionnaire. « Top soirées (30 j) » **supprimé** (redite de la liste
des soirées). Même squelette que le club : Ce soir · 4 chiffres · Prochaines
soirées.

### 6.3 Ventes › Vue d'ensemble — ≈ 25 blocs → 6

| Bloc | Verdict |
|---|---|
| 5 onglets piliers avec leur € | **Simplifier** en un filtre « Tout · Billets · Tables · Bar · Guest list » sans montant (le montant est dans les tuiles). Remboursements sort des piliers (→ Finance, et une ligne « dont remboursé » sous le CA). |
| « VUE D'ENSEMBLE » (titre de zone) | **Supprimer** (3e « Vue d'ensemble » à l'écran). |
| 4 tuiles Revenu brut / Commandes / Panier moyen / Clients uniques | **Remplacer** par CA · Entrées · Dépense par tête · Clients, comparées à la période précédente de même longueur **en soirées**. |
| « Ventes, jour par jour » | **Garder**, piloté par la tuile cliquée (CA / entrées / clients) ; retirer le total en haut à droite (déjà dans la tuile). |
| « Ce que tu touches » | **Déplacer** vers Finance (Paiements) ; ici une seule ligne « Net versé : 8 239 € → Paiements ». |
| « Bilan par soirée » | **Simplifier** : tableau 4 colonnes (Soirée · Entrées · CA · vs précédente), 7 lignes + « Voir tout », soirées passées seulement, un clic ouvre le Rapport. Chips « 0 € · 0 » retirées (on n'affiche pas un pilier vide). |
| Détail › « De la visite à l'achat » (bar) | **Déplacer** vers le pilier Bar. |
| Détail › donut « D'où vient le CA » | **Supprimer** (redite des piliers) → barre empilée 3 parts sous la tuile CA. |
| Détail › « Top vendeurs » | **Déplacer** vers le pilier Bar. |
| Détail › « La soirée » (Présents, No-show, Revenu/tête, Remplissage GL, Arrivées/heure) | **Fusionner** : Dépense par tête monte en tuile, le reste va au Rapport de soirée. |
| Détail › Guest list (`GuestListAnalyticsSection`, 10 blocs) | **Déplacer** vers le pilier Guest list (§6.4). |

### 6.4 Les piliers — un gabarit unique

Aujourd'hui chaque pilier a sa propre anatomie (Billets : 6 tuiles + 4
sous-onglets à l'ancien design ; Bar : 4 + 6 tuiles, 2 graphiques de revenu ;
Tables : 6 + 5 tuiles ; Guest list : 5 tuiles + 9 blocs, lignes à 13 tuiles).
**Gabarit commun** : 1 phrase · 4 tuiles · 1 graphique · 1 liste classée · 1
tableau par soirée (7 lignes). Tout le reste derrière « Détail ».

| Pilier | 4 tuiles | Graphique | Liste classée | Retiré / replié |
|---|---|---|---|---|
| **Billets** | Billets vendus · CA · Prix moyen · Remplissage | Ventes par jour avant la soirée (J-N, soirée précédente en pointillé) | Formules / paliers (vendus, CA, jauge) | `TicketAnalyticsOverview/Launch/Types/Phases` (ancien design, « Entrées par phase » en double) → **supprimés** ; `TicketPillarInsights` (attach boisson, upgrades, assurance, achat sans compte) → « Détail : options prises » (une seule liste, déjà dans Communauté › Achats → garder UNE maison : Achats) |
| **Tables** | Tables réservées · CA tables · Dépense par table · Absents | Réservations par soirée | Formules / zones | `VipConsumptionSection` (5 tuiles) → 2 chiffres « consommé / minimum » ; classement des hôtes → Détail ; « Rotation », « Upsell » retirés |
| **Bar** | CA bar · Commandes · Panier bar (€) · Temps de service | Commandes par heure de la nuit | Top produits | `DrinkAnalyticsSection` (6 tuiles, 2e courbe de revenu, 2e top produits, donut catégories) → **fusionné** ; « Panier moyen » en articles → renommé « Articles / commande » en Détail |
| **Guest list** | Inscrits · Entrées · Présence · CA des invités (bar + tables) | De l'inscription à la caisse (entonnoir 4 marches) | Par détenteur de liste (inscrits, présence, CA — 3 colonnes, plus de ligne à 13 tuiles) | « Un invité vaut-il un client payant ? » garde UNE phrase ; lead time, type d'invitation, genre, heure d'arrivée → Détail ; « Soirée par soirée » = le tableau du gabarit |

### 6.5 Ventes › Par soirée (Rapport de soirée)

Ordre gardé (ventes, évolution, trafic, qui achète, ce qui a fait vendre),
mais chaque question a UNE réponse :

| Bloc | Verdict |
|---|---|
| En-tête | **Garder** + la phrase-réponse (« 92 billets sur 650 à J-0, 20 de plus qu'à la même heure pour The Revival »). |
| Verdict après la soirée (note /10 + 5 tuiles + bilan replié) | **Simplifier** : pas de note sans vente ; 4 tuiles (Entrées · CA · Dépense par tête · Présence) ; « Statistiques détaillées » (12 stats) → **supprimées** (toutes présentes ailleurs dans le rapport). |
| « Où en sont mes ventes ? » 5 cartes + tableau | **Garder le tableau** (c'est le cœur) ; les 5 cartes → 4 jauges (Billets, Tables, Guest list, CA) ; « Visites » va au bloc trafic. |
| « Comment évoluent mes ventes ? » | **Garder** (courbe J-N + comparaison = notre meilleur graphique). |
| « La soirée va-t-elle remplir ? » (Hype : score, calibration, prévision, 4 sous-scores, explication) | **Simplifier en UNE ligne** posée sous la jauge Billets : « Projection : ≈ 119 entrées (18 %) — en retard sur le rythme ». Score, 5 sous-scores et explication → Détail. Plus de « 3/10 basse » à côté de « Confiance élevée ». |
| « Est-ce qu'on voit ma soirée ? » + « Qu'est-ce qui a fait vendre ? » | **Fusionner** en « D'où viennent les ventes ? » : un seul classement canal → visites, ventes, CA ; liens suivis et emails/push en dessous, affichés seulement s'ils existent. |
| « Qui achète ? » (nouveaux/habitués, âge, sexe, anneau Participants) | **Simplifier** : nouveaux / habitués (barre 2 parts) + âge + villes ; anneau « Participants 86/313 » **supprimé** (redite du remplissage avec une AUTRE capacité) ; sexe seulement s'il est déclaré, pas « estimé via guest list ». |
| « Détail avancé » (tout Ventes › Vue d'ensemble rejoué, bilan NON filtré sur la soirée) | **Supprimer** : remplacé par le filtre pilier du rapport. |
| Soirée sans vente | **Une carte** : « Pas encore de vente pour cette soirée » + [Partager le lien] [Envoyer un push]. |

### 6.6 Ventes › Partenaires

**Garder.** « Rendement ×N » → « CA pour 1 € de commission » ; « Clic → vente »
→ « Conversion ». La liste « Liens suivis » du rapport renvoie ici.

### 6.7 Trafic — 3 vues → 2

| Vue | Verdict |
|---|---|
| Ma page | **Fusionner avec Sources** : 3 tuiles (Visites · Visiteurs · Conversion) + courbe + « D'où viennent-ils ? » en barres triées AVEC la conversion par source. Une seule période (celle de la page, pas un 2e sélecteur 30 j / 90 j / 1 an). |
| Par soirée | **Garder** (tableau Soirée · Visites · Achats · Conversion). |
| Sources : donut, tableau UTM (Source / Medium / Campaign), Top referrers, Pays, « Engagement web » (durée, scroll, rebond, appareils, carte de chaleur) | Donut **supprimé** (fusionné plus haut). UTM → « Campagnes » en langage clair, dans Détail. Durée, scroll, rebond, appareils → **supprimés** (mesures de site web, pas de club). Paniers abandonnés → pilier concerné. Carte de chaleur jour × heure → une seule, dans Communauté › Achats. |

### 6.8 Communauté — 5 vues → 3

| Vue | Verdict |
|---|---|
| Vue d'ensemble | **Garder**, allégée : 4 tuiles OK ; « À combien de soirées viennent-ils ? » et « Dernier achat » → lignes à 0 masquées (« Jamais venus 0 », « 1 à 2 ans 0 ») ; « Nouveaux contacts, soirée par soirée » (tableau) → barres par soirée ; « Top clients » → 5 lignes + lien Clients. |
| Abonnés (`AudienceDashboard`, ≈ 15 cartes, 580 lignes) | **Simplifier à 5 blocs** : 4 tuiles · courbe des abonnés · « D'où viennent-ils ? » · « Ce qu'ils rapportent » (abonnés vs non-abonnés) · meilleur créneau d'envoi. Démographie et goûts → Public ; segmentation → page Clients ; « Performance marketing » et « Campagnes récentes » → pages Push / Email ; « Face à {ville} » → Détail. |
| Achats (`PurchaseBehaviorView`, 6 tuiles + 7 sections) | **Simplifier** : 4 tuiles (Panier moyen par commande · Délai d'achat médian · Réachat · Achat sans compte) ; sections gardées : quand (délai + jour × heure), ce qu'ils ajoutent, présence. « Par pilier », canaux, passage à l'achat, taille de panier → **supprimés** (maisons : piliers, Trafic). |
| Public | **Fusionner avec Goûts** : âge · sexe (déclaré) · villes · genres, seuils ≥ 10 conservés. L'`AudienceInsights` orga (RFM 7 segments, Platinum/Gold/Silver/Bronze) → **supprimé** ici (vit dans Clients). |
| Goûts | → Public. |

### 6.9 En direct

**Garder** (c'est opérationnel et c'est lisible). Seule retouche : la pastille
« N en ligne » de l'en-tête Analytics n'apparaît que sur En direct.

### 6.10 Hors Analytics

| Écran | Verdict |
|---|---|
| Service VIP › Vue d'ensemble (8 tuiles + ≈ 12 cartes) | **Opérationnel seulement** : tables de ce soir (réservées / arrivées / min. atteint), top clients présents. L'analyse part dans le pilier Tables. |
| Commandes (4 onglets) | **Corriger** les totaux (vendus seulement par défaut, annulés/remboursés à part) ; noms du dictionnaire. |
| Guest list (`OwnerGuestList`, `PartCard`) | Garder « Alloué / Inscrits » ; « entré(s) » exclut les annulés. |
| Clients | « Panier moyen » → « Dépense par client » ; deux « À risque » (drapeau + segment RFM) → un seul, celui du RFM. |
| Comptabilité | « − Frais Yuno » affiché comme déjà déduit (information), pas comme soustraction. |
| Fiche co-soirée | Chiffres du dictionnaire (Entrées = tous piliers, CA remboursements déduits, annulés exclus). |

### 6.11 Code mort à retirer

`ConversionFunnelCard.tsx`, `owner/co-event/EventAnalyticsModule.tsx` (et donc
`TableAnalyticsSection.tsx`), `AnalyticsAnchorNav` construit mais jamais rendu
dans les deux pages Analytics, `recentActivity` (requête toutes les 10 s jamais
affichée), `nextStats` de l'accueil (calculé, jamais affiché), CA du jour du
Manager (recalculé toutes les 60 s, jamais affiché), `conversionRate30` orga
(toujours 0). Les composants à l'ancien design (`TicketAnalytics*`,
`DrinkAnalyticsSection`, `RefundAnalyticsSection`, `AnalyticsEssentialView`)
sortent avec le lot 3.

---

## 7. Le kit visuel à ajouter

Dans `src/components/analytics/kit.tsx` (club et orga, thème clair et sombre) :

| Composant | Usage | Remplace |
|---|---|---|
| `AnswerLine` | La phrase-réponse en tête de vue, avec chiffres en gras | les titres-questions sans réponse |
| `KpiTile` (unique) | Valeur · comparaison ▲▼ signée · sparkline · ⓘ · cliquable | 6 styles de tuiles différents |
| `KpiRow` | 4 tuiles max, 2×2 sur téléphone, pilote le graphique principal | rangées de 5 à 13 tuiles |
| `BulletBar` | Vendu / capacité + trait « soirée précédente au même J-N » | `FillBar`, anneaux décoratifs |
| `RankedBars` | Classement horizontal trié, valeur + %, 7 lignes + « Voir tout » | donuts, tableaux de sources |
| `StackBar` | Répartition 2-3 parts (piliers, nouveaux/habitués) | donuts |
| `DayHourHeatmap` | Jour × heure, un seul composant | 2 cartes de chaleur |
| `EmptyAnswer` | Une phrase + une action | cartes vides empilées |
| `NightsTable` | Soirée · 3 chiffres · vs précédente · clic → rapport | 8 listes « soirée par soirée » |

## 8. Ajouts à forte valeur (repris des leaders)

1. **Dépense par tête** en chiffre-phare (Toast, SevenRooms).
2. **Objectif de soirée + rythme** (Shopify Targets) : champ « objectif
   d'entrées » sur la soirée, jauge et phrase « en avance / en retard ».
   Remplace le Hype Score comme réponse à « vais-je remplir ? ».
3. **« À retenir » : 0 à 3 phrases** calculées serveur, avec seuils, lien vers la
   preuve (GA4, Shopify). Déjà amorcé dans `PurchaseBehaviorView`.
4. **Récap du lendemain** (push à 11 h + email hebdo : titre, 3 chiffres, 1
   constat, 1 lien) — Shotgun, SevenRooms. Passe par `platform_notification_settings`.
5. **Repères sur la courbe J-N** (Mixpanel annotations) : annonce, email, push,
   changement de palier — pour voir ce qui a fait monter les ventes.

## 9. Les lots

| Lot | Contenu | Pourquoi dans cet ordre |
|---|---|---|
| **1 — Des chiffres justes** | `src/lib/metrics.ts` + clés `gl.*` du dictionnaire ; corrections §2 (IA branchée sur les RPC de l'écran, note sans vente, capacité unique, période sans soirées futures, net cumulé, format des nombres, donut fictif, totaux Commandes, guest list annulée, uniques additionnés, Comptabilité, « Panier moyen » en articles, « Commandes » mixte) ; renommages ; tutoiement. | Simplifier des chiffres faux ne sert à rien. |
| **2 — Accueils** | Club + orga + Manager au squelette Ce soir · 4 chiffres · Prochaines soirées ; graphiques redondants retirés. | C'est l'écran vu chaque jour. |
| **3 — Ventes** | Kit §7 ; Vue d'ensemble à 6 blocs ; gabarit unique des 4 piliers (Billets, Tables, Bar, Guest list) ; « Ce que tu touches » → Finance ; composants à l'ancien design retirés. | Le plus gros gain de lisibilité. |
| **4 — Rapport de soirée** | Réponse en une phrase, Hype en une ligne, trafic + canaux fusionnés, « Qui achète ? » resserré, Détail avancé supprimé, état vide. | Le rapport devient l'écran du lendemain. |
| **5 — Trafic & Communauté** | Trafic 3 → 2 vues ; Communauté 5 → 3 (Abonnés allégé, Achats resserré, Public + Goûts). | Moins consultés, plus simples à couper. |
| **6 — Hors Analytics + ménage** | Service VIP opérationnel, Clients, Commandes, fiche co-soirée ; code mort §6.11. | |
| **7 — Nouveautés** | Objectif de soirée + rythme, « À retenir », récap du lendemain, repères sur la courbe. | Une fois l'existant lisible. |

À chaque lot : mode d'emploi (`ohelp.pg.analytics.*`, `ohelp.org.analytics.*`,
3 langues), articles de l'Assistant Console (`purchase-behavior`,
`collab-night-closing`…), et captures démo avant / après (`drive.mjs`, front
local branché sur la base : `VITE_APP_BASE_URL=http://localhost:8080`, CA du
proxy importée dans `~/.pki/nssdb` avec `certutil`).

**Budget d'écran visé** (blocs visibles sans rien déplier) :

| Vue | Avant | Après |
|---|---|---|
| Accueil club | 11 blocs / ≈ 30 chiffres | 5 blocs / ≈ 12 chiffres |
| Ventes › Vue d'ensemble (Détail ouvert) | ≈ 25 | 6 |
| Un pilier | 12 à 20 | 5 |
| Rapport de soirée (en vente) | 16 | 8 |
| Communauté › Abonnés | ≈ 15 | 5 |
| Trafic (3 vues) | 13 | 7 (2 vues) |

---

## Annexe — sources consultées

Shopify : help.shopify.com (overview dashboard, customizing, targets, live view,
mobile widgets), changelog.shopify.com (targets, data-driven insights).
Stripe : support.stripe.com (dashboard home charts), docs.stripe.com (reporting
chart). Shotgun : support-pro.shotgun.live (sales performance, event traffic),
pro.shotgun.live (blog event traffic). DICE : dice.fm/partners, mio.dice.fm.
Eventbrite : eventbrite.com/help (analytics tool, sales by ticket type, sales
summary), features/analytics. Posh : academy.posh.vip. Tixr : creators.tixr.com,
support.tixr.com. Fever : business.feverup.com. Xceed : xceed.me/en/business.
Weezevent : support.weezevent.com. Toast : support.toasttab.com (reporting
dashboard, sales summary, day of week, benchmarking). Square :
squareup.com/help (dashboard app). SevenRooms : sevenrooms.com/platform/reporting.
Plausible : plausible.io/docs. Fathom : usefathom.com/docs. GA4 : lovesdata.com.
Klaviyo : help.klaviyo.com. Mailchimp : mailchimp.com/resources. Mixpanel :
docs.mixpanel.com. Linear : linear.app/docs/insights. Principes : Stephen Few
(perceptualedge.com), NN/g (dashboards preattentive, choosing chart types).
NB : plusieurs centres d'aide étaient inaccessibles depuis le conteneur ; leur
contenu a été relevé par extraits de recherche.
