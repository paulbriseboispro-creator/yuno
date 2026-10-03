# Connecteur IA Yuno — ce qu'il te reste à faire

Le serveur est en ligne et fonctionne : `https://yunoapp.eu/mcp`. Il reste trois
choses que personne ne peut faire à ta place : créer le compte de relecture,
tester avec ton propre Claude, et soumettre aux annuaires (Claude, puis
ChatGPT). Compte environ 1 h 30 de ton temps, plus les délais d'examen.

Tous les textes à coller sont dans `docs/mcp-directory/SUBMISSION.md`.

## Ce qui est déjà fait

- Serveur MCP en production, clé serveur dédiée créée dans Supabase
  (`mcp_worker`, révocable seule) et posée en secret sur le Worker Cloudflare.
- Testé de bout en bout en production : connexion OAuth, consentement, les
  22 outils, l'ancienne et la nouvelle version du protocole, l'inspecteur MCP
  officiel, et une vraie conversation avec Claude
  (`docs/mcp-directory/example-answer.md`).
- Descriptions d'outils et réponses relues contre les grilles d'examen de
  Claude et d'OpenAI (aucune consigne cachée, aucun identifiant technique).
- Route de vérification de domaine OpenAI prête
  (`/.well-known/openai-apps-challenge`).
- Les 100 fonctions edge en production sont identiques à `main`
  (`owner-assistant`, `stripe-webhook`, `club-subscription`, `invite-org-member`
  étaient en retard : redéployées et revérifiées).
- Script du compte de relecture prêt, dossier de soumission prêt.

## 1. Créer le compte de relecture — 2 min

Les annuaires veulent un compte rempli, utilisable tout de suite, sans 2FA.
C'est un compte démo (données fictives, aucun envoi possible) qui voit le club
démo, l'organisation démo et le compte Yuno CRM démo (« Nuits Démo »).

```bash
node scripts/demo/create-reviewer-account.mjs
```

Le mot de passe s'affiche **une seule fois** : range-le dans ton gestionnaire.
Tu le colleras dans les deux portails.

## 2. Tester toi-même dans Claude — 10 min

Les deux portails te font cocher « j'ai testé chaque outil ».

1. Claude (web ou appli) → Paramètres → Connecteurs → « Ajouter un connecteur
   personnalisé » → nom `Yuno`, URL `https://yunoapp.eu/mcp`.
2. Clique sur « Connecter ». Connecte-toi avec `review@womber.fr` (ou ton
   propre compte pro, pour voir tes vrais chiffres).
3. Sur l'écran Yuno, coche les espaces, choisis « Chiffres + fiches clients »,
   puis « Autoriser ».
4. Dans une conversation, active Yuno dans le menu des outils, puis pose les
   5 questions de la section « Test & launch » du dossier.
5. Ouvre la Console → Paramètres (Réglages chez un organisateur) → Assistants IA : la connexion apparaît, avec son
   journal. Teste « Couper l'accès », puis reconnecte-la.

Si une réponse te paraît fausse ou faible, envoie-moi la question et la
réponse : les consignes d'analyse se règlent dans `worker/mcp/guide.ts`.

## 3. Soumettre à l'annuaire Claude — 20 min

Il te faut un abonnement Claude payant.

