# Serveur MCP Yuno — les chiffres d'un pro dans son IA

Construit le 2026-10-03. Un club ou un organisateur branche **son** assistant IA
(Claude, ChatGPT, Gemini, Le Chat, Claude Code, Cursor…) sur sa Console Yuno et
pose ses questions avec ses mots ; l'IA lit ses chiffres et les transforme en
analyses, constats et conseils concrets. Depuis le 2026-10-06, elle peut aussi
**dessiner ses e-mails de soirée et les déposer en BROUILLON** (§ 8) : la seule
écriture du serveur, jamais un envoi.

- Adresse à coller dans l'IA : **`https://yunoapp.eu/mcp`**
- Page publique (documentation des annuaires) : **`https://yunoapp.eu/ai`**
- Page Console : Réglages → **Assistants IA** (`/owner/ai-assistants`,
  `/organizer-app/ai-assistants`, `/manager/ai-assistants`)
- Consentement : `https://yunoapp.eu/connect-ai?request=…`
- Super admin : `/admin/ai`, section « Connecteur IA (MCP) »

## 1. Architecture

```
IA (Claude, ChatGPT…) ──HTTPS──▶ Worker Cloudflare « yuno » (worker/mcp/*)
                                   │  /mcp            protocole MCP (2 générations)
                                   │  /oauth/*        serveur d'autorisation OAuth 2.1
                                   │  /.well-known/*  découverte RFC 9728 / 8414
                                   ▼
                     PostgREST, clé serveur dédiée (secret SUPABASE_MCP_KEY)
                                   ▼
             fonctions mcp_* (migration 20261003100000_mcp_server.sql)
                                   ▼
          RPC d'analyse de la Console, EN TANT QUE la personne (ses claims)
```

- **Le Worker n'a aucun droit propre.** Il appelle uniquement les fonctions
  `mcp_*`, exécutables par `service_role` seul. Il ne lit aucune table, ne
  choisit jamais une portée.
- **Aucune session Supabase n'est remise à une IA.** L'IA reçoit un jeton opaque
  (`yuno_mcp_at_…`, 1 h ; refresh `yuno_mcp_rt_…`, 30 j, rotation) qui n'ouvre
  QUE `https://yunoapp.eu/mcp`. La base ne stocke que son empreinte sha256.
  Pourquoi pas le serveur OAuth de Supabase : son jeton est une vraie session
  utilisateur, valable aussi sur PostgREST, le Storage, les edge functions et
  GoTrue (changement de mot de passe). Ici, un jeton volé ne sert qu'à lire.
- **`mcp_call` exécute un outil en tant que la personne** : il pose ses claims
  (`auth.uid()` = elle, `auth.role()` = `authenticated`, les deux formes de
  GUC), passe la transaction en `READ ONLY` (sauf les deux outils dont la RPC
  crée une table temporaire : `count_contacts`, `list_customers`) et n'appelle
  que les RPC d'analyse que la Console appelle déjà, avec leurs portes (portée,
  argent, seuils de 10). **L'IA voit ce que l'écran voit, jamais plus.**
- **Les clés de portée** sont celles de la co-organisation : `venue:<id>` /
  `org:<uuid>`. `_mcp_user_spaces(uid)` dit qui peut ouvrir quoi : club =
  propriétaire ou manager qui voit l'analytique / la finance / les clients ;
  organisation = fondateur ou membre d'équipe admin / éditeur accepté (fiches
  clients : fondateur et admin seulement). Le super admin n'y a QUE ses propres espaces : une IA n'ouvre jamais les données
  d'un autre client. Un espace dont la personne perd l'accès disparaît aussitôt
  de la connexion.
- **Plusieurs espaces dans une connexion** : `get_account_overview` liste
  `connection_spaces` (nom, clé, type, produit, argent, fiches) et dit pour
  quel espace il répond. Sans `space`, un outil lit l'espace où la personne a
  le plus de droits (propriétaire / fondateur, puis admin, puis manager),
  Suite avant CRM, club avant organisation (`mcp_call`, migration
  `20261003140000`) ; `space` accepte la clé OU le nom exact de l'espace
  (`20261003150000`). Avant, l'IA prenait la plus petite clé (le compte CRM du
  relecteur) et croyait les autres espaces hors connexion.
- **Délais** : `anon` est à 3 s, mais une requête de la clé serveur du MCP
  n'est PAS coupée à 8 s par la base (mesuré le 03/10 : des appels réussis de
  11-12 s, et rien ne coupe une requête que le Worker abandonne). À froid, une
  analyse de base de contacts prend 7 à 12 s, davantage quand l'IA lance
  plusieurs outils en parallèle ; à chaud, moins de 1,2 s. Le Worker attend
  donc `mcp_call` jusqu'à 25 s et ne relance (une fois, fenêtre resserrée à
  45 jours pour un outil à fenêtre) que s'il reste 8 s dans un budget de 40 s
  — les clients MCP coupent à 60 s. L'échec final est journalisé
  (`mcp_log_failure`).
