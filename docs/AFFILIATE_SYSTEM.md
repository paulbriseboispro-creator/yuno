# Système Agence — modèle, état, et système parfait

Dernière revue : 2026-07-27. Ce document est la source de vérité produit du
pilier « agences de promoteurs » : le modèle commercial, ce qui existe, et la
feuille de route vers le système parfait pour les objectifs.

## LA FUSION (2026-07-27) : une entité, deux modes de distribution

Les deux profils historiques — `agencies` (clubs Yuno : contrats, ventes
in-app, grand-livre) et `affiliates` (clubs externes : redirection billetterie,
attribution par clics) — sont désormais UNE SEULE entité :

- **`agencies` est l'identité maître.** `affiliates.agency_id` relie le bras
  externe ; deux triggers provisionnent automatiquement le bras manquant à
  toute création (create_agency OU invitation affiliée), et un trigger de
  synchro pousse nom/ville/logo/bio/site/WhatsApp de l'agence vers le bras
  externe (le linktree public suit tout seul). Le chef porte les deux rôles
  (`agency` + `affiliate`).
- **Un seul cockpit.** `/agency-app` avec la sidebar unifiée
  (`agency-app-sidebar.tsx`) qui couvre les deux familles de routes :
  `/agency-app/*` (contrats, événements, stats ventes, finance) et
  `/affiliate/*` (clubs externes, soirées, linktree, analytics trafic,
  assignations, communication, inbox). Le même shell (header : cloche du flux
  affilié + langue + aide + retour profil) habille les deux layouts — la
  navigation entre les deux familles est invisible. `/affiliate` (index)
  redirige l'admin vers `/agency-app`.
- **Un seul roster.** La page Promoteurs groupe par humain : lignes
  `promoters` (par club Yuno) + badge « Externe » si la personne a une ligne
  `affiliate_members` (rapproché par `user_id`). L'invitation propose les deux
  modes : « Club Yuno (contrat) » → `invite-promoter`, « Clubs externes » →
  `invite-affiliate-member`.
- **Le code argent n'a PAS bougé.** Conversions, marges, règlements, triggers
  de garde : intacts. La fusion est additive (migrations 20260727120000 +
  20260727120100).
- **Le flywheel est branché** : un club externe convaincu par les chiffres
  passe sous contrat → mêmes promoteurs, même agence, zéro réonboarding —
  seule la distribution change de mode.

Reste à faire (fusion phase 2) : espace promoteur unifié (aujourd'hui un
humain bi-mode a `/promoter` ET `/affiliate/promoteur`), bouton « passer ce
club en vente Yuno » (migration affiliate_venue → venue sous contrat),
alignement MFA entre les deux familles de routes.

## Le modèle en une page

**Le rôle affilié = le chef d'agence de promotion d'une ville** (ex. madbynight
à Madrid), qui travaille déjà avec les plus gros clubs — ceux qui sont trop
gros pour signer avec Yuno aujourd'hui, ou qui ne le connaissent pas encore.

**Ce que Yuno y gagne.**
- **Le catalogue complet.** La marketplace montre les meilleures soirées de la
  ville, pas seulement les clubs clients. Yuno devient LE point d'entrée
  nightlife d'une ville *avant* d'avoir signé un seul club.
- **La donnée d'intention.** Qui regarde quoi, quand, d'où : la carte de
  chaleur de la demande nightlife, ville par ville — introuvable ailleurs.
- **Un pipeline B2B chaud.** Chaque club partenaire voit passer du trafic
  « powered by Yuno ». Le jour où il veut vendre en direct, la conversation
  est déjà ouverte (voir « Le pont » plus bas).
- **Coût marginal quasi nul.** Pas de paiement, pas de support billetterie,
  pas de risque de fraude : la vente reste chez le club.

**Ce que le chef d'agence y gagne** (vs WhatsApp + stories Insta, ses outils
actuels) :
- **Une infrastructure brandée** : linktree agence (`/p/slug`), pages
  soirée/club propres, linktrees par promoteur (`/promo/slug`).
- **L'exclusivité de sa ville** : une agence par ville (champ `city` de
  `affiliates` + promesse commerciale). Statut + barrière à l'entrée.
- **Des outils d'équipe** : invitations, assignations de soirées, validation
  des linktrees par les managers, suivi par promoteur.
- **La fin du trou noir** : vues, clics, sources, heures de pointe, par
  soirée ET par promoteur. Ses chiffres, enfin.
