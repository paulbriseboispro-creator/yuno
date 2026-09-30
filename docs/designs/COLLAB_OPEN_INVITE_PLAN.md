# Collaboration ouverte — un seul verbe, « inviter sur une soirée » (2026-09-30)

Méthode : skill `simplification`. Suite de `COLLAB_SIMPLIFICATION_PLAN.md`.
Demande de Paul : « le mode collab est tourné vers UN club ; en tant qu'orga ou
club je dois pouvoir collaborer avec un club, une orga, plusieurs orgas et un
club, plusieurs clubs… déjà sur Yuno ou pas. Et une orga qui n'a jamais
travaillé avec moi doit pouvoir être invitée. Le partenariat (demande +
contrat + pourcentages) n'a plus de sens depuis que le contrat est optionnel. »

## Diagnostic

| # | Bloc (avant) | Défaut | Destination |
|---|---|---|---|
| 1 | Dialogue « Nouvelle collaboration » : 4 chemins | tous pensés « un club » pour une orga ; « Proposer » grisé sans partenariat | 2 chemins : **une nouvelle soirée / une soirée déjà créée** |
| 2 | Formulaire : « Mode de collaboration » (4 cartes) | une décision sur un club qu'on n'a pas encore choisi | rangé dans la ligne du **Lieu / Organisateur** (Co-soirée · Location de salle · Le club pilote) |
| 3 | Formulaire : « Club partenaire » (liste des partenariats actifs) | impossible d'inviter quelqu'un de nouveau ; 1 seul club | fusionné dans **« Avec qui fais-tu cette soirée ? »** |
| 4 | Formulaire : « Organisations partenaires » | 2ᵉ recherche, 2ᵉ système pour la même question | fusionné dans le même bloc |
| 5 | Formulaire : « Contrat & partage de l'argent » | défaut tiré des conditions du partenariat | gardé sous le bloc, défaut « Réglé entre vous », contrat Yuno = part de l'orga (billets / tables) |
| 6 | Onglet « Partenaires » : partenariats (demande + %), cartes, « Proposer une soirée », révocation | un pré-requis qui ne sert plus | retiré → **Annuaire** |
| 7 | Dialogues « Proposer une soirée » (club et orga) | doublon du formulaire | retirés (le formulaire fait tout) |
| 8 | Invitation email à part (onglet / dialogue) avec son propre deal | 3ᵉ façon d'inviter | dans la même recherche : « Inviter par email » |
| 9 | 2ᵉ formulaire orga (`OrgEventFormDialog`) : mode + club partenaire | idem #2-#3 | retiré ; affiche le lieu rattaché, renvoie vers « Avec qui ? » |

Score : 2 systèmes d'invitation → 1 ; 4 blocs de formulaire → 1 (+ l'argent) ;
4 portes → 2 ; partenariat préalable → aucun.

## Le modèle

**Tout le monde s'invite, tout le monde accepte.** L'invitation de
co-organisation (`event_cohosts`) sert désormais à TOUT : elle porte un rôle.

- `principal` — le **Lieu** (un club, quand une orga mène) ou l'**Organisateur**
  (une orga, quand un club mène). Un seul par soirée publique. À l'acceptation,
  `_collab_promote_principal` le rattache (`partner_venue_id` /
  `partner_organizer_id`, `event_mode`, responsabilités du mode) et applique
  l'accord choisi (`principal_terms`) : « réglé entre vous » (partage 100/0 par
  pilier, vente ouverte) ou contrat Yuno pré-signé par le lead, réglé par
  virement (Stripe = charges directes seulement).
- `cohost` — **Co-gestion** (`editor`) ou **Partenaire** (`viewer`), inchangé.

Par email : une ORGANISATION passe par `create_cohost_email_invite` (rôle
compris) ; un CLUB hors Yuno ne peut arriver que comme lieu, via
`invite-club-collab` (son club se crée à l'acceptation, l'accord « réglé entre
vous » est respecté).

Le formulaire ne ÉCRIT plus jamais le partenaire : une soirée est solo tant que
le lieu / l'organisateur n'a pas accepté. Choisir un club comme lieu remplit
l'adresse de la soirée avec la sienne.

## Fichiers

- Migration `20260930210000_collab_open_invitations.sql` : colonnes `role`,
  `principal_terms` (+ statut `promoted`), `_collab_principal_terms`,
  `_collab_principal_blocker`, `_collab_promote_principal`,
  `invite_event_cohost` / `create_cohost_email_invite` (DROP + CREATE,
  `p_principal`, `p_terms`), `respond_event_cohost_invitation`,
  `accept_cohost_email_invite`, `get_my_cohost_invitations` (rôle), et
  `get_collab_directory` (l'annuaire). Smoke rejoué dans des transactions
  annulées : org → club et club → org, réglé entre vous et contrat Yuno.
- Front : `src/lib/collabInvite.ts` (règles pures, testées),
  `EventPartnersField` + `YunoSplitFields`, `sendPartnerInvites`,
  `OwnerEvents` (bloc unique, `?new=1`, `?edit=…&focus=partners&with=…`),
  `NewCollabDialog`, `CollabHub`, `CollabDirectory`, `CoorgInvitesInbox`.
- Edge : `invite-organizer-collab` (`_shared/coorg-invite.ts`,
  `buildCoorgInvitation`), `accept-club-collab-invitation`.

## Rien n'a disparu

- Les tables `venue_organizer_partnerships` restent : les anciens partenariats
  actifs apparaissent dans l'annuaire (« déjà travaillé ensemble »), sans soirée.
- Contrats-cadres des séries récurrentes : sous l'annuaire.

## Reste

- Les séries récurrentes choisissent encore leur organisateur parmi les anciens
  partenariats (`RecurringEventsManager`) : même traitement à faire.
- Jouer club + orga sur la démo, deux thèmes, mobile.