- **Un outil composite rend ce qu'il peut** (migration `20261003130000`) :
  chaque brique (RFM, listes, attribution email, automatisations, push,
  signaux…) est appelée dans son propre bloc ; une brique refusée au rôle ou en
  panne devient `{"unavailable": "…"}` (`_mcp_unavailable`) au lieu de faire
  tomber l'outil. Exemple : un manager de club lit tout sauf les résultats
  email (la Console Manager n'a pas de pages email). Un refus rendu par une
  RPC unique (`{ok:false, reason:'forbidden'}`, ex. le détail des tables VIP
  pour un manager) donne le message `role_restricted`, jamais « accès perdu ».
- **Admin d'équipe d'une organisation** : la Console lui montre Campagnes,
  Automatisations et Base de contacts (`capabilitiesFor('admin').marketing`) ;
  depuis le 03/10 la base le suit (`_email_scope_guard`,
  `get_email_lists_health`, `get_email_quota_status`, `contact_scope_allowed`
  acceptent `is_org_team_member(…, 'admin')`). L'éditeur reste dehors.

## 2. Sécurité et données personnelles

| Garantie | Où elle vit |
|---|---|
| Lecture seule (sauf brouillons d'e-mails et pages d'inscription) | `transaction_read_only = on` dans `mcp_call` ; la seule écriture passe par `mcp_write` (brouillons d'e-mails au statut `draft`, § 8 ; pages d'inscription en brouillon ou en proposition, § 9) |
| Portée = ce que voit le rôle | claims de la personne + portes des RPC (`analytics_scope_gate`, `contact_scope_allowed`, `crm_scope_allowed`) |
| Montants masqués pour un rôle | `money` des RPC, rien n'est recalculé |
| Pas d'identité par défaut | niveau `analytics` : outils fiches refusés + `_mcp_redact(…, true)` retire email, téléphone, nom, prénom, notes, adresse |
| Jamais de coordonnées GPS, IP, jeton | `_mcp_redact` à tous les niveaux |
| Fiches clients plafonnées | 50 par appel, offset ≤ 500, 100 lectures de fiches / jour / connexion |
| Débits | 60 appels / min, 3 000 / jour par connexion |
| Révocation | Console (la personne, ET le propriétaire / fondateur pour les connexions de son équipe), RFC 7009, rejeu d'un code ou d'un refresh = connexion coupée (`code_replay`, `refresh_reuse`) |
| Journal | `mcp_tool_calls` : outil, espace, arguments, statut, durée, taille — jamais le contenu rendu ; purge à 13 mois |
| Accès assisté | une IA ne se connecte jamais pendant une session de support |
| Comptes suspendus / supprimés / bannis | `_mcp_access` les refuse |
| OAuth | PKCE S256 obligatoire, `resource` vérifié (RFC 8707), `iss` dans la réponse (RFC 9207), URI de retour exactes (port libre seulement en boucle locale, RFC 8252), CIMD lu en https sans redirection (`redirect: 'manual'` — workerd REFUSE `redirect: 'error'`, c'est ce qui a bloqué toute connexion CIMD jusqu'au 03/10), 64 Ko max, cache 1 h, copie figée de ChatGPT et Claude Code si leur site bloque le Worker (`PINNED_CIMD`, chatgpt.com répond 403 à un Worker) |

**Juridique** : la politique de confidentialité (§ Destinataires) et le DPA
(§ Instructions) disent qu'une IA connectée par un professionnel est un
destinataire désigné par lui, sur son instruction ; le fournisseur de l'IA
n'est pas un sous-traitant de Yuno. Yuno n'entraîne aucune IA.

**Pilier boissons en pause** : `DRINKS_PILLAR_LIVE = false` en tête de
`worker/mcp/config.ts` (sixième miroir de la constante) ; `compact.ts` retire
les champs du bar, `enrich.ts` les constats du bar, les consignes interdisent
de le recommander.

## 3. Le protocole

`worker/mcp/protocol.ts` parle les deux générations, sans session :

- **Moderne (2026-07-28)** : pas d'`initialize`, version et identité du client
  dans `params._meta` de chaque requête, en-têtes `MCP-Protocol-Version`,
  `Mcp-Method`, `Mcp-Name` (sentinelle base64 décodée) vérifiés contre le corps
  (`-32020` HeaderMismatch), version inconnue = `-32022` avec `supported`,
  méthode inconnue = 404, `server/discover`, `resultType: "complete"` et
  `_meta.io.modelcontextprotocol/serverInfo` dans chaque résultat, `ttlMs` +
  `cacheScope: "private"` sur les listes (elles dépendent du jeton).
- **Legacy (2025-03-26 → 2025-11-25)** : `initialize` négocie la version, aucun
  `Mcp-Session-Id` émis, lots JSON-RPC acceptés, notifications = 202.
- GET `/mcp` : 302 vers `/ai` pour un navigateur, 405 sinon.
- Sans jeton ou jeton mort : 401 + `WWW-Authenticate: Bearer
  resource_metadata="https://yunoapp.eu/.well-known/oauth-protected-resource/mcp"`.

## 4. Les outils (lecture : `readOnlyHint: true` ; brouillons d'e-mails : voir § 8 ; pages d'inscription : voir § 9 ; scénarios : voir § 10)

40 outils : 33 en lecture, 7 en écriture (`create_email_draft`, `update_email_draft`,
`add_email_image`, `create_signup_page`, `update_signup_page`,
`create_scenario_draft`, `update_scenario_draft`).

| Outil | Ce qu'il rend | Source |
|---|---|---|
| `get_account_overview` | espaces, date, fuseau, argent visible, niveau, 5 dernières / 5 prochaines soirées, mode d'emploi court | `events`, `analytics_scope_gate` |
| `list_events` | soirées + chiffres, pipeline des prochaines | `get_analytics_event_rail`, `get_events_sales_summary`, `get_crm_nights` |
| `get_event_report` | rapport de soirée complet | `get_event_report`, `get_crm_night_report` |
| `get_event_details` | billets / tables / guest list / trafic / rythme / porte / partenaires / promoteurs | `ticket_rounds`, `get_vip_table_analytics`, `get_guest_list_analytics`, `get_event_traffic`, `get_analytics_pacing`, `get_analytics_door`, `get_collab_party_breakdown`, `get_analytics_promoters` |
| `compare_events` | 2 à 6 soirées côte à côte | `get_event_report` |
| `get_sales_overview` | ventes sur N soirées vs N d'avant + constats | `get_sales_takeaways`, `get_crm_overview` |
| `get_sales_trends` | courbe J-N, ce qui fait vendre, nouveaux / habitués | `get_sales_period_*` |
| `get_purchase_behavior` | délai, heures, groupes, panier, tunnel, présence | `get_purchase_behavior` |
| `get_audience_overview` | base, croissance, fidélité, goûts, cohortes | `get_community_overview`, `get_community_tastes`, `get_analytics_cohorts` |
| `get_customer_segments` | RFM, segments enregistrés, listes, seuil de panier | `get_analytics_rfm`, `contact_segments`, `get_email_lists_health`, `suggest_basket_threshold` |
| `count_contacts` | taille d'une audience (règle libre) | `count_contact_segment_def` |
| `get_web_traffic` | visites, sources, conversion | `get_page_traffic`, `get_analytics_sources` |
| `get_marketing_performance` | emails, attribution, meilleure heure, automatisations, push, SMS | `email_campaigns`, `get_email_campaign_attribution`, `get_email_send_time_insights`, `get_email_automation_*`, `get_push_*`, `sms_campaigns` |
| `get_campaign_report` | une campagne email en détail | `email_campaigns`, `get_campaign_*_stats` |
| `get_promoters_performance` | promoteurs (Suite) | `get_analytics_promoters` |
| `get_live_now` | temps réel (Suite) | `get_live_view` |
| `get_recommendations` | tout pour un plan d'action | `get_sales_takeaways`, `get_events_sales_summary`, `get_analytics_insights`, `get_analytics_rfm`, automatisations |
| `list_customers` · `list_customers_by_segment` · `get_customer_profile` | fiches clients (niveau `customers`) | `list_contact_base` (aussi pour la fiche, filtrée par l'adresse : 0,6 s contre 20 s par `contact_rows`), `get_*_customer_segments`, `get_customer_automation_emails` |
| `get_glossary` · `search_yuno_help` | définitions, mode d'emploi | Worker (`guide.ts`, `_shared/console-help-articles.ts`) |
| `get_email_design_kit` | marque, soirées, faits de la soirée visée, balises Yuno + aperçu de leurs valeurs, règles HTML, méthode, exemple, brouillons récents | `_mcp_email_tool` (`_mcp_email_event_facts`, `get_external_event_live`, `get_event_lineup_live`, `_event_tables_left`) + Worker (`emailGuide.ts`) |
| `list_email_audiences` | audiences et effectifs joignables (CRM : base, cycles de vie, segments, préréglages ; Billetterie : abonnés, VIP…, segments, listes) | `crm_email_send_options`, `count_campaign_recipients`, `count_organizer_audience_kinds` |
| `get_email_draft` | un brouillon / une campagne : sections (id, texte visible, contenu), `version`, objet, langue, audience, thème | `email_campaigns` |
| `list_email_images` | images ajoutées par l'IA (30 j) et liens de dépôt en attente — pour les e-mails comme pour les pages | `mcp_email_images` |
| `create_email_draft` · `update_email_draft` | **écriture** : un brouillon d'e-mail (§ 8) | `mcp_write` → `_mcp_email_write` |
| `add_email_image` | **écriture** : un emplacement d'image (fichier joint, lien, ou page de dépôt), pour un e-mail ou une page | `mcp_write` → `_mcp_email_image_add`, Worker `emailImages.ts` |
| `get_signup_page_kit` | marque, soirées, pages existantes, les quatre types et leurs règles, gabarits et polices, modèle du design sur mesure, balises de page + aperçu, règles web, méthode, exemple | `_mcp_signup_tool` + Worker (`signupGuide.ts`) |
| `get_signup_page` | une page : réglages, sections du design (id, texte visible, contenu), proposition en attente, `version`, liens Console et public | `crm_signup_pages` (`_mcp_signup_page_view`) |
| `create_signup_page` · `update_signup_page` | **écriture** : une page d'inscription en brouillon, ou une proposition sur une page en ligne (§ 9) | `mcp_write` → `_mcp_signup_write` |
| `list_scenarios` · `get_scenario_report` | scénarios d'un espace Yuno CRM : état, entrés, objectif, témoin ; un scénario en détail (graphe, contrôles, résultats par étape) | `_mcp_scenario_tool` (`crm_scenarios`, `crm_scenario`, `crm_scenario_report`) |
| `get_night_plan` | plan d'envois daté d'une soirée à venir (Yuno CRM), calculé par Yuno : étapes (maintenant, la semaine d'avant, la veille), audiences « Qui cibler » où chaque personne compte une fois, joignables, canal et coût en Yunits, solde, rythme contre l'édition précédente, envois déjà prévus, familles confirmées ; un `audience_id` par audience pour `create_email_draft` | `_mcp_scenario_tool` → `crm_night_plan` |
| `get_weekly_review` | bilan de la semaine écoulée (Yuno CRM), calculé par Yuno : activité, ce qui a marché mesuré contre les non-contactés, dérives, 1 à 3 actions | `_mcp_scenario_tool` → `crm_weekly_review` |
| `get_scenario_kit` | format du graphe, déclencheurs, étapes, conditions (famille, format), limites, 7 exemples + modèles d'e-mail, segments, pages, soirées, familles confirmées du compte | `_mcp_scenario_tool` + Worker (`scenarioTools.ts`, depuis le validateur de l'éditeur) |
| `create_scenario_draft` · `update_scenario_draft` | **écriture** : un BROUILLON de scénario (§ 10) | `mcp_write` → `_mcp_scenario_write` |

Le cerveau d'analyste vit dans `worker/mcp/guide.ts` : consignes du serveur
(méthode, règles, définitions de `metrics.ts`, playbook de la nuit, catalogue
des actions Yuno), glossaire, 14 prompts localisés (dont `plan_night`, `build_scenario`, `weekly_review`). `enrich.ts` traduit les
constats calculés par la base (`mix_shift`, `channel_gap`…) en phrases avec
leurs chiffres ; `compact.ts` retire images, vides et bruit (−15 à −50 % de
caractères mesurés sur la démo selon l'outil). `search_yuno_help` traduit les
mots anglais courants vers ceux des articles (`EN_TO_FR`, `help.ts`) et ne rend
d'un long article que son ouverture et les phrases qui parlent de la question
(≤ 2 400 caractères, `excerpt: true`). **Ajouter un outil** = une branche dans `_mcp_tool` (SQL, en appelant
une RPC de la Console déjà gardée), une entrée dans `TOOLS` (description « use
this when… », exemples de questions), un libellé `aiTool.*` (3 langues) pour le
journal, une ligne ici, et un cas dans `worker/mcp/__tests__/mcp.test.ts`.

## 8. Brouillons d'e-mails dessinés par l'IA (2026-10-06)

Plan : `docs/designs/MCP_EMAIL_DESIGN_PLAN.md`. Migrations `20261009150000`
(outils, `mcp_write`), `151000` (soirées miroirs d'un espace CRM visibles des
outils de soirée), `152000` (brouillons accordés seulement par un écran qui
les annonce) et `153000` (itérer sans écraser le pro, images).
Le pro demande à son IA « dessine l'e-mail de ma soirée, à ma DA, pour toute ma
base, et une version VIP » ; l'IA lit le kit, dessine, et dépose les brouillons
dans la Console (Billetterie ou Yuno CRM). Le pro relit et envoie.

- **Sections sur mesure** : l'IA écrit du HTML (bloc `html` du Studio) et y
  pose les **balises Yuno** (`{{event.title}}`, `{{event.date}}`,
  `{{#each tickets}}`, `{{event.tickets_url}}`, `{{#if event.sold_out}}`,
  `{{#each lineup}}`, `{{tables.left_label}}`, `{{countdown.days}}`,
  `{{first_name}}`…). Moteur UNIQUE `supabase/functions/_shared/email-smart.ts`
  (rendu, nettoyage, besoins en données, contrôle) partagé par le Studio, le
  Worker et `send-campaign`. Les liens posés par balise sont SUIVIS (lien
  `/l/` + `yc=`, ou `utm_source=yuno-m-<campagne>` vers Shotgun) : attribution
  et résultats identiques aux autres e-mails.
- **Une seule porte d'écriture, `mcp_write`** : jeton, espace, débits (30
  créations / 200 modifications par jour et par connexion), permission de la
  connexion (`mcp_grants.can_draft`, posée par `mcp_approve_authorization`
  seulement quand l'écran de consentement passe `p_drafts = true`, défaut
  `false` ; les connexions plus anciennes restent à `false` et se reconnectent), droit d'écrire dans
  l'espace (`_mcp_space_can_draft` : CRM = `crm_scope_writable` + CRM actif ;
  Billetterie = titulaire du club ou fondateur, comme la policy RLS). Elle
  n'écrit QUE des lignes `email_campaigns` au statut `draft` ; une campagne
  programmée ou envoyée est refusée (`draft_not_editable`). Aucun outil
  n'envoie, ne programme, ne teste ni ne supprime.
- **Contrôle avant écriture** (Worker, `emailDraft.ts`) : le HTML est nettoyé
  (script, style, iframe, formulaire, svg, `on*`, `javascript:`), puis contrôlé
  (balises inconnues, blocs mal fermés, soirée manquante, poids > 90 Ko,
  objet). Une erreur = RIEN n'est écrit, l'IA reçoit la liste à corriger ; les
  avertissements (alt manquant, flex, lien écrit en dur…) partent avec le
  brouillon.
- **Traçabilité** : `email_campaigns.ai_author` (« Claude ») et `mcp_grant_id`
  → bandeau « Préparé par Claude » dans le Studio CRM, nombre de brouillons à
  côté de l'IA dans Réglages → Assistants IA ; `mcp_tool_calls` garde un
  RÉSUMÉ (nom, objet, nombre de sections, poids), jamais le HTML.
- **Langue** : `email_campaigns.language` (`fr` | `en` | `es`, réglable
  aussi dans les deux Studios) → blocs Yuno natifs (boutons, « From €18 »,
  tables restantes, compte à rebours, guest list), dates, valeurs des balises,
  pied de page légal, `lang` du document. Mots dans UNE source,
  `_shared/email-words.ts` (Studio, envoi, Worker, moteur des sections) ; le
  français y est celui d'avant, au caractère près. Un libellé resté au défaut
  d'une des trois langues suit la langue (`localizeDefaultLabel`) ; un texte
  écrit par le pro reste le sien.
- **Itérer avec son IA** (migration `20261009153000`) : `get_email_draft` rend
  chaque section avec son id stable, son texte visible et une `version`
  (`updated_at` en µs) ; `update_email_draft` vise les sections par id
  (réécrire, options d'un bloc natif, insérer au-dessus / en dessous, déplacer,
  supprimer), reçoit `draft_version` (version périmée = `draft_changed`, les
  sections actuelles rendues) et passe `expected_version` à la base (écriture
  atomique). Chaque écriture de l'IA pose `email_campaigns.ai_updated_at` : les
  deux Studios ADOPTENT cette version (retour sur l'onglet, puis toutes les 8 s
  quand il est visible ; ⌘Z rend celle du pro) et leur sauvegarde automatique
  filtre sur `ai_updated_at` (jamais d'écriture par-dessus une version de l'IA
  pas encore vue). Une capture d'écran collée dans le chat est lue par l'IA
  elle-même : rien à transmettre au connecteur.
- **Images** : `add_email_image` ouvre un emplacement (`mcp_email_images`, code
  à usage unique, 30 min, rattaché à l'espace, 60 / jour / connexion). Le
  fichier part dans `email-assets/mcp/<code>/image.<ext>` avec la clé PUBLIQUE
  (policy `Email assets: AI image slot` → `mcp_image_slot_open`) : le Worker
  n'y gagne aucun droit. Format et dimensions lus dans les octets (JPEG, PNG,
  GIF, WebP, 8 Mo), puis `mcp_image_finish` (service) vérifie l'objet et rend
  l'image prête. Trois entrées : le fichier joint à la conversation (ChatGPT,
  `_meta["openai/fileParams"]`), un lien https recopié, ou la page
  `/ai/image/<code>` où le pro colle (⌘V) ou dépose l'image (même code :
  `POST /mcp/image/<code>`, aussi utilisable par une IA qui exécute du code).
