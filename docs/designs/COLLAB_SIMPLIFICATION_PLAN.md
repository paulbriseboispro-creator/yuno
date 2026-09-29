# Collaborations — plan de simplification (2026-09-29)

Méthode : skill `simplification` (refonte Analytics). Surfaces : hub
`/owner/collaborations` + `/organizer-app/collaborations`, page de co-soirée
`/owner/collab/event/:id` + `/organizer-app/events/:id` (`CollabEventDetail`),
page de co-organisation `/…/coorg/:id` (`CoorgEventPanel`). Base : `main` +
branche `claude/brave-pasteur-whnd2x` (co-organisation à N parties, virements
suivis, Stripe Oui / Non).

## Le constat

Le système est complet (club × orga, orga × orga, N parties, contrat, barème,
décompte, virements) mais il se présente comme **deux produits côte à côte** :
le « collab » (deux parties, contrat, Stripe) et la « co-organisation »
(N parties, accord, virements). Chacun a SA liste de soirées, SA boîte de
réception, SON carnet de partenaires, SA façon d'inviter. Un pro qui a une
soirée avec un partenaire ne sait pas par quelle porte entrer.

## Grille d'audit (résumée)

| # | Bloc (avant) | Question | Défauts | Destination |
|---|---|---|---|---|
| 1 | Onglet « Soirées » | Où en sont mes soirées à deux ? | DUP #5 | fusionner → Soirées (liste unique) |
| 2 | Onglet « Organisateurs » / « Clubs partenaires » | Avec qui je travaille ? | DUP #7 | ranger → Partenaires |
| 3 | Onglet « Inviter » (email) | Comment faire venir quelqu'un hors Yuno ? | 4ᵉ porte d'entrée | ranger → « Nouvelle collaboration » › Pas encore sur Yuno (dialogue) |
| 4 | Onglet « Co-organisation » : carte d'explication | C'est quoi ? | TITRE, texte long | ranger → une ligne dans « Nouvelle collaboration » |
| 5 | Co-organisation : soirées | Où en sont mes soirées à plusieurs ? | DUP #1 | fusionner → Soirées (liste unique) |
| 6 | Co-organisation : invitations reçues | Qu'est-ce que je dois accepter ? | DUP #9 | fusionner → Soirées › À traiter |
| 7 | Co-organisation : « Vos partenaires » | Avec qui je travaille ? | DUP #2, autres chiffres | fusionner → Partenaires (sans doublon de personne) |
| 8 | Contrats-cadres (en tête de Soirées) | Quels accords récurrents ai-je ? | pas une tâche, posé au-dessus de la liste | ranger → Partenaires |
| 9 | Propositions + avenants (en tête de Soirées) | Qu'est-ce que je dois signer ? | éclaté en 3 boîtes | garder → Soirées › À traiter (une section) |
| 10 | Carte soirée club : 3 pastilles (mode, statut, initiateur) | Où en est-elle ? | JARGON (« org_hosted », « initié par ») | garder UNE pastille = l'étape (« À signer », « En attente de Goya ») |
| 11 | Carte soirée club : 4 liens (billets, tables, GL, factures) | — | DUP de la page soirée | retirer (la page les porte, tiroir « Détails ») |
| 12 | Carte soirée club : « Répartition des ventes » | D'où viennent les ventes ? | FRONT, LENT (1 requête par carte), DUP #22 | retirer (reste dans la page › Analyse) |
| 13 | Carte soirée : pause / suppression toujours visibles | — | action dangereuse en façade | replier → page soirée › « Gérer la collaboration » ; la carte ne montre qu'une DEMANDE en cours |
| 14 | Carte soirée orga : bouton « Aperçu » / « Ouvrir » | — | asymétrie club/orga | fusionner → carte unique cliquable |
| 15 | 4 boutons d'invitation (Inviter / Demander un partenariat / Proposer une soirée / Co-organiser) | Comment je commence ? | 4 portes | fusionner → UN bouton « Nouvelle collaboration » + choix guidé |
| 16 | En-tête page soirée : 5 pastilles + 3 boutons | — | pastille « Co-événement » redit la ligne des partenaires ; « Live » redit la feuille de route | garder phase + visibilité (+ Aperçu) ; « Copier le lien », « Voir » |
| 17 | Outils : « Page publique » | — | DUP de « Voir » | retirer |
| 18 | Outils : « Live » et « Check-in » (club : même route) | — | DUP | fusionner côté club |
| 19 | Carte « Billetterie » orga (texte + bouton) | — | DUP de l'outil et de la feuille de route | garder seulement quand elle apporte quelque chose (club qui tient la billetterie → aperçu des tarifs ; Stripe manquant) |
| 20 | Co-organisation d'une soirée collab | Puis-je ajouter un 3ᵉ organisateur ? | injoignable depuis la page soirée | ajouter l'outil « Co-organisateurs » |
| 21 | Chiffres `toFixed(2) €` | — | format | `useNumberFormat` |
| 22 | « La soirée en preuve » | D'où viennent les ventes ? | JARGON, sous-titre faux (parle du partage) | renommer « D'où viennent les ventes » |

