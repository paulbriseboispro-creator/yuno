# Yuno Billetterie au niveau de Yuno CRM : le plan de transposition

> Rédigé le 2026-10-17 à la demande de Paul. **Statut : plan validé, rien de
> construit.** Les dix décisions sont prises (§4), dont le nom : la Billetterie
> devient **Yuno Tickets** dans les trois langues, renommage à la session 3.
> Jusque-là, les textes et ce document disent encore « Billetterie ».
> État des lieux fait sur `origin/main` (le dossier local `main` a 192 commits
> de retard, voir §2.7).

## 1. Ce qu'on construit

Les deux produits restent séparés : Yuno CRM sur `crm.yunoapp.eu`, la Billetterie
sur `yunoapp.eu`. Mais la Console de la Billetterie (Club, Manager, Organisateur)
prend **le design du CRM** (blanc et rouge) et **toute sa puissance** :
Accueil, Analyses (Ventes, Trafic, Communauté, Guest list, Parcours client),
Campagnes (e-mails, SMS, automatisations), Pages d'inscription, Clients
(tous les clients, segments, imports). Ces écrans lisent les ventes que Yuno
fait lui-même (billets, tables, guest list), pas Shotgun.

Tout ce qui sert à VENDRE (soirées, billetterie, tables VIP, guest list, porte,
commandes, compta, promoteurs, collaborations, réglages) garde ses fonctions et
change seulement de design.

Ordre demandé par Paul : d'abord le design system, ensuite les écrans un par un.

## 2. Ce que j'ai trouvé

### 2.1 Les deux Consoles côte à côte

| | Yuno CRM (`src/crm/`) | Console Billetterie (`/owner`, `/organizer-app`, `/manager`) |
|---|---|---|
| Taille | ~330 fichiers, ~60 000 lignes ; ~400 fonctions SQL | ~120 pages ; ~490 fichiers de pages et composants, ~145 000 lignes |
| Technique de style | Un fichier CSS (`src/crm/styles/crm.css`, scope `.yc`), styles en ligne, composant `Hv` pour les survols. Ni Tailwind ni shadcn | Tailwind + shadcn + variables du thème pro (`pro-theme.css`), kits `org-ui`, `analytics/kit` |
| Thème | Clair seulement | Sombre par défaut + clair en option |
| Polices | Bricolage Grotesque (titres, chiffres), Geist (texte), Geist Mono (étiquettes) | Space Grotesk, Inter, JetBrains Mono |
| Graphiques | SVG faits main, animés | recharts |
| Ton | Vouvoiement | Tutoiement (« Ce que tu touches ») |
| Menu | 3 verbes : Piloter / Agir / Connaître | 5 groupes : Vue d'ensemble, Soirées, Ventes & finances, Marketing & CRM, Réglages |
| Source des chiffres | Shotgun seulement (`external_tickets`) | Ventes Yuno (`tickets`, `table_reservations`, `guest_list_entries`) |
| Source visuelle | Projet Claude Design « Design system Yuno créé » (28 écrans de Console) | `docs/DESIGN_SYSTEM.md` (« Yuno Dark Premium ») |

### 2.2 Le vrai cœur du chantier : le CRM ne lit que Shotgun