- **Annotations** : `create_email_draft` et `add_email_image` =
  `readOnlyHint: false`, `destructiveHint: false` ; `update_email_draft` =
  `destructiveHint: true`.
  Dans Claude, ces deux outils demandent confirmation même quand « Outils en
  lecture seule » est sur « Toujours autoriser ».
- **Le cerveau du designer** : `worker/mcp/emailGuide.ts` (règles HTML e-mail,
  méthode ouverture + vente, exemple de section) rendu par le kit et par la
  ressource `yuno://guide/email-design` ; consignes « EMAIL DESIGN » dans
  `guide.ts` ; prompt `design_event_email`.
- Tests : `npx vitest run worker/mcp src/lib/email`.

## 9. Pages d'inscription dessinées par l'IA (2026-10-06)

Plan : `docs/designs/MCP_SIGNUP_PAGE_DESIGN_PLAN.md`. Migration
`20261009160000`. Même mécanique que les brouillons d'e-mails (§ 8), pour les
pages d'inscription de Yuno CRM (`/j/<nom>`). Le pro décrit sa page, colle sa
charte ou une capture d'une page qui l'inspire ; l'IA la dessine, la dépose en
brouillon, puis la retouche dans la conversation. Le titulaire publie.

- **« Design sur mesure »** (`crm_signup_pages.custom_design`, NULL = un des
  dix gabarits comme avant) : un thème (fond, encre, accent, polices Google,
  rayon, ombre, CSS commun) et jusqu'à 24 sections, chacune soit du HTML/CSS
  libre, soit un bloc Yuno (`form`, `countdown`, `reward`, `count`). Le
  **formulaire Yuno est toujours là, une fois** : champs, case d'accord, double
  confirmation et scène « inscrit » restent ceux de Yuno, l'IA ne les dessine
  jamais. Une section peut ne s'afficher qu'avant ou après l'inscription
  (`show_on`). Les **balises de page** (`{{page.title}}`, `{{event.date}}`,
  `{{reward.text}}`, `{{page.count}}`, `{{#if scene.signed_up}}`…) passent par
  le moteur des e-mails (`email-smart.ts`), avec leurs valeurs propres
  (`buildPageTagData`). Module pur unique `src/crm/signup/custom.ts` (modèle,
  nettoyage, contrôle, rendu des balises, thème) importé par le Worker et la
  Console, testé (`signupCustom.test.ts`).
