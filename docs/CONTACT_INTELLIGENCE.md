# Intelligence de la base importée — import unifié + segmentation proposée

Livré le 2026-09-08 pour WOH (Kevin, organisateur). Migrations
`20260908150000_contact_intelligence` et `20260908151000_contact_rows_consolidation`.

## Le problème

Un pro qui arrive avec l'export de son ancienne billetterie (12 000 lignes :
email, téléphone, pays, département, ville, zone, âge, genre, opt-in
newsletter, date d'ajout, dernier achat, total dépensé, nombre de soirées)
devait importer DEUX fois (une liste email, une liste SMS) et perdait toute la
matière qui rend une base exploitable. Il ne pouvait ni cibler Paris, ni
distinguer un habitué de la guest list d'un acheteur de table.

## Ce qui existe

```
fichier CSV ─▶ parseContactFile (front, src/lib/contactImport.ts)
                 lit 18 champs, E.164, ISO-2, dates ISO, nombres
            ─▶ import_contact_list (RPC, lots de 500)
                 ├─ imported_contacts       ← la ligne typée (attributs)
                 ├─ import_email_contacts   ← emails → newsletter_subscriptions
                 └─ import_sms_contacts     ← numéros → venue_sms_contacts
            ─▶ analyze_contact_lists (RPC)  ← faits + propositions chiffrées
            ─▶ save_contact_segments (RPC)  ← contact_segments (définition jsonb)
                 ├─ email : audiences_json {"kind":"contact_segment","segmentId"}
                 └─ SMS   : segment_filters {"type":"contact_segment","segment_id"}
```

### Tables

| Table | Rôle |
|---|---|
| `contact_list_imports` | UNE liste = UN fichier = UNE attestation. Relie `email_import_id` (email_list_imports) et `sms_import_id` (sms_list_imports). Porte les colonnes détectées, les canaux choisis, les effectifs et la dernière analyse. |
| `imported_contacts` | Une ligne par contact du fichier avec ses attributs. Ne porte AUCUN consentement. |
| `contact_segments` | Segments sur attributs importés, aux DEUX portées (club et organisateur). |

### Règles intouchables

- **L'import unifié APPELLE les RPC existantes** (`import_email_contacts`,
  `import_sms_contacts`). Les portes de conformité (attestation, désabonné
  jamais réactivé, liste repoussoir STOP, suppression) restent au seul endroit
  qui les porte. La session support, elle, est AUTORISÉE à importer depuis le
  2026-09-15 (décision de lancement, à refermer) et laisse sa trace dans
  `attested_via_support` + `admin_support_audit`. Ne jamais écrire dans
  `newsletter_subscriptions` ou `venue_sms_contacts` depuis l'import unifié.
- **Un segment ne joint personne sans consentement.** `count_contact_segment_def`
  et les résolveurs email/SMS ne comptent que les emails opt-in non supprimés et
  les numéros consentis < 36 mois sans STOP. La ligne importée est de la
  matière, pas une autorisation.
- **Une personne = sa ligne la plus récente** (`contact_rows`) : à date égale,
  la plus renseignée. Un vieil export à 0 € ne classe pas « gratuite » une
  personne que le nouvel export montre à 300 €.
- **Condition inconnue ⇒ FAUX** (`contact_row_matches`) : l'audience rétrécit,
  jamais l'inverse. Un `segmentId` malformé ne matche rien.
- **L'analyse est déterministe et scope-wide** (pas d'IA) : les effectifs
  annoncés sont ceux que le pro obtiendra à l'envoi. Une proposition exige
  ≥ 10 personnes (ou 1 % de la base) et n'existe que si le fichier portait la
  donnée (≥ 30 % de couverture ; 40 % pour âge/genre).
- **Le nom du segment est traduit côté front** (`describeSuggestion`) au moment
  de l'acceptation ; la base stocke le nom dans la langue du pro et la
  `suggestion_key` stable (« geo_zone:paris », « spend_tables ») pour ne pas
  reproposer ce qui existe.
- **Ajouter un paramètre aux RPC SMS = DROP + CREATE**, jamais de surcharge.
- **Tout doit tenir sous 8 s** (`statement_timeout` du rôle `authenticated`)
  sur 15 000 lignes. Une définition est COMPILÉE en prédicat SQL
  (`contact_definition_predicate`, littéraux via `%L`) puis exécutée en UNE
  requête ; la base consolidée + joignabilité est matérialisée une fois par
  appel (`contact_build_rows` → temp `_cr`). Ne jamais réintroduire une
  fonction scalaire évaluée ligne par ligne dans une boucle de candidats : la
  version initiale prenait 37 s sur la base de WOH. `resolve_contact_segment_def`
  reste sans temp table (appelé depuis des fonctions STABLE).

### Réunir / Croiser (2026-09-08 soir)

