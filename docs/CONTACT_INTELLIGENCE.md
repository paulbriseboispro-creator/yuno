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
  jamais réactivé, liste repoussoir STOP, suppression, session support) restent
  au seul endroit qui les porte. Ne jamais écrire dans
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

### Vocabulaire des définitions (v1)

`country {in[]}` · `country_not {in[]}` · `zone {in[]}` · `city {in[]}` ·
`region {in[]}` · `spent {op,value}` · `spent_per_event {op,value}` ·
`events {op,value}` · `last_purchase_days {op,value}` · `added_days {op,value}` ·
`age {min,max}` · `gender {in[]}` · `newsletter_opt_in {value}` ·
`has_email {value}` · `has_phone {value}` · `list {in[]}` — `op` ∈ gte, gt, lte, lt, eq.

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

## Tester

- Parseur : `npx vitest run src/lib/__tests__/contactImport.test.ts` (joue aussi
  le vrai fichier de Kevin s'il est dans `~/Downloads`).
- Base : le scénario complet (import → analyse → segments → comptages email et
  SMS, en transaction annulée) se rejoue avec `supabase db query --linked --file`
  en posant `request.jwt.claims` sur l'uid du pro (voir la mémoire
  `contact-intelligence-2026-09-08`).