- **Trois barrières contre un contenu piégé** : le Worker nettoie et refuse
  avant d'écrire (balises et attributs interdits, `javascript:`, images hors
  du stockage Yuno, CSS sans `@import`, `@font-face`, `expression()` ni image
  d'un autre site) ; la base refuse une forme invalide ou un motif dangereux
  (`_mcp_signup_write`) ; la page publique repasse chaque section par
  DOMPurify et la rend dans un **Shadow DOM** sous `contain: paint` : son CSS
  ne peut ni sortir, ni masquer ou recouvrir le formulaire, la case d'accord
  ou le bouton (même un `position: fixed` reste dans la boîte de sa section). Les images d'une page viennent du stockage du projet Yuno
  (même porte que les e-mails : `add_email_image`, `list_email_images`) ou
  des fichiers d'image de yunoapp.eu, jamais d'un site tiers ni d'un autre
  projet Supabase : une image hébergée ailleurs verrait l'IP de chaque fan.
- **Permission** : `mcp_grants.can_pages` (défaut `false`), posée seulement si
  l'écran de consentement passe `p_pages = true` ; `/connect-ai` l'annonce
  (`aiMcp.can5`). Les connexions existantes ne la reçoivent pas : les
  reconnecter. L'espace doit avoir Yuno CRM actif (`crm_not_active` sinon) et
  la personne le droit d'écrire dans la Console (`_mcp_space_can_draft`).
  Débits : 20 créations / 200 modifications par jour et par connexion.
  Journal : un RÉSUMÉ (page, type, titre, gabarit ou design, nombre de
  sections, poids), jamais le HTML.
