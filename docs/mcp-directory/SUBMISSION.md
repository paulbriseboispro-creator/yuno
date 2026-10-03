# Dossier de soumission — connecteur Yuno (MCP)

Tout ce qu'il faut copier-coller dans les portails Claude et OpenAI. Les textes
des formulaires sont en anglais (les relecteurs lisent l'anglais). Chaque
longueur respecte la limite du portail (comptée le 2026-10-03 : one-liner
183 / 200, description ≈ 1 500 / 2 000). Contexte technique : `docs/MCP.md`. Ton pas
à pas : `docs/MCP_GO_LIVE_GUIDE.md`.

## Commun aux deux

| Champ | Valeur |
|---|---|
| Server URL | `https://yunoapp.eu/mcp` |
| Name | Yuno |
| Company / developer | Yuno (édité par WOMBER SAS, SIREN 995 130 747) |
| Website | https://yunoapp.eu |
| Documentation | https://yunoapp.eu/ai |
| Privacy policy | https://yunoapp.eu/legal/privacy |
| Terms | https://yunoapp.eu/legal/cgu |
| Support | contact@yunoapp.eu (URL : https://yunoapp.eu/ai) |
| Icon / logo | `public/icon-1024.png` (carré, PNG 1024×1024) — `public/icon-512.png` si une taille plus petite est demandée |
| Auth | OAuth 2.1 : Dynamic Client Registration ET Client ID Metadata Documents, PKCE S256, `resource`, `iss` |
| Read / write | Read only (22 outils, tous `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, avec `title`) |
| Test account | `review@womber.fr` — mot de passe affiché par `node scripts/demo/create-reviewer-account.mjs` |

## Claude — claude.ai/directory/manage → Submit new → MCP connector

**Connection** : `https://yunoapp.eu/mcp`, une seule URL pour tous.

**Listing**

- Server name (≤ 100) : `Yuno`
- One-liner (≤ 200) :

  > Ask about your nightlife business in plain words: Yuno reads your event sales, VIP tables, guest lists, audience and marketing, read-only, and turns them into analysis and next steps.

- Description (≤ 2 000) :

  > Yuno is the nightlife platform clubs and event organizers use to sell tickets, VIP tables and guest lists, and to run their customer base and email marketing. This connector lets a Yuno pro ask Claude about their own numbers, in their own words, and get answers backed by the same figures as their Yuno Console.
  >
  > What you can ask:
  > - "How did last Saturday go compared with the previous one?" Sales by ticket tier, tables and guest list, entries at the door, the sales curve day by day before the event, where buyers came from.
  > - "Is my next party selling slower than usual? What should I do this week?" Pace against comparable events, computed signals and concrete actions with where to click in Yuno.
  > - "Which channel brings ticket sales? Did my last email make money?" Traffic sources, tracked links, email and push results with attributed revenue.
  > - "How many regulars stopped coming, and how big would that audience be?" Loyalty, customer segments and audience sizing.
  >
  > Read-only and private by design: the connector cannot change anything, send any message or touch money. You choose which club or organization the AI can read and whether customer identities are shared (numbers only by default). It sees exactly what your role sees in the Yuno Console, every question is logged, and access can be cut in one click from Settings > AI assistants.
  >
  > Requires a Yuno pro account: club owner, manager with analytics access, or event organizer. Works with Yuno Suite and Yuno CRM accounts.

- Categories (1 à 5) : prendre les plus proches de « Analytics », « Marketing », « Business / Sales » dans la liste du portail.
- Slug (définitif) : `yuno`

**Use cases**

- Primary use cases :
  - Post-event recap: compare an event with the previous ones and explain what changed.
  - Pre-event pacing: check whether an upcoming event sells faster or slower than usual and what to do about it.
  - Marketing performance: which channels, emails, push campaigns and promoters bring sales.
  - Audience and loyalty: size customer segments, find regulars who stopped coming, plan win-back campaigns.
- Prerequisites : a Yuno pro account (club or organizer) with access to analytics in the Yuno Console. Free to connect, no additional plan.
- Reads or writes : **Reads data only.**

**Company** : Yuno — https://yunoapp.eu — contact principal : toi (email pro).

**Authentication** : OAuth with dynamic client registration + client ID metadata documents (les deux sont actifs ; aucun identifiant détenu par Anthropic n'est nécessaire).

**Data handling** : API = la nôtre (first-party, même domaine que le service). Pas de données de santé. Pas de contenu sponsorisé.

**Test & launch — instructions pour les relecteurs** (à coller, en remplaçant le mot de passe) :

> 1. Add a custom connector with the URL https://yunoapp.eu/mcp.
> 2. When Claude opens the Yuno sign-in page, sign in with email + password: review@womber.fr / <PASSWORD>. There is no 2FA, no email code.
> 3. On the consent screen, keep the three spaces checked (the demo club "Yuno", "Organisateur Démo" and the Yuno CRM demo organization), select "Numbers + customer details" to exercise every tool, then click Allow.
> 4. Try: "How did my last party go compared with the previous one?", "Give me 3 actions to sell more for my next event", "How many people took a VIP table and have not come back in 60 days?", "Who are my 10 best customers?", "Is the Yuno CRM demo selling better through Instagram or email?"
> 5. All data in this account is fictitious demo data. The account cannot send any email, push or SMS (demo safeguard). Every connection is listed, logged and revocable by the account holder in the Yuno Console (Settings > AI assistants).

Coche « j'ai testé chaque outil » seulement après l'étape 2 de ton guide.

**Compliance** (7 cases) : toutes vraies pour Yuno — directory guidelines, API first-party, aucune transaction financière (lecture seule), aucune génération d'image / vidéo / audio, descriptions sans injection de consignes (relues pour ça), aucune collecte de conversation (seuls les arguments d'outil sont journalisés, jamais la conversation ni les réponses), documentation publique (https://yunoapp.eu/ai).

## OpenAI — platform.openai.com/plugins

Préalables : organisation **vérifiée** (Settings → Organization → General → verification, au nom de WOMBER / Yuno) et toi propriétaire de l'organisation.

**Domain verification** : le portail donne un jeton. Le Worker sert déjà `https://yunoapp.eu/.well-known/openai-apps-challenge` : il suffit de poser le jeton (voir le guide, étape 4, point 3).

**Metadata**

| Champ | Limite | Valeur |
|---|---|---|
| name | 64 | `yuno` |
| displayName | 30 | `Yuno` |
| shortDescription | 30 | `Your nightlife numbers` |
| longDescription | 4 000 | la description Claude ci-dessus |
| developerName | 80 | `Yuno` |
| version | — | `1.0.0` |
| websiteURL | — | `https://yunoapp.eu` |
| supportURL | — | `https://yunoapp.eu/ai` |
| privacyPolicyURL | — | `https://yunoapp.eu/legal/privacy` |
| termsOfServiceURL | — | `https://yunoapp.eu/legal/cgu` |
| defaultPrompt 1 | 128 | `How did my last party go compared with the previous one?` |
| defaultPrompt 2 | 128 | `Give me 3 actions to sell more tickets for my next event.` |
| defaultPrompt 3 | 128 | `Which channel brings me the most ticket sales?` |
| author.name / email / url | — | `Yuno` / `contact@yunoapp.eu` / `https://yunoapp.eu` |

**Test cases positifs (5)** — à jouer chacun dans ChatGPT avec le compte de test avant de soumettre :

1. *Post-event recap* — prompt : `How did my last party go compared with the previous one?` — tools : `get_account_overview`, `get_event_report`, `compare_events` — expected : a recap with tickets, tables, guest list, revenue and entries for both events, the differences in numbers, and 2-4 findings.
2. *Channel performance* — prompt : `Which channel brings me the most ticket sales over the last 3 months?` — tools : `get_sales_trends` — expected : channels and tracked links ranked by attributed sales and revenue, compared with the previous period.
3. *Audience sizing* — prompt : `How many people took a VIP table and have not come back in 60 days?` — tools : `count_contacts` — expected : the number of matching contacts and how many are reachable by email and SMS.
4. *Email results* — prompt : `Did my last email campaign make money?` — tools : `get_marketing_performance`, `get_campaign_report` — expected : delivery, open and click rates, unsubscribes and revenue attributed to the campaign (click then purchase within 72 h).
5. *Action plan* — prompt : `Give me 3 actions to sell more tickets for my next event, with where to click in Yuno.` — tools : `get_recommendations`, `search_yuno_help` — expected : three ranked actions based on the account's signals, each with the exact place in the Yuno Console and the number that will show it worked.

**Test cases négatifs (3)** — le connecteur ne doit pas s'activer, ou doit refuser proprement :

1. `What's the weather in Paris tonight?` — no Yuno tool should run.
2. `Write me a short poem about techno music.` — no Yuno tool should run.
3. `Send an email to all my customers about Saturday.` — the connector is read-only: no tool sends anything; ChatGPT explains the steps to send it from the Yuno Console (Marketing & CRM > Email).

**Demo video** (2 à 3 min, URL accessible — YouTube non répertorié par exemple) — déroulé :

1. ChatGPT web, mode développeur : Settings → Apps → Create app → `https://yunoapp.eu/mcp`, OAuth.
2. La page Yuno de connexion, puis l'écran de consentement : les espaces, le niveau « Numbers and analyses », le contrat (lecture seule), « Allow ».
3. Les 5 prompts positifs, l'un après l'autre (on voit les outils appelés et les réponses).
4. Un prompt négatif (`Send an email…`) : rien n'est envoyé.
5. La Console Yuno → Settings → AI assistants : la connexion, son journal, « Cut access ».

**Reviewer credentials** (champ *Review details*, jamais dans le paquet) : URL de connexion `https://yunoapp.eu/auth`, `review@womber.fr` + mot de passe, « no MFA, no email code », même consigne de consentement que pour Claude.

## Le Chat (Mistral) et Gemini

- **Le Chat** : pas d'annuaire à soumettre. Chaque utilisateur ajoute le connecteur (Intelligence → Connectors → Add connector → Custom MCP connector → l'URL). L'enregistrement dynamique est détecté tout seul.
- **Gemini** : les applis personnalisées (Settings → Connected apps → Add a custom app) s'ouvrent pays par pays ; rien à soumettre. Gemini Enterprise demande une configuration OAuth manuelle : à faire seulement si un client entreprise le demande.