1. Va sur https://claude.ai/directory/manage → « Submit new » → « MCP connector ».
2. Remplis chaque étape avec la section « Claude » du dossier : Connection,
   Tools (rien à faire, ils se synchronisent et sont tous en lecture seule),
   Listing, Use cases, Company, Authentication, Data handling, Test & launch
   (avec le mot de passe de l'étape 1), Compliance (les 7 cases sont vraies).
3. Pour l'icône, prends `public/icon-1024.png`.
4. Soumets. Anthropic scanne automatiquement et liste Yuno comme connecteur
   « Community » ; un examen humain peut suivre. Le suivi se fait dans le même
   portail. En cas de blocage : mcp-review@anthropic.com.

## 4. Soumettre à ChatGPT (OpenAI) — 45 min, plus la vidéo

1. **Vérifier l'organisation.** Sur https://platform.openai.com → Settings →
   Organization → General, lance la vérification d'entreprise au nom de
   WOMBER / Yuno. Seul le propriétaire de l'organisation peut soumettre.
2. **Créer le plugin** sur https://platform.openai.com/plugins, avec un
   serveur MCP distant à l'adresse `https://yunoapp.eu/mcp`.
3. **Vérifier le domaine.** Le portail affiche un jeton. Deux façons de le
   poser :
   - tu me l'envoies (« pose ce jeton OpenAI : … ») et je le pose ;
   - ou tu le poses toi-même. La commande se lance depuis ton dossier
     personnel, pas depuis le projet (le `.env.local` du projet contient un
     jeton Cloudflare limité au DNS, que wrangler prendrait à la place) :

     ```bash
     cd ~ && printf '%s' 'COLLE_LE_JETON_ICI' | npx wrangler@4 secret put OPENAI_APPS_CHALLENGE --name yuno
     ```

   Ensuite, clique sur « Verify ». Pour vérifier avant :
   `https://yunoapp.eu/.well-known/openai-apps-challenge` doit afficher le jeton.
4. **Remplir les champs** avec le tableau « Metadata » du dossier. Le logo est
   `public/icon-1024.png`.
5. **Jouer les tests.** ChatGPT web → Paramètres → Applications → Paramètres
   avancés → mode développeur → « Créer une application » →
   `https://yunoapp.eu/mcp`, authentification OAuth, compte de relecture. Joue
   les 5 tests positifs et les 3 négatifs du dossier, et saisis-les dans le
   portail.
6. **Enregistrer la vidéo** (2 à 3 min) en suivant le déroulé du dossier, puis
   la mettre en ligne en lien non répertorié.
7. **Identifiants de relecture** : dans « Review details » uniquement, jamais
   dans le paquet.
8. **Soumettre.** La réponse arrive par email. Une fois le plugin approuvé, c'est
   toi qui cliques sur « Publish plugin ».

En attendant l'annuaire, n'importe quel client sur les offres Plus, Pro,
Business, Enterprise ou Edu peut déjà brancher Yuno via le mode développeur
(page `/ai`).

## 5. Le Chat et Gemini — rien à soumettre

- **Le Chat** : chaque client ajoute le connecteur lui-même (Intelligence →
  Connecteurs → Connecteur MCP personnalisé). Teste-le une fois si tu veux le
  citer.
- **Gemini** : les applications personnalisées ouvrent pays par pays. Rien à
  faire tant qu'aucun client ne le demande.

## 6. Le faire savoir aux clients

- La page publique : https://yunoapp.eu/ai.
- L'article « Assistants IA » du mode d'emploi est en ligne (club,
  organisateur, CRM), et l'Assistant Console sait l'expliquer.
- Pour la plaquette ou un email d'annonce : demande-le-moi quand tu veux, je ne
  les ai pas touchés.

## 7. Suivre l'adoption

Dans `/admin/ai`, section « Connecteur IA (MCP) », tu vois :

- les connexions actives et les pros connectés ;
- les analyses les plus demandées, les IA utilisées et les espaces les plus
  actifs ;
- les erreurs ;
- les coupures de sécurité (une clé réutilisée coupe la connexion
  automatiquement).

La démo est exclue par défaut, comme sur le reste du dashboard.

## À savoir

- **Gros comptes** : l'analyse « public » peut prendre 10 à 15 s sur une très
  grosse base. Le serveur relance tout seul quand le premier essai dépasse le
  délai.
- **Clé serveur** : si elle devait fuiter, révoque `mcp_worker` dans Supabase
  (Settings → API Keys), puis demande-moi d'en reposer une. Rien d'autre ne
  l'utilise.
- **Wrangler est connecté sur ton Mac** depuis aujourd'hui (connexion Cloudflare
  avec les droits Workers). Pour le déconnecter :

  ```bash
  cd ~ && npx wrangler@4 logout
  ```

- Toute la mécanique, la sécurité et la marche à suivre pour ajouter un outil
  sont dans `docs/MCP.md`.