- **Ce que l'IA écrit** : `create_signup_page` = toujours un BROUILLON ;
  `update_signup_page` sur un brouillon le modifie, sur une page EN LIGNE
  écrit une **proposition** (`ai_proposal` : réglages + design, essayés à blanc
  par `crm_signup_page_save` puis annulés) — rien ne change pour les fans. Le
  pro la voit en bandeau sur la fiche de la page (« Aperçu », « Ignorer »,
  « Appliquer », `crm_signup_page_ai_proposal`). Les réglages passent TOUS par
  `crm_signup_page_save`, la fonction de la Console (mêmes contrôles). Aucun
  outil ne publie, ne ferme, ne supprime, n'écrit les relances ni n'envoie :
  une page préparée par l'IA dont les relances sont vides passe d'abord par
  l'étape de relecture de l'assistant avant la mise en ligne.
- **Itérer sans écraser le pro** : `get_signup_page` rend une `version`
  (`updated_at` en µs) et les sections par id ; `update_signup_page` les vise
  (`section_updates` : réécrire, insérer avant / après, déplacer, supprimer ;
  le formulaire ne se supprime pas) et reçoit `page_version` (périmée =
  `page_changed`). Chaque écriture pose `ai_updated_at` ; l'assistant ouvert
  ADOPTE la version de l'IA (retour sur l'onglet, puis toutes les 8 s, toast
  avec « Annuler ») et `crm_signup_page_save` refuse `ai_changed` quand l'écran
  enregistrerait par-dessus une version de l'IA qu'il n'a pas vue
  (`_seen_ai_at`). Choisir un gabarit dans l'assistant remplace le design sur
  mesure (confirmation demandée).
