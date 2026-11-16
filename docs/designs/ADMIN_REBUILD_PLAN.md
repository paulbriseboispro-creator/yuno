# Refonte de l'admin Yuno — un seul admin, organisé par question

Date : 2026-11-16. Statut : architecture validée par Paul ; lots 0 à 7 construits et assemblés le 16/11 sur la branche `claude/admin-rebuild-integration-024194` (section 7), PAS en ligne : migrations à appliquer puis front à déployer (section 9).
Sources : audit de l'existant (36 entrées de menu, 2 admins, 121 RPC) et étude
des back-offices de marketplace / SaaS (a16z, Stripe Connect, Stephen Few,
guides d'accès assisté, RGPD / DSA / DAC7).

## 1. Ce qui ne va pas aujourd'hui (constats de l'audit)

1. Deux admins (`/admin` sombre, `/admin/crm` clair) : deux menus, deux
   recherches, deux « Pilotage », deux « Clients », deux pages démo, deux pages
   d'accès assisté. Un compte Billetterie + CRM se lit à deux endroits.
2. 36 entrées de menu. Le même chiffre vit à plusieurs endroits : inscriptions
   (8 endroits), MRR (5), pool e-mail (4), leads (3 tables, 3 pages, 3 cases
   « contacté »), invitations (6 portes), « ce qui s'est passé » (3 flux).
3. Le Cockpit compte mais ne dit pas quoi faire : 17 lignes de « Santé » qui
   mêlent technique et commercial, sans action, sans le MRR du CRM.
4. Graphiques : séries sur un axe caché, axes sans unité, cinq vocabulaires de
   période, pas de comparaison sur les revenus, palette d'un rouge et trois gris.
5. Aucune fiche complète d'un pro (pas de page organisateur ni agence). Fiche
   d'un client coupée en deux. Rien de légal côté Billetterie.
6. L'interrupteur « Démo incluse » est ignoré par la moitié des pages.
7. `/admin` ne vérifie pas la 2FA, `/admin/crm` oui.

## 2. Principes (tirés de l'étude)

- Un admin s'ouvre pour trois raisons : qu'est-ce qui demande une décision,
  qui est ce compte, comment va l'entreprise. Le menu suit ces tâches, pas les
  tables de la base.
- Une page = une question, écrite en titre. Quatre à six chiffres en tête,
  chacun comparé à la période précédente, chacun menant à une liste, chaque
  liste à une action.
- Un nom = une formule (dictionnaire `src/lib/metrics.ts`, déjà en place).
- Cinq formes de graphique au plus : chiffre, courbe, barres, barres empilées,
  tableau. Axes visibles avec unité, une seule échelle par graphique.
- Une seule période pour toute une page (7 j, 30 j, 90 j, 12 mois), comparée à
  la même durée juste avant.
- Toute action sensible demande un motif et entre au journal.
- Recherche globale ⌘K partout : pro, client, soirée, commande, page.

## 3. Architecture cible : un admin, huit rubriques

Adresse unique `/admin`. Les anciennes adresses (`/admin/crm/*` comprises)
redirigent. Noms de rubriques à valider par Paul.

| Rubrique | Question | Contenu |
|---|---|---|
| **Aujourd'hui** | Qu'est-ce qui demande une décision ? | File unique « à traiter » (pros à rappeler, inscriptions bloquées, essais CRM qui finissent, synchros en échec, soirées à modérer, demandes de support, virements à trancher, ventes payées sans billet, échéances, demandes RGPD), chaque ligne avec son bouton et « traité ». Six chiffres de la semaine (ventes, revenu Yuno, MRR, nouveaux pros, pros actifs, acheteurs). Feux de santé (paiements, e-mail, crons, apps). Fil d'activité unique. |
| **Pilotage** | Comment va l'entreprise ? | Vue d'ensemble (revenu Yuno = commissions + abonnements + Yunits) · Acquisition des pros (un seul entonnoir Billetterie + CRM) · Activation et rétention des pros (cohortes, santé) · Audience et acheteurs (trafic, tunnel, récurrence) · Produit et usage (signaux, IA, MCP, NPS, demandes). |
| **Pros** | Qui sont mes comptes et où en sont-ils ? | Tous les comptes (clubs, organisateurs, associations, agences, comptes CRM) dans une seule liste triable, avec produit, statut, santé, ventes, dernier signe de vie · **Fiche d'un pro** : identité, produits, Stripe, ventes, soirées, équipe, usage CRM, envois, support, légal, notes, gestes · Prospects (leads Links + inscriptions + pipeline CRM réunis) · Inviter (une seule porte) · Démo (une seule liste) · Accès assisté (une seule page). |
| **Clients** | Qui achète sur Yuno ? | Base des acheteurs (segments, cohortes) · **Fiche d'une personne** unique (achats, billets, consentements, messages reçus, notes, sécurité du compte) · Soirées (modération) · Annuaire DJ, promoteurs, staff. |
| **Argent** | Qu'a-t-on vendu, gagné, et que reste-t-il à régler ? | Ventes et commissions · Commandes et remboursements · Litiges Stripe · Factures · Virements entre parties en retard · Abonnements CRM et Yunits · Coûts et marge (Resend, SMS, IA, hébergement). |
| **Communication** | Que dit Yuno, et est-ce que ça arrive ? | Campagnes de Yuno (e-mail, SMS, push) · Notifications automatiques (moteur, règles) · Délivrabilité (un seul endroit : pool, Postmaster, niveaux par compte, sous-domaines, suppressions) · Page bio Yuno Links. |
| **Légal** | Sommes-nous en règle ? | Consentements et preuves · Acceptations des conditions (Billetterie et CRM) · Demandes RGPD et suppressions de compte (échéance d'un mois) · Incidents (72 h) · Vendeurs : identité, TVA, DAC7 / DSA · Sous-traitants · Échéances (certificats, secrets) · Journal d'audit unique. |
| **Système** | Est-ce que la machine tourne ? | Santé technique (apps, OTA, crons, base, webhooks) · Interrupteurs (maintenance, paiements, canaux) · Offre et tarifs · Connecteurs (Shotgun) · IA (coûts). |

Ce qui disparaît du menu : Cockpit, Croissance, Inscriptions pro, Revenus,
Signaux produit, Consommation IA, Clubs, Organisateurs, Agences, Annuaire,
Commandes, Retours, Alertes, Journal, et les douze entrées de l'Admin CRM. Leur
contenu est rangé dans les rubriques ci-dessus ; rien n'est supprimé sans
équivalent.

## 4. Décisions prises (à contredire si besoin)

- **Un seul style, le meilleur disponible, sans lien obligé avec la marque
  Yuno** (décision de Paul du 16/11 : « le meilleur possible, pas grave si pas
  de rapport avec Yuno, les meilleures choses en libre service »). Outil
  interne sobre à la Linear / Vercel / Stripe : neutres, une seule couleur
  d'accent, clair et sombre, Geist Sans + Geist Mono (licence OFL), composants
  shadcn/ui (déjà dans le dépôt), graphiques shadcn Charts sur Recharts,
  palette `cmdk`, tableaux TanStack Table. Titres en forme de question. Le kit
  vit dans `src/admin/ui/` et remplace `src/components/admin/ui.tsx` et
  `src/crm/admin/ui.tsx` lot par lot ; les écrans existants sont d'abord
  remontés tels quels dans la nouvelle coquille.
- **Les calculs ne changent pas.** Les RPC existantes sont réutilisées ; les
  nouvelles ne font qu'assembler (file du jour, liste de comptes, fiche, recherche).
- **2FA exigée** pour tout l'admin.
- **Démo** : un seul interrupteur, lu par toutes les pages.
- Pilier boissons : aucune trace dans le nouvel admin (porte `DRINKS_PILLAR_LIVE`).

## 5. Lots de construction

Ordre : lot 0 seul, puis lots 1 à 6 en parallèle (un worktree chacun, fichiers
disjoints), puis lot 7. Une migration par lot, jouée une à la fois sur la prod.

| Lot | Modèle | Contenu | Fini quand |
|---|---|---|---|
| **0. Fondations** | Opus | Coquille unique, menu à huit rubriques, garde 2FA, ⌘K global (`admin_search`), période et démo uniques, kit de graphiques (axes, comparaison) et tableau triable, redirections de toutes les anciennes adresses, pages existantes remontées dans les nouvelles rubriques sans changement. | Chaque ancienne adresse ouvre sa page dans le nouveau menu ; plus de bascule Suite / CRM. |
| **1. Aujourd'hui** | Opus | RPC `admin_today` (file unifiée, « traité », motifs), six chiffres, feux, fil d'activité unique. | Une ligne par chose à faire, chacune avec son action. |
| **2. Pros** | Opus | RPC `admin_accounts` et `admin_account` (liste et fiche tous produits), prospects réunis, Inviter, Démo et Accès assisté fusionnés. | Un compte Billetterie + CRM a une seule fiche. |
| **3. Clients** | Sonnet | Fiche d'une personne unique, base découpée en vues, soirées, annuaire. | Plus de fiche en double ; la page de 1 259 lignes est découpée. |
| **4. Pilotage et Argent** | Opus | Vue d'ensemble du revenu, entonnoir pro unique, cohortes, pages Argent, coûts et marge, vocabulaire d'argent unique. | Un seul chiffre de MRR et de revenu Yuno dans tout l'admin. |
| **5. Légal** | Opus | Registre RGPD, acceptations Billetterie, vendeurs (TVA, DAC7 / DSA), incidents et journal communs aux deux produits. | Chaque obligation a son écran et son échéance. |
| **6. Communication et Système** | Sonnet | Délivrabilité en un lieu (dont sous-domaines), campagnes, moteur, santé technique, réglages. | Le pool e-mail n'est affiché qu'une fois. |
| **7. Finitions** | Sonnet | Textes en trois langues, suppression des pages mortes, CLAUDE.md, vérification visuelle de chaque rubrique. | Tests, lint et build verts ; aucune page orpheline. |

## 6. Limites connues

- L'étude n'a trouvé aucune source publique sur les admins internes de Stripe,
  Shopify ou Airbnb : l'architecture s'appuie sur des pratiques générales et
  sur les sources citées (métriques, accès assisté, conformité).
- DAC7 / DSA : les seuils et le statut exact de Yuno sont à faire confirmer par
  un juriste ; le lot 5 construit les écrans, pas l'avis juridique.
- Coûts réels (Resend, Octopush, Supabase) : pas d'API branchée aujourd'hui ;
  ils seront saisis à la main dans un réglage, comme la marge CRM.

## 7. Ce qui est construit (lots 0 à 7, 16/11)

### Lot 0 : fondations

Branche `claude/admin-rebuild-lot0-74a2d1`. Un seul admin, monté à `/admin/*`
(`src/App.tsx` ne contient plus qu'une ligne : `<Route path="/admin/*" element={<AdminApp />} />`).

- **Coquille** `src/admin/shell/` : barre latérale à huit rubriques (`Sidebar`),
  en-tête (`Topbar` : fil d'Ariane, ⌘K, cloche `NotificationsBell`, démo,
  clair / sombre), palette `CommandPalette` (cmdk), cadres des écrans hérités
  (`frames.tsx` : `SuiteFrame`, `CrmFrame`, `PageBoundary`), garde
  (`AdminGuard` + `mfa.ts`) et connexion unique `/admin/login` (`AdminLogin`).
- **Garde** : `is_super_admin()` ET 2FA. 2FA activée et pas confirmée dans ce
  navigateur → code (preuve `mfaSession` partagée avec `RequireMFA`) ;
  super admin SANS 2FA et sans `mfa_exempt` → `/mfa-setup` (nouveau : l'ancien
  `/admin` ne vérifiait rien, l'ex-Admin CRM ne demandait le code que si la 2FA
  était déjà activée).
- **Carte du menu** `src/admin/nav.ts` (pure, testée) : rubrique → entrées →
  chemin, libellés `adm.nav2.*`, badge optionnel (`useNavBadges`,
  `src/admin/shell/badges.ts`).
- **Redirections** `src/admin/redirects.ts` (pure, testée) : chaque ancienne
  adresse des deux admins, requête et ancre comprises. `adminNotifLink()`
  (`src/lib/notifications.ts`) passe par `currentAdminHref`, donc les alertes
  déjà émises ouvrent la bonne page.
- **Domaine** : l'admin vit sur **yunoapp.eu**. `/admin/crm` n'est plus un
  chemin CRM (`productHost.ts`) : ouverte sur crm.yunoapp.eu, une ancienne
  adresse repart sur yunoapp.eu. Le Worker de la landing garde `/admin/crm`
  dans sa liste (`appPathOnCrmHost`) pour relayer ces vieux liens : **ne pas
  l'en retirer**, et ne pas y ajouter `/admin` (rien à changer côté landing).
  Deux origines = deux sessions : le super admin se connecte sur yunoapp.eu.
- **Recherche** : RPC `admin_search(p_q, p_include_demo)` (migration
  `20261218100000`, appliquée en prod le 16/11 après répétition annulée) :
  clubs, organisateurs, agences, comptes CRM, personnes (profils vivants),
  soirées, commandes (référence exacte, QR ou e-mail d'acheteur, dès 4
  caractères), 6 par famille, démo par CTE matérialisé. Liens :
  `src/admin/shell/searchHref.ts`.
- **Kit** `src/admin/ui/` (voir conventions). Polices Geist auto-hébergées
  (`@fontsource-variable/geist`, `-mono`), aucun CDN (CSP `font-src 'self'`).
- **Période et démo** : `useAdminFilters()` (`src/admin/context/`).

Rangement provisoire des écrans existants (remontés tels quels, rien réécrit) :

| Rubrique | Adresse | Écran d'origine |
|---|---|---|
| Aujourd'hui | `/admin` | « À faire » de l'ex-Cockpit CRM + Cockpit de la Suite |
| | `/admin/today/alerts`, `/feedback` | Alertes, Retours |
| Pilotage | `/admin/pilot` (+ `growth`, `signups`, `product`, `ai`) | Cockpit, Croissance, Inscriptions pro, Signaux produit, IA |
| | `/admin/pilot/crm`, `crm-acquisition`, `crm-product` | Cockpit, Acquisition, Produit de l'Admin CRM |
| Pros | `/admin/pros/venues(/:id)`, `organizers`, `agencies`, `demo`, `support` | Clubs, Organisateurs, Agences, Accès démo, Accès assisté |
| | `/admin/pros/crm(/:id)`, `sales`, `invite`, `crm-demo`, `crm-support` | Clients, Vente, Inviter, Démo, Accès assisté de l'Admin CRM |
| Clients | `/admin/clients`, `events`, `people(/:id)` | Clients (CRM plateforme), Soirées, Annuaire |
| Argent | `/admin/money`, `orders`, `crm`, `subscriptions` (caché) | Revenus, Commandes, Argent CRM, Abonnements |
| Communication | `/admin/comms` (+ `email/...`), `automations`, `sms`, `push`, `engine`, `links` | Marketing, Push, Moteur, Yuno Links |
| Légal | `/admin/legal`, `deadlines`, `audit` | Légal CRM, Alertes (échéances), Journal |
| Système | `/admin/system`, `crm(/plan/...)`, `settings` | Santé, Plateforme CRM, Réglages CRM |

### Lot 1 : Aujourd'hui (16/11)

Branche `claude/admin-rebuild-lot1-0bf651`. Migration `20261218110000_admin_today`
(répétée en transaction annulée sur la prod : 291 ms avec les chiffres, 166 ms
sans ; **non appliquée**, c'est l'assemblage qui l'applique).

- **`admin_today(p_include_demo, p_with_kpis)`** rend UNE file : chaque ligne a
  sa famille, une clé stable, le compte ou la personne (id + nom), un détail,
  depuis quand / jusqu'à quand, une urgence (1 maintenant, 2 cette semaine,
  3 quand possible) et l'adresse où agir. Familles assemblées depuis
  l'existant, sans rien recalculer autrement : `signup` (personnes bloquées ou
  en demande, joignables, jamais contactées, et comptes ouverts qui redonnent
  leurs coordonnées, lus dans `admin_pro_signups(60)`), `lead` (Yuno Links non
  contactés), `prospect` (prochaine action due), `trial` (essai CRM qui finit
  sous 3 jours), `sync` (synchro billetterie en échec), `billing` (paiement CRM
  en retard), `frozen`, `silent` (payant muet depuis 30 j), `yunits` (< 500),
  `deletion` (ces sept-là lus dans `_crm_admin_rows`, l'ancien « à faire » CRM),
  `moderation` (soirées À VENIR en attente), `feedback`, `transfer`
  (`admin_coorg_transfer_issues`), `alert` (non lues, urgentes ou hautes, hors
  types déjà couverts par une autre famille), `deadline` (échues, sous 30 j ou
  sans date), `support` (accès assisté en attente), `claim` (vitrines),
  `incident` (CNIL pas prévenue, 72 h). La clé porte la version de la cause
  quand elle peut revenir (date de l'erreur, de fin d'essai…).
- **« Traité » / « Plus tard »** : table `admin_today_marks` (RLS sans policy),
  RPC `admin_today_mark(key, 'done' | 'snoozed' | 'open', jours, motif)`,
  journal d'audit (`entity_type = 'admin_today'`), une alerte traitée est aussi
  lue. Une ligne dont la cause a disparu sort seule ; marques purgées à 90 j.
- **Six chiffres** (7 derniers jours contre les 7 d'avant) : Ventes (GMV de
  `admin_cockpit.week`) ; Revenu Yuno (frais de service + assurance des billets,
  service + gestion des tables, formule du cockpit) ; MRR Yuno CRM (somme des
  `mrr` de `_crm_admin_rows` ; semaine d'avant = abonnements déjà souscrits il y
  a 7 jours, faute d'historique des résiliations) ; Nouveaux pros (clubs,
  organisations hors vitrines et agences créés) ; Pros actifs (clubs et
  organisations avec une vente payée ou une inscription guest list sur une de
  leurs soirées, ou une campagne e-mail envoyée) ; Acheteurs (adresses
  distinctes qui ont payé un billet ou une table). Chaque définition est dans
  l'info-bulle du chiffre.
- **Écran** `src/admin/today/` : `TodayHome` (chiffres, file `TodayQueue`
  groupée par urgence et filtrable par famille, feux `HealthLights` lus dans le
  bloc `health` d'`admin_cockpit`, fil `ActivityFeed` qui réunit
  `admin_activity_feed` paginé et `crm_admin_activity` par `mergeFeed`, sans les
  commandes du bar). Règles pures `queue.ts` et `health.ts`, testées
  (`src/admin/__tests__/today.test.ts`). Textes : module `today.ts`.
- Badge de la rubrique = lignes urgentes non traitées (`todayUrgent`,
  `admin_today(false, false)`). « Toutes les alertes » reste l'écran hérité ;
  « Support et retours » est réécrit avec le kit (`FeedbackPage`, `?id=` ouvre
  le tiroir ; la suppression d'un élément n'y est plus, « Fermé » la remplace).
  L'ancien Cockpit reste sous Pilotage (lot 4) ; `src/pages/admin/AdminFeedback.tsx`
  n'a plus de route (à supprimer au lot 7).
- Hors file pour l'instant : délivrabilité par compte et prévisions de
  `crm_admin_daily` (lot 6 et lot 4).
### Lot 2 : la rubrique « Pros » (16/11)

Branche `claude/admin-rebuild-lot2-d36b43`. Migration `20261218120000_admin_pros_accounts`
(répétée sur la prod dans une transaction annulée, liste 283 ms, fiche 250 à 450 ms ;
**pas appliquée**, à jouer seule à l'assemblage).

- **Une liste** `/admin/pros` (`AccountsPage`, RPC `admin_accounts(p_include_demo, p_days)`) :
  une ligne par compte, clé `venue:<id>` | `org:<uuid>` | `agency:<uuid>`, tous produits.
  Cinq chiffres (comptes, qui vendent, nouveaux, à risque, payants CRM + MRR), filtres
  type / produit / statut / ville dans l'adresse (`?type=&product=&status=&city=`).
  CA club = formule de `admin_venue_overview` (fees.ts) ; l'état CRM (santé, MRR,
  Yunits, synchro) est lu dans `_crm_admin_rows`, jamais recalculé ; le bar n'entre nulle part.
- **Une fiche** `/admin/pros/<clé>` (`AccountPage`, RPC `admin_account(p_key)`), qui
  assemble `admin_venue_overview` et `crm_admin_account` : Vue d'ensemble, Ventes
  (12 mois par pilier), Soirées, CRM (si le compte l'a), Équipe (2FA), Support et légal
  (accès assisté, retours, NPS, acceptations, identité légale, niveau d'envoi),
  Journal et notes. Gestes rebranchés, chacun par `ReasonDialog` : produits
  (`AccountProductsButton`), modifier / masquer / décommissionner / restaurer un club,
  Association, activer une agence, Yunits offerts, essai prolongé, gel d'envoi, accès
  SMS, demander l'accès assisté, « Voir sa Console ». Les gestes qui n'avaient ni
  motif ni trace (visibilité d'un club, activité d'une agence) passent par
  `admin_account_set_flag` ; ceux dont la RPC n'a pas de motif (décommission,
  restauration, modification) écrivent le leur par `admin_account_log`.
- **Notes et étiquettes, tous produits** : `admin_account_notes` (plusieurs notes,
  épinglables) et `admin_account_tags`, RLS sans policy, RPC `admin_account_note_*`,
  `admin_account_set_tags`. L'ancienne note CRM (`crm_admin_notes`) reste lue.
- **Prospects** `/admin/pros/prospects` : leads Links + inscriptions (personnes,
  `admin_pro_signups`) + pipeline CRM dans une liste (`admin_prospects`), UN geste
  « Contacté » (`admin_prospect_contacted`, qui écrit dans la bonne table). Le kanban
  du pipeline reste un onglet (cadre hérité).
- **Inviter** `/admin/pros/invite` : type puis produit, puis le chemin existant
  (création du club + `invite-owner` ou lien d'accès, `invite-platform-user`,
  `invite-affiliate`, écran d'invitation CRM en cadre hérité) ; toutes les
  invitations en cours dessous (`admin_pending_invitations`).
- **Démo** `/admin/pros/demo` : un onglet par produit, écrans hérités en cadre.
  **Accès assisté** `/admin/pros/support` : réécrit avec le kit (`admin_support_overview`) :
  accordés, en attente, tous, journal, demande avec motif.
- Anciennes adresses : `/admin/pros/venues/:id` et `/admin/pros/crm/:clé` mènent à la
  fiche ; `/admin/venues|organizers|agencies` et `/admin/crm/clients` à la liste filtrée ;
  `sales`, `crm-demo`, `crm-support` aux pages réunies (`redirects.ts`, testé).
  ⌘K ouvre la fiche d'un club, d'un organisateur, d'une agence ou d'un compte CRM.
- **Restent hors menu** (pages cachées, gestes pas encore repris) : `/admin/pros/venues`
  (purge immédiate d'un club de test), `/organizers` (organisateur vitrine, renommer,
  supprimer, relancer une invitation), `/agencies` (relancer / révoquer une invitation
  d'agence), `/crm` (liste et tiroir de l'ex-Admin CRM).

**Statuts de cycle de vie d'un compte** (définis une fois en SQL, dits dans une info-bulle,
évalués dans cet ordre) :

| Statut | Définition |
|---|---|
| Clos | Club décommissionné, agence désactivée ou titulaire suspendu. |
| Vend | Une vente Yuno dans les 30 derniers jours, ou un abonnement Yuno CRM payant à 40/100 ou plus. |
| À risque | A déjà vendu mais rien depuis 30 jours et aucune soirée à venir, ou Yuno CRM en retard de paiement, en essai qui finit sous 3 jours, ou sous 40/100. |
| En pause | Compte Yuno CRM seul dont l'abonnement est en pause ou résilié. |
| Configuré | Paiements Stripe prêts, connexion billetterie posée ou une soirée à venir, sans vente encore. |
| Inscrit | Le titulaire s'est connecté, rien n'est configuré. |
| Invité | Personne ne s'est encore connecté (invitation pas acceptée). |
### Lot 3 : Clients (`src/admin/clients/`, branche `claude/admin-rebuild-lot3-795c5d`)

Question : « Qui achète sur Yuno ? ». Cinq pages, kit seulement : **Vue d'ensemble**
(`/admin/clients` : clients, joignables, actifs, nouveaux, taux de retour comparés
à la période précédente, courbe des nouveaux, segments RFM cliquables, cohortes),
**Tous les clients** (`/list`, filtres en puces dans l'adresse, tri et pagination
côté serveur par `admin_segmentation_customers`, export CSV conservé),
**fiche UNIQUE** (`/admin/clients/:id`), **Soirées** (`/events`, modération par
motif) et **Annuaire** (`/directory`, DJ / promoteurs / staff).

- **Clé d'une personne = l'e-mail encodé** (sept clients sur neuf n'ont pas de
  compte ; c'est aussi la clé des étiquettes et des notes). Un id de compte (uuid :
  recherche ⌘K, anciennes adresses `/admin/people/:id`) est accepté, la RPC le
  résout en e-mail (`personKey.ts`, testé). `/admin/clients/people[/:id]` et les
  anciennes adresses redirigent (`redirects.ts` + test) ; `searchHref.ts` ouvre
  cette fiche.
- **Fiche** : en-tête (identité, segment, compte / app / joignable), cinq onglets :
  Achats (billets, tables, guest list un par un, tous clubs ; les boissons n'y sont
  pas, pilier en pause), Messages (e-mails de campagne et push, 50 derniers ; les
  e-mails de service ne sont pas listés), Consentements, Compte (rôles, 2FA,
  suspension, mot de passe : chaque geste par `ReasonDialog` + `admin_log_action`),
  Notes et étiquettes (`admin_crm_*`).
- **Migration `20261218130000_admin_clients.sql`** (répétée annulée sur la prod, NON
  appliquée) : `admin_clients_period(p_days)` (chiffres comparés + courbe, n'assemble
  que `_admin_customer_activity()`) et `admin_person(p_email, p_user_id)` (assemble
  `admin_customer_detail` + achats, consentements, messages, compte). Super admin
  seul, REVOKE / GRANT, aucune table temporaire.
- **Limites assumées** : la base clients ne prend pas `p_include_demo` (les fonctions
  de base `_admin_customer_*` excluent la démo par construction, y ajouter le
  paramètre changerait leur signature) : la Vue d'ensemble le dit quand l'interrupteur
  démo est allumé. Pas de filtre « ville » (`admin_segmentation_customers` ne le
  propose pas). L'annuaire promoteurs ne montre plus les clics / conversions (une
  requête par ligne) mais le montant dû et versé. Les clés `adminSeg.*` du
  dictionnaire principal ne servent plus à l'admin (non supprimées).
- Supprimés : `AdminCustomers`, `AdminUserDetail`, `AdminPeople`, `AdminEvents`,
  `directory/Directory{DJs,Promoters,Staff}`.
### Lot 4 : Pilotage et Argent (16/11)

Branche `claude/admin-rebuild-lot4-44036a`. Migration `20261218140000_admin_pilot_money`
(répétée sur la prod dans une transaction annulée : vue d'ensemble 1 s, acquisition
180 ms, rétention 360 ms, refus d'un non-admin ; **pas appliquée**, à jouer seule à
l'assemblage ; smoke : `lot4-smoke.sql` du dossier de notes).

**Le vocabulaire d'argent, unique dans tout l'admin** (`src/admin/money/terms.ts`, testé ;
libellés et définitions `adm.money.term.*`). « GMV », « CA total », « Volume de ventes »,
« Revenus Yuno » ne s'écrivent plus.

| Terme | Définition | Source |
|---|---|---|
| Ventes de la plateforme | Ce que les acheteurs ont payé (billets et tables payés, remboursés compris). Démo jamais comprise. | `admin_platform_analytics.totals.gmv` |
| Frais de service | Service + assurance des billets, service + gestion des tables. | `admin_platform_analytics.totals.yuno_revenue` |
| Abonnements CRM | Abonnements Stripe de Yuno CRM au prix de la grille (formule de `crm_admin_money`), au prorata des jours actifs. **Estimation** : Yuno ne garde pas les factures Stripe. | `admin_pilot_overview` (`_admin_crm_subs`) |
| Recharges de Yunits | Yunits achetés, montant HT (formule de `crm_admin_money`). | `admin_pilot_overview` (`_admin_crm_recharges`) |
| Revenu de Yuno | Frais de service + abonnements CRM + recharges. | `admin_pilot_overview` (somme au front, `yunoRevenue`) |
| MRR | Somme des `mrr` de `_crm_admin_rows` (abonnement Stripe payé ou en retard ; un compte offert n'y entre jamais). À une date passée : formule des mois de `crm_admin_money`. | `admin_pilot_overview.kpis.mrr` |
| Remboursements | Montants rendus sur les ventes de la période. | `admin_platform_analytics.totals.refunds_total` |
| Coûts | Saisis par mois et par poste (`admin_costs`) ; l'IA est lue dans `ai_usage_events` (USD au taux indicatif 0,92) tant qu'aucune ligne ne la remplace. | `admin_costs_list` |
| Marge | Revenu de Yuno − coûts. | `CostsPage` (`margin`) |

- **Pilotage** (`src/admin/pilotage/`) : Vue d'ensemble `/admin/pilot` (`admin_pilot_overview` :
  six chiffres comparés, revenu de Yuno par jour avec la période précédente, par source,
  12 derniers mois, concentration des 5 premiers pros) ; Acquisition (`admin_pro_acquisition` :
  UN entonnoir Billetterie + CRM lu dans `admin_pro_signups` et `crm_landing_events`, chaque
  étape dit sa source, par produit, délai médian jusqu'à la première vente ; la liste à rappeler
  est un lien vers Pros › Prospects) ; Rétention (`admin_pro_retention` : cohortes par mois de
  première vente, M0 à M+6, comptes ou ventes, aucun % sous 10 comptes ; départs CRM) ; Audience
  (`get_platform_traffic` sur la période et la précédente, `admin_buyers_stats` : acheteurs actifs
  et récurrents) ; Produit (onglets Signaux, IA et MCP, Yuno CRM : chiffres clés au kit, **détail
  encore hérité** en cadre : `AdminProduct`, `AdminAi`, `crm/admin/pages/ProductPage`). Les
  Cockpits Suite et CRM disparaissent (`/admin/crm` et `/admin/pilot/crm` mènent à la vue
  d'ensemble) ; `/admin/pilot/signups` reste joignable caché (écran hérité).
- **Argent** (`src/admin/money/`) : Ventes `/admin/money` (`admin_platform_analytics`, export CSV
  par jour) ; Commandes (`admin_orders_list` paginée serveur, démo globale, `?open=ticket:<id>` |
  `table:<id>` ouvre le tiroir, remboursement par `ReasonDialog` + `owner-refund` ; ⌘K y mène,
  `orderLink.ts`) ; À régler (`admin_money_issues` : alertes d'argent non lues, « Traité » =
  `admin_money_issue_done` avec motif au journal ; virements de co-organisation et de collab via
  `admin_coorg_transfer_issues`, tranchés par `admin_resolve_coorg_transfer` ; règlements
  promoteurs contestés ou non confirmés, en lecture) ; Abonnements et Yunits (`crm_admin_money`
  réécrit, MRR en tête = celui de la vue d'ensemble, seuil des 50 payants) ; Coûts et marge
  (`admin_costs`, `admin_cost_set` / `admin_cost_delete` avec motif et journal, onglet Factures
  `admin_invoices_list`, échecs en tête).
- Les alertes d'argent (litige, vente payée sans billet, remboursement ou facture en échec,
  virements entre parties) ouvrent désormais « À régler » (`src/lib/notifications.ts`).
- **Écarts constatés, non corrigés (les calculs ne changent pas)** :
  1. `admin_crm_revenue` porte encore l'ancienne grille (35/49/89/129/175/249 € par
     `essential/pro/business`) alors que toutes les lignes sont `base` : il rendrait 0 € de MRR
     pour tout abonné. N'est plus lu par le lot 4 ; à supprimer ou réaligner.
  2. `crm_admin_money.kpi.mrr` compte un abonnement Stripe en essai (`trialing`, carte
     enregistrée) ; `_crm_admin_rows` non. Au 16/11 les deux disent 0 €. L'admin affiche
     `_crm_admin_rows`.
  3. `crm_admin_money` (et donc l'historique) valorise un non-fondateur à `price_month_next`
     (34 €) même avant le 50ᵉ payant, où il paie 24 €.
  4. `get_platform_traffic.sales` (30 j : 659 billets, 11 663 €) ne dit pas la même chose
     qu'`admin_platform_analytics` (365 j : 493 ventes, 7 330 €) : périmètre démo ou statuts
     différents, à trancher au lot 7. L'Audience n'affiche pas ces montants.
  5. Les ventes (`admin_platform_analytics`) excluent toujours la démo ; comptes, acheteurs et
     abonnements suivent l'interrupteur. L'écran le dit.
  6. La palette sombre du kit (`--a-chart-2` et `-3`) sort légèrement de la bande de luminosité
     du validateur dataviz (0,785 / 0,774 > 0,77) ; le clair passe tout.
  7. **À l'assemblage** : le chiffre « Revenu Yuno » du lot 1 (`admin_today`) ne compte que les
     frais de service ; il doit prendre le libellé « Frais de service » ou passer au revenu de
     Yuno ci-dessus. Ses « Ventes » lisent `admin_cockpit` (statuts `paid/used`), pas
     `admin_platform_analytics` (`paid_at` posé) : deux formules pour un même mot.
### Lot 5 : Légal (`src/admin/legal/`, branche `claude/admin-rebuild-lot5-f8dea6`)

Question : « Sommes-nous en règle ? ». Dix écrans au kit, des REGISTRES et des
tableaux de suivi, jamais un avis juridique : chaque obligation cite sa source dans
le dépôt (`docs/legal/*`, `src/data/legalContent.ts`, `LEGAL_VERSIONS`) ou se dit
« à confirmer par un juriste » (encadré `SourceNote`).

- **Vue d'ensemble** (`/admin/legal`) : une ligne par obligation (demandes RGPD,
  incidents, conditions, dossiers vendeurs, échéances, accès assistés, signalements),
  état en règle / à traiter / en retard décidé par `obligations()` (`rules.ts`, testé),
  compteurs par `admin_legal_overview`. Chaque ligne mène à sa page.
- **Demandes RGPD** (`/requests`) : table `privacy_requests` (RLS sans policy),
  saisie à la main, échéance = réception + 1 mois + prolongation 0 à 2 mois avec motif
  (CHECK SQL ⇄ `requestDeadline`). Dans la même liste, marqué « automatique », ce qui
  est LU sans être recopié : `security_logs.account_deleted`, `meta_data_requests`,
  `ticketing_erasures`, effacements CRM (marque `external_tickets.erased_at`, groupée
  par connexion et par minute). Une demande d'effacement mène à la fiche de la
  personne (lot 3) ; elle n'efface rien.
- **Consentements** (`/consents`) : registre par produit (Tickets `product IS NULL`,
  CRM, portée Yuno), part avec preuve (même règle que `crm_admin_legal`), accords
  donnés / retirés sur la période, repoussoir, imports des trois tables (attestation,
  `attested_via_support` signalé, fusionnés) ; recherche d'une adresse = sa preuve
  (texte exact, source, compte, CGV, documents acceptés).
- **Conditions** (`/terms`) : `legal_acceptances` par document et version ; comptes
  pros ouverts sans la version en vigueur (`REQUIRED_DOCS` : Billetterie
  `terms_pro` + `confidentiality`, CRM `terms_crm` + `dpa` ; versions envoyées par le
  front depuis `LEGAL_VERSIONS`, seule source) ; preuves CGV acheteurs
  (`terms_acceptances`) en compteur.
- **Vendeurs** (`/sellers`) : identité légale, régime de TVA (`organizer_vat_rate`,
  club à 20 %), Stripe, factures émises (`invoice_numbers`) et ventes payées sans
  facture depuis plus d'une heure, ventes de l'année ENCAISSÉES par le compte Stripe
  du pro (CA club de `fees.ts`, remboursements déduits), repères DAC7 (30 ventes OU
  2 000 €), colonne « dossier complet » = champs présents (`sellerGaps`), export CSV.
- **Incidents** (`/incidents`) : `crm_incidents` + colonne `product`
  (`tickets` | `crm` | `both`, défaut `crm`) ; `admin_legal_incident_save` appelle
  `crm_admin_incident_save` (journal compris) puis pose le produit, donc l'écran CRM
  hérité marche toujours. Échéances affichées : CNIL 72 h (RGPD art. 33), pros 48 h
  pour le CRM (DPA 12.8), « dans les meilleurs délais » pour la Billetterie (DPA art. 7).
  `admin_legal_incident_pros` prépare la liste (clubs ET organisateurs), n'envoie rien.
- **Signalements** (`/reports`) : table `content_reports` (DSA), saisie à la main.
- **Documents** (`/documents`) : textes et versions (`LEGAL_VERSIONS`), sous-traitants
  tels que le DPA les nomme (art. 5, 6, 12.7), pages publiques, documents internes.
- **Échéances** (`/deadlines`) : `admin_credential_deadlines` réécrit au kit avec les
  RPC existantes (inchangées). **Journal** (`/audit`) : `admin_legal_audit` =
  `admin_audit_log` (Suite + ex-Admin CRM) ∪ `admin_support_audit` (accès assisté,
  agent compris), filtres période / source / compte (`?account=venue:…`) / texte.
- Toute écriture (demande, signalement, incident) passe par `ReasonDialog` et la RPC
  écrit `admin_audit_log` (`privacy_request_*`, `content_report_*`, `crm_incident_*`).
- **Migration `20261218150000_admin_legal.sql`** : répétée sur la prod dans une
  transaction annulée (vue d'ensemble 15 ms, conditions 11 ms, vendeurs 17 ms,
  consentements 132 ms, journal 7 ms ; refus d'un non-admin, helpers sans GRANT,
  motif de prolongation exigé), NON appliquée.
- Liens : fiche d'un pro `/admin/pros/<clé>` (lot 2), fiche d'une personne
  `/admin/clients/<e-mail>` (lot 3) ; ils ne s'ouvrent qu'une fois ces lots fusionnés.
- Fichiers touchés hors `src/admin/legal/` : `src/admin/nav.ts` (rubrique légal
  seulement), `src/i18n/locales/admin/modules/shell.ts` (libellés `adm.nav2.legal.*`,
  l'entrée `crm` devient `overview`), `modules/index.ts` (+ `legal`), nouveau module
  `modules/legal.ts`, la migration. Aucune redirection nouvelle (les anciennes
  adresses `/admin/crm/legal`, `/admin/audit` tombaient déjà sur la rubrique).
- **À confirmer par un juriste** : (1) statut de Yuno au regard de DAC7 (opérateur de
  plateforme ou non), seuils, ce qui compte comme une vente et le montant à retenir
  (brut, net, frais) ; (2) applicabilité du DSA et du « notice and action » à Yuno,
  contenu attendu de l'exposé des motifs ; (3) qui notifie la CNIL selon que Yuno est
  responsable ou sous-traitant des données touchées ; délai de prévenance des pros
  Billetterie (DPA art. 7 ne chiffre pas) ; (4) vérification d'identité et forme des
  réponses aux demandes RGPD, motifs de prolongation acceptables ; (5) liste des champs
  qui font un dossier vendeur « complet » ; (6) documents qu'un pro doit avoir acceptés
  (`REQUIRED_DOCS`) ; (7) constat de la répétition : 790 abonnés du CRM n'ont aucun
  événement de preuve dans `marketing_consent_events` (accords venus du connecteur) ;
  la preuve tient-elle par la source `connector:shotgun` ?
- Restent dans l'ancien écran : la purge des espaces CRM (90 jours) et la liste des
  accès assistés vivent dans Pros › Accès assisté (lot 2) ; `src/crm/admin/pages/LegalPage.tsx`
  et `IncidentsSection.tsx` n'ont plus de route (lot 7 : à supprimer).

### Lot 6 : Communication et Système (16/11)

Branche `claude/admin-rebuild-lot6-470c27`. Migration `20261218160000_admin_platform_switches.sql`
(une seule RPC, `admin_set_platform_switch` : Maintenance et Paiements avec motif, au journal ; répétée,
non appliquée). Le reste assemble des RPC déjà en base.

- **Communication** (`src/admin/comms/`) : `Campaigns` (index : base marketing de Yuno, e-mail / SMS / push en
  onglets, éditeurs hérités dans leur cadre), `Engine` (chiffres comparés à la période précédente par la même
  RPC sur 2 × la durée, courbe à une échelle, onglets Règles et textes / Politique / Crédits), `Deliverability`
  (UN endroit : pool, plaintes, rebonds, spam Gmail, comptes à l'écart, courbe des envois, comptes expéditeurs,
  Gmail et Postmaster, sous-domaines d'envoi, suppressions ; chaque geste par `ReasonDialog`), `Links` (page bio :
  leads et liste d'attente restent dans leurs onglets hérités tant que Pros › Prospects n'est pas fusionné).
  Le pool e-mail du mois n'est affiché que dans Délivrabilité.
- **Système** (`src/admin/system/`) : `Health` (cinq états + une section par état ; crons en UNE liste, sans e-mail),
  `Switches` (Maintenance, Paiements, canaux CRM, registre hérité des notifications, journal des modifications),
  `Pricing` (en-tête et onglets au kit ; contenu de l'ex-Admin CRM gardé dans `CrmFrame`), `Connectors`
  (Shotgun et scénarios natifs ; `connectors/plan/:scope/:event` garde l'écran du plan), `Ai` (coût et erreurs).
- **Adresses** : `/admin/system/crm(/plan/…)` et `/admin/system/settings` redirigent (`redirects.ts`, testé).
- **Reste hérité** : formulaires de règles, textes et crédits des notifications (`AdminNotificationAutomations`,
  exportés), registre `SystemTab`, éditeurs Email Studio / SMS / push, `AdminLinks`, contenu des onglets de
  `Pricing` (grille de prix, cycle de vie, analyse, « Vos clients »), plan d'un prospect.
- **Pas de comparaison** sur les chiffres de Délivrabilité (taux sur 30 jours glissants, aucune série précédente en base).

### Lot 7 : assemblage (16/11)

Branche `claude/admin-rebuild-integration-024194` (partie du lot 0) : les lots 1 à 6
fusionnés dans l'ordre, un commit de fusion par lot, conflits réglés en gardant le
travail de chacun (`nav.ts`, `redirects.ts` et son test, `searchHref.ts`,
`modules/index.ts`, ce plan). Rien n'est poussé ni déployé.

- **Menu final** = section 3, huit rubriques, aucune entrée en double. Pages hors
  menu mais joignables (`hidden`) : `/admin/pilot/signups`, `/admin/pros/venues`,
  `organizers`, `agencies`, `crm`. Chaque adresse
  littérale `/admin/...` du code a été passée dans `currentAdminHref` puis comparée
  aux routes réelles : toutes tombent sur une page qui existe.
- **Liens croisés** : la file du jour (liens réécrits dans la migration
  `20261218110000`, non appliquée), le fil d'activité et `adminNotifLink` ouvrent la
  fiche d'un pro (`/admin/pros/<venue|org|agency>:<id>`), la fiche d'une personne,
  Prospects, À régler, Demandes RGPD, Incidents, Délivrabilité, Interrupteurs,
  Échéances. La fiche d'un pro porte « Ailleurs dans l'admin » : ses commandes, son
  identité légale, sa délivrabilité (listes pré-filtrées : `DataTable.initialSearch`
  lu dans `?q=`). Un achat de la fiche d'une personne ouvre la commande
  (`orderHref`). `src/crm/admin/adminNav.ts` pointe sur les adresses finales.
- **Une information, un endroit** : Aujourd'hui lit ventes et frais de service de
  la semaine par `admin_platform_analytics` (comme Argent), avec les libellés de
  `money/terms.ts` (« Frais de service », plus « Revenu Yuno ») ; MRR → Argent ›
  Yuno CRM ; pool e-mail → Délivrabilité seulement (Santé technique n'en montre
  rien) ; leads de la page bio → Pros › Prospects (l'onglet leads de la page bio est
  retiré, le lien de la carte y mène) ; coût de l'IA → Système › IA, son usage →
  Pilotage › Produit ; journal et échéances → Légal.
- **Retiré** (plus rien ne l'importait) : `AdminCockpit`, `AdminGrowth`,
  `AdminRevenue`, `AdminOrders`, `AdminAuditLog`, `AdminSupportAccess`,
  `AdminSystem`, `AdminFeedback`, `AdminVenueDetail`, sept cartes de
  `src/components/admin/`, les pages CRM Cockpit, Acquisition, Activité, Argent,
  Plateforme, Légal, Incidents, Support, trois hooks, `salesSeries`, cinq modules
  de textes. Raccrochés au lieu d'être perdus : l'état des prix Stripe (seuil des
  50, `PriceTierCard`) dans Système › Offre et tarifs, la mesure de crm.yunoapp.eu
  (`LandingTab`) dans Pilotage › Acquisition.
- **Passe visuelle** (banc local, données d'exemple, clair et sombre, captures
  claires dans `docs/designs/admin-rebuild/`) : libellé d'un chiffre sur deux
  lignes au lieu d'être coupé, pourcentages au format de la langue (`fmtPct` lit
  `<html lang>`), « 1 ligne » au singulier, statuts d'achat traduits, « 1
  obligation » sans « (s) ».
- **Encore dans un cadre hérité** (`SuiteFrame` / `CrmFrame`, à réécrire avec le
  kit) : Aujourd'hui › Toutes les alertes ; Pilotage › Inscriptions (caché) et le
  détail des trois onglets de Produit (`AdminProduct`, `AdminAi`, Produit CRM) ;
  Pros › anciennes listes (cachées : purge d'un club, organisateur vitrine,
  invitations d'agence, comptes CRM avec leurs onglets risques et onboarding),
  onglets hérités de Démo et d'Inviter ; Argent › Abonnements (caché) ;
  Communication › éditeurs de campagnes e-mail, SMS, push, automatisations, page
  bio (`AdminLinks`), règles et crédits du moteur ; Système › contenu d'Offre et
  tarifs, plan de soirée CRM, catalogue boissons (fermé, pilier en pause).
- **Écarts connus, non corrigés** : `get_platform_traffic.sales` (Pilotage ›
  Audience) ne dit pas la même chose qu'`admin_platform_analytics` (point 4 du lot
  4) ; `admin_crm_revenue` garde l'ancienne grille et n'est plus lu (à supprimer) ;
  les tailles en Mo de Santé technique gardent le point décimal. Fichiers orphelins
  ANTÉRIEURS à la refonte, laissés tels quels (hors admin) : `email-editor/*`,
  `StaffPinDialog`, `scopeFilter`, `RichTextField` des campagnes, onboarding
  widgets…
- **À confirmer par un juriste** : la liste du lot 5 (DAC7, DSA, notification CNIL,
  réponses RGPD, dossier vendeur complet, documents requis, preuve des accords
  venus de Shotgun). **Coûts** (Resend, Octopush, Supabase, Cloudflare, Stripe)
  saisis à la main dans Argent › Coûts et marge (`admin_costs`) ; l'IA est lue
  automatiquement si rien n'est saisi.

- Échéances à saisir à la main retirées de l'admin le 16/11 à la demande de Paul ; la table `admin_credential_deadlines` et son balayage restent en base.

### Passe de design (17/11)

Direction : `docs/designs/ADMIN_DESIGN_SYSTEM.md` (une page) et sa page vivante
`/admin/system/ui` (hors menu). Rouge seul accent (échelle Radix à 12 pas, aplat
assombri pour du blanc en AA), neutres chauds, statuts distincts de l'accent (une
baisse en encre neutre, « à traiter » ambre, « critique » aplat bordeaux avec un
mot), palette de graphiques rouge / bleu / sarcelle / violet validée clair et
sombre, tuiles à 26 px sans orpheline, tableaux à 40 px, page à 1280 px. Les cadres
hérités redéfinissent leurs variables sur les tokens du kit (`.a-legacy`,
`.a-crm-legacy` dans `admin.css`). Toutes les alertes réécrite au kit. Captures
claire et sombre de chaque rubrique dans `docs/designs/admin-rebuild/`.

**Reste hérité après cette passe** (lignes de code de l'écran, à répartir) :

| Écran | Adresse | Cadre | Lignes |
|---|---|---|---|
| `AdminDemoAccess` | Pros › Démo (onglet Billetterie) | Suite | 988 |
| `AdminVenues` | `/admin/pros/venues` (caché : purge, gestes de club) | Suite | 705 |
| `AdminNotificationAutomations` | Communication › Notifications (règles, textes, crédits) | Suite | 673 |
| `AdminLinks` | Communication › Page bio | Suite | 618 |
| `AdminProSignups` | `/admin/pilot/signups` (caché) | Suite | 478 |
| `InvitePage` (CRM) | Pros › Inviter (onglet CRM) | CRM | 398 |
| `AdminMarketing` (éditeur, rapport, modèles, automatisations) | `/admin/comms/email/*`, `automations` | Suite | 391 |
| `AdminPushNotifications` | `/admin/comms/push` | Suite | 348 |
| `DemoPage` (CRM) | Pros › Démo (onglet CRM) | CRM | 252 |
| `AdminOrganizers` | `/admin/pros/organizers` (caché) | Suite | 250 |
| `ClientsPage` (CRM) | `/admin/pros/crm` (caché) | CRM | 245 |
| `SalesPage` (CRM) | Pros › Prospects (onglet Pipeline) | CRM | 236 |
| `AdminAgencies` | `/admin/pros/agencies` (caché) | Suite | 166 |
| `AdminMarketingSms` | `/admin/comms/sms` | Suite | 71 |
| `AdminDrinkCatalog` | `/admin/system/drinks` (fermé, pilier en pause, aucun menu n'y mène) | Suite | 380 |
| `NightPlanReport` (rapport de la Console, dans la page `NightPlan` au kit) | `/admin/system/connectors/plan/*` | CRM | n/a |

Réécrits au kit dans la passe Pilotage / Système / Argent (17/11) : Produit
(Signaux, IA, CRM), page publique CRM d'Acquisition, Offre et tarifs (quatre
onglets), plan de soirée (titre et états ; le rapport reste celui de la Console,
dans son cadre CRM), Abonnements de la Suite (supprimé : fonction coupée, adresse
redirigée vers Argent › CRM). `AdminProSignups` reste : Pros › Prospects ne montre
ni les parcours d'une personne, ni les étapes fines du formulaire (rôle,
structure, e-mail), ni l'outil utilisé, la taille et la fréquence déclarées, ni
les alertes envoyées, ni les comptes invités ou supprimés.

Ces écrans ont les couleurs, la police et le rouge du kit, mais gardent leur
mise en page (cartes à grands rayons, boutons et tableaux à eux). L'ancien kit
(`src/components/admin/ui.tsx`, `src/crm/admin/ui.tsx`) disparaît avec le dernier.

## 8. Conventions pour les lots 1 à 6

1. **Où poser une page** : dans le dossier de SA rubrique,
   `src/admin/<rubrique>/` (`today`, `pilotage`, `pros`, `clients`, `money`,
   `comms`, `legal`, `system`). Sa route va dans `src/admin/<rubrique>/routes.tsx`,
   chemin RELATIF à la rubrique, composant chargé par `lazyWithRetry`. Ne
   jamais toucher `src/App.tsx`, `src/admin/AdminApp.tsx` ni le `routes.tsx`
   d'une autre rubrique.
2. **Déclarer une entrée de menu** : une ligne `{ key, path }` dans la rubrique
   de `src/admin/nav.ts` (+ `end` pour un index, `prefixes` pour ses pages
   filles, `hidden` pour une page hors menu, `badge` pour un compteur), et le
   libellé `adm.nav2.<rubrique>.<key>` en trois langues. **Le seul fichier
   partagé par plusieurs lots est `nav.ts`** (et `shell.ts` des libellés) :
   n'y modifier QUE sa rubrique, pour que la fusion reste mécanique. Les
   textes d'une page vont dans un module à soi
   (`src/i18n/locales/admin/modules/<lot>.ts`, ajouté à `index.ts`), triplets
   [EN, FR, ES], jamais de tiret cadratin.
3. **Remplacer un écran hérité** : le nouvel écran prend l'adresse de l'ancien
   (ou une nouvelle, avec sa règle dans `redirects.ts` et son cas dans
   `redirects.test.ts`). Une ancienne adresse ne doit jamais tomber sur l'accueil.
4. **Primitives** (`import { … } from '@/admin/ui'`) : `Page` (titre = la
   question, `period` pour le choix de période), `Section`, `Card`, `Grid`,
   `KpiRow` + `Kpi` (4 à 6, `current` / `previous` pour l'écart, `spark`, `to`
   vers la liste), `DataTable` (colonnes TanStack, `meta.align: 'right'` pour
   un nombre, `loading` / `error` + `onRetry` / `empty`, `rowHref`), `Chart`
   (`line` | `bar` | `stacked`, `unit` obligatoire, `previous` en gris, jamais
   deux échelles), `Funnel`, `Badge` / `Status` (tons, jamais une couleur),
   `Tabs` + `useTab` (`?tab=`), `Drawer`, `Dialog`, `ReasonDialog` (TOUTE action
   sensible : motif obligatoire, envoyé à la RPC qui écrit le journal),
   `EmptyState` / `ErrorState`, `KeyValue`, `Timeline`. Textes par `useAdminT()`
   (`t(clé, { n })`), chiffres par `src/lib/adminFormat.ts`.
5. **Période et démo** : `const { range, includeDemo } = useAdminFilters()` ;
   chaque RPC reçoit `p_include_demo` (et `range.days` / `range.from` quand elle
   dépend de la période). Une page ne filtre jamais la démo elle-même.
6. **Couleurs** : seulement les variables `--a-*` du kit (`src/admin/ui/admin.css`),
   jamais un hexadécimal dans une page. Clair et sombre se vérifient tous les
   deux. Une classe d'affichage Tailwind (`hidden`, `md:flex`) se pose sur un
   conteneur, pas sur un `.a-btn` (qui porte son propre `display`).
7. **Fenêtres** : `Dialog` / `Drawer` du kit (montées dans la coquille par le
   portail `useAdminPortal`), jamais un portail sur `document.body` (il perdrait
   les variables du kit).
8. **Écrans hérités** : une page Suite reste dans `SuiteFrame`, une page CRM dans
   `CrmFrame`, jusqu'à sa réécriture ; un écran réécrit avec le kit n'a besoin
   d'aucun cadre. L'ancien kit `src/components/admin/ui.tsx` et `src/crm/admin/ui.tsx`
   disparaissent avec le dernier écran qui les utilise.
9. **SQL** : une migration par lot, timestamp vérifié contre `origin/main`,
   répétée dans une transaction annulée avant d'être appliquée, jouée SEULE sur
   la prod. Toute RPC admin : `is_super_admin()`, `p_include_demo` par CTE
   matérialisé, REVOKE / GRANT explicites.
10. **Pas encore fait** au lot 0 : `admin_today` (lot 1), fiches pro et
    personne uniques (lots 2-3), les pages d'Argent et de Pilotage réécrites
    (lot 4), les écrans légaux de la Billetterie (lot 5), délivrabilité en un
    lieu (lot 6). La recherche ⌘K ouvre la meilleure page actuelle d'un
    organisateur (sa fiche de compte) ou d'une commande (la liste) : les lots
    2 et 4 la brancheront sur les fiches.

## 9. Mise en ligne

**Les six migrations des lots 1 à 6 sont additives** (lu dans le dépôt le 16/11 ;
le catalogue de la prod n'a pas été relu par l'assemblage) : aucune ne réécrit une
fonction existante, aucune ne change une signature qu'appelle le site en ligne,
aucune ne dépend d'une autre. Le bundle actuellement en ligne ne voit aucune
différence.

| Migration | Contenu | Effet sur l'existant |
|---|---|---|
| `20261218110000_admin_today` | table `admin_today_marks`, `admin_today`, `admin_today_mark` | aucun |
| `20261218120000_admin_pros_accounts` | tables `admin_account_notes`, `admin_account_tags`, RPC des comptes, prospects, accès assisté, invitations | aucun (les gestes écrivent `venues.is_hidden`, `agencies.is_active`, `links_pro_leads`, `pro_signups` seulement quand on les appelle) |
| `20261218130000_admin_clients` | `admin_clients_period`, `admin_person` | aucun |
| `20261218140000_admin_pilot_money` | table `admin_costs`, RPC Pilotage et Argent, helpers `_admin_*` | aucun |
| `20261218150000_admin_legal` | tables `privacy_requests`, `content_reports`, RPC `admin_legal_*` | ajoute `crm_incidents.product` (défaut `'crm'`, CHECK) : sans effet sur `crm_admin_incident_save` / `crm_admin_incidents` (vérifié par le lot 5) |
| `20261218160000_admin_platform_switches` | `admin_set_platform_switch` | aucun |

Marche à suivre, dans l'ordre :

1. Relire la branche `claude/admin-rebuild-integration-024194` (captures dans
   `docs/designs/admin-rebuild/`).
2. Appliquer les six migrations UNE PAR UNE, dans l'ordre des dates, chacune
   d'abord répétée dans une transaction annulée (les smokes des lots 2, 4 et 5 sont
   dans le dossier de notes partagé), en vérifiant `pg_stat_activity` avant, sans
   autre écriture lourde en même temps ; `NOTIFY pgrst, 'reload schema'` une seule
   fois à la fin.
3. Vérifier qu'un compte super admin a la 2FA activée (sinon `/mfa-setup`).
4. Fusionner la branche dans `main` et déployer le front (Cloudflare) APRÈS les
   migrations : les nouveaux écrans appellent les nouvelles RPC.
5. Ouvrir chaque rubrique en vrai, clair et sombre, et quelques anciennes adresses
   (`/admin/crm/clients`, `/admin/venues/<id>`, `/admin/marketing`).
6. Ensuite : supprimer `admin_crm_revenue`, réécrire les écrans encore hérités,
   puis retirer `src/components/admin/ui.tsx` et `src/crm/admin/ui.tsx`.
