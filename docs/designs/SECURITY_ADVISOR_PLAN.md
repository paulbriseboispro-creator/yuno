# Security Advisor Supabase — inventaire et plan de correction

Relevé du 2026-09-30 sur le projet `fulawxvdlwtdlpkycixe`, en rejouant les lints
officiels (`splinter.sql`, ceux qui alimentent l'écran Advisor) contre la base
liée, puis en croisant chaque fonction avec le code (front, edge, policies RLS,
triggers, crons) et en **appelant les fonctions suspectes avec le rôle `anon`**
sur des identifiants démo. Les chiffres collent à l'écran : 2 erreurs,
1 233 avertissements sécurité, 71 suggestions.

Annexes machine (à partir desquelles les migrations se génèrent) :
`docs/security/advisor-2026-09-30-summary.json` (compte par lint) et
`docs/security/advisor-2026-09-30-functions.json` (les 664 fonctions
SECURITY DEFINER exposées, avec catégorie, qui les appelle, résultat du test
`anon`, action).

## 1. Ce qui est réellement grave (trouvé en testant, pas en lisant le lint)

Trois fonctions internes du super admin sont **appelables sans être connecté**
et rendent des données réelles de la plateforme (vérifié en `SET ROLE anon`) :

| Fonction | Ce qu'un anonyme obtient |
|---|---|
| `_admin_customer_activity()` | toutes les ventes et inscriptions guest list de la plateforme, avec l'email de chaque client |
| `_admin_customer_rfm()` | même base, avec dépense, fréquence, tier |
| `_admin_customer_identity(email)` | prénom, nom, téléphone, date de naissance de n'importe quel email |

Elles sont marquées `_admin_` parce que seules les RPC `admin_*` (gardées par
`is_super_admin()`) devaient les appeler. Mais Supabase accorde `EXECUTE` à
`anon` et `authenticated` sur toute fonction du schéma public par défaut, donc
`/rest/v1/rpc/_admin_customer_identity` répond à tout le monde. **Même
mécanisme sur 44 autres helpers internes** (`resolve_campaign_audience`,
`get_sales_overview`, `email_marketing_pressure`, `event_parties`…) qui n'ont
aucune garde parce que leurs appelants en ont une.

Autres fuites confirmées au test `anon` :

- `get_visitor_stats(venue, …)` : trafic et conversions de N'IMPORTE QUEL club (33 311 visites du club démo rendues à un anonyme).
- `get_customer_timeline(user_id, …)` : journal d'activité de n'importe quel utilisateur (non référencée par le code, mais exposée).
- `get_user_nightlife_stats(user_id)` : stats de sortie de n'importe quel compte (le front la passe avec `user.id`, mais rien n'empêche un autre id).
- `get_event_table_availability(event)` : identifiants et statuts des réservations de table d'une soirée (le front n'a besoin que des compteurs).
- `is_org_member(u, org)`, `is_event_door_staff(u, e)`, `is_org_team_member(u, org, role)`, `get_venue_user_ids(venue)`, `get_event_managing_organizer(e)` : sondage de l'organigramme (« tel uuid est-il staff de tel club ? »).
- `email_has_account(email)` : énumération de comptes. C'est un choix produit (mémoire « compte existant détecté à la saisie »), mais sans limite de débit.
- Bucket `minor-auth-uploads` : **public ET listable**. Il contient les pièces d'identité que des mineurs téléversent au checkout (2 fichiers aujourd'hui). N'importe qui peut lister le bucket puis télécharger les PDF.

## 2. Inventaire complet

### 2.1 Sécurité (ce que l'onglet montre)

| Lint | Niveau | Nombre | Nature |
|---|---|---|---|
| `security_definer_view` | ERROR | 2 | `djs_public`, `venue_subscription_public` |
| `authenticated_security_definer_function_executable` | WARN | 664 | fonctions DEFINER appelables par un compte connecté |
| `anon_security_definer_function_executable` | WARN | 479 | les mêmes, appelables sans compte |
| `function_search_path_mutable` | WARN | 61 | fonctions sans `search_path` figé |
| `public_bucket_allows_listing` | WARN | 14 | buckets publics avec une policy SELECT large |
| `rls_policy_always_true` | WARN | 13 | policies INSERT `WITH CHECK (true)` |
| `extension_in_public` | WARN | 1 | `pg_net` |
| `materialized_view_in_api` | WARN | 1 | `analytics_daily_rollup` lisible par anon/authenticated |
| `rls_enabled_no_policy` | INFO | 71 | tables RLS sans policy (voulu : accès par RPC / service_role) |