- **Annotations** : `create_signup_page` = `readOnlyHint: false`,
  `destructiveHint: false` ; `update_signup_page` = `destructiveHint: true`.
- **Le cerveau du designer** : `worker/mcp/signupGuide.ts` (types de page et
  leurs règles, gabarits, polices, modèle du design, règles web mobile, méthode,
  voix « tu » du formulaire, exemple) rendu par le kit et la ressource
  `yuno://guide/signup-page-design` ; consignes « SIGNUP PAGE DESIGN » et
  « ITERATING ON A SIGNUP PAGE » dans `guide.ts` ; prompt `design_signup_page`.
  Écriture : `signupTools.ts` (lecture du travail en cours, chemins de design),
  `signupDesign.ts` (construction, mises à jour par id, réglages, contrôles).
- Tests : `npx vitest run worker/mcp src/crm/lib/__tests__/signupCustom.test.ts`.

## 10. Scénarios préparés par l'IA (2026-10-16)

Migration `20261016160000_crm_scenario_mcp.sql`, Worker `scenarioTools.ts`.

- **Lecture pour toute connexion dont un espace a Yuno CRM** : `list_scenarios`
  et `get_scenario_report` rendent des agrégats (jamais une personne) par les
  RPC de la Console, avec leurs portes (`crm_scope_allowed`, montants derrière
  `_crm_money_gate`). Le rapport passe par une table temporaire
  (`_mcp_needs_temp`).
- **Brouillons derrière un droit propre** : `mcp_grants.can_scenarios`
  (défaut `false`), posé seulement si l'écran de consentement passe
  `p_scenarios = true` ; `/connect-ai` l'annonce (`aiMcp.can6`). Les
  connexions existantes ne le reçoivent pas : les reconnecter. Le kit
  (`get_scenario_kit`) n'est listé qu'avec ce droit.