Dès que deux audiences sont cochées (email : écran Audience ; SMS : liste des
segments intelligents), un réglage apparaît : **Réunir** (A ou B, défaut) ou
**Croiser** (A et B). Email : `exclusions_json.audienceMatch` = 'any' | 'all',
lu par `resolve_campaign_audience` (valeur inconnue ⇒ réunir) ; le nombre
d'audiences satisfaites par contact = audiences simples satisfaites +
`cseg_hits` + `vseg_hits` (jointures hachées, jamais de sous-requête corrélée :
la première version faisait 12 000 × résolution ⇒ timeout). SMS :
`segment_filters.segment_ids[]` + `segment_filters.match`, résolveurs à
8 paramètres (`p_segment_ids`, `p_match`). Vérifié sur WOH : Paris ∪ Actifs =
9 983 emails, Paris ∩ Actifs = 1 711.

### Vocabulaire des définitions (v1)

`country {in[]}` · `country_not {in[]}` · `zone {in[]}` · `city {in[]}` ·
`region {in[]}` · `spent {op,value}` · `spent_per_event {op,value}` ·
`events {op,value}` · `last_purchase_days {op,value}` · `added_days {op,value}` ·
`age {min,max}` · `gender {in[]}` · `newsletter_opt_in {value}` ·
`has_email {value}` · `has_phone {value}` · `list {in[]}` — `op` ∈ gte, gt, lte, lt, eq.

