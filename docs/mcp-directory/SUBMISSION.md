# Dossier de soumission — connecteur Yuno (MCP)

Tout ce qu'il faut copier-coller dans les portails Claude et OpenAI. Les textes
des formulaires sont en anglais (les relecteurs lisent l'anglais). Chaque
longueur respecte la limite du portail (comptée le 2026-10-06 : one-liner
195 / 200, description 1980 / 2 000). Contexte technique : `docs/MCP.md`. Ton pas
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
| Read / write | 33 outils de lecture (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, avec `title`) + 7 outils d'écriture liés aux BROUILLONS d'e-mails, aux PAGES D'INSCRIPTION et aux BROUILLONS de scénarios (`create_email_draft`, `add_email_image`, `create_signup_page` et `create_scenario_draft` : `readOnlyHint: false`, `destructiveHint: false` ; `update_email_draft`, `update_signup_page` et `update_scenario_draft` : `destructiveHint: true`). Aucun outil n'envoie, ne programme, ne publie ni ne supprime ; sur une page déjà en ligne, l'IA ne laisse qu'une proposition que le pro applique ; un scénario préparé par l'IA reste un brouillon que le pro publie. |
| Test account | `review@womber.fr` — mot de passe affiché par `node scripts/demo/create-reviewer-account.mjs` |

## Claude — claude.ai/directory/manage → Submit new → MCP connector

**Connection** : `https://yunoapp.eu/mcp`, une seule URL pour tous.

**Listing**

- Server name (≤ 100) : `Yuno`
- One-liner (≤ 200) :

  > Ask about your nightlife business in plain words: Yuno reads your sales, VIP tables, guest lists, audience and marketing, turns them into next steps, and designs on-brand emails and signup pages.

- Description (≤ 2 000) :

  > Yuno is the nightlife platform clubs and event organizers use to sell tickets, VIP tables and guest lists, and to run their customer base and email marketing. This connector lets a Yuno pro ask Claude about their own numbers, in their own words, and get answers backed by the same figures as their Yuno Console.
  >
  > What you can ask:
  > - "How did last Saturday go compared with the previous one?" Sales by ticket tier, tables and guest list, door entries, the sales curve before the event, where buyers came from.
  > - "Is my next party selling slower than usual? What should I do this week?" Pace against comparable events and concrete actions with where to click in Yuno.
  > - "Which channel brings ticket sales? Did my last email make money?" Sources, tracked links, email and push results with attributed revenue.
  > - "How many regulars stopped coming?" Loyalty, customer segments and audience sizing.
  > - "Design the announcement email of my next party in my brand style, plus a VIP version." Claude designs it from an inspiration, the poster or a brand guide and saves it as a DRAFT, with live prices, line-up and sales links.
  > - "Make a presale signup page for my next party, like this screenshot." Claude designs the page around Yuno's sign-up form and saves it as a DRAFT; on a live page it leaves a proposal you apply or ignore.
  >
  > Private by design: the connector reads your numbers and can save email drafts and signup pages in your Yuno Console; it never sends a message, never publishes a page, never changes events, settings or customers, and never touches money. You choose which club or organization the AI can read and whether customer identities are shared (numbers only by default). It sees exactly what your role sees, every question is logged, and access can be cut in one click from Settings > AI assistants.
  >
  > Requires a Yuno pro account: club owner, manager with analytics access, or event organizer. Works with Yuno Suite and Yuno CRM accounts (signup pages need Yuno CRM).

- Categories (1 à 5) : prendre les plus proches de « Analytics », « Marketing », « Business / Sales » dans la liste du portail.
- Slug (définitif) : `yuno`

**Use cases**

- Primary use cases :
  - Post-event recap: compare an event with the previous ones and explain what changed.
  - Pre-event pacing: check whether an upcoming event sells faster or slower than usual and what to do about it.
  - Marketing performance: which channels, emails, push campaigns and promoters bring sales.
  - Audience and loyalty: size customer segments, find regulars who stopped coming, plan win-back campaigns.
  - Email design: create on-brand event emails as drafts (never sent by the AI), linked to live prices, line-up and tracked sales links.
  - Signup page design (Yuno CRM): design presale, RSVP, waiting-list or community signup pages from a description, a brand guide or an inspiration screenshot, as drafts the person publishes; edits on a live page are saved as a proposal the person applies.
- Prerequisites : a Yuno pro account (club or organizer) with access to analytics in the Yuno Console. Free to connect, no additional plan.
- Reads or writes : **Reads data, and writes email drafts and signup-page drafts only** (the person reviews, sends and publishes them from the Yuno Console; on a live page the AI only leaves a proposal).

**Company** : Yuno — https://yunoapp.eu — contact principal : toi (email pro).

**Authentication** : OAuth with dynamic client registration + client ID metadata documents (les deux sont actifs ; aucun identifiant détenu par Anthropic n'est nécessaire).

**Data handling** : API = la nôtre (first-party, même domaine que le service). Pas de données de santé. Pas de contenu sponsorisé.

**Test & launch — instructions pour les relecteurs** (à coller, en remplaçant le mot de passe) :

> 1. Add a custom connector with the URL https://yunoapp.eu/mcp.
> 2. When Claude opens the Yuno sign-in page, sign in with email + password: review@womber.fr / <PASSWORD>. There is no 2FA, no email code.
> 3. On the consent screen, click Allow: the connection covers the three demo spaces of the account (the club "Yuno", "Organisateur Démo" and "Nuits Démo", a Yuno CRM account connected to its ticketing) and allows email drafts and signup pages.
> 4. Try: "How did my last party go compared with the previous one?", "Give me 3 actions to sell more for my next event", "How many people took a VIP table and have not come back in 60 days?", "Who are my 10 best customers?", "In Nuits Démo, which of my last parties brought the most new customers?"
> 5. Roles, as in the Yuno Console: this account manages the club "Yuno" as a manager (not its owner), so in that space email-campaign results and VIP-table / guest-list detail are reserved to the owner and the connector says so in its answer; "Organisateur Démo" shows every tool with full data. Mentioning the space in a question ("in Organisateur Démo, …") avoids Claude asking which one you mean.
> 6. Email drafts: "Design the announcement email of the next Nuits Démo party for the whole base, dark and fiery, and save it as a draft." Claude calls get_email_design_kit, list_email_audiences and create_email_draft, then gives a crm.yunoapp.eu link to the draft (sign in with the same account to see it). Nothing is sent. In the club "Yuno" this account is a manager, not the owner, so drafts there are refused, as in the Console.
> 7. Signup pages: "In Nuits Démo, design a presale signup page for the next party, dark with neon pink, a free drink for the first 100, and save it." Claude calls get_signup_page_kit and create_signup_page, then gives a crm.yunoapp.eu link to the draft page; follow with "make the title bigger and add a short FAQ under the form" (get_signup_page, update_signup_page). Nothing is published: this account is a team admin, publishing stays with the account holder.
> 8. All data in this account is fictitious demo data. The account cannot send any email, push or SMS (demo safeguard). Every connection is listed, logged and revocable by the account holder in the Yuno Console (Settings > AI assistants).

Coche « j'ai testé chaque outil » seulement après l'étape 2 de ton guide.

**Compliance** (7 cases) : toutes vraies pour Yuno — directory guidelines, API first-party, aucune transaction financière (lecture + brouillons d'e-mails et de pages d'inscription, jamais d'envoi ni de publication), aucune génération d'image / vidéo / audio, descriptions sans injection de consignes (relues pour ça), aucune collecte de conversation (seuls les arguments d'outil sont journalisés, jamais la conversation ni les réponses), documentation publique (https://yunoapp.eu/ai).

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

**Test cases positifs (9)** — à jouer chacun dans ChatGPT avec le compte de test avant de soumettre :

1. *Post-event recap* — prompt : `How did my last party go compared with the previous one?` — tools : `get_account_overview`, `get_event_report`, `compare_events` — expected : a recap with tickets, tables, guest list, revenue and entries for both events, the differences in numbers, and 2-4 findings.
2. *Channel performance* — prompt : `Which channel brings me the most ticket sales over the last 3 months?` — tools : `get_sales_trends` — expected : channels and tracked links ranked by attributed sales and revenue, compared with the previous period.
3. *Audience sizing* — prompt : `How many people took a VIP table and have not come back in 60 days?` — tools : `count_contacts` — expected : the number of matching contacts and how many are reachable by email and SMS.
4. *Email results* — prompt : `Did my last email campaign make money?` — tools : `get_marketing_performance`, `get_campaign_report` — expected : delivery, open and click rates, unsubscribes and revenue attributed to the campaign (click then purchase within 72 h).
5. *Action plan* — prompt : `Give me 3 actions to sell more tickets for my next event, with where to click in Yuno.` — tools : `get_recommendations`, `search_yuno_help` — expected : three ranked actions based on the account's signals, each with the exact place in the Yuno Console and the number that will show it worked.
6. *Email draft* — prompt : `In Nuits Démo, design the announcement email of my next party for my whole base and save it as a draft.` — tools : `get_email_design_kit`, `list_email_audiences`, `create_email_draft` — expected : a draft created in the Yuno Console (link returned), with the audience size; nothing is sent.
7. *Draft changes* — prompt (after case 6) : `In that draft, remove the line-up section and add a short dress-code line under the title.` — tools : `get_email_draft`, `update_email_draft` — expected : only those sections change (the result lists what changed), Console link returned; nothing is sent.
8. *Signup page* — prompt : `In Nuits Démo, design a presale signup page for my next party, dark with neon pink, with a free drink for the first 100 sign-ups.` — tools : `get_signup_page_kit`, `create_signup_page` — expected : a draft signup page created in the Yuno Console (Console and public links returned) with the Yuno sign-up form inside; nothing is published.
9. *Page changes* — prompt (after case 8) : `Make the title bigger and add a short FAQ under the form.` — tools : `get_signup_page`, `update_signup_page` — expected : only those sections change (the result lists what changed); the page stays a draft.

**Test cases négatifs (3)** — le connecteur ne doit pas s'activer, ou doit refuser proprement :

1. `What's the weather in Paris tonight?` — no Yuno tool should run.
2. `Write me a short poem about techno music.` — no Yuno tool should run.
3. `Send an email to all my customers about Saturday.` — no tool sends anything: ChatGPT can prepare a draft and explains that sending happens in the Yuno Console (Marketing & CRM > Email).

**Demo video** (2 à 3 min, URL accessible — YouTube non répertorié par exemple) — déroulé :

1. ChatGPT web, mode développeur : Settings → Apps → Create app → `https://yunoapp.eu/mcp`, OAuth.
2. La page Yuno de connexion, puis l'écran de consentement : les espaces, le contrat (lecture, brouillons d'e-mails et pages d'inscription, rien ne part ni ne se publie sans le pro), « Allow ».
3. Les prompts positifs, l'un après l'autre (on voit les outils appelés et les réponses) ; pour le brouillon, ouvrir le lien rendu : l'e-mail est dans le Studio, marqué « Préparé par ChatGPT » ; pour la page, ouvrir le lien rendu : la page est dans Pages d'inscription, en brouillon, marquée « Préparé par ChatGPT ».
4. Un prompt négatif (`Send an email…`) : rien n'est envoyé.
5. La Console Yuno → Settings → AI assistants : la connexion, son journal, « Cut access ».

**Reviewer credentials** (champ *Review details*, jamais dans le paquet) : URL de connexion `https://yunoapp.eu/auth`, `review@womber.fr` + mot de passe, « no MFA, no email code », même consigne de consentement que pour Claude.

## Le Chat (Mistral) et Gemini

- **Le Chat** : pas d'annuaire à soumettre. Chaque utilisateur ajoute le connecteur (Intelligence → Connectors → Add connector → Custom MCP connector → l'URL). L'enregistrement dynamique est détecté tout seul.
- **Gemini** : les applis personnalisées (Settings → Connected apps → Add a custom app) s'ouvrent pays par pays ; rien à soumettre. Gemini Enterprise demande une configuration OAuth manuelle : à faire seulement si un client entreprise le demande.