- **Ce que l'IA écrit** : `crm_scenario_save`, la fonction de l'éditeur, au
  nom de la personne (claims posés par `mcp_write`, `crm_scope_writable`,
  `_mcp_space_can_draft`). Un brouillon incomplet s'enregistre ; la réponse
  donne les contrôles qui bloquent la publication, étape par étape (forme
  vérifiée d'abord dans le Worker par le MÊME validateur que l'éditeur,
  `graphErrors`). Sur un scénario en ligne, seul le brouillon change : la
  version en ligne tourne jusqu'à ce que le pro publie. **Aucun outil ne
  publie, ne reprend, ne met en pause, n'archive ni ne supprime** un
  scénario (`unknown_tool` en base pour tout autre nom). Le brouillon porte
  « Préparé par <IA> » (`crm_scenarios.ai_author`, `mcp_grant_id`), compté
  dans Réglages → Assistants IA (`scenarios_created`).
- **Débits** : 20 créations / 200 modifications par jour et par connexion.
  Journal : un RÉSUMÉ (scénario, nombre d'étapes, déclencheur), jamais le
  graphe.
- **Consignes** : bloc « SCENARIOS » d'`INSTRUCTIONS` (lire avant d'écrire,
  partir de l'exemple le plus proche, modèles d'e-mail existants seulement,
  familles confirmées seulement, dire que c'est un brouillon, ne jamais
  inventer un gain). Les descriptions d'outils décrivent, sans ordre.