- **Du revenu passif** : à mesure que la base d'utilisateurs Yuno grandit, la
  marketplace envoie des clients sur ses liens sans qu'il ne fasse rien. La
  tuile « Trafic apporté par Yuno » (Analytics) rend cet argument visible et
  mesurable — c'est l'hameçon de rétention.

## Architecture (état 2026-07-24, après remise à niveau)

- **Tables** : `affiliates` (agence, `linktree_slug`, `city`, exclusivité),
  `affiliate_venues` / `affiliate_events` / `affiliate_recurring_templates`
  (catalogue, `external_ticket_url` = la redirection), `affiliate_members`
  (promoteurs + managers, `linktree_status` draft→pending_review→approved),
  `affiliate_event_assignments` (qui promeut quoi, `submitted_url`),
  `promoter_linktree_events` (sélection + `promo_link` par promoteur),
  `affiliate_visitor_sessions` / `affiliate_clicks` / `affiliate_live_pings`
  (tracking), `affiliate_app_notifications` (inbox, 4e flux du modèle
  staff/organizer/admin, clé `feed_key`), `affiliate_notifications` +
  `affiliate_notification_automations` (communication d'équipe).
- **Tracking** : écritures anonymes via RPC `SECURITY DEFINER`
  (`flush_affiliate_session`, `ping_affiliate_live`) — ne JAMAIS revenir à des
  UPDATE/UPSERT anonymes directs : les policies UPDATE publiques ont été
  retirées par le hardening et tout écrasement silencieux reviendrait.
- **Attribution promoteur** : page `/promo/slug` OU lien tracé
  `?via=<linktree_slug>` sur les pages publiques soirée/club (le tracking ne
  démarre qu'après résolution du `via` — sinon double session).
- **Clics** : `affiliate_clicks.click_type` distingue `ticket` (soirée) et
  `booking` (réservation table depuis la page club). Un clic cible une soirée
  OU un club (contrainte `affiliate_clicks_target_check`).
- **Marketplace** : les soirées affiliées sont mêlées aux natives dans
  Explore (`eventType:'affiliate'`), routées vers `/affiliate-event/:slug`,
  divulgation « billetterie partenaire » sur les 4 surfaces publiques.
  L'assistant IA client les recommande (section SOIRÉES PARTENAIRES).

## Analyse double-casquette (2026-07-27) — ce qui manque pour une expérience premium unifiée

**Casquette gérant d'agence — sa semaine type et où le produit le sert (ou pas) :**
1. *Lundi matin, « qu'est-ce qui s'est passé ? »* → Aperçu : argent + trafic ✓.
   Manquait : le récap hebdo automatique (automation `weekly_recap` = config
   morte) et une vue unifiée des 7 prochains jours. → moteur d'automations SQL
   + strip « 7 prochains jours » bi-mode sur l'Aperçu.
2. *Préparer la semaine* : assignations externes ✓, événements Yuno ✓ — dans
   la même sidebar désormais.
3. *Motiver l'équipe* : leaderboard € ✓, suivi trafic ✓. Manquait : « top
   promoteur de la semaine » automatique. → automation.
4. *Payer* : Finance ✓ (intouché).
5. *Prouver sa valeur aux clubs* : RIEN. C'est pourtant SON argument de
   négociation. → **Rapport Club partageable** (lien public en lecture seule).
6. *Faire grandir* : aucun canal pour dire « ce club veut vendre sur Yuno ».
   → bouton lead → flux admin plateforme.
7. *Être prévenu sans chercher* : la cloche couvrait l'externe mais PAS le
   Yuno (un club signe ton contrat → silence). → triggers contrats → inbox.
8. *Fiche promoteur bi-mode* : le détail ignorait le bras externe. → section
   externe (linktree + stats 30 j).

**Casquette CEO Yuno :**
- Chaque rapport club envoyé = une impression « powered by Yuno » chez un gros
  club non-client. Le Rapport Club est autant un outil d'acquisition B2B qu'une
  feature agence — priorité n°1 des deux chaises.
- Le bouton lead alimente `admin_notifications` : pipeline B2B mesurable.
- Zéro config morte visible (les 8 automations tournent) = crédibilité produit.
- Cohérence trilingue partout = premium (pilules de période, jours du heatmap).

**Décisions de NON-construction (assumées) :**
- Fusion complète de l'espace promoteur bi-mode : touche l'UX argent des
  promoteurs club-side (confirmations de règlement) — cross-links pour
  l'instant, chantier dédié ensuite.
- « Migration 1-clic » club externe → venue réelle : l'onboarding club exige
  compte owner + Stripe — c'est un flux commercial (le lead), pas un bouton.
- Push mobile agence : cap edge functions (402).
- MFA asymétrique /affiliate vs /agency-app : posture de sécurité conservée.

## Les features qui font la différence (priorisées)

### P1 — Le Rapport Club partageable ⭐ le différenciant n°1
Le chef d'agence négocie sa commission avec les clubs **sur du vent**
(screenshots de stories). Lui donner un rapport par club auto-généré — vues,
clics billetterie, sources, heures, croissance, part Yuno — avec un **lien
public en lecture seule** à envoyer au manager du club chaque semaine.
- C'est son **arme de négociation** (la donnée que le club n'a pas).
- C'est le **canal d'acquisition B2B de Yuno** : le club lit un rapport
  « powered by Yuno » chaque semaine. Personne d'autre ne peut offrir ça.
- Effort : table `affiliate_report_links` (token) + RPC agrégat SECURITY
  DEFINER + une page publique `/r/:token`. Un chantier court.

### P2 — Le cahier de conversions
La vente réelle se passe sur Fourvenues : invisible. Mais les agences
**reçoivent les chiffres des clubs**. Leur donner la saisie des ventes par
soirée (billets attribués, commission due) rapprochée des clics → funnel
complet vues→clics→ventes, taux de conversion par promoteur, et **registre des
commissions dues par club** (réglées / en attente / en retard). Yuno devient le
grand livre de l'agence — l'outil qu'on n'abandonne pas. Plus tard : import
CSV Fourvenues.

### P3 — Gamification de l'équipe
Les promoteurs sont jeunes, la compétition est le moteur. Le leaderboard
existe (Suivi promoteurs) ; il manque : notification automatique du lundi
« top 3 de la semaine » (via le dispatcher d'automations, voir dette),
objectifs par soirée, et le classement visible côté promoteur (aujourd'hui
seul l'admin le voit — le rendre visible aux promoteurs est un one-liner à
fort effet).

### P4 — Kit de partage 30 secondes
Le lien tracé + QR existent. Il manque la **story template auto-générée**
(flyer + QR + logo agence, format 9:16 à télécharger) depuis l'assignation.
Objectif : « soirée assignée → story postée » en 30 secondes. C'est LA tâche
répétitive quotidienne des promoteurs ; celui qui la réduit gagne l'équipe.

### P5 — Badge « Partenaire officiel Yuno · <Ville> »
Sur le linktree agence et les pages publiques. Coût quasi nul, valeur de
statut réelle : il matérialise l'exclusivité ville vis-à-vis des clubs ET des
agences concurrentes.

### P6 — Le pont vers la conversion in-app (le flywheel long terme)
Quand un club partenaire, nourri au Rapport Club, veut vendre en direct :
migration club affilié → client Yuno, **l'agence garde l'attribution** et
touche une commission sur les ventes in-app (le champ
`affiliates.commission_rate` existe déjà ; le système club-side
`promoter_conversions` aussi). L'affilié devient la force de vente de Yuno
dans sa ville — et il est payé pour ça. C'est le modèle terminal : Yuno
recrute une agence par ville, chaque agence recrute ses clubs.

## Dette technique / risques connus

- **Automations sans dispatcher** : `affiliate_notification_automations` (8
  types, config seedée, UI de toggle) n'est lue par AUCUN cron. Config morte.
  Brancher le dispatch dans `process-scheduled-campaigns` (fonction déjà
  déployée → pas de blocage 402) sur le modèle de `dispatchPromoterPushes()`.
- **Notifications in-app monolangues** : les triggers écrivent le
  titre/message en français (même limite que staff/organizer/admin). Une
  agence espagnole lira du français dans sa cloche.
- **`?via=` limité aux linktrees approuvés** : la policy publique de
  `affiliate_members` ne montre que les membres au linktree approuvé — un
  promoteur non validé ne peut pas être attribué par lien tracé.
- **Pas de push mobile affilié** : l'inbox est in-app seulement. Le brancher
  au registre `platform_notification_settings` (audience "pro") quand le cap
  edge functions sera levé.
- **Admin = 1 seul user** : `affiliates.user_id` est scalaire ; les agences
  ont des associés. Les managers couvrent une partie du besoin.
- **Score Linktree non persisté** : recalculé à l'affichage, pas de tendance.

## Métriques de succès du pilier

1. Villes sous exclusivité active (agences avec ≥ 1 soirée publiée / semaine).
2. Part « Trafic apporté par Yuno » (croissance = l'argument passif devient réel).
3. Rapports club envoyés / semaine (P1) — proxy du pipeline B2B.
4. Promoteurs actifs hebdo (≥ 1 lien soumis ou ≥ 1 vue sur leur linktree).
