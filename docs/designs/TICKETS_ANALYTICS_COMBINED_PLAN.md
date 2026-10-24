# Yuno Tickets › Analyses : combiner l'Analytics de la Billetterie et les Analyses du CRM

> 22/10, à la demande de Paul : « fais un mélange des deux, les analytics de Yuno
> Tickets spécialisées pour le logiciel et celles de Yuno CRM que j'aime ».
> Statut : **proposition, rien de construit**. Point de départ : la copie des
> Analyses du CRM sur la branche `tix/analytics` (PR #26) et l'Analytics actuelle
> (`OwnerAnalytics.tsx`, `OrgAppAnalytics.tsx`).

## 1. Le verdict en une phrase

**Le CRM a la meilleure façon de LIRE ; la Billetterie a les meilleures DONNÉES.**
On garde le squelette, la grammaire et les définitions du CRM, et on y range, à
une place précise, chaque bloc que seule la Billetterie sait calculer. On ne fait
pas l'inverse : la Billetterie a trop de niveaux de navigation et des définitions
qui se contredisent, c'est elle qu'il faut ranger.

## 2. Les deux en face

### Ce que le CRM fait mieux (à garder tel quel)

| Force | Pourquoi c'est mieux |
|---|---|
| **Une question par écran, une réponse d'abord** (héros + chiffre géant + phrase « à retenir ») | On comprend en 3 secondes ; la Billetterie empile 4 cartes de KPI sans phrase. |
| **Comparaison partout** (période d'avant, ou soirée d'avant de la même série, au même J-N) | La Billetterie compare tantôt une fenêtre égale, tantôt des soirées. |
| **Filtre de segment** (habitués, occasionnels, nouveaux, endormis) sur Ventes et Communauté | N'existe pas dans la Billetterie. |
| **Rythme de vente** (jauge + attendu aujourd'hui + estimation) et **courbe comparée aux deux dernières** | Plus actionnable que la courbe moyenne par soirée. |
| **« Quand mes clients achètent-ils ? »** (jour × créneau) et **tarifs** | Clair, une carte chacun. |
| **« Quelles soirées marchent le mieux ? »** (remplissage + ventes + vs précédente) | Remplace « Top soirées » + « Bilan par soirée ». |
| **Trafic par source** avec nouveaux clients, contacts gagnés, et marques d'envoi | La Billetterie sépare canaux, liens, e-mails dans trois blocs. |
| **Communauté** : cycle de vie aux règles réglables, « Qui revient » (cohortes +1 à +4), fréquence, valeur par groupe, âge / ville, meilleurs clients, **trois groupes à réveiller avec un bouton** | La Billetterie a trois segmentations différentes (Fidélité, RFM du Public, Abonnés). |
| **Gratuits** : gratuit → payant, taux de venue honnête (porte mesurée, seuil 10), listes, heure d'arrivée | La Billetterie a beaucoup de chiffres guest list mais pas la conversion gratuit → payant. |
| **Parcours client** (reçu → ouvert → clic → achat → retour, qui s'arrête, quelle campagne convertit) | N'existe pas dans la Billetterie. |
| **Règles d'honnêteté** : pas de % sous 10, « — » plutôt que 0, une seule définition par mot | La Billetterie affiche « 100 % nouveaux », « €5.3k », « Clients uniques » à vie mélangés à la période. |
| **Finition** : animations, mêmes pièces partout, export par onglet, un seul niveau de filtres | — |

### Ce que la Billetterie a et que le CRM n'a pas (à apporter)

| Bloc de la Billetterie | Valeur |
|---|---|
| **Piliers** : Billetterie (lancement, phases, prévente vs public, liste d'attente), **Tables VIP** (zones, minimums, acomptes, consommation, rotation, hôtes), Guest list (détenteurs de liste, quotas), **Remboursements** | Le cœur du métier ; le CRM ne voit qu'un « billet ». |
| **« Ce que vous touchez »** (volume brut − Stripe − remboursements = net versé / gain net après partenaire) | L'argent réel ; absent du CRM. |
| **Partenaires** (promoteurs : ventes attribuées, commissions, clic → vente, rendement) | Absent du CRM (seulement une source « promoteurs »). |
| **Rapport d'une soirée** : objectif d'entrées + rythme, « À retenir » serveur, repères sur la courbe (publication, nouveau tarif, e-mail, push), comparer avec n'importe quelle soirée, détail des ventes ligne par ligne, verdict après coup, prévision Hype | Beaucoup plus profond que la vue « une soirée » du CRM. |
| **La soirée / la porte** : présents, no-show, revenu par tête, tables arrivées, arrivées par heure | Le CRM n'a que la porte des gratuits. |
| **Comportement d'achat** : délai d'achat, taille des commandes et des tables, options prises, achats croisés, acheté ≠ venu | Absent du CRM. |
| **Visites** : page du club / de l'organisateur, visites par soirée, tunnel visite → achat | Déjà ajouté en partie à la copie (« De la visite à l'achat »). |
| **Abonnés et push** : croissance, rétention, portée push, revenu des abonnés, goûts musicaux | Absent du CRM. |
| **En direct** (globe, ventes de l'instant) | Déjà ajouté à la copie (22/10). |

### Les défauts de la Billetterie à ne pas recopier

- **Quatre niveaux de navigation** sur Ventes : famille, vue, carte de pilier, ancres (+ sous-onglets dans Billetterie). On se perd.
- **Définitions qui se contredisent** : « Revenu brut » (tout ce qu'a payé le client) à côté du CA club ; « Clients uniques » sur la période mais « Fidélité » à vie ; trois segmentations (Nouveaux / Actifs / À risque / Perdus, RFM à 7 noms, Abonnés) ; attribution d'un e-mail à 72 h ici, 7 jours au CRM.
- **Calculs dans le navigateur** (`useAnalyticsData`, `useNightAnalytics`, `usePromoterAnalytics`, gain net de l'organisateur) : lents, et plafonnés à ~1 000 lignes par PostgREST.
- **Code mort** : `SalesOverviewView`, `SalesPillarDetail`, la vue « Sources » et la vue « Goûts » ne s'affichent plus.
- **Blocs faibles** : « Revenu brut — horaire » (l'heure de la journée, sans soirée), « Top soirées » qui double le bilan, chiffres abrégés (€5.3k), en mode soirée les zones répétées avec des écarts vides.

### Les limites de la copie du CRM (ce qui lui manque pour la Billetterie)

- Les tables VIP n'y sont qu'un tarif ; pas de remplissage des tables, de minimum, d'acompte.
- Pas d'argent net (Stripe, part partenaire), pas de remboursements détaillés.
- La vue « une soirée » ne couvre que J-21 → J, sans objectif, sans repères, sans verdict.
- « Écrire à… » ouvre une campagne vide (les segments de la Billetterie ne sont pas encore ceux du CRM : session `tix-clients`).
- « Ce qui fait venir » (moteur d'analyse) n'est pas transposé.

## 3. La cible : le squelette du CRM, avec les blocs de la Billetterie rangés dedans

Mêmes règles que le CRM : une question par onglet, héros + 4 tuiles + cartes, un seul
rang de filtres (période · soirée · segment · comparer), « — » sous 10, et chaque
nouveau chiffre calculé par la base (RPC `tix_*`), jamais dans le navigateur.

| Onglet | Base CRM (déjà copiée) | Ce qu'on y ajoute de la Billetterie, et où |
|---|---|---|
| **Ventes** « Combien ai-je vendu ? » | Héros, 4 tuiles, rythme + courbe, jour × créneau, tarifs, soirées, ce qui a fait vendre | (1) un **sélecteur de pilier** dans le héros (Tout · Billets · Tables VIP · Guest list · Remboursements) qui change le héros et les tuiles, à la place des cartes de pilier ; (2) les tuiles d'un pilier : pour les tables, remplissage, panier, minimum, acomptes ; pour les remboursements, taux, montant, motifs ; (3) **« Ce que vous touchez »** en bas, à la place du bandeau sombre quand on choisit « Tout » ; (4) dans « Quelles soirées marchent », les entrées et le net par soirée (le bilan par soirée disparaît). |
| **Partenaires** « Qui vend pour moi ? » | (nouveau, dessiné comme les cartes du CRM) | Promoteurs : ventes attribuées, commissions, clic → vente, rendement, classement ; les liens partenaires et co-organisateurs ; « Qui fait vendre » d'une co-soirée. |
| **Trafic** « D'où vient mon public ? » | Qui fait vendre (par source), tuiles, sources, nouveaux, soirées qui attirent, de la visite à l'achat | La **page du club / de l'organisateur** (visites, d'où), le détail des **liens suivis** et des **e-mails / push** (aujourd'hui dans « D'où viennent les ventes ») sous chaque source. |
| **Communauté** « Qui sont mes clients ? » | Base, cycle de vie, joignables, qui revient, fréquence, qui vient, âge / ville, meilleurs clients, à réveiller | Une sous-vue **Abonnés** (croissance, portée push, revenu des abonnés) et une sous-vue **Achats** (délai d'achat, taille des commandes et des tables, options, achats croisés, acheté ≠ venu) ; le genre et les **goûts musicaux** dans « Qui sont-ils ». Les segmentations Fidélité et RFM disparaissent : une seule, celle du CRM. |
| **Gratuits** « Qui entre gratuitement, et qui finit par payer ? » | Tout l'onglet du CRM | Quotas et remplissage des listes, détenteurs de liste (promoteurs), « un invité vaut-il un client payant ? », manque à gagner des no-show. |
| **Une soirée choisie** (filtre « Soirée ») | La même grammaire, restreinte à la soirée | Le **rapport de soirée** de la Billetterie en tête : la phrase, l'objectif d'entrées + rythme, « À retenir », les repères sur la courbe, « comparer avec », le détail des ventes, **la porte** (présents, no-show, revenu par tête, arrivées par heure), la prévision (club) avant, le verdict après. |
| **En direct** | — | La Live View telle quelle (déjà fait). |
| **Parcours client** | Tout le parcours du CRM | Le canal **push** (la Billetterie en envoie ; le CRM non) et le SMS. |

Ce qu'on retire de la Billetterie : « Revenu brut — horaire », « Top soirées »,
« Bilan par soirée » (fondu dans les soirées), les cartes et ancres de pilier, les
trois anciennes segmentations, le code mort.

## 4. Les définitions à trancher (une seule par mot)

| Sujet | Billetterie aujourd'hui | CRM | Recommandation |
|---|---|---|---|
| Chiffre d'affaires | « Revenu brut » à côté du CA club | CA (montant de la vente) | **CA club de `fees.ts`** partout ; le brut seulement dans « Ce que vous touchez ». |
| Attribution d'un e-mail | 72 h après le clic | 7 jours | **7 jours** (décision D7 du 17/10). |
| Habitués | Fidélité / RFM / abonnés | N soirées en M mois (réglable) | **Règles du CRM** (D7). |
| « Venu » | Billet scanné | Porte mesurée (≥ 10 scans et ≥ 10 %) | **Porte mesurée**, sinon « porte non mesurée ». |
| Périodes | 24 h · 48 h · 72 h · 7 j · 30 j · Tout | 24 h · 48 h · 7 j · 30 j · 90 j · 12 mois | **Celles du CRM** + « Tout ». |
| Comparaison | Fenêtre égale / soirées d'avant | Période d'avant, soirée d'avant de la série au même J-N | **Celle du CRM**. |

## 5. Les décisions à prendre (Paul)

1. **Valider le principe** : squelette et définitions du CRM, blocs de la Billetterie rangés dedans (tableau §3).
2. **Partenaires** : un onglet à part (recommandé), ou une section de Trafic ?
3. **Abonnés et Achats** : sous-vues de Communauté (recommandé, comme le CRM a « Vue d'ensemble / Ce qui fait venir »), ou onglets ?
4. **Les définitions du §4** (recommandées : celles du CRM).
5. **Quand l'ancienne Analytics disparaît** : dès que la nouvelle couvre tout le tableau de parité (§6), recommandé.

## 6. Comment le construire (sessions)

Chaque lot : RPC `tix_*` d'abord (répétée en prod dans une transaction annulée),
écran dans le dessin du CRM, captures sombre / clair, ordinateur / téléphone, puis
ton accord. Une **feuille de parité** liste chaque chiffre de l'ancienne Analytics
et dit où il vit dans la nouvelle (ou pourquoi il disparaît) : rien ne se perd sans ton accord.

| Lot | Contenu | Ordre |
|---|---|---|
| 1 | Ventes : sélecteur de pilier, tuiles Tables VIP / Remboursements, « Ce que vous touchez », soirées avec entrées et net | d'abord (le plus utilisé) |
| 2 | Une soirée choisie : rapport de soirée de la Billetterie en tête, la porte, objectif, repères, verdict, prévision | 1 |
| 3 | Partenaires | indépendant |
| 4 | Trafic : page du club / organisateur, détail liens / e-mails / push | indépendant |
| 5 | Communauté : sous-vues Abonnés et Achats, genre et goûts | après la session `tix-clients` (segments) |
| 6 | Gratuits : quotas, détenteurs, valeur d'un invité | indépendant |
| 7 | Parcours client : canal push | indépendant |
| 8 | Bascule : `TIX_ANALYSES_LIVE = true`, ancienne Analytics supprimée, mode d'emploi, assistant, `CLAUDE.md` | à la fin |

Les lots 3, 4, 6 et 7 peuvent tourner en parallèle, chacun dans son dossier ; 1 et 2
touchent les mêmes fichiers (Ventes) et passent l'un après l'autre.
