# Yuno CRM — le catalogue de segments (2026-10-06)

Demande de Paul : « Pour la segmentation de la base client à l'import ou même de
Shotgun, il y en a peu par rapport à ce qu'on avait avec Yuno Tickets. Update le
Yuno CRM pour avoir la variété de choix des segments, et à la fin de l'import
(fichier ou Shotgun), une fenêtre premium pour offrir le choix des segments,
avec des labels Recommandé pour la longue liste. »

## Constat

| | Billetterie (Suite) | CRM avant | CRM après |
|---|---|---|---|
| Modèles de segment | ~37 propositions à l'import (`analyze_contact_lists`) | 9 modèles fixes | 34 fixes + 5 familles calculées sur les données (≈ 40-50 selon la base) |
| Colonnes lues à l'import | 18 (pays, ville, CP, zone, âge, naissance, genre, dépense…) | 5 (e-mail, tél, prénom, nom, ville) | 10 (+ code postal, pays, âge, naissance, genre) |
| Profil Shotgun (âge, genre, ville, pays) | — | stocké dans `external_tickets`, jamais utilisé | utilisé par les segments |
| Choix à la fin de l'import | dialogue de propositions | rien | fenêtre « Choisissez vos segments » |

## Ce qui a été construit

**Base (migration `20261008200000_crm_segment_catalog.sql`)**

- `_crm_area_key(texte)` : clé d'une ville (« 75011 Paris », « Paris 11e
  arrondissement », « PARIS » → `paris`).
- `_crm_people_build` : sept colonnes de plus à `_cp` — `age`, `gender`,
  `country` (ISO 2), `area`, `area_key`, `upcoming` (billet ou invitation pour une
  soirée pas encore commencée), `basket` (dépense par soirée payée). Profil :
  dernière valeur rapportée par Shotgun, sinon les fichiers importés. Cycle de vie,
  soirées et dépense ne changent pas.
- `_crm_filter_sql` : nouvelles clés `nb_min`, `nb_max`, `last_lt_days`, `sp_min`,
  `basket_min`, `paid_min`, `age_min`, `age_max`, `gender`, `area[]`, `country[]`,
  `country_not`, `up`, `click_lt_days`, `ch`, et `msg = never_sent`. Toute valeur
  illisible ne retient personne ; `last_gt_days` illisible ne retire plus la
  condition (le segment devenait « tout le monde »).
- `crm_segment_catalog(portée, p_items)` : les modèles fixes du front + les modèles
  calculés (meilleurs clients = 90e centile de la dépense dès 20 payeurs ; panier =
  3e quartile ; six villes ; hors du pays principal ; trois pays étrangers ; 10
  personnes au moins), tous comptés en UNE lecture de `_cp`, avec couverture
  (âge, genre, ville, pays), soirée à venir, modèles déjà créés. Dans
  `demo_preview_writable_rpc` (tables temporaires).
- `crm_segments_create_many` : crée plusieurs segments, saute un modèle déjà créé
  (même `template`), verrou par espace.
- `crm_home__core` : tâche « Choisir vos segments » tant que l'espace n'a aucun
  segment et compte au moins 10 contacts.

Répété sur la prod dans une transaction annulée (compte démo `crm@womber.fr`,
2 650 personnes) : catalogue en ~0,4 s une fois compilé ; Paris 917, meilleurs
clients ≥ 170 € (145), âge connu pour 52 %.

**Front**

- `src/crm/lib/segments.ts` : `SEGMENT_TEMPLATES` (34, chacun dans une des dix
  familles), `DYNAMIC_TEMPLATES`, `RECOMMENDED` (ordre de présentation), `REC_MIN = 10`.
  Les neuf identifiants d'avant ne bougent pas.
- `src/crm/lib/segmentCatalog.ts` (pur, testé) : noms et règles traduits, état
  (déjà créé, indisponible faute de soirée à venir, vide), badge Recommandé.
- `src/crm/components/SegmentCatalog.tsx` : `SegmentCatalogModal` (vues
  « Recommandés » / « Tous les segments », familles, couverture, « Tout cocher »,
  pied collant « Créer N segments ») et `SegmentsNextStep` (carte « Étape
  suivante » qui ouvre la fenêtre, seule quand une recommandation attend).
- Branchements : fin d'import fichier (`ImportWizard`), fin du premier import
  Shotgun (`ConnectorsPage`, seulement si l'import s'est terminé sous les yeux du
  pro), page Segments (remplace l'ancien « Nouveau segment », `?new=1`,
  `?new=rec` depuis la tâche de l'accueil).
- Import de fichier : `cp`, `pays`, `age`, `naissance`, `genre` reconnus (lecteurs
  de la Suite : `countryToIso`, `parseGender`, `ageFromBirth`) ; « Nombre » est un
  prénom espagnol.
- Correction en route : dans Clients, un segment enregistré dont le critère n'a
  pas de bouton à l'écran (`msg`, et désormais âge, ville…) était pris pour « aucun
  filtre » — « Écrire à… » visait toute la base. Porte unique `hasCriteria`.

## Règles

- Recommandé = dans `RECOMMENDED`, au moins 10 personnes, pas déjà créé,
  disponible. Après un import, les recommandés sont cochés d'office ; depuis la
  page Segments, rien n'est coché.
- Un modèle « Prochaine soirée » est indisponible sans soirée à venir (sinon
  « habitués sans place » = tous les habitués).
- Pas de chiffre inventé : âge, genre, ville, pays sont ceux que Shotgun ou les
  fichiers ont donnés, et la fenêtre dit pour quelle part de la base ils sont connus.
- Hors périmètre, à décider : l'historique d'un fichier importé (dépense, nombre
  de soirées, dernier achat) n'entre pas dans `_cp` — le compter changerait le cycle
  de vie (« Jamais venus ») et les automatisations ; et des filtres âge / ville dans
  la liste Clients.