Chaque chiffre de la Console CRM vient de `external_tickets`. Les soirées Yuno
en sont exclues exprès (`external_source IS NOT NULL` dans `_crm_ana_setup`,
`_crm_people_build`, `crm_home__core`, `crm_nights__core`, la guest list, le
tiroir d'une soirée… migration `20261008130000`). Un acheteur Yuno entre bien
dans la base de contacts, mais avec 0 soirée, 0 €, cycle de vie « aucun ».

Donc **copier les écrans ne suffit pas** : ils seraient vides pour un compte
Billetterie. Il faut d'abord apprendre au moteur du CRM à lire les ventes Yuno.

### 2.3 Ce qui est déjà commun aux deux produits

- La portée : toutes les RPC prennent `(p_venue_id, p_organizer_user_id)`, les mêmes identifiants des deux côtés.
- Les tables e-mail (`email_campaigns`, modèles, destinataires), l'edge `send-campaign`, le moteur de l'Email Studio (le CRM réutilise son store et ses blocs).
- Le moteur SMS (`send-sms-campaign` gère déjà les deux portefeuilles).
- Le registre de consentement (`newsletter_subscriptions`), les imports (`import_contact_list`), la base vivante `contact_rows` (qui additionne déjà Yuno et Shotgun).
- Le moteur des recettes d'e-mail (`email_automations`, `collect_email_automations` lit déjà les deux sources).
- Les liens suivis (`tracked_links`).

### 2.4 Les portes

Presque toutes les RPC `crm_*` vérifient le RÔLE, pas le produit
(`crm_scope_allowed`, `crm_scope_writable`) : un propriétaire de club peut déjà
les appeler, elles rendent juste du vide. Ce qui ferme vraiment le CRM à un
compte Billetterie : `get_my_crm_spaces`, `crm_user_in_scope` (policies des
campagnes du CRM), les Yunits (`crm_yunits_ensure_allowance`, `get_crm_limits`),
la facturation (`crm_campaign_is_crm`, `sms_campaign_is_crm`), `CrmLegalGate`,
et le domaine (`productHostDecision` envoie `/crm` et `/j` sur crm.yunoapp.eu).

### 2.5 La Billetterie mesure plus que Shotgun

Les cartes « Bientôt, avec l'intégration partenaire Shotgun » du CRM (visites de
la page de vente, passage visite → achat, qui a cliqué sans acheter, paniers
abandonnés) parlent de données que Yuno POSSÈDE pour ses propres ventes
(`visitor_sessions`, checkouts, clics). Dans la Billetterie, ces cartes
deviennent de vrais chiffres. C'est un argument de vente.

### 2.6 Ce que la Billetterie a et que le CRM n'a pas (à garder)

Tables VIP comme pilier d'analyse, En direct (globe), Comportement d'achat,
Rapport de soirée (objectif, prévision Hype), promoteurs et « Qui fait vendre »,
push, publicité Meta, CA club net des frais Yuno, co-organisation et collab.

### 2.7 Trois constats en route

- **Le dossier local `main` a 192 commits de retard sur GitHub** (et un commit
  local, `baa74e0e` « Écran noir au lien collé dans Safari », absent de
  `origin/main`). Les scénarios, « Ce qui fait venir », le plan de soirée,
  « Qui cibler », le témoin 10 % et les liens partenaires n'y sont pas. Il y a
  aussi des fichiers modifiés non commités (prix CRM, aide), sans doute d'une
  autre session. À remettre d'aplomb avant la session 1, sans écraser ce travail.