Ajouts du 2026-09-15 (base vivante) : `engagement {in[]}` · `origin {in[]}` ·
`emails_received` / `opens` / `clicks {op,value}` · `last_open_days` /
`last_click_days {op,value}` · `guest_lists {op,value}` · `yuno_customer {value}`
· `has_account {value}`. Ajouts du 2026-09-16 (faits Yuno) : `tables` /
`tickets` / `orders {op,value}` (réservations de table, billets, commandes bar
chez ce pro) · `last_seen_days {op,value}` (dernier achat, venue OU clic).
Une condition inconnue rend FAUX — et ne lève jamais (le littéral nu
`parts || 'false'` plantait la compilation jusqu'au 16/09).

### Propositions (clé → règle)

| Famille | Clé | Règle |
|---|---|---|
| geo | `geo_country:<ISO>` | pays (≥ 2 % de la base, 6 max) |
| geo | `geo_abroad` | hors pays principal |
| geo | `geo_zone:<zone>` | zone géographique (sinon ville), 8 max |
| spend | `spend_free` | total dépensé = 0 |
| spend | `spend_tickets` | > 0 et < 60 € par soirée |
| spend | `spend_tables` | ≥ 60 € par soirée |
| spend | `spend_top` | ≥ 90e percentile des payeurs |
| freq | `freq_once` / `freq_regular` / `freq_loyal` | 1 / 2-3 / ≥ 4 soirées |
| recency | `recent_active` / `recent_lapsed` / `recent_dormant` | ≤ 90 j / 91-365 j / > 365 j |
| recency | `winback_regulars` | ≥ 2 soirées et > 120 j |
| recency | `new_recent` | 1 soirée et ≤ 60 j |
| demo | `age_18_21` … `age_31_plus`, `gender_female`, `gender_male` | |
| consent | `newsletter_yes` | opt-in déclaré dans l'ancien outil |
| channel | `channel_both` / `channel_sms_only` | |

### Les segments Yuno — préréglages en un clic (2026-09-16)

L'analyseur se tait sous 10 personnes ou 30 % de couverture : sur une base qui
démarre, « Prend des tables » n'apparaissait jamais. Quatre définitions FIXES
vivent dans le front (`YUNO_SEGMENT_PRESETS`, `src/lib/contactSegments.ts`) et
sont proposées aux deux portées — écran Audience du studio (section « Segments
Yuno », un clic crée le segment via `save_contact_segments` ET l'ajoute à la
campagne) et dialogue Segments (fusionnées aux propositions de l'analyseur).
Effectif live par `count_contact_segment_def` ; un préréglage vide est tu.

| Clé | Règle | Plaquette |
|---|---|---|
| `yuno_tables` | `tables ≥ 1` | Prend des tables |
| `spend_tables` / `spend_tables:<n>` | `spent_per_event ≥ n` — n = valeur Yuno de la portée (`suggest_basket_threshold` : 3e quartile des paniers payés dès 20 payeurs, sinon prix par convive de la formule de table la moins chère, sinon 1,5 × le billet le plus cher, sinon 60), remplaçable par le pro | Panier moyen élevé |
| `yuno_seen_60` | `last_seen_days ≤ 60` | Vus il y a moins de 60 jours |
| `yuno_lapsing` | `events ≥ 3` et `last_seen_days > 90` | Habitués qui décrochent |

## La base vivante : engagement, clients Yuno, bilan par campagne (2026-09-15)

Migrations `20260915180000_contact_base_engagement` (+ `181000`, `182000`).
Page `/owner/campaigns/contacts` et `/organizer-app/campaigns/contacts`
(`ContactBasePanel`), carte `CampaignImpactCard` dans le rapport de campagne
et dans le dialogue de segmentation, export unifié (`contactBaseExport.ts`).

```
campagne envoyée ─▶ record_campaign_list_baseline (photo « avant » : base + segments)
                 ─▶ refresh_contact_engagement  (fin d'envoi, cron 10 min, bouton Actualiser)
                       ├─ newsletter_subscriptions.user_id ← compte auth VIVANT (identité Yuno)
                       ├─ contact_engagement (portée, email) : envois, ouvertures, clics, bounce dur,
                       │    plainte, désabonnement, statut daté
                       └─ contact_engagement_state (dernière lecture par portée + résumé)
                 ─▶ refresh_campaign_list_impacts (photo « maintenant » par campagne ≤ 30 j :
                       destinataires par statut, nouveaux engagés, réactivés, segments)
contact_rows v3 = imported_contacts (consolidés) FULL OUTER JOIN contact_scope_customers
                  (billets, tables, commandes, guest list, abonnés entrés par Yuno) par email
                  LEFT JOIN contact_engagement  → origin import|yuno|both, eng_status, …
```

### Règles intouchables (suite)

- **`contact_rows` est LA base** : tout ce qui segmente (email ET SMS), compte,
  liste ou exporte passe par elle. Pour une personne des deux côtés, l'identité
  Yuno gagne (prénom, nom, téléphone E.164, compte), `total_spent` et
  `event_count` s'ADDITIONNENT (le fichier est le passé, Yuno le présent),
  `last_purchase_at` = le plus récent. Origine : `import` / `yuno` / `both`.
- **`imported_contacts` n'est jamais modifiée par l'engagement** : c'est la
  pièce du dossier de consentement. L'engagement vit dans `contact_engagement`
  (RLS lecture par portée, aucune écriture hors `refresh_contact_engagement`).
- **Statuts** (seule définition, dans `refresh_contact_engagement`) :
  `unreachable` (suppression, bounce dur `Permanent`, plainte — passe DEVANT
  `unsubscribed` parce que `suppress_email` coupe aussi `opted_in`) ·
  `unsubscribed` · `active` (clic < 90 j ou ≥ 2 ouvertures en 90 j) ·
  `passive` (ouverture < 180 j) · `silent` (≥ 2 emails reçus, rien) · `new`.
  Un bounce transitoire (boîte pleine) ne rend pas injoignable. Le statut
  DÉCRIT ; seul `email_ok` / `phone_ok` (consentement) AUTORISE.
- **Le rafraîchissement ne se fait jamais « en ligne » dans une RPC lue par le
  front** (4,9 s pour 12 300 contacts, plafond 8 s) : fin d'envoi
  (`send-campaign` → `notifyOwnerIfFinished`), cron `contact-engagement-sweep`
  (`*/10`), bouton Actualiser. Les bilans (`get_campaign_list_impact`) ne
  recalculent que les photos. Les gardes des fonctions de rafraîchissement
  acceptent le contexte interne via `session_user` (`contact_scope_allowed_or_internal`),
  JAMAIS `current_user` (toujours le propriétaire en SECURITY DEFINER).
- **Bilan de campagne** : baseline prise UNE fois à la fin de l'envoi (jamais
  réécrite) ; `current` recalculée ≤ 30 j. Écarts par segment = current −
  baseline ; sans baseline (campagnes d'avant le 15/09), la carte le dit.
- **Vocabulaire v2** : `engagement {in[]}`, `origin {in[]}`, `emails_received`,
  `opens`, `clicks`, `last_open_days`, `last_click_days`, `guest_lists`
  (`{op,value}`), `yuno_customer {value}`, `has_account {value}`. Familles
  proposées en plus : `eng_active`, `eng_clickers`, `eng_passive`,
  `eng_silent`, `eng_never_sent` (dès qu'une campagne est partie),
  `src_yuno`, `src_yuno_only`, `src_both`, `src_guest_list` (seuil 3).
- **Export** (`export_contact_base`) : une passe, `{columns, rows[][]}`
  (12 347 lignes en 0,7 s), appartenance aux segments dans la même requête.
  Refusé en session support. La page Clients (club et orga) exporte CETTE
  base, plus la vue filtrée de l'écran.
- **`list_contact_base`** : recherche (email, nom, téléphone, ville, LIKE
  échappé), filtres statut / origine / segment / liste, tris, 200 max par page.

## Tester

- Parseur : `npx vitest run src/lib/__tests__/contactImport.test.ts` (joue aussi
  le vrai fichier de Kevin s'il est dans `~/Downloads`).
- Base : le scénario complet (import → analyse → segments → comptages email et
  SMS, en transaction annulée) se rejoue avec `supabase db query --linked --file`
  en posant `request.jwt.claims` sur l'uid du pro (voir la mémoire
  `contact-intelligence-2026-09-08`).
