# Refonte de l'admin Yuno — un seul admin, organisé par question

Date : 2026-11-16. Statut : architecture validée par Paul ; lot 0 (fondations) construit le 16/11, voir la section 7.
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

## 7. Ce qui est construit (lot 0, 16/11)

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
