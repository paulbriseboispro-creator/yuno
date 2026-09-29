# Co-organisation — N parties sur une soirée (orgas × orgas × clubs)

Date : 2026-09-28. Migrations `20260928100000` → `100400`. Front : `src/lib/coorg.ts`,
`src/components/coorg/*`, `src/pages/CoorgEventPage.tsx`.

## 1. Ce qui existait, et ses limites

Le collab Yuno est un **contrat à deux** : un club + un organisateur, câblé partout à deux
(colonnes `partner_*` sur `events`, deux blocs de signature, `revenue_distributions` à deux
jambes, `SplitResult` primary/secondary, PDF à deux parties). C'est ce qui permet le partage
Stripe AUTOMATIQUE au moment de la vente — et c'est pour ça qu'il ne peut pas s'étendre à N :
un paiement Stripe chez Yuno n'a que deux jambes.

Trous trouvés pendant l'analyse (corrigés dans ce chantier) :

| Constat | Correction |
|---|---|
| Garde « partenaire » **éteint** : `protect_event_columns_from_partner` était SECURITY DEFINER avec un test `current_user = 'authenticated'` jamais vrai, et `v_is_lead` valait NULL sur une soirée menée par le club. Un orga partenaire pouvait réécrire `revenue_split_rules` (le partage lu par le checkout) par un simple UPDATE. Vérifié sur la base. | `20260928100300` : INVOKER, logique à 3 valeurs corrigée, équipes / managers inclus, colonnes recalculées exclues. Matrice de 10 cas rejouée. |
| Le **partenaire d'une co-soirée ne recevait jamais les contacts** : le trigger d'achat n'écrit qu'une portée (club si club, sinon orga). | La case email nomme tous les hôtes qui partagent le CRM et verse le contact à chacun (`share_event_marketing_consent`). |
| Une **table** achetée sur une soirée d'orga sans club ne versait l'accord dans AUCUN registre. | `auto_subscribe_newsletter_on_purchase` retombe sur la portée de la soirée. |
| Le checkout billets d'une soirée d'orga **nommait le lieu** (« Rooftop Oberkampf ») au lieu de l'organisateur quand `profiles.organization_name` était vide. | Nom public `organizer_profiles` d'abord (comme la guest list). |
| Le push « nouvelle soirée » n'allait qu'aux abonnés du club + de l'orga principal, jamais du partenaire. | `get_event_host_followers` : abonnés de TOUS les hôtes (push à redéployer, voir §6). |

## 2. Ce que fait le marché (Shotgun en tête)

Shotgun : co-hôtes Viewer / Editor, soirée affichée sur les pages des deux, acheteurs ajoutés
aux listes de contacts des deux (invitation AVANT la première vente, pas de rétroactif), push de
lancement aux deux communautés — et **l'argent ne va qu'à l'organisateur principal**, le partage
se règle hors plateforme. DICE / RA / Eventbrite : même modèle (un seul marchand, co-promoteurs
crédités). DICE ne transmet que les fans opt-in et propage les désinscriptions ; la CNIL exige que
le partenaire soit NOMMÉ à la collecte.

## 3. Le modèle Yuno : deux étages

1. **Collab contractuelle (inchangée)** — 1 club + 1 orga, partage Stripe automatique par pilier
   ou barème + décompte de fin de soirée.
