# Admin › Madrid : la marketplace externe, mesurée honnêtement

Date : 17/11/2026. Rubrique de l'admin `/admin/madrid` (nom provisoire), code
`src/admin/madrid/`, migration `20261218180000_admin_madrid.sql` (NON appliquée).
Question de Paul : « Je veux savoir si cette stratégie commerciale sur Madrid
marche et vaut le coup. »

La marketplace de Madrid, ce sont les soirées de clubs **non clients** de Yuno
(`affiliate_events` de l'agence « Mad by Night »), dont le bouton sort vers la
billetterie du club (Whan, avec `?ref=` d'un compte promoteur). **Rien ne se vend
dans Yuno pour ces soirées.** La rubrique ne compte que cette marketplace ; les
ventes faites DANS Yuno n'apparaissent que sur la page « Effet sur Yuno ».

## 1. Inventaire des données (lu en prod le 17/11, lecture seule)

| Source | Ce qu'elle contient pour Madrid | Volume réel | Depuis | Pièges |
|---|---|---|---|---|
| `affiliates` | 3 agences : **Mad by Night (Madrid)**, 2 à Paris (démo / test). | 1 agence à Madrid | 07/08 | La ville est un texte libre (`city`). |
| `affiliate_venues` | Les clubs du catalogue. | 24 clubs, **6 actifs** (Istar, Los Amantes, Rubicon, Teatro Kapital, Todos Santos, Victoria) | 08/2026 | 18 clubs inactifs gardent des séries allumées. |
| `affiliate_events` | Les soirées. `status` = `published` (visible) ou `draft` (pas de lien, invisible). | 353 publiées, 658 brouillons (tous sans lien) ; dates du 25/09/2026 au 25/01/2027 | 25/09 | Les soirées d'avant le 25/09 ont été **effacées** (ancienne purge) : leurs visites et clics ne gardent que la photo `event_slug` / `event_name`. |
| `affiliate_recurring_templates` | Séries (un jour de la semaine, 0 = dimanche). | 54 actives, 7 éteintes | | 29 séries actives appartiennent à des clubs inactifs : elles fabriquent 290 brouillons inutiles. |
| `affiliate_ticket_sync_runs` / `_seen` / `_sources` | Synchro Whan quotidienne (18 h Madrid), 2 comptes promoteur (`paul-brisebois-2`, `milo-madbynight`). | 53 passages (1 / jour depuis le 28/09), 229 liens posés, 18 soirées ponctuelles créées, 0 erreur | 28/09 | Le journal dit ce qui a été posé, pas si le lien marche encore. |
| `affiliate_clicks` | **Une ligne = une sortie vers la billetterie.** Toujours enregistrée (sans consentement : anonyme). | 145 clics externes depuis août (66 personnes) ; 32 internes | 06/08 | `is_internal` ne marque que le titulaire sur sa propre page : il faut AUSSI retirer super admins, titulaire, membres et démo (8 clics de comptes connectés, dont le super admin et le titulaire). `referrer_category = paid_social` vient de `fbclid`, qu'Instagram ajoute partout : c'est Instagram, pas de la pub. Dans l'app le référent est vide : sorties de l'app = « direct ». |
| `affiliate_visitor_sessions` | Mesure de l'agence, **avec consentement** (identifiant visiteur d'un an). Une ligne par page + soirée (pas par visite). | 506 lignes externes, 183 visiteurs depuis juin | 14/06 | Gatée par le bandeau cookies : ne voit qu'une partie des visiteurs. `country` et `city` jamais remplis. Sert aux retours et aux cohortes, jamais aux volumes. |
| `platform_sessions` + `platform_page_views` | Mesure de la plateforme **sans cookie** (empreinte salée du jour) : toutes les pages publiques, `/affiliate-event/`, `/affiliate-venue/`, `/p/`, `/rp/`, `/promo/` comprises. Pays, langue, canal, app ou web. | 1 430 sessions ont vu la marketplace depuis le 27/08 ; **≈ 80 % sont des robots** | 27/08 | L'empreinte change chaque jour : impossible de suivre quelqu'un d'un jour à l'autre. 1 155 sessions sur 1 430 viennent des États-Unis, sans référent, navigateur inconnu ou Chrome Android, 1,3 page, 0 s : des robots d'indexation qui exécutent la page. |
| `affiliate_reported_sales` | Ventes et commissions déclarées à la main. | **0 ligne** | | La seule preuve de vente qui pourrait exister : elle est vide. |
| `affiliate_report_links`, `affiliate_event_assignments`, `affiliate_members`, `affiliate_linktree_events` | Rapport partageable, promoteurs, sélection du linktree. | 1 lien de rapport, 0 assignation, 0 membre, 6 soirées choisies | | Aucun promoteur n'est rattaché : pas de conversion par promoteur. |
| `favorites` | Favoris sur un club / une soirée externe. | 4 favoris, 2 personnes | | |
| `profiles` | Ville du profil. | 5 profils « Madrid » (dont le titulaire de l'agence) | | 11 profils « Segovia » : comptes de test probables, à vérifier. |
| `push_subscriptions` | Abonnés push. | Pas de ville : aucune liste d'abonnés « Madrid » n'existe. | | |
| `pro_signups`, `links_pro_leads`, `venues` | Pros de Madrid côté Yuno. | 1 inscription (« Dakiti prueba », un test), 0 lead, 2 clubs Yuno cachés (tests) | | |
| Découverte personnalisée | `get_taste_events_for_user` filtre par ville et inclut les soirées partenaires. | Pas de journal d'envoi par ville lisible ici. | | Non mesuré dans la rubrique. |

Ce que **personne** ne mesure : l'achat chez le club, l'installation de l'app
par ville, le lien encore valide (la synchro lit Whan pour trouver les liens, rien ne vérifie qu'un lien posé marche encore), le
visiteur qui crée un compte sans jamais cliquer connecté.

## 2. Définitions

Chaque chiffre de la rubrique sort d'une de ces règles (RPC `admin_madrid_traffic`
et `admin_madrid_offer`, super admin seul, < 0,3 s mesuré en transaction annulée).

- **Agence de Madrid** = `affiliates.city` commence par « madrid » ; une agence dont
  le titulaire est un compte démo n'en est une qu'avec l'interrupteur démo.
- **Nuit** = heure de Paris (= Madrid) − 8 h, la règle d'`affiliate_night_date()`.
- **Visiteur** = une empreinte `platform_sessions.visitor_hash` (une personne sur un
  jour) d'une session qui a ouvert une page de la marketplace de Madrid : une
  soirée de Madrid (ou une soirée effacée qui n'appartient à aucune autre agence),
  un club de Madrid, le linktree / la page d'agence / un promoteur de l'agence.
  **Robots retirés** : session web (jamais l'app) sans référent depuis les
  États-Unis, ou navigateur non reconnu (`_admin_madrid_is_robot`).
- **A vu une soirée** = visiteur dont la session a ouvert une `/affiliate-event/`.
- **Sortie** = une ligne `affiliate_clicks` d'une agence de Madrid, hors interne,
  hors super admins, titulaire, membres, agence fusionnée et démo.
  **Personne sortie** = `visitor_id`, sinon `browser_id`, sinon le clic lui-même
  (un clic anonyme compte pour une personne : borne haute).
- **Vente connue** = ligne `affiliate_reported_sales`. Aucune aujourd'hui :
  l'écran dit « Non mesuré ».
- **Club d'une sortie ou d'une vue** = club de la soirée ; pour une soirée effacée,
  la série dont le slug préfixe `<slug>-AAAA-MM-JJ`, sinon le club dont le slug est
  contenu dans celui de la soirée. Sinon « club inconnu ».
- **Taux de sortie** = personnes sorties / visiteurs, **affiché dès 10 visiteurs**
  (sinon « n sur base »). Deux mesures différentes : il peut dépasser 100 % sur une
  petite base, et l'écran le dit.
- **Source** (visite) = app, pub (utm payant), linktree (`/p/`, `/rp/`, linktr.ee),
  Instagram (navigateur Instagram, référent ou `utm_source = ig`), autres réseaux,
  recherche, site Yuno (arrivée sur une autre page de Yuno), direct, autre.
  **Source** (sortie) = celle gardée par le clic (`referrer_category`, utm).
- **Déjà venu** (mesure avec consentement) = visiteur de la période dont la première
  visite connue précède la période. **Cohorte** = semaine de première visite, part
  revue la semaine k (1 à 6).
- **Compte venu par Madrid** = compte créé, puis connecté quand il a cliqué une
  sortie de Madrid dans les 7 jours. **Comptes connus** = ont cliqué connectés,
  favori à Madrid, ou ville « Madrid ».
- **Achat ensuite dans Yuno** = billet payé (`paid`, `used`) ou table payée
  (`paid`, `confirmed`) après la première sortie de la personne, soirées démo
  retirées. Montant = ce que le client a payé (une **dépense**, jamais un CA) ;
  frais de service Yuno à part. Acheter après ne prouve pas la cause.
- **Club retrouvé chez Yuno** = même nom une fois retirés « the », « club »,
  « madrid », espaces et ponctuation, dans `venues`, `pro_signups`, `links_pro_leads`.
- **Soirée sans lien** = brouillon sans `external_ticket_url` d'un club actif.
- **Coût** = saisie mensuelle facultative `admin_madrid_inputs` (coût en euros,
  heures, note), écrite par `admin_madrid_input_set` (journal d'audit). Coût par
  sortie = coût des mois renseignés / sorties de ces mois.

## 3. Le verdict (seuils)

Calculé au front (`src/admin/madrid/rules.ts`, testé) sur des fenêtres FIXES de
4 semaines contre les 4 précédentes, quelle que soit la période choisie :

- **trop peu pour juger** : moins de 20 sorties ET moins de 50 visiteurs ;
- **progresse / recule** : sorties ± 20 % ET au moins 5 sorties d'écart ;
- **stable** sinon ;
- **retours faibles** : moins de 10 % des visiteurs mesurés déjà venus (base ≥ 10) ;
- **« vaut le coup ? »** n'est jamais dit tant que les ventes chez les clubs ne sont
  pas connues ; le coût par sortie n'apparaît qu'une fois des coûts saisis.

## 4. Ce que dit la rubrique le 17/11 (données réelles)

- **4 dernières semaines** : 50 sorties vers la billetterie (40 personnes) contre 20
  (15 personnes) les 4 semaines d'avant ; 106 visiteurs contre 67. Verdict :
  « l'intérêt progresse ».
- **Retours** : 1 visiteur mesuré sur 50 était déjà venu ; cohortes à 0 ou 1 retour
  par semaine. La marketplace attire du passage, elle ne fidélise pas encore.
- **Robots** : 833 sessions sur 949 (30 jours) étaient des robots. Sans ce filtre, le
  trafic aurait l'air de décupler depuis octobre.
- **Clubs** (30 j) : Teatro Kapital 14 sorties, Todos Santos 12, Victoria 9, Rubicon 8,
  Los Amantes 5, Istar 2. Le samedi fait 28 sorties sur 50, le jeudi 12.
- **Sources** (30 j) : recherche 36 visiteurs / 24 sorties, Instagram 27 / 24, app 29 / 0
  visible (la sortie de l'app se range en « direct »), site Yuno 7.
- **Pays** : 61 visiteurs depuis l'Espagne sur 110 ; langue du téléphone en anglais
  pour 67 : beaucoup d'étrangers vivant ou de passage à Madrid.
- **Ventes** : aucune déclarée, aucune commission. Coûts : non renseignés.
- **Effet sur Yuno** : 3 comptes venus par Madrid (tous en septembre) ; 1 seule
  personne a ensuite acheté dans Yuno, pour 6,99 € (0,99 € de frais Yuno), soirées
  démo retirées. Ce compte a la ville « Segovia » : probablement un test, à vérifier.
  Aucun club du catalogue n'est client, inscrit ou prospect de Yuno.
- **Catalogue** : 6 clubs actifs sur 24, 95 soirées publiées sur 4 semaines, synchro
  quotidienne sans erreur ; 83 soirées de clubs actifs sans lien sur 8 semaines ;
  81 des 103 soirées publiées passées (30 j) n'ont eu **aucune** sortie.

## 5. Pour trancher vraiment

1. **Les ventes** : demander à Whan (ou au club) le nombre de billets vendus avec le
   `?ref=` de chaque compte promoteur, chaque mois, et le saisir dans
   `affiliate_reported_sales` (la table et sa page existent côté agence). Sans ça,
   « ça vaut le coup » reste invérifiable.
2. **Les coûts** : remplir chaque mois coût et heures dans Verdict › « Ce que Madrid
   coûte et rapporte ».
3. **L'app** : poser la source sur le clic (`referrer_category = 'app'` quand la page
   est ouverte dans l'app) pour ne plus ranger les sorties de l'app en « direct ».
4. **L'attribution des comptes** : garder l'arrivée « marketplace de Madrid » sur la
   création de compte (comme `pro_signups.source`) pour voir les comptes qui ne
   cliquent jamais connectés.
5. **Le pays des visites de l'agence** : `affiliate_visitor_sessions.country` n'est
   jamais rempli (la mesure plateforme le fait, via `cf-ipcountry`).

## 6. Les autres rubriques sont-elles polluées ?

Lu dans les définitions vivantes, rien n'a été modifié :

- **Oui, les visites.** `admin_cockpit`, `admin_product_insights` et
  `get_platform_traffic` lisent `platform_sessions` sans filtre : les pages
  `/affiliate-event/` et `/affiliate-venue/` y comptent comme des pages de soirée
  (`platform_page_group` les range dans `event` / `venue`), robots compris. Sur
  30 jours, 956 sessions sur 8 201 (12 %) ont vu la marketplace de Madrid, dont 839
  robots ; sur toute la plateforme, 1 991 sessions ressemblent à des robots.
- **Non, les ventes et les soirées.** Les rubriques Argent, Clients › Soirées,
  Pilotage › Vue d'ensemble lisent `events`, `tickets`, `table_reservations` : les
  soirées externes n'y entrent pas.
- **Les inscriptions** comptent normalement les comptes venus par Madrid (ce sont de
  vrais comptes) ; elles ne savent pas qu'ils viennent de Madrid.

## 7. Écrans

| Adresse | Question | Forme |
|---|---|---|
| `/admin/madrid` | La stratégie de Madrid marche-t-elle ? | Héros sorties par nuit contre la période précédente, phrase de verdict, 4 semaines / 4 d'avant ; entonnoir visiteurs → soirée vue → sortis, ventes « non mesurées » ; coûts et saisie mensuelle. |
| `/admin/madrid/clubs` | Quels clubs et quelles soirées attirent ? | Barres triées des clubs, soirs de la semaine, calendrier des nuits, séries contre ponctuelles, liste dense des soirées avec mini-courbe, soirées sans lien. |
| `/admin/madrid/audience` | Qui vient, d'où, et revient-il ? | Héros visiteurs par nuit, app / web, Espagne / étranger, sources avec leurs sorties, nouveaux / déjà venus, langues, pays, heures et jours, cohortes. |
| `/admin/madrid/yuno` | Qu'est-ce que Madrid apporte au reste de Yuno ? | Comptes venus, personnes connues, achats ensuite dans Yuno, clubs retrouvés, limites. |
| `/admin/madrid/supply` | Le catalogue est-il vivant ? | Clubs × 8 semaines teintés, synchro Whan en barres de disponibilité, soirées sans lien, jamais cliquées, sans affiche, séries sans occurrence. |

Reste pour la coquille (hors de ce lot, `src/admin/shell/`) : l'icône `MapPin` de la
rubrique (elle prend celle de Pilotage), un raccourci `g` + lettre, et le libellé de
la palette ⌘K (lu de `nav.ts`, déjà là).
