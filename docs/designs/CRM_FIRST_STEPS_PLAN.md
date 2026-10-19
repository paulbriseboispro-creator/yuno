# Yuno CRM — Premiers pas : guider les premiers pas d'un compte

Demande de Paul (19/10/2026), avant d'ouvrir le compte de Jules (3AM, offre
fondateurs) : une fois le compte créé, accompagner le pro dans ses premiers pas
(Shotgun, Claude, etc.), **guidé mais jamais obligatoire**. Ce n'est pas
l'inscription (qui vit sur la landing) : c'est l'« onboarding produit », ce qui
se passe entre la première ouverture de la Console et le moment où Yuno
travaille pour lui.

Nom de travail à l'écran : « Premiers pas » (EN « First steps », ES « Primeros
pasos »), le libellé le plus courant chez les SaaS français (Brevo, HubSpot,
Notion, Qonto, Pennylane). À confirmer par Paul : une seule clé à changer
(`yc.fs.name`).

## 1. Ce que dit la recherche (sources dans le rapport du 19/10)

| Constat | Chiffre | Source |
|---|---|---|
| Une visite guidée se termine de moins en moins à mesure qu'elle s'allonge | 73 % (1-2 étapes) · 38 % (3-5) · 25 % (6-8) · 8 % (9+) | Produktly 2026, 464 SaaS |
| Lancée par la personne, elle se termine bien plus | 64-69 % contre 21-23 % lancée d'office | Chameleon 2024, Produktly 2026 |
| Une fenêtre qui s'ouvre au chargement est fermée sans être lue | ~40 % ; contenu intégré à la page : jusqu'à 1,5 × plus d'action | Chameleon 2025 |
| Le tutoriel d'entrée n'aide pas | 91 % de réussite avec, 94 % sans | NN/g |
| Une barre de progression aide | +12 % de complétion | Chameleon 2025 |
| Partir avec une étape déjà faite aide (« progrès offert ») | 34 % contre 19 % | Nunes & Drèze 2006 |
| Une liste d'étapes d'un CRM se termine rarement | médiane 10 %, CRM 13 % | Userpilot, 188 sociétés |
| Un accompagnement humain double l'activation | > 65 % contre ~2 × moins | Superhuman |

Ce qu'on en retient :

1. **Une carte intégrée à l'Accueil, jamais une fenêtre au chargement.** La
   fenêtre des Conditions Yuno CRM s'ouvre déjà à la première visite : rien ne
   s'y empile.
2. **Cinq étapes au plus**, chacune une ACTION (« Branchez… », pas « Découvrez… »),
   plus « Votre espace est ouvert » déjà cochée (progrès offert).
3. **Les étapes se cochent seules, lues dans la base**, jamais sur un clic : une
   étape faite ailleurs (ou par un membre de l'équipe) est cochée pour tout
   l'espace.
4. **Pas de visite guidée.** À la place, l'aide au bon endroit : quand le pro
   ouvre une étape depuis le guide, une petite carte l'attend sur la page (ce
   qu'il faut avoir sous la main, où cliquer, « Montrer où »), et lui propose
   l'étape suivante dès que celle-ci est faite.
5. **Masquable et reportable**, rouvrable depuis Aide, le menu du profil et la
   barre latérale ; jamais rejoué tout seul.
6. **Données d'abord** (Klaviyo, Attio) : Shotgun en premier.
7. **Fêter le vrai résultat, une fois** : le premier billet vendu par un e-mail
   Yuno, pas chaque case cochée.
8. **Une porte humaine** : « On le fait ensemble ? » mène à l'accès assisté.

## 2. Les étapes

| # | Étape | Cochée quand (lu en base) | Qui | Lien |
|---|---|---|---|---|
| 0 | Votre espace est ouvert | toujours | — | — |
| 1 | Branchez Shotgun | connexion `ticketing_connections` active (l'import en cours se dit) | titulaire | `/crm/connectors?v=wizard` |
| 2 | Signez vos e-mails | `_crm_email_identity().ready` (nom, raison sociale, adresse, conditions) | équipe | `/crm/emails/settings` |
| 3 | Envoyez votre premier e-mail | une campagne CRM partie, en cours ou programmée (un brouillon se dit) | équipe | Modèles, sur la prochaine soirée |
| 4 | Allumez une automatisation | une recette allumée ou un scénario en ligne | équipe | `/crm/automations` |
| 5 | Branchez Claude | une connexion MCP vivante sur l'espace | chacun | `/crm/connectors?v=claude` |
| + | Créez vos segments | au moins un segment | équipe | `/crm/segments?new=rec` |
| + | Invitez votre équipe | un membre accepté | titulaire | `/crm/account/team` |

Les deux dernières sont « Pour aller plus loin », repliées, hors de la barre.
L'ordre n'est jamais une serrure : chaque étape s'ouvre à tout moment ; la
« prochaine » est la première non faite.

Résultat suivi après le premier envoi : acheteurs dont le billet porte une
source d'e-mail Yuno (`utm_source` `yuno-m-…`).

## 3. Où il vit

- **Accueil** : la carte « Premiers pas » en tête (progression, étape suivante
  dépliée avec son bouton, étapes faites repliées avec leur résultat réel). Elle
  remplace la liste « Pour bien démarrer » de l'Accueil tant qu'elle est là.
- **Barre latérale** : une entrée « Premiers pas » avec son anneau de
  progression, au-dessus de Connecteurs, tant que le guide n'est ni masqué ni
  terminé. Elle ouvre un volet avec la même liste.
- **Sur la page d'une étape** (ouverte depuis le guide, `?guide=<étape>`) : une
  carte compacte en bas à droite, réductible, qui dit quoi faire ici et
  « Montrer où » (anneau autour de l'élément `data-yc-guide`). Dès que l'étape
  est faite : « C'est fait » et l'étape suivante.
- **Rouvrir** : Compte › Aide (carte en tête), menu du profil.

## 4. Qui le voit

- Le titulaire : d'office tant que les étapes ne sont pas toutes faites et que
  le compte CRM a moins de 60 jours.
- Un membre de l'équipe qui peut écrire : depuis Aide ou le menu ; les étapes
  du titulaire disent « {prénom} s'en charge ».
- Un lecteur : jamais.
- Aperçu démo, accès assisté : visible depuis Aide, jamais d'office, et aucune
  préférence enregistrée (Yuno ne masque pas le guide à la place du pro).

## 5. Base

Migration `20261101100000_crm_first_steps.sql` :

- `crm_first_steps` (personne × espace) : `dismissed_at`, `snoozed_until`,
  `finished_at`. RLS sans policy. **Aucune étape n'y est écrite** : l'avancement
  se relit à chaque fois.
- `crm_first_steps(venue, orga)` : l'état (porte `crm_scope_allowed`), lecture
  seule, sans table temporaire (passe en aperçu démo).
- `crm_first_steps_set(venue, orga, action)` : `dismiss`, `snooze` (jusqu'à
  demain 6 h, heure de Paris), `resume`, `finish`. Sans effet en accès assisté.

Le front se tait si la fonction n'existe pas encore (front livré avant la
migration) : pas de guide, pas d'erreur.