2. **Co-organisation (nouveau)** — N co-hôtes (`event_cohosts` : orgas OU clubs, `editor` /
   `viewer`, `share_crm`) sur n'importe quelle soirée, y compris une co-soirée qui a déjà son
   contrat. Parties = principales (colonnes de l'événement) + co-hôtes acceptés
   (`event_parties()`), clé `venue:<id>` / `org:<uuid>`.

Ce que la co-organisation donne, par partie :
- la soirée dans SA Console : listes (champs calculés `cohost_org_ids` / `cohost_venue_ids`),
  26 RPC d'analyse / CRM élargies (`cohost_event_ids_*`), rapport de soirée ouvert au co-hôte ;
- accès RLS aux billets, tables, guest lists de la soirée ; un éditeur habille et gère la vente
  (`can_manage_event_design/tables/guestlist_house`), jamais la structure
  (`protect_event_columns_from_cohost`, INVOKER, liste blanche de colonnes) ;
- CRM : la case email du checkout NOMME tous les hôtes qui partagent le CRM ; le contact est
  versé à chacun avec sa preuve (`marketing_consent_events`). Le SMS reste à la portée principale ;
- marketing : les recettes « nouvelle soirée » et « dernier appel » de chaque hôte couvrent la
  soirée (`coorg_marketing_event_ids`), R5 garantit une seule annonce par personne ;
- page publique « Présenté par » + « Suivre tous les hôtes » (`follow_event_hosts`) ;
- carnet de partenaires (`get_my_coorg_partners`) : soirées faites ensemble, billets, « Refaire
  une soirée ».

## 4. L'argent à N : jamais Stripe, toujours tracé

Décision (CEO) : ne pas vendre un partage automatique que le logiciel n'assume pas. Au-delà de
deux parties, **le contrat Stripe est désactivé par construction** : le co-hôte n'entre jamais dans
le split, et la page le dit en clair. À la place :

1. **Accord facultatif** (`event_coorg_deals`) : parts en %, « Simple accord » (chacun valide) ou
   « Contrat signé » (termes `src/lib/coorgAgreement.ts`, signature électronique simple, PDF).
   Toute modification remet les signatures à zéro. Sans accord : dashboards + CRM partagés,
   l'argent reste à qui l'encaisse.
2. **Décompte** après la soirée (`_coorg_compute`) : ventes Yuno NETTES (fees.ts : CA − remboursé
   − Stripe 1,5 % + 0,25 €), créditées à qui les a reçues (jambes `revenue_distributions` au prorata,
   sinon l'encaisseur ; bar au club) + recettes / frais déclarés par chaque partie
   (`event_coorg_ledger`, chacun pour SA partie). Droit = part × résultat + frais avancés ; solde =
   droit − encaissé. Arrondi au centime, résidu à la plus grosse part. Validé par TOUTES les
   parties dans la même version (`stale_version` sinon).
3. **Virements** (`event_coorg_transfers`) : algorithme glouton (moins de virements possible),
   référence `YCO-…`, IBAN pré-rempli (orga) ou saisi par le bénéficiaire ; le payeur déclare, SEUL
   le bénéficiaire confirme ou conteste. Même doctrine que le règlement promoteur. Toute action
   d'argent est refusée en session d'accès assisté.

## 4 bis. Suivi des virements (29/09)

Même doctrine que le règlement promoteur : délai de paiement signé dans l'accord (7/15/30 j),
échéance par virement, relances automatiques (J-3, puis tous les 3 jours de retard, 6 max),
toutes les parties prévenues à J+7, super admin à J+14, 7 jours au bénéficiaire pour confirmer
(silence = litige), relance manuelle par le bénéficiaire (1/24 h), arbitrage super admin avec
motif. Smoke : `scripts/demo/smoke-coorg-payment-followup.sql`.

## 4 ter. Revue adverse (29/09) — ce qui a été corrigé

CRM réservé au consentement nommé (plus de base vivante / export / segments nourris par les
soirées co-hébergées, lignes de vente réservées aux éditeurs), preuve d'achat pour verser le
consentement, argent visible seulement avec une part, garde co-hôte étendue (mode, date de
publication, rejet de découverte), accord figé dès le début de la soirée, signature et
validation liées à ce qu'on a lu (version, empreinte), tables hors Yuno exclues du décompte,
refus sur un collab à barème, garde démo. Smoke : `scripts/demo/smoke-coorganization.sql`
(74 étapes).

## 5. Tests joués

- Smoke SQL rejouable (`scripts/demo/smoke-coorganization.sql`, transaction annulée) : 54 étapes,
  par rôle (orga lead, asso co-hôte, club co-hôte, étranger), invitations, refus, RLS, garde de
  structure, analyses, CRM, accord, décompte à 3 parties juste au centime, virements, consentement.
- Les 26 RPC réécrites exécutées en portée orga ET club co-hôte.
- Front réel (build prod + comptes démo, `scripts/demo/drive.mjs`) : invitation depuis le hub,
  acceptation, badge « Co-hôte » dans la liste d'événements, accord signé à deux, page publique
  « Présenté par », case du checkout nommant les deux hôtes, décompte validé par l'orga, l'asso ET
  le club, virement déclaré puis confirmé.
- Vitrine démo laissée en place : « Yuno Rooftop Sunset » (Orga Démo 50 % × Asso Yuno 30 % ×
  club Yuno 20 %, contrat signé, décompte validé, un virement reçu, un en attente) et « Rooftop
  Session » (Orga Démo × Asso Yuno, contrat actif).

## 6. Reste à faire

- **Redéployer `process-scheduled-campaigns`** pour que le push de lancement parte aux abonnés de
  tous les hôtes. Le code est prêt (avec repli) ; il n'a PAS été déployé le 28/09 car la version en
  ligne diffère du repo sur ~12 fichiers `_shared` non liés (night-recap, live-ops-alerts,
  auto-push…) : un déploiement les embarquerait sans revue.
- Porte (check-in) : un co-hôte n'a pas encore le manifeste de scan ; la porte reste à l'équipe de
  l'hôte (qui peut ajouter les gens du co-hôte à son staff).
- Codes promo d'un co-hôte sur la soirée (portée promo non élargie).
- Invitation d'une structure SANS compte Yuno (aujourd'hui : elle crée d'abord son compte pro).

## 7. Première soirée à plusieurs organisations (29/09 soir)

Décision CEO : l'argent n'est jamais une condition d'une collaboration.
- Formulaire de soirée : « Organisations partenaires » (invitées à l'enregistrement,
  rôle « Partenaire » par défaut, « Co-gestion » en option) et « Contrat & partage de
  l'argent » (« Réglé entre vous » par défaut / « Encadré par Yuno »). Même choix dans
  les deux « Proposer une soirée » club × orga.
- Club × orga « Réglé entre vous » : partage 100/0 par pilier, charge directe chez qui
  encaisse, aucun contrat (`set_event_collab_external_agreement`).
- Espace partenaire en tête de la page Co-organisation : où en est la soirée, ses
  ventes, SES liens (direct + 4 canaux semés à son nom), « Écrire à ma base ».
- Emails d'un partenaire sur SES liens (attribution juste dans « Qui fait vendre ? »),
  audience informative « acheteurs de la soirée » réservée aux parties principales.
- Reste : push d'un partenaire sur la soirée (le sélecteur de `OwnerPush` n'inclut pas
  encore les soirées co-hébergées), porte pour un « Partenaire » (réservée à la
  Co-gestion), statistiques de liens pour un membre d'équipe (`get_tracked_link_stats`
  ne connaît que le fondateur).