- **Vocabulaire** (agents, principe 4) : un brouillon dont un texte (nom,
  objet, SMS, étiquette) prête un goût ou un motif à une personne (« aime »,
  « fan de », « vient pour », « son ami », « préfère », et leurs équivalents
  EN / ES) est refusé AVANT toute écriture (`forbidden_wording`,
  `src/crm/lib/agentText.ts`, partagé avec la Console et le jeu d'évaluation).
- **Invite `build_scenario`** (« Créer avec l'IA », argument `idea`), listée
  seulement pour une connexion qui a `can_scenarios`. Les invites réservées
  au CRM sont aussi listées pour un compte Billetterie + CRM (`crm: true`) :
  avant, `products` ne lisait que le produit de l'espace.
- Tests : `npx vitest run worker/mcp` ; banc SQL :
  `node scripts/crm-bench/scenarios.mjs mcp`.

### 10 bis. Le plan de soirée (agents, lot A1)

Aucune IA chez Yuno (décision de Paul, 08/10) : c'est l'IA du pro, par le MCP,
qui prépare. Migration `20261016155000_crm_night_plan.sql`.

- `get_night_plan` (lecture, toute connexion d'un espace Yuno CRM) rend
  `crm_night_plan` : les étapes datées de « Qui cibler », chaque personne
  comptée UNE fois (`first_n`), joignables, canal conseillé (SMS la veille
  seulement si l'identité de l'expéditeur est prête), coût en Yunits, solde,
  rythme contre l'édition précédente au même moment, envois déjà prévus,
  témoin, familles confirmées. **Tout chiffre est calculé par le serveur** :
  l'IA le lit, elle ne l'écrit jamais.
- Chaque audience porte un `audience_id` (`target:<soirée>:<audience>`) que
  `create_email_draft` accepte (`_mcp_email_audience`) : le brouillon vise le
  filtre `ntgt`, la même porte serveur que les chiffres du plan.
- Invite `plan_night` (« Plan de soirée ») et bloc « NIGHT PLAN »
  d'`INSTRUCTIONS`. La même page existe dans la Console
  (`/crm/nights/<id>/plan`), pour les pros sans IA branchée.
- Banc : `node scripts/crm-bench/scenarios.mjs plan`.

### 10 ter. Le bilan de la semaine (agents, lot A3)

`get_weekly_review` (lecture, toute connexion d'un espace Yuno CRM) rend
`crm_weekly_review` (migration `20261016175000`) : la semaine écoulée,
calculée par Yuno sans IA — activité, mesures contre les personnes mises de
côté (verdict net seulement), dérives, 1 à 3 actions. Invite
`weekly_review`, consigne « WEEKLY REVIEW ». Annoncé le lundi dans le fil
de notifications de la Console (`weekly_review`). Banc :
`node scripts/crm-bench/scenarios.mjs review`.

## 5. Mise en service — fait le 2026-10-03

1. **Clé serveur** : clé secrète Supabase dédiée `mcp_worker` (Project Settings
   → API Keys → *Secret keys*), révocable seule sans toucher aux autres clés.
2. **Cloudflare** : posée en secret `SUPABASE_MCP_KEY` sur le Worker `yuno`
   (`wrangler secret put`, depuis `~` : le `.env.local` du projet porte un jeton
   limité au DNS). Sans elle, `/mcp` et `/oauth/*` répondent 503 proprement.
   Rotation : créer une nouvelle clé, la poser, puis révoquer l'ancienne.
3. Le push sur `main` déploie le Worker (Workers Builds). Vérifier :
   `curl https://yunoapp.eu/.well-known/oauth-protected-resource/mcp`.
4. Testé de bout en bout en production (OAuth, consentement, 22 outils, deux
   époques du protocole, MCP Inspector, vraie conversation Claude :
   `docs/mcp-directory/example-answer.md`).

Ce qui reste à Paul (compte de relecture, soumissions Claude et OpenAI, jeton
de domaine OpenAI) : **`docs/MCP_GO_LIVE_GUIDE.md`**.

## 6. Kit annuaires

Tous les champs prêts à coller (Claude, OpenAI, Le Chat, Gemini) :
**`docs/mcp-directory/SUBMISSION.md`**. Résumé :

**Commun** — Nom : Yuno · Description courte : « Ask your nightlife numbers in
plain words: sales, events, audience and marketing from your Yuno Console,
and have it prepare on-brand email drafts and signup pages you review, send and publish yourself. » · Documentation : https://yunoapp.eu/ai · Confidentialité :
https://yunoapp.eu/legal/privacy · Conditions :
https://yunoapp.eu/legal/cgu · Support : contact@yunoapp.eu · Icône :
`public/icon-1024.png` · Auth : OAuth 2.1 (DCR + CIMD, PKCE) · Outils de
lecture annotés `readOnlyHint: true` ; cinq outils d'écriture (brouillons
d'e-mails, images, pages d'inscription en brouillon ou en proposition ; jamais
d'envoi ni de publication) annotés `readOnlyHint: false`.

**Compte de test** : `review@womber.fr`, créé par
`node scripts/demo/create-reviewer-account.mjs` (mot de passe généré, affiché
une fois ; manager en lecture du club démo + admin d'équipe de l'organisation
démo et du compte Yuno CRM démo). Jamais un compte réel, jamais le mot de passe
démo historique. Les données démo sont fictives ou masquées, aucun envoi
possible (`demo_no_send`).

**Claude** (https://claude.ai/directory/manage → MCP connector) : chaque outil a
`title` + `readOnlyHint` ✅, noms ≤ 64 caractères ✅, lecture et écriture
séparées ✅ (cinq outils d'écriture, brouillons et propositions seulement, annotés). Redirections Claude acceptées sans liste
blanche (DCR et CIMD, https).

**ChatGPT** (https://platform.openai.com/plugins) : `readOnlyHint`,
`destructiveHint`, `openWorldHint` explicites ✅, CIMD
`https://chatgpt.com/oauth/client.json` accepté (traité en client public) ✅,
`iss` renvoyé (redirection `connector_platform_oauth_redirect`) ✅.
Cas de test positifs :
1. « How did my last party go compared with the previous one? » → `get_account_overview`, `get_event_report(last)`.
2. « Which channel brings me the most ticket sales over the last 3 months? » → `get_sales_trends(days 90)`.
3. « How many people took a VIP table and have not come back in 60 days? » → `count_contacts`.
4. « Did my last email campaign make money? » → `get_marketing_performance(email)`, `get_campaign_report`.
5. « Give me 3 actions for this week to sell more. » → `get_recommendations`, `search_yuno_help`.
Cas négatifs (le connecteur ne doit PAS servir) :
1. « What's the weather in Paris? »
2. « Write me a poem about techno. »
3. « Send an email to all my customers now. » → aucun outil n'envoie : l'IA
   peut préparer un brouillon et explique que l'envoi se fait dans la Console.
Cas positif d'écriture : « Design the announcement email for my next party for
my whole base and save it as a draft. » → `get_email_design_kit`,
`list_email_audiences`, `create_email_draft` (lien Console rendu, rien
d'envoyé). « Design a presale signup page for my next party, dark and neon,
with a free drink for the first 100. » → `get_signup_page_kit`,
`create_signup_page` (brouillon, lien Console rendu, rien de publié).

**Gemini** : applis personnalisées encore réservées à certains pays / langues ;
Gemini Enterprise : OAuth manuel (non configuré ici, DCR suffit ailleurs).
**Le Chat** : DCR détecté automatiquement.

## 7. Exploitation

- Journal d'une connexion : `mcp_connection_activity` (Console).
- Adoption : `/admin/ai` → « Connecteur IA (MCP) » (`admin_mcp_usage`).
- Ménage quotidien : cron `mcp-housekeeping` (04:41 UTC) — demandes et codes à
  7 j, jetons morts à 7 j, clients jamais utilisés à 30 j, journal à 13 mois.
- Tests : `npx vitest run worker/mcp` (protocole, OAuth, CIMD, validation,
  mise en forme, relance) ; bout en bout contre la vraie base : Worker local
  (`wrangler dev --var SUPABASE_MCP_KEY:…`) + compte de relecture. Une
  connexion est limitée à 60 appels / minute : un banc qui enchaîne les outils
  doit attendre ~1 s entre deux appels, sinon il ne mesure que la limite.
- Revue du 03/10 (compte `review@womber.fr`, 166 appels, 3 espaces) : avant
  correction, 49 erreurs (CIMD cassé, rôles d'équipe refusés, délais non
  relancés) ; après, seules restent les réponses voulues (soirée ou contact
  introuvable, détail réservé au propriétaire du club).
- `iss` est figé à `https://yunoapp.eu` en SQL : un aperçu `*.workers.dev` ne
  peut pas finir une connexion (les clients valident `iss`) — c'est voulu.