Les 664 + 479 = 1 143 lignes portent sur **664 fonctions distinctes**. Le lint
ne distingue pas une fonction trigger (inappelable en RPC) d'une RPC publique
voulue ni d'un helper interne oublié ; c'est le croisement avec le code qui le fait :

| Catégorie | Fonctions | Dont anon | Décision |
|---|---|---|---|
| Fonctions trigger (`RETURNS trigger`) | 121 | 121 | REVOKE, zéro risque |
| Helpers appelés seulement par des fonctions DEFINER | 44 | 23 | REVOKE (dont les trois `_admin_customer_*`) |
| Référencées par rien (ni code, ni policy, ni cron) | 34 | 29 | REVOKE, puis DROP |
| Appelées seulement par un cron | 2 | 1 | REVOKE |
| Appelées seulement par une edge function | 29 | 24 | REVOKE quand l'edge est en service_role (25 sur 29) |
| RPC appelées par le front | 385 | 243 | garder `authenticated` ; retirer `anon` aux 192 dont le corps exige une session ; revoir les 51 sans garde |
| Référencées par une policy RLS | 44 | 36 | GARDER (une policy s'évalue avec le rôle de l'appelant) |
| Appelées par un trigger SECURITY INVOKER | 5 | 2 | GARDER |

Après le plan, environ 430 avertissements `authenticated` et 100 `anon`
resteront **par construction** : une RPC SECURITY DEFINER appelée par un
compte connecté est exactement ce que le lint signale, et c'est le modèle de
Yuno (la garde vit dans le corps, `auth.uid()`, `can_manage_venue`…). L'objectif
n'est pas zéro ligne, c'est **zéro exposition non voulue**, et un registre qui
dit pourquoi chaque ligne restante est acceptée.

### 2.2 Performance (autre onglet, à traiter après)

| Lint | Niveau | Nombre |
|---|---|---|
| `multiple_permissive_policies` | WARN | 1 338 |
| `auth_rls_initplan` | WARN | 563 |
| `unindexed_foreign_keys` | INFO | 219 |
| `unused_index` | INFO | 136 |
| `no_primary_key` | INFO | 2 (`promo_code_failed_checks`, `contact_base_cache`) |
| `table_bloat` | WARN | 1 (`net._http_response`) |

## 3. Plan en six lots

Chaque lot = une migration (ou deux), poussée via `supabase db push`, suivie de
`supabase db lint --linked`, du rejeu des lints (`splinter.sql`) et d'un smoke
en `SET ROLE anon` / `authenticated` sur la démo. Estimations : humain vs
CC + gstack.

### Lot 0 — Fermer les fuites confirmées (aujourd'hui, 1 migration + 1 déploiement front)

Humain : 1 jour. CC : 1 h.