Score : 7 DUP → 0, 4 portes d'entrée → 1, 4 onglets → 2, 3 pastilles par carte → 1.

## La nouvelle forme

**Hub Collaborations = deux onglets, une action.**

- Bouton unique **« Nouvelle collaboration »** → dialogue « Avec qui ? » :
  1. *Proposer une soirée à un partenaire* (contrat club × organisateur, argent
     partagé par Yuno) — grisé tant qu'il n'y a pas de partenaire actif ;
  2. *Ajouter un partenaire Yuno* (recherche, il accepte) ;
  3. *Inviter quelqu'un qui n'est pas sur Yuno* (email, avec la soirée et les
     conditions) ;
  4. *Co-organiser une de mes soirées à plusieurs* (N organisateurs / clubs,
     parts réglées par virement).
- **Soirées** (`?tab=nights`, défaut) : « À traiter » (propositions, avenants,
  invitations de co-organisation — chaque boîte se tait vide), puis UNE liste
  des soirées à plusieurs (collab ∪ co-organisation, fusionnées par soirée),
  passées repliées. Carte = affiche, titre, date, « Avec X · Y », UNE pastille
  d'étape, demande de pause / suppression en cours seulement.
- **Partenaires** (`?tab=partners`) : invitations reçues, partenaires actifs
  (conditions par défaut, historique ensemble, « Proposer une soirée »),
  partenaires de co-organisation qui ne sont pas déjà dans la liste,
  contrats-cadres, demandes envoyées, historique replié.
- Anciennes adresses : `events`, `coorg` → `nights` ; `organizers` →
  `partners` ; `invite` → `nights` + dialogue d'invitation ouvert
  (`src/lib/collabHubNav.ts`, testé).

**Page de co-soirée** : feuille de route inchangée (§13), en-tête allégé,
outils sans doublon + « Co-organisateurs », carte Billetterie orga seulement
quand elle informe, « Gérer la collaboration » (pause / suppression) replié en
bas, montants au format de la langue.

## Lots

| Lot | Contenu | État |
|---|---|---|
| A | `collabHubNav` + test, dialogue « Nouvelle collaboration », hub à deux onglets (club + orga), liste unique, carte unique, partenaires fusionnés | livré 29/09 |
| B | Page de co-soirée : en-tête, outils, billetterie orga, gestion repliée, formats | livré 29/09 |
| C | Aide (`ohelp.*` ×3), assistant (`HELP_ARTICLES`), `CLAUDE.md`, lint / test / build | livré 29/09 |
| D | Hors code : jouer club + orga + co-organisation sur la démo (`drive.mjs`), deux thèmes, mobile | à faire (Paul) |

Rien n'a été retiré de la base ni des RPC : toutes les données restent
servies, elles sont rangées ailleurs ou repliées.