- **Console Club sur téléphone** : le bouton du menu n'existe que sur l'accueil
  (`OwnerHeader` n'en a pas), et le menu ne se referme pas après un clic. La
  **Console Manager n'a pas de menu du tout**, et deux de ses cartes mènent à des
  pages qui n'existent pas (`/manager/finance`, `/manager/crm`). La nouvelle
  coquille règle les trois.
- `src/pages/crm/*` (`CrmHome`, `CrmNights`, `CrmNightReport`, `CrmAudience`) et
  les RPC `get_crm_overview` / `get_crm_nights` / `get_crm_night_report` sont du
  code mort, remplacé par `src/crm/`. À supprimer à la fin.

## 3. Les choix d'architecture (mes recommandations)

**A1. Un seul design system, partagé par les deux produits.** On sort le kit du
CRM (`src/crm/ui`, `Hv`, `Icon`, `motion`, graphiques de `anaUi`, tableaux,
états de chargement et d'erreur) dans un module commun, avec des variables qui ne
se marchent plus dessus (aujourd'hui `--ink` et `--paper` veulent dire deux
choses différentes dans le CRM et dans Tailwind). Le CRM s'affiche à
l'identique, la Billetterie l'utilise. Jamais deux copies qui divergent.

**A2. Un seul moteur, deux sources de ventes.** Les RPC du CRM lisent une source
de ventes unique : ventes Yuno ∪ ventes Shotgun, avec les mêmes règles (ce qui
est une vente, qui est venu, guest list, provenance, argent). Les mêmes RPC
servent alors la Console CRM (compte Shotgun), la Console Billetterie (compte
Yuno) et un compte qui a les deux (WOH : ses soirées Yuno ET Shotgun, une seule
base). L'autre voie, réécrire les écrans du CRM sur les RPC de la Billetterie,
fabriquerait deux moteurs d'analyse qui divergent : c'est exactement le défaut
des « treize endroits où le même mot porte deux chiffres » corrigé le 25/09.

**A3. Un écran = un composant, deux adresses.** `/crm/clients` et
`/owner/clients` (ou `/organizer-app/clients`) rendent le même composant ; seul
le contexte change (routes, droits, produit). Une correction profite aux deux
produits.

**A4. Chaque écran neuf arrive derrière un interrupteur.** Leçon du 01/10
(Analytics v3 construite puis rejetée) : tu vois chaque écran en vrai, sur la
démo, en capture avant / après (ordinateur et téléphone), l'ancien reste en place
jusqu'à ton accord, puis il est supprimé dans la foulée. Ce plan remplace la
règle du 01/10 « ne pas proposer un écran qui remplacerait les familles
d'Analytics » : c'est ta demande d'aujourd'hui, à écrire dans `CLAUDE.md` à la
session 0.

**A5. Ce qui ne change pas.** Le staff de nuit (videur, hôte VIP, vestiaire) et
l'app native Yuno Pro restent sombres : on s'en sert dans un club la nuit. Pages
publiques, e-mails, passes Wallet : rien. Le pilier boissons reste en pause et
gaté.

## 4. Les décisions

Validées par Paul le 2026-10-17 : D1, D2 et D4 à D10 telles que recommandées,
D3 après discussion (pistes : garder « Billetterie », « Yuno Tickets », « Yuno »
tout court).

| # | Question | Décision |
|---|---|---|
| D1 | Thème de la Console | Clair seulement (blanc et rouge), le sombre retiré de la Console dès la session 2. Le staff de nuit reste sombre. |
| D2 | Tu ou vous ? La Billetterie tutoie, le CRM vouvoie | Vouvoiement dans toute la Console (« usted » en espagnol), appliqué écran par écran pendant la transposition, puisque chaque texte est réécrit de toute façon. |
| D3 | Le nom. Paul dit « Yuno Ticket » ; aujourd'hui c'est « Yuno Billetterie » en français, « Yuno Ticketing » en anglais et en espagnol (~50 textes) | **« Yuno Tickets », le même nom en français, en anglais et en espagnol.** Renommage à la session 3, avec la coquille. Le CRM reste « Yuno CRM ». |
| D4 | Le menu | Les trois verbes du CRM, plus un groupe pour vendre : **Piloter** (Accueil, Analyses), **Vendre** (Soirées, Billetterie, Guest list, Tables VIP, Promoteurs), **Agir** (Campagnes : e-mails, SMS, push, automatisations, publicité), **Connaître** (Pages d'inscription, Clients, Fidélité), **Argent** (Commandes, Remboursements, Factures, Compta, Paiements). Pied : Réglages, Aide. La règle « cinq groupes » de `CLAUDE.md`, le fil d'Ariane du mode d'emploi et les extraits de l'assistant suivront. |
| D5 | L'argent | Les fonctions CRM sont **incluses** dans la Billetterie (Yuno se rémunère sur les billets). Les e-mails gardent le modèle Billetterie (15 000 offerts par mois, crédits au prix coûtant). Le SMS s'ouvre dans la Billetterie par Octopush avec les crédits SMS de la Billetterie. Les Yunits restent au CRM. Conséquence à assumer : « ajouter Yuno CRM » à un compte Billetterie ne sert plus qu'à brancher Shotgun. |
| D6 | Compte à deux produits (WOH) | Une seule base et toutes ses soirées, Yuno et Shotgun, dans les deux Consoles. Aujourd'hui la Console CRM masque les soirées Yuno parce qu'elles s'y affichaient à 0 vendu ; avec le moteur commun, elles auront leurs vrais chiffres. |
| D7 | Les définitions communes | Argent = ce que le pro touche hors frais de billetterie (CA club pour Yuno, valeur faciale pour Shotgun). Fenêtre d'attribution d'un e-mail = 7 jours partout (CRM) au lieu de 72 h (Billetterie). Habitués = règles du CRM (N soirées en M mois, réglables) à la place des six noms RFM. Venu = scanné, sur une soirée dont la porte a scanné au moins la moitié. |
| D8 | Qui voit la nouvelle Console, et quand | Toi et les comptes démo d'abord (interrupteur par compte), puis tous les comptes réels d'un coup, zone par zone, après ta validation. WOH et Amoris ne voient jamais un écran à moitié fini. |
| D9 | Consoles Agence et Affilié | Dans le périmètre, mais en dernier (elles ont leurs propres kits `promoter-ui`, `affiliate-ui`). |
| D10 | Design des écrans de vente | Le projet Claude Design du CRM exclut la billetterie. Pour les cinq gros écrans (Soirées et formulaire, Billetterie, Tables VIP, Commandes, Compta), je fais d'abord une maquette dans Claude Design, dans le même design system ; tu la commentes ; je code ensuite. Le reste passe directement au nouveau design, validé sur captures. |

## 5. Les sessions

Une session = une branche dans son propre dossier de travail, un livrable que tu
vois en vrai, une validation de ta part avant la fusion. Les sessions SQL passent
une par une (la prod est sur une machine Micro : un test lourd à la fois).

### Vue d'ensemble

| # | Session | Ce que tu verras à la fin | Après |
|---|---|---|---|
| 0 | Préparer | Dépôt à jour, captures « avant » de toute la Console, décisions écrites | — |
| 1 | Design system commun | Le CRM identique au pixel, le kit disponible pour la Billetterie | 0 |
| 2 | Le vernis | Toute la Console Billetterie en blanc et rouge, polices du CRM | 1 |
| 3 | La coquille + le nom | Nouveau menu, barre du haut, recherche, cloche ; mobile réparé ; Manager avec un menu ; « Yuno Tickets » partout | 2 |
| 4 | Composants de saisie + maquettes | Formulaires, dates, téléversements, tableaux d'argent ; maquettes des 5 gros écrans dans Claude Design | 3 |
| 5 | Moteur : une source de ventes | La Console CRM de la démo club affiche les ventes Yuno, avec les bons chiffres | 1 (SQL, peut avancer pendant 2-4) |
| 6 | Moteur : les personnes | Clients, cycle de vie, segments, guest list, recettes et scénarios sur les ventes Yuno | 5 |
| 7 | Moteur : ce que seule la Billetterie mesure | Les cartes « Bientôt » deviennent des chiffres ; tables VIP, promoteurs, push dans les analyses | 6 |
| 8 | Accueil | L'accueil du CRM dans la Billetterie | 3, 7 |
| 9 | Analyses : Ventes + Trafic | Avec En direct et le rapport de soirée | 8 |
| 10 | Analyses : Communauté + Guest list + Parcours client | Avec « Ce qui fait venir » | 9 |
| 11 | Clients, fiche client, Segments, Imports | La base unique, le catalogue de segments | 6, 3 |
| 12 | Campagnes e-mail + Automatisations + Scénarios | Push et publicité Meta rangés dans Campagnes | 11 |
| 13 | SMS + Pages d'inscription + Liens de partage | Le SMS ouvert dans la Billetterie (D5) | 12 |
| 14 | Soirées | Liste, fiche, formulaire, séries, collaborations | 4 (parallélisable) |
| 15 | Billetterie + Guest list | Tarifs, mode libre, codes promo, rareté, liste d'attente, parts | 4 (parallélisable) |
| 16 | Tables VIP + Service VIP | Atelier, plan de salle, salles VIP, service du soir | 4 (parallélisable) |
| 17 | Argent | Commandes, remboursements, factures, compta, paiements Stripe | 4 (parallélisable) |
| 18 | Promoteurs, agences, DJ, co-organisation | | 4 (parallélisable) |
| 19 | Réglages, équipe, aide, guide de configuration | | 4 (parallélisable) |
| 20 | Consoles Agence + Affilié | Si D9 | 19 |
| 21 | Bascule et ménage | Nouvelle Console pour tous, ancien code supprimé, docs et aide à jour | tout |

Les sessions 14 à 19 ne touchent pas les mêmes fichiers que 5 à 13 : elles peuvent
tourner en parallèle, chacune dans son dossier, dès que la session 4 est faite.

### Détail

**Session 0 : préparer (courte).**
- Remettre le dossier local à jour avec GitHub sans perdre le commit local ni les fichiers modifiés d'une autre session.
- Prendre les captures « avant » de chaque page de la Console, club et organisateur, ordinateur et téléphone (`scripts/demo/drive.mjs`), comme référence.
- Écrire tes réponses aux décisions D1 à D10 dans ce document et dans `CLAUDE.md` (dont le remplacement de la règle Analytics du 01/10).

**Session 1 : le design system commun.**
- Sortir de `src/crm/` les jetons, le kit, `Hv`, `Icon`, `motion`, les toasts, les graphiques (`anaUi`), les tableaux, les états de chargement et d'erreur, vers un module commun.
- Renommer les deux variables qui se marchent dessus, `--ink` et `--paper`, pour que Tailwind et le kit cohabitent dans la même page.
- Un seul chargeur de polices ; le thème Tailwind expose les jetons du design system.
- Rassembler les composants en double du CRM (plusieurs `GreenSwitch`, `Seg`, `CardHead`…).
- Écrire `docs/DESIGN_SYSTEM_CONSOLE.md`, la référence des deux Consoles.
- Preuve : captures du CRM avant / après, identiques ; tests et typage au vert.
- Risque : le CRM sert un vrai client (Kevin). C'est un déménagement de fichiers sans changement de rendu, prouvé par captures.

**Session 2 : le vernis.**
- Les variables du thème pro prennent les valeurs du CRM (papier, sable, encre, rouge Yuno, rayons, ombres) et les polices du CRM. Les ~490 fichiers de la Console changent d'apparence sans être touchés un par un.
- La Console passe en clair seulement (D1) ; le sombre reste pour le staff de nuit et les îlots (globe En direct, aperçus de téléphone).
- Corriger la cinquantaine de fichiers aux couleurs sombres écrites en dur (`vip-service/*`, guides de configuration, `TemporalOrders`, `AdPreview`…).
- Derrière l'interrupteur (D8). Preuve : captures avant / après de chaque page.

**Session 3 : la coquille.**
- Menu latéral et barre du haut du CRM pour Club, Manager et Organisateur, avec le menu de D4, la recherche, la cloche, le menu du compte, le changement d'espace.
- Mobile : tiroir avec bouton partout, fermeture après un clic. Manager : un vrai menu, les liens morts retirés.
- Corriger en même temps le fil d'Ariane du mode d'emploi (`ohelp.*`, trois langues) et les extraits de `owner-assistant` qui nomment les groupes.
- **Renommer le produit en « Yuno Tickets »** (D3) partout où un pro le lit : ~50 textes de l'app (« Yuno Billetterie » en français, « Yuno Ticketing » en anglais et en espagnol, dont ceux du CRM qui renvoient vers la Billetterie), mode d'emploi, assistant, serveur MCP, e-mails, super admin, la landing (dépôt `Yuno-landing`), puis `CLAUDE.md` et les docs. Les noms techniques ne bougent pas (`product = 'suite'`, routes, clés i18n).

**Session 4 : composants de saisie + maquettes.**
- Ce que le kit du CRM n'a pas et dont la Billetterie a besoin : champs, sélecteurs, date et heure, téléversement d'image et de vidéo, étapes, tableaux d'argent, pastilles de statut des piliers, fenêtres et tiroirs à la place de shadcn.
- Maquettes Claude Design des cinq gros écrans de vente (D10), pour ton avis.

**Session 5 : le moteur, une source de ventes.**
- Une source unique des ventes (Yuno ∪ Shotgun), en partant de `_sales_period_tx` qui décrit déjà les ventes Yuno, avec pour chaque vente : soirée, personne, montant (règles de `fees.ts`), unités, scanné ou non, guest list, remboursement, provenance.
- Les soirées de la portée : Yuno, miroirs Shotgun ou les deux (D6), collab et co-organisation comprises comme dans `analytics_scope_gate`.
- Brancher dessus `_crm_tickets`, `_crm_ana_setup`, `_crm_ticket_source`, `_crm_event_scan_known`, `_crm_email_attrib`, `_crm_night_tiers` (tarifs = `ticket_rounds`).
- Banc à l'échelle de WOH, en rôle `authenticated` (leçon du 15/10 : sans, le mauvais plan reste invisible). Chaque écran sous 3 s.
- Preuve : on donne le CRM au club démo `womber` le temps du test ; la Console CRM existante, sans changement d'écran, affiche ses ventes Yuno avec les mêmes chiffres que l'Analytics de la Billetterie.

**Session 6 : le moteur, les personnes.**
- `_crm_people_build` lit la source unique : soirées, dépense, cycle de vie, guest list, provenance, profil (âge, ville) pour un acheteur Yuno. Sans double comptage avec `contact_scope_customers`, qui additionne déjà les deux sources.
- Garder les deux chemins de `_crm_people_build` (avec et sans la mémoire de transaction).
- Segments : faire converger `crm_segments`, `contact_segments` et `venue_segments` sans casser une campagne qui vise un ancien segment.
- Recettes, scénarios, analyse « Ce qui fait venir », score, témoin 10 % : déclencheurs et recalculs sur les ventes Yuno (aujourd'hui seul `ticketing_after_sync` les réveille).

**Session 7 : ce que seule la Billetterie mesure.**
- Les cartes « Bientôt Shotgun » deviennent de vrais chiffres pour les ventes Yuno : visites de la page de vente, passage visite → achat, paniers abandonnés, cliqué sans acheter.
- Nouvelles provenances : promoteur, push, Explore, page du club, liens suivis `/l/` et liens partenaires.
- Les tables VIP comme pilier des analyses. Tableau de parité : aucun chiffre de l'Analytics actuelle ne disparaît sans ton accord.

**Sessions 8 à 13 : les écrans du CRM dans la Billetterie.** Chaque session :
même composant que le CRM (A3), derrière l'interrupteur, captures avant / après,
textes ×3, mode d'emploi, assistant, données démo.
- **8. Accueil.** L'accueil du CRM, plus ce qui ne vit que dans la Billetterie (prochaines soirées en vente, actions du jour).
- **9. Ventes + Trafic.** En direct reste (globe). Le rapport de soirée devient le tiroir d'une soirée, comme dans le CRM.
- **10. Communauté + Guest list + Parcours client**, avec « Ce qui fait venir ».
- **11. Clients, fiche client, Segments, Imports.** Remplace `OwnerCustomers` / `OrgAppCustomers`, la base de contacts et le dialogue d'import.
- **12. E-mails + Automatisations + Scénarios.** Vue d'ensemble, campagnes, modèles, résultats, analyse, réglages, Studio, envoi. Push et publicité Meta rejoignent Campagnes avec le nouveau design.
- **13. SMS + Pages d'inscription + Liens de partage.** À trancher en session : une page d'inscription d'un compte Billetterie doit-elle vivre sur `yunoapp.eu/j/…` plutôt que `crm.yunoapp.eu` ?

**Sessions 14 à 19 : le reste de la Billetterie, nouveau design.** Les fonctions
ne changent pas. Les cinq gros écrans partent des maquettes validées (D10).
- **14. Soirées** : `OwnerEvents` (2 500 lignes), séries, hub Collaborations.
- **15. Billetterie et guest list** : `OwnerTicketing` (2 000 lignes), mode libre, codes promo, rareté, liste d'attente, parts.
- **16. Tables VIP** : atelier club et orga, plan de salle, salles VIP, Service VIP.
- **17. Argent** : commandes, remboursements, factures, compta, paiements Stripe.
- **18. Promoteurs, agences, DJ, co-organisation.**
- **19. Réglages** (établissement, équipe, staff, managers, intégrations, IA, accès assisté), notifications, centre d'aide, guide de configuration. À trancher : la porte de l'organisateur (`/organizer-app/checkin`), utilisée la nuit, reste-t-elle sombre ?

**Session 20 : Consoles Agence et Affilié** (si D9).

**Session 21 : bascule et ménage.**
- Nouvelle Console pour tous les comptes.
- Supprimer l'ancien : pages remplacées, `src/pages/crm/*`, anciens composants d'Analytics, `org-ui`, l'ancien `DESIGN_SYSTEM.md`, et les RPC sans lecteur.
- `CLAUDE.md` réécrit sur ces sections, mode d'emploi complet (captures WebP ≤ 1280 px), assistant, glossaire du MCP, démo rafraîchie, QA complète, vitesse en prod.

### Effort

| | Équipe humaine | Claude Code |
|---|---|---|
| Design system + coquille (0 à 4) | 4 à 5 semaines | 5 sessions |
| Moteur commun (5 à 7) | 5 à 6 semaines | 3 sessions |
| Écrans CRM (8 à 13) | 6 à 8 semaines | 6 sessions |
| Restyle du reste (14 à 20) | 8 à 10 semaines | 7 sessions, en partie en parallèle |
| Bascule (21) | 2 semaines | 1 à 2 sessions |
| **Total** | **~6 mois à deux ou trois** | **~22 sessions** |

Ce qui ne se compresse pas : ton regard sur chaque écran.

## 6. Règles pour chaque session

- Une branche et un dossier de travail par session. Push, fusion et migrations en prod : c'est toi qui lances (ou tu passes la session en « Demander les permissions »).
- Une migration se répète d'abord en prod dans une transaction annulée, puis `db lint`. Un test SQL lourd à la fois, jamais pendant la migration d'une autre session.
- Chaque nombre suit `metrics.ts` et `fees.ts`. Ce qu'on ne mesure pas s'affiche « Bientôt », jamais un chiffre inventé.
- Textes en trois langues ; mode d'emploi et assistant dans la même session ; données démo à jour.
- Captures avant / après, ordinateur et téléphone, avant de te demander ton accord.
- Rien du pilier boissons n'est supprimé ; toute nouvelle surface qui en parle est gatée.
- `CLAUDE.md` mis à jour en fin de session, une seule fois, sur ce que la session a changé.

## 7. Risques

- **Ton goût.** C'est le premier risque (l'Analytics v3 du 01/10). Réponse : interrupteur, captures, validation écran par écran, l'ancien gardé jusqu'à ton oui.
- **Double comptage** d'un compte à deux produits. Réponse : une seule source, testée sur WOH.
- **Vitesse.** `_cp` est recalculé à chaque requête ; une deuxième source l'alourdit. Réponse : banc WOH à chaque session SQL, plafond de 3 s par écran. Chaque fonction ajoutée rallonge aussi le rechargement du cache de l'API (~1 400 fonctions) : réutiliser plutôt qu'ajouter.
- **Clients réels en pleine transition** (Amoris, WOH). Réponse : D8.
- **Deux versions d'un écran trop longtemps.** Réponse : supprimer l'ancien dès ton accord, zone par zone.
- **Sessions en parallèle** sur des fichiers partagés (`App.tsx`, `CLAUDE.md`, les textes). Réponse : un seul écrivain par groupe de fichiers, chaque session dans son dossier.

## 8. Prochaine étape

La session 0.