1. `REVOKE EXECUTE … FROM anon, authenticated, PUBLIC` sur les 44 helpers
   « appelés seulement par des fonctions DEFINER » et les 34 « référencés par
   rien » (liste dans l'annexe, `cat = INTERNAL_DEFINER_ONLY | UNREFERENCED`).
   Avant d'exécuter, vérifier qu'aucune n'est citée dans une contrainte CHECK,
   une colonne générée ou un default (`pg_constraint`, `pg_attrdef`) — le
   croisement a couvert policies, vues, triggers, crons et code, pas ceux-là.
2. Gardes de corps :
   - `get_visitor_stats` → `can_manage_venue(p_venue_id)` sinon `42501`.
   - `get_user_nightlife_stats` → `p_user_id = auth.uid()` (ou super admin).
   - `get_event_table_availability` → ne rendre que les compteurs (retirer ids et statuts de réservation), ou la garder réservée au checkout (elle sert la jauge publique, donc compteurs seulement).
   - `is_org_member`, `is_org_team_member`, `is_event_door_staff` → `_user_id = auth.uid()` sauf super admin, comme `coorg_party_level` depuis la revue du 29/09.
   - `generate_invoice_number` : appelée par le front dans `OrderConfirmation` et par les `verify-*` en service_role. REVOKE `anon` ; à terme retirer l'appel front (un client ne doit pas numéroter une facture).
   - `email_has_account` : garder (décision produit) mais freiner à 20 appels / heure / visiteur via `links_visitor_context()`, comme `check_promo_code`.
3. **Bucket `minor-auth-uploads` → privé.** Ordre imposé : (a) front d'abord —
   `OwnerTicketOrders` lit le justificatif par `createSignedUrl` (1 h), et
   `MinorAuthGate` stocke le CHEMIN (pas l'URL publique) dans `minor_doc_url`
   des billets ; (b) puis migration : `update storage.buckets set public =
   false`, policy SELECT limitée à `is_venue_owner` / `can_manage_organizer`
   de la soirée du chemin (`<event_id>/…`), INSERT gardée pour anon/authenticated
   avec `owner = auth.uid()` OU chemin préfixé par une soirée en vente. Les
   2 fichiers existants gardent leur chemin ; leurs URLs publiques stockées
   sont à réécrire en chemins (script ponctuel). Le MODÈLE vierge d'autorisation
   (`venues.minor_auth_doc_url`) n'est pas concerné : il vit dans `venue-assets`.
4. `REVOKE SELECT ON analytics_daily_rollup FROM anon, authenticated` (personne ne la lit côté client).

Vérification : rejouer le test `anon` du relevé (les 76 appels) → les trois
`_admin_customer_*` doivent répondre `permission denied for function`.

### Lot 1 — Les deux erreurs rouges (même journée, 1 migration + 8 fichiers front)

Humain : 2 jours. CC : 2 h.

Les deux vues exposent un sous-ensemble sûr d'une table privée : `djs_public`
(DJ actifs, sans `whatsapp_number`, `pending_amount`, `total_paid`) et
`venue_subscription_public` (plan + statut des abonnements actifs, sans les
identifiants Stripe). Passer ces vues en `security_invoker` casserait le
modèle : `djs` et `venue_subscriptions` n'ont AUCUNE policy de lecture publique,
et une policy `is_active = true` ouvrirait TOUTES les colonnes de la table de
base (Postgres n'a pas de RLS par colonne).

Décision : **remplacer chaque vue par une fonction `SECURITY DEFINER STABLE`
qui rend la même liste de colonnes**, puis supprimer la vue.

- `djs_public()` `RETURNS TABLE (… les 24 colonnes de la vue …)`. Les 9 appels
  `.from('djs_public').select(...).eq/in/ilike(...)` deviennent
  `.rpc('djs_public').select(...).eq/in/ilike(...)` : PostgREST applique
  `select` et filtres au résultat d'une fonction ensembliste exactement comme à
  une vue. Fichiers : `SearchOverlay` (2), `LiveEventContext`,
  `CollabDesignPreview`, `explore/catalog.ts`, `EventDetails`, `TicketSelection`,
  `Favorites`, `_shared/wallet/passes.ts` (edge, service_role — redéployer
  `send-ticket-confirmation` + `send-vip-confirmation` ensemble).
- `get_venue_subscription_public(p_venue_id text)` pour le seul appelant
  (`PromoterHub`).
- `GRANT EXECUTE … TO anon, authenticated` explicite, `SET search_path`.
- Regénérer `types.ts` (rediriger stderr).

Effet : les 2 ERROR disparaissent ; deux WARN « RPC publique légitime » les
remplacent, inscrits au registre. Le vrai découplage — sortir
`whatsapp_number`, `pending_amount`, `total_paid` de `djs` vers une table
`dj_private` à RLS propre, puis rendre la vue `security_invoker` — est le lot 4.

### Lot 2 — Edge, crons, search_path, pg_net (1 semaine plus tard, 2 migrations)

Humain : 3 jours. CC : 2 h.

1. **Edge functions** : REVOKE anon + authenticated sur les 25 fonctions que
   les edge appellent en service_role (`claim_campaign_recipients`,
   `consume_email_send_quota`, `reserve_ticket_capacity`, `unsubscribe_by_token`,
   `verify_invitation_token`…). Trois exceptions à vérifier fichier par
   fichier : `accept_org_member_invitation`, `create_cohost_email_invite`,
   `meta_scope_allowed` (client au JWT de l'utilisateur → garder
   `authenticated`) ; `search_events_semantic` (client anon → garder les deux) ;
   `ack_push_delivery` (l'extension iOS appelle avec la clé anon → garder anon,
   c'est voulu). REVOKE aussi les deux fonctions de cron.
2. **`function_search_path_mutable` (61)** : `ALTER FUNCTION … SET search_path
   = public, extensions, pg_temp` — c'est le `search_path` par défaut de la
   base, donc aucun changement de résolution (vérifié : aucune des 61 n'appelle
   une fonction d'extension non qualifiée). `pgrst_demo_preview_guard` en
   dernier, la sortie de secours de CLAUDE.md sous la main (`ALTER ROLE
   authenticator RESET pgrst.db_pre_request`).
3. **`pg_net`** : l'extension n'est pas relocalisable (`extrelocatable = false`,
   `ALTER EXTENSION … SET SCHEMA` échouera). `DROP EXTENSION pg_net; CREATE
   EXTENSION pg_net SCHEMA extensions;` dans un créneau calme (03 h Paris) : les
   fonctions restent dans le schéma `net`, les 8 crons `net.http_post(...)`
   continuent tels quels, seules les tables transitoires de file sont perdues,
   ce qui règle au passage le `table_bloat` de `net._http_response`.

### Lot 3 — RPC du front : retirer `anon` où une session est exigée (2 semaines, par domaine)

Humain : 1 semaine. CC : 3 h, en 4 migrations (club / organisateur / staff / marketing).

192 RPC appelées par le front vérifient `auth.uid()` dans leur corps et sont
pourtant appelables par `anon`. Leur retirer `anon` ne change rien pour un
utilisateur connecté et ferme la porte à toute future régression de garde.
Risque : une page qui appelle la RPC avant l'hydratation de la session verra
`permission denied` au lieu de `Not authenticated` — même famille d'erreur,
même repli. Procéder par domaine avec `scripts/demo/drive.mjs` (parcours
démo complets) après chaque migration.

Les 51 RPC front sans garde (liste dans l'annexe) sont à revoir une par une :
la plupart sont des lectures publiques voulues (`resolve_event_path`,
`get_links_public_stats`, `get_public_favorite_counts`, `get_guest_list_invite`
par jeton…) et entrent au registre ; les autres (`get_hype_favorite_stats`,
`get_dj_availability`, `get_affiliate_venue_report`) reçoivent une garde ou
un plafond de débit.

### Lot 4 — Policies « toujours vrai » et buckets (3 semaines)

Humain : 1 semaine. CC : 4 h.

1. **13 policies INSERT `WITH CHECK (true)`.** Le projet a déjà le bon
   modèle : une RPC SECURITY DEFINER avec visiteur haché et anti-flood
   (`track_links_event`, `track_pro_signup`, `flush_affiliate_session`).
   Convertir par famille :
   - Tracking anonyme : `visitor_sessions`, `attribution_touchpoints`
     (`useVisitorTracking`), `affiliate_clicks`, `affiliate_visitor_sessions`
     (`useAffiliateVisitorTracking`), `affiliate_live_pings`, `promoter_clicks`
     (edge `track-promoter-click`, déjà en service_role → la policy anon peut
     tomber tout de suite).
   - Listes d'attente : `event_waitlist`, `ticket_waitlist` (edge
     `join-waitlist`), `vip_table_waitlist`, `launch_waitlist` (`join_links_waitlist`
     existe déjà : y router `ExploreLowDensity` et `Maintenance`).
   - Formulaires : `feedback_issues` (3 pages pro : exiger `auth.uid()` dans
     le WITH CHECK, un pro est connecté), `pro_contact_leads`
     (`submit_links_pro_lead` existe déjà), `minor_ticket_docs` (aucun
     écrivain côté client : supprimer la policy).
   Chaque RPC : dédup par visiteur, plafond horaire, colonnes autorisées
   nommées. Jamais plus de `WITH CHECK (true)` sur une table dont les lignes
   comptent (une liste d'attente est un fichier de contacts).
2. **13 buckets publics listables** : supprimer la policy SELECT large de
   chacun (`Public read …`, `… publicly accessible`). Un bucket public sert
   ses fichiers par `/object/public/` SANS policy ; la policy ne sert qu'à
   `list()`, `download()` et aux URLs signées, et le code n'en utilise aucun
   sur ces buckets. `ad-creatives` et `affiliate-media` : Meta et les
   linktrees lisent par URL publique, rien ne change. Vérifier après coup
   qu'un `getPublicUrl` rend toujours 200 sur chaque bucket.
3. Découplage `djs` / `dj_private` (voir lot 1), puis `djs_public` redevient
   une vue `security_invoker` avec une policy `is_active = true`.

### Lot 5 — Ménage et registre (1 mois)

Humain : 2 jours. CC : 1 h.

- `DROP FUNCTION` des 34 non référencées (après un mois de REVOKE sans
  incident) : `settle_promoter_payout` et `settle_agency_promoter_payout`
  (déjà en `use_two_step_flow`), `get_for_you_events`, `admin_delete_venue`,
  `refresh_analytics_rollup`…
- Registre des avertissements acceptés : `docs/security/ADVISOR_REGISTER.md`,
  une ligne par fonction restante (policy helper, RPC publique, trigger
  INVOKER) avec la raison. Rejouer `splinter.sql` mensuellement et comparer au
  registre — toute ligne nouvelle est une question, pas un bruit.
- Le `rls_enabled_no_policy` (71) reste : c'est le modèle « table sans policy,
  tout passe par RPC » écrit dans CLAUDE.md pour `event_coorg_*`, `ota_*`,
  `meta_*`, `crm_*`. Ajouter un `COMMENT ON TABLE … IS 'RLS sans policy, accès
  par RPC : <fonctions>'` sur chacune pour que l'intention soit lisible.

### Lot 6 — Performance (quand la sécurité est close)

- `auth_rls_initplan` (563) : réécrire `auth.uid()` en `(select auth.uid())`
  dans les policies. Mécanique : script qui lit `pg_policy`, régénère le
  `CREATE POLICY` et le rejoue. CC : 2 h + un smoke complet.
- `multiple_permissive_policies` (1 338) : fusionner, par table × rôle ×
  commande, les policies permissives en une seule `OR`. C'est le chantier le
  plus long (≈ 300 tables) ; le faire table par table en commençant par les
  plus lues (`events`, `tickets`, `table_reservations`, `guest_list_entries`,
  `orders`). Humain : 3 semaines. CC : 1 journée étalée.
- Index : ajouter les 219 index de FK manquants d'un bloc (`CREATE INDEX
  CONCURRENTLY`), supprimer les 136 inutilisés après 30 jours de
  `pg_stat_user_indexes` à zéro, poser une PK sur `promo_code_failed_checks`
  et `contact_base_cache`.

## 4. Règle à inscrire dans CLAUDE.md quand le lot 0 est poussé

> **Toute fonction nouvelle du schéma public naît appelable par `anon` et
> `authenticated`.** Une migration qui crée une fonction SECURITY DEFINER
> écrit dans la même transaction `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC,
> anon, authenticated;` puis `GRANT EXECUTE … TO <les rôles voulus>;`. Un
> helper interne (`_xxx`, `can_*` appelé par d'autres fonctions) ne reçoit
> aucun GRANT client. Une RPC publique reçoit `anon` seulement si une page
> publique l'appelle. Et `SET search_path = public, extensions, pg_temp` sur
> chaque fonction. Vérification : `supabase db lint --linked` + rejeu de
> `splinter.sql` (procédure §5).

## 5. Rejouer le relevé

```bash
curl -sL https://raw.githubusercontent.com/supabase/splinter/main/splinter.sql -o /tmp/splinter.sql
supabase db query --linked -f /tmp/splinter.sql > /tmp/lints.json
python3 -c "import json,collections;r=json.load(open('/tmp/lints.json'))['rows'];print(collections.Counter((x['level'],x['name']) for x in r))"
```

Le test `anon` : `BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.<fn>(…);
ROLLBACK;` sur la démo. Une fonction interne doit répondre `permission denied
for function`, jamais des lignes.
