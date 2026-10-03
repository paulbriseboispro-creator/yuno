# Serveur MCP Yuno — les chiffres d'un pro dans son IA

Construit le 2026-10-03. Un club ou un organisateur branche **son** assistant IA
(Claude, ChatGPT, Gemini, Le Chat, Claude Code, Cursor…) sur sa Console Yuno et
pose ses questions avec ses mots ; l'IA lit ses chiffres, en lecture seule, et
les transforme en analyses, constats et conseils concrets.

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
  organisation = fondateur ou membre d'équipe admin / éditeur accepté. Le
  super admin n'y a QUE ses propres espaces : une IA n'ouvre jamais les données
  d'un autre client. Un espace dont la personne perd l'accès disparaît aussitôt
  de la connexion.
- **Statement timeout** : `anon` est à 3 s (trop court pour les analyses
  lourdes), `service_role` hérite des 8 s d'`authenticator`, comme la Console.
  Une analyse qui dépasse est relancée une fois par le Worker (le cache est
  alors chaud), sur une fenêtre resserrée à 45 jours pour un outil à fenêtre,
  et l'échec final est journalisé (`mcp_log_failure`).

## 2. Sécurité et données personnelles

| Garantie | Où elle vit |
|---|---|
| Lecture seule | `transaction_read_only = on` dans `mcp_call` ; aucun outil d'écriture |
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
| OAuth | PKCE S256 obligatoire, `resource` vérifié (RFC 8707), `iss` dans la réponse (RFC 9207), URI de retour exactes (port libre seulement en boucle locale, RFC 8252), CIMD lu en https sans redirection, 64 Ko max, cache 1 h |

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

## 4. Les outils (tous `readOnlyHint: true`, `destructiveHint: false`)

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
| `list_customers` · `list_customers_by_segment` · `get_customer_profile` | fiches clients (niveau `customers`) | `list_contact_base`, `get_*_customer_segments`, `contact_rows`, `get_customer_automation_emails` |
| `get_glossary` · `search_yuno_help` | définitions, mode d'emploi | Worker (`guide.ts`, `_shared/console-help-articles.ts`) |

Le cerveau d'analyste vit dans `worker/mcp/guide.ts` : consignes du serveur
(méthode, règles, définitions de `metrics.ts`, playbook de la nuit, catalogue
des actions Yuno), glossaire, 8 prompts localisés. `enrich.ts` traduit les
constats calculés par la base (`mix_shift`, `channel_gap`…) en phrases avec
leurs chiffres ; `compact.ts` retire images, vides et bruit (−15 à −50 % de
caractères mesurés sur la démo selon l'outil). **Ajouter un outil** = une branche dans `_mcp_tool` (SQL, en appelant
une RPC de la Console déjà gardée), une entrée dans `TOOLS` (description « use
this when… », exemples de questions), un libellé `aiTool.*` (3 langues) pour le
journal, une ligne ici, et un cas dans `worker/mcp/__tests__/mcp.test.ts`.

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
read-only. » · Documentation : https://yunoapp.eu/ai · Confidentialité :
https://yunoapp.eu/legal/privacy · Conditions :
https://yunoapp.eu/legal/cgu · Support : contact@yunoapp.eu · Icône :
`public/icon-1024.png` · Auth : OAuth 2.1 (DCR + CIMD, PKCE) · Tous les outils
en lecture seule, annotés.

**Compte de test** : `review@womber.fr`, créé par
`node scripts/demo/create-reviewer-account.mjs` (mot de passe généré, affiché
une fois ; manager en lecture du club démo + admin d'équipe de l'organisation
démo et du compte Yuno CRM démo). Jamais un compte réel, jamais le mot de passe
démo historique. Les données démo sont fictives ou masquées, aucun envoi
possible (`demo_no_send`).

**Claude** (https://claude.ai/directory/manage → MCP connector) : chaque outil a
`title` + `readOnlyHint` ✅, noms ≤ 64 caractères ✅, lecture et écriture
séparées ✅ (aucune écriture). Redirections Claude acceptées sans liste
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
3. « Send an email to all my customers now. » → aucun outil d'écriture : l'IA
   explique les étapes dans la Console.

**Gemini** : applis personnalisées encore réservées à certains pays / langues ;
Gemini Enterprise : OAuth manuel (non configuré ici, DCR suffit ailleurs).
**Le Chat** : DCR détecté automatiquement.

## 7. Exploitation

- Journal d'une connexion : `mcp_connection_activity` (Console).
- Adoption : `/admin/ai` → « Connecteur IA (MCP) » (`admin_mcp_usage`).
- Ménage quotidien : cron `mcp-housekeeping` (04:41 UTC) — demandes et codes à
  7 j, jetons morts à 7 j, clients jamais utilisés à 30 j, journal à 13 mois.
- Tests : `npx vitest run worker/mcp` (protocole, OAuth, validation, mise en
  forme, relance) ; bout en bout contre la vraie base : Worker local (`wrangler
  dev --var SUPABASE_MCP_KEY:…`) + compte démo.
- `iss` est figé à `https://yunoapp.eu` en SQL : un aperçu `*.workers.dev` ne
  peut pas finir une connexion (les clients valident `iss`) — c'est voulu.
