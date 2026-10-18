# Yuno CRM — la suite de l'analyse client (plan §16, 2026-10-07)

Suite de `CRM_CLIENT_ANALYSIS_PLAN.md` (en ligne le 07/10). Ce plan transforme
les hypothèses en gestes : qui cibler pour une soirée, faire revenir après la
1re soirée, variables par personne, et un MCP qui lit enfin la Console CRM.

## Décisions de Paul (07/10)

| Sujet | Décision |
|---|---|
| Recette 1re → 2e soirée | E-mail au délai médian de retour du compte, vers la prochaine soirée choisie POUR la personne ; puis SMS 5 jours plus tard s'il n'a pas acheté (35 Yunits, numéros consentis seulement) |
| Nom de la recette | « Faire revenir après la 1re soirée » |
| Plan d'une soirée à venir | Onglet du tiroir soirée de la Console CRM + invite MCP avec la soirée en argument |
| Nom du plan | « Qui cibler » |
| Variables par personne | `{{artiste}}`, `{{1re_soiree}}`, `{{nb_soirees}}`, chacune avec un texte de repli |
| Segment lié à une soirée | « Fidèles du concept sans place » |

Hors de ce plan : le signal « a acheté dans les 24 h après l'annonce de X »
(attend trois mois de recul de `crm_artist_seen`) et les repères entre comptes
(lot E, attend 8 comptes contributeurs et la clause validée).

## Lots

### N1 — Le MCP lit la Console CRM (`20261011100000_crm_mcp_reads.sql`)

Sur un compte CRM, `get_sales_overview`, `get_sales_trends`,
`get_purchase_behavior`, `get_audience_overview`, `get_customer_segments`,
`get_web_traffic`, le RFM de `get_recommendations` et
`list_customers_by_segment` rendaient le vide (tables de la billetterie Yuno).
Ils lisent désormais `crm_ana_sales`, `crm_ana_traffic`, `crm_ana_community`,
`crm_clients_overview`, `crm_segments_overview`, `crm_clients_list`,
`crm_analysis_overview`, avec la période demandée (`_mcp_crm_period`).
Ces RPC créent des tables temporaires : `_mcp_needs_temp(tool, product)`
n'ouvre l'écriture temporaire qu'aux comptes CRM. `mcp_call` est repris de la
base liée, seul cet appel change.

### N2/N3 — « Qui cibler » et « Fidèles du concept sans place »

Une soirée à venir d'un compte CRM ouvre l'onglet « Qui cibler » dans son
tiroir (`?v=target`). Audiences, toutes SANS place pour la soirée :

| Clé | Qui | Famille testée |
|---|---|---|
| `concept` | venus à une édition passée du même concept | série |
| `lineup` | ont vu un artiste (non résident) qui joue ce soir-là | line-up |
| `genre` | genre le plus fréquenté = un genre de la soirée, 2 soirées ou plus | musique |
| `early` | habitude d'acheter tôt ou à la mise en vente | achat tôt / mise en vente |
| `last_minute` | habitude d'acheter la veille ou le jour même | dernière minute |
| `once_local` | venus une seule fois, habitent à proximité | — |

Chaque audience montre sa taille, les joignables par e-mail et par SMS, le
statut de sa famille d'hypothèses sur le compte, le moment conseillé
(maintenant, la semaine d'avant, la veille à 18 h) et l'angle. Le bouton
« Écrire à… » ouvre `WriteModal` avec le filtre `ntgt: {e, a}` et la soirée
reliée (l'envoi exclut déjà ceux qui ont acheté entre-temps).

- Porte unique de l'appartenance : `_crm_night_target_set(scope, event, aud)`,
  lue par la RPC `crm_night_targets` ET par la clé de filtre `ntgt` de
  `_crm_filter_sql` : le chiffre affiché = le filtre = l'envoi.
- La portée : `_crm_people_build` pose `yuno.crm_scope` (transaction) ; la clé
  `ntgt` ne lit que cette portée, et une soirée d'un autre compte rend vide.
- « Fidèles du concept sans place » = segment enregistré depuis « Qui cibler »
  (`template = 'concept_no_ticket:<event>'`, définition `ntgt`).
- MCP : outil `get_event_targets` (niveau analytics) + invite
  `target_next_event` qui prend la soirée en argument.

### N4 — Variables par personne dans un e-mail

`{{artiste}}` = l'artiste le plus vu par la personne qui joue à la soirée de
l'e-mail (sinon son artiste le plus vu, sinon le repli). `{{1re_soiree}}` =
titre de sa 1re soirée. `{{nb_soirees}}` = nombre de soirées faites. Résolues
à l'envoi par lot (comme `get_recipient_block_conds`), rendues par le même
rendu (front et port Deno), proposées dans le sélecteur de variables du
Studio, avec un repli par variable.

### N5 — « Faire revenir après la 1re soirée » (e-mail puis SMS)

Une recette d'automatisation de plus (kind `first_return`). Cible : venus une
seule fois, la 1re soirée finie depuis le délai médian de retour du compte
(`crm_analysis_state.stats.median_days`, borné 7 → 60 jours, 21 par défaut),
sans place pour une soirée à venir, pas « de passage ». Soirée choisie POUR la
personne (même règle que « L'habitué décroche » : même concept, artiste déjà
vu, genre, puis la plus proche). Étape 2 : un SMS 5 jours après l'e-mail à qui
n'a toujours pas acheté et dont le numéro est consenti, débité en Yunits, dans
les heures autorisées. Registre propre (une personne ne reçoit la recette
qu'une fois), budget de pression propre à la séquence (les deux étapes
comptent pour une).
