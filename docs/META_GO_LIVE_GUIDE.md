# Meta — guide de mise en service de la connexion en un clic

> Pour Paul. Tout le code est écrit et poussé (voir « Ce qui est déjà fait »).
> Ce guide liste, dans l'ordre, ce que TOI seul peux faire : les démarches
> côté Meta, les secrets à poser, les deux commandes à lancer, et le test de
> bout en bout avant d'allumer l'interrupteur pour les clubs.
> Tant que la dernière étape n'est pas faite, les pros voient la carte Meta
> « En construction » (badge « Bientôt » dans la sidebar) et ne peuvent rien
> y faire. Toi, tu testes tout depuis `/admin/system` (carte Meta de Yuno).

---

## Ce qui est déjà fait (rien à refaire)

| Brique | Où | État |
|---|---|---|
| Tables + Vault + RPC (phase 1) | migration `20260914120000` | **en prod** |
| Colonnes OAuth, statut « choix du pixel », rappels Meta | migration `20260914150000` | **en prod** |
| Envoi serveur des achats / leads (Conversions API) | `_shared/meta-capi.ts`, `verify-*`, `create-*` | **en prod** |
| Pixel navigateur, CMP v2, pages Intégrations, textes légaux, mode d'emploi | front | **en prod** (carte « En construction ») |
| Edge `meta-connect` : un clic (OAuth), manuel, santé, rappels Meta | `supabase/functions/meta-connect` | **codée, PAS déployée** (cap 402, voir étape 5) |
| Publicité (campagnes, audiences, jumeaux), leads (webhook), résultats | migration `20260915100000`, `_shared/meta-ads.ts`, page `/owner/ads` et `/organizer-app/ads`, bouton « Booster » | **codé**, à tester (étape 6 bis) |
| Interrupteur pros | `src/lib/metaIntegration.ts` → `META_INTEGRATION_LIVE = false` | à flipper à l'étape 8 |

Le parcours pro, une fois live : Réglages → Intégrations → « Connecter avec
Facebook » → fenêtre Meta (choix de l'entreprise, des actifs) → retour sur
Yuno → si un seul pixel, c'est fini ; sinon il le choisit dans une liste.
Rien à coller. Le « mode avancé » (Pixel ID + jeton) reste replié en dessous.

---

## Étape 1 — Créer l'app Meta (30 min)

1. Va sur https://developers.facebook.com/apps/ avec le compte Facebook qui
   est **administrateur du Business Manager de Yuno** (si Yuno n'a pas de
   Business Manager : https://business.facebook.com → « Créer un compte »,
   nom « Yuno », site yunoapp.eu).
2. « Créer une app » → cas d'usage **« Autre »** → type **« Entreprise »**
   (Business). Nom : `Yuno`. Email de contact : ton email pro. Portefeuille
   d'entreprise : celui de Yuno.
3. Dans **Paramètres de l'app → Général**, note :
   - **ID de l'app** → ce sera `META_APP_ID`
   - **Clé secrète** (« Afficher ») → `META_APP_SECRET` — ne la colle nulle
     part ailleurs que dans les secrets Supabase (étape 4).
   Et remplis :
   - **Domaines de l'app** : `yunoapp.eu`
   - **URL de la politique de confidentialité** : `https://yunoapp.eu/legal/confidentialite`
   - **URL des conditions d'utilisation** : `https://yunoapp.eu/legal/cgu`
   - **URL de rappel de suppression des données utilisateur** :
     `https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/data-deletion`
     (l'edge répond au `signed_request` de Meta et efface les connexions du
     compte : c'est un motif de rejet classique quand il manque)
   - **Icône** (1024×1024, l'icône de l'app Yuno) et **Catégorie** : « Entreprise et pages ».
   - Enregistre.
4. **Paramètres → Avancé → Sécurité** : active **« Exiger la preuve du secret
   de l'app pour les appels serveur »** (le code envoie `appsecret_proof`
   sur chaque appel). Enregistre.

## Étape 2 — Cas d'usage, produit Facebook Login for Business, configuration (30 min)

Le tableau de bord Meta est organisé par **cas d'usage** : chacun pré-sélectionne
un paquet de permissions. On en ajoute trois, et dans chacun on ne garde QUE
les permissions listées ci-dessous. Chaque permission en trop est une vidéo de
plus à fournir à l'App Review et une raison de rejet en plus.

### 2.1 Choisir les cas d'usage (à la création de l'app)

À la création, Meta demande de cocher des **cas d'usage** ; chacun
pré-sélectionne un paquet de permissions. Facebook Login for Business n'est
PAS dans cette liste : il est ajouté automatiquement dès qu'un cas d'usage
« entreprise » est coché, et ses réglages apparaissent après la création
(2.2). Le « Authenticate and request data from users with Facebook Login »
grisé est le Login classique grand public, incompatible : c'est normal.

| Cas d'usage | On le coche ? | Pourquoi |
|---|---|---|
| **Create & manage ads with Marketing API** | **Oui** | `ads_read`, `ads_management`, `business_management` ; audiences et campagnes (phases 3-4) |
| **Measure ad performance data with Marketing API** | **Oui** | c'est celui de la Conversions API, des audiences personnalisées et de la qualité du dataset : le cœur de ce que Yuno fait en premier |
| **Capture & manage ad leads with Marketing API** | **Oui** | `leads_retrieval` (Lead Ads, phase 4) |
| **Manage everything on your Page** | **Oui** | `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads` |
| Manage messaging & content on Instagram | **Optionnel** | uniquement pour `instagram_basic` : afficher les pubs « Booster » (phase 4) sous le compte Instagram du club plutôt que sa Page Facebook. À ne cocher que si Personnaliser permet de ne garder QUE `instagram_basic` (retirer toute la messagerie et le contenu, les permissions les plus scrutées). Sinon, seconde App Review en phase 4. |
| Other / Create an app without a use case | **Non** | ancienne expérience, en voie de disparition |

Puis **Next**, type **Entreprise**, portefeuille d'entreprise de Yuno.

### 2.1 bis Élaguer les permissions (après création)

Tableau de bord → **Cas d'usage** → sur chaque cas, **Personnaliser** : la
liste des permissions apportées s'affiche, avec « Ajouter » / « Retirer ».
Ne garde que celles-ci ; chaque permission en trop est une vidéo de plus à
fournir à l'App Review et une raison de rejet en plus.

| Cas d'usage | Permissions à GARDER | À retirer |
|---|---|---|
| Create & manage ads / Measure ad performance | `ads_read`, `ads_management`, `business_management` | le reste |
| Manage everything on your Page | `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads` | `pages_manage_posts`, `pages_messaging`, `pages_manage_engagement`, `pages_read_user_content` (publication, messagerie, contenu) |
| Capture & manage ad leads | `leads_retrieval` | le reste |
| Instagram (si coché) | `instagram_basic` | tout le reste (`instagram_manage_messages`, `instagram_content_publish`, `instagram_manage_comments`…) |

Pourquoi tout demander maintenant alors que la connexion en un clic n'a
besoin que de `ads_read` + `business_management` + `pages_read_engagement` :
les audiences (phase 3) et Lead Ads / « Booster » (phase 4) exigent
`ads_management` et `leads_retrieval`, et une App Review se fait par lot.
Si tu préfères un premier dossier plus court, ne garde que
`ads_read` + `business_management` + `pages_show_list` +
`pages_read_engagement` ; le reste passera dans un second dossier.

Ce que chaque permission fait dans Yuno (à réutiliser tel quel dans les
textes de l'App Review) :

- `public_profile` et la fonctionnalité **Marketing API Access Tier** sont
  ajoutés d'office : on les laisse, ils ne demandent rien.

- `ads_read` : lire la qualité du dataset et, plus tard, la dépense et les
  résultats des campagnes pour les afficher au pro.
- `business_management` : lister les pixels, comptes publicitaires et Pages
  du portefeuille du pro pour qu'il choisisse ceux à connecter.
- `ads_management` : créer les audiences personnalisées à partir des
  contacts consentants du pro, et créer des campagnes en pause qu'il active.
- `pages_show_list`, `pages_read_engagement` : identifier la Page du pro et
  la proposer à la connexion.
- `pages_manage_metadata` : abonner la Page au webhook `leadgen`.
- `pages_manage_ads`, `leads_retrieval` : recevoir et lire les formulaires
  Lead Ads remplis sur les pubs du pro pour les verser dans sa base de contacts.
- `instagram_basic` (optionnel) : retrouver le compte Instagram lié à la Page
  pour que les campagnes créées par Yuno s'affichent sous le nom Instagram
  du club.

### 2.2 Régler Facebook Login for Business

Il est déjà là : **Cas d'usage → Personnaliser** (sur un cas Marketing API)
→ onglet **Paramètres**, section « Facebook Login for Business » ; ou dans
le menu de gauche **Facebook Login for Business → Paramètres**. Si vraiment
il n'apparaît nulle part : « Ajouter un produit » → Facebook Login for
Business (bien « for Business », PAS le Facebook Login classique).

**Paramètres** :

- **URI de redirection OAuth valides** (copie exacte, `https`, sans `/` final) :
  `https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/oauth/callback`
- **URL de rappel de désautorisation** :
  `https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/deauthorize`
- **Connexion OAuth client** : oui. **Connexion OAuth web** : oui.
  **Connexion OAuth intégrée au navigateur** (webview) : **non** — la
  connexion part toujours d'un vrai navigateur (dans l'app Pro, Safari).
- **Appliquer HTTPS** : oui. **Mode strict pour les URI** : oui. Login
  depuis un appareil, SDK JavaScript, domaines du SDK : non / vide.
  Le champ « Check URI » avec example.com en haut est un testeur, sans
  effet. Enregistre.

### 2.3 Créer la configuration de connexion

Facebook Login for Business → **Configurations** → « Créer une configuration » :

- **Nom** : `Yuno — connexion club / organisateur`
- **Type de jeton d'accès** : **Utilisateur système d'intégration
  d'entreprise** (« Business Integration System User »). C'est le jeton qui
  n'expire pas et qui est rattaché à l'entreprise du pro, pas à sa personne.
  Le code sait aussi recevoir un jeton utilisateur (60 jours) si le pro n'a
  pas de portefeuille d'entreprise ; Meta le propose alors de lui-même.
- **Expiration du jeton** : **Jamais**.
- **Actifs** demandés : **Comptes publicitaires**, **Pages**, **Pixels /
  jeux de données**. (Instagram : non coché.)
- **Permissions** : exactement celles de la colonne « à garder » du tableau 2.1 bis,
  soit `ads_read`, `ads_management`, `business_management`,
  `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`,
  `pages_manage_ads`, `leads_retrieval`. Meta ne propose ici que les
  permissions apportées par tes cas d'usage : si une manque, retourne à 2.1 bis.
- Enregistre, puis copie l'**ID de configuration** (un nombre) →
  ce sera `META_LOGIN_CONFIG_ID` (étape 4).

Une deuxième configuration, plus petite, peut servir plus tard aux clubs qui
ne veulent que le tracking (`ads_read` + `business_management` +
`pages_read_engagement`) ; le code en accepte une seule pour l'instant, on
verra selon les retours.

### 2.4 Rôles de test

**Rôles de l'app → Testeurs** : ajoute ton compte Facebook (celui qui
administre le Business Manager de Yuno) et, si tu veux tester avec un vrai
club avant l'App Review, le compte Facebook de ce club. En mode
Développement, seuls les comptes ayant un rôle peuvent passer la fenêtre
Meta ; les autres voient « L'app n'est pas disponible ».

### 2.5 Vérifier depuis Yuno

Une fois les secrets posés (étape 4) et la fonction déployée (étape 5), le
bouton « Vérifier maintenant » de la carte Meta affiche les permissions
réellement accordées par la fenêtre. Si `ads_read`, `business_management`
ou `pages_read_engagement` manquent (le pro les a décochées), la carte le
dit en clair et propose de reconnecter.

## Étape 3 — Meta Business Verification (1 à 3 jours, à lancer tout de suite)

Business Manager de Yuno → **Paramètres → Centre de sécurité → Vérification
de l'entreprise**. Il faut : Kbis / extrait SIRENE de la société, l'adresse,
un justificatif au nom de l'entreprise, et le domaine `yunoapp.eu` vérifié
(Business Manager → Sécurité de la marque → Domaines → ajouter `yunoapp.eu`
→ méthode « balise meta » : donne-moi la balise, je la pose dans
`index.html`, ou méthode DNS TXT dans Cloudflare).

Sans cette vérification, aucune permission avancée n'est accordée.

## Étape 4 — Poser les secrets Supabase (2 min)

```bash
cd /Users/paul/Desktop/yuno-app.nosync
supabase secrets set META_APP_ID="<id de l'app>" META_APP_SECRET="<clé secrète>" META_LOGIN_CONFIG_ID="<id de configuration>"
```

Ne les mets jamais dans `.env`, dans le front ni dans un commit. Sans ces
trois secrets, l'edge répond `oauth_not_configured` et la carte ne propose
que le mode avancé.

## Étape 5 — Déployer `meta-connect` (2 min)

Le projet a atteint le maximum de fonctions edge (402). La fonction
`bulk-notify-waitlist` est morte (aucun appelant dans le code, aucune autre
fonction ne l'appelle, aucun cron, aucune réponse HTTP sur 30 jours) :

```bash
supabase functions delete bulk-notify-waitlist
supabase functions deploy meta-connect
```

Son code reste dans le repo ; ne la redéploie pas, elle reprendrait le slot.
Puis vérifie que l'URL de rappel répond (Meta l'appelle sans JWT) :

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/oauth/callback?state=x"
```

Attendu : `302` (redirection vers yunoapp.eu avec `meta=error&reason=state_invalid`).

## Étape 6 — Tester le bout en bout avec le pixel de Yuno (20 min)

Tout se fait depuis `/admin/system`, carte Meta (portée plateforme, active
même quand les pros voient « En construction »).

**Règle Meta à connaître avant de cliquer** : l'entreprise qui POSSÈDE l'app
ne peut pas s'y connecter par la fenêtre « Connecter avec Facebook » (le
portefeuille « Yuno » apparaît grisé avec la mention « owns the app »). Ça ne
concerne que nous. Conséquences :

- pour TESTER le parcours d'un club, choisis « Create a business portfolio »
  dans la fenêtre : Meta crée un portefeuille de test (« Yuno test ») et un
  pixel neuf, exactement comme pour un petit club sans portefeuille ;
- pour le VRAI pixel de Yuno (portefeuille principal, acquisition Yuno), passe
  par le « Mode avancé » de la carte : Pixel ID + jeton généré dans Events
  Manager du portefeuille Yuno. C'est le seul chemin possible pour le
  propriétaire de l'app, et il fait la même chose.

1. Dans le Business Manager de Yuno, crée un jeu de données « Yuno — test »
   (Events Manager → Connecter des sources de données → Web, sans installer
   de code).
2. Sur `/admin/system` → carte Meta → **« Connecter avec Facebook »**. La
   fenêtre Meta s'ouvre (tu es testeur de l'app) : choisis le Business
   Manager de Yuno, accorde les actifs. Retour sur `/admin/system?meta=…`.
   - `meta=connected` : un seul pixel, connexion active.
   - `meta=choose` : plusieurs pixels, choisis « Yuno — test » puis Confirmer.
   - `meta=error&reason=…` : la raison est celle renvoyée par Meta (le plus
     fréquent : URI de redirection pas exactement identique à l'étape 2).
3. **Vérifier maintenant** (santé) : `is_valid: true`, les scopes accordés.
4. **Envoyer un événement de test** avec le code de l'onglet « Événements de
   test » d'Events Manager : il doit y apparaître en quelques secondes.
5. Sur yunoapp.eu en navigation privée : accepter « Publicité (Meta) » dans
   le bandeau, ouvrir une soirée depuis un lien `…?fbclid=test123`, acheter
   un billet de test. Dans Events Manager : ViewContent, InitiateCheckout
   puis **un seul Purchase** (reçu du navigateur ET du serveur, dédoublonné),
   avec le montant. Dans la carte : « Envoyés 7 j » = 3, taux de
   consentement > 0.
6. Refuser la publicité dans le bandeau, refaire un achat : rien dans
   Events Manager, mais une ligne dans `meta_consent_log` avec
   `consent_marketing = false`. C'est la preuve qui protège les clubs.
7. **Déconnecter** : la carte revient à vide, et l'app Yuno disparaît de
   Business Manager → Intégrations → Apps connectées.

Si tout passe, le système est bon. Reconnecte le pixel de Yuno (étape 2 du
test) pour qu'il reste actif : c'est aussi notre propre acquisition, et il
génère les appels API nécessaires à l'étape 7.

## Étape 6 bis — Publicité, audiences, leads (phases 3-4, même app)

Tout est codé et se règle dans la même app Meta. Trois réglages en plus :

1. **Webhook Lead Ads : rien à faire.** L'app s'abonne elle-même au champ
   `leadgen` de l'objet Page par l'API (jeton d'app), à chaque passage du cron
   et à chaque « Vérifier maintenant » de la carte Meta de `/admin/system`
   (ligne `app_webhook.registered` dans la santé). Pour le voir côté Meta :
   App Dashboard → Webhooks → objet Page → `leadgen` coché, URL
   `…/functions/v1/meta-connect/webhook`. Si tu devais le refaire à la main,
   le jeton de vérification se calcule avec
   `node -e "const c=require('crypto');console.log(c.createHash('sha256').update('yuno-meta-webhook:'+process.argv[1]).digest('hex').slice(0,32))" "<META_APP_SECRET>"`.
   Ensuite chaque club clique « Activer la réception » dans sa page Publicité
   (abonne SA Page) ; la fonction vérifie la signature `X-Hub-Signature-256`
   de chaque envoi et verse les leads dans `meta_leads` puis dans la base de
   contacts du club.
2. **Conditions d'usage des audiences** : par compte publicitaire, un humain
   doit les accepter une fois (`business.facebook.com/ads/manage/customaudiences/tos/?act=…`).
   La page Publicité affiche le lien tant que ce n'est pas fait ; sans ça,
   la création d'audience répond `custom_audience_tos`.
3. **Marketing API « Full Access »** (étape 7.3) : sans lui, la création de
   campagnes et d'audiences répond avec une erreur de permission / de
   limite. Le palier Limited suffit pour tester sur ton propre compte pub.

Test de bout en bout depuis un compte de club testeur (l'app en mode
Développement suffit) : page Publicité → « Vérifier le compte » (devise,
moyen de paiement, CGU) → Audiences → « Acheteurs 12 mois » → Envoyer à Meta
(statut « prête », taille) → « Booster une soirée » → Créer en pause →
la campagne apparaît en pause dans Ads Manager avec l'affiche → Activer →
« en validation Meta » → après validation, « Rafraîchir » ramène dépense et
impressions ; un achat via le lien copié apparaît en « Ventes Yuno ».

## Étape 7 — App Review (5 à 20 jours ouvrés par cycle)

Tant que l'app est en mode **Développement**, seuls les testeurs peuvent
se connecter. Pour les clubs, il faut :

1. **Access Verification** (« Vérification d'accès », dossier « tech
   provider ») : App Dashboard → Vérification de l'accès. Décris que Yuno
   traite des données d'autres entreprises (clubs, organisateurs) pour
   envoyer leurs conversions à leur pixel. ~5 jours.
2. **App Review** : Dashboard → Révision de l'app → Permissions et
   fonctionnalités → demander **l'accès avancé** pour chacune des huit
   permissions de l'étape 2.1. **Plan de tournage détaillé, une vidéo par
   permission, textes d'usage et instructions pour le reviewer :
   `docs/META_APP_REVIEW_VIDEOS.md`.** Les comptes démo (`@womber.fr`) et le
   super admin voient les vraies pages Meta même en « En construction » :
   c'est avec eux qu'on filme et que le reviewer teste. Pour chacune : un texte d'usage précis (pas générique) et
   **une vidéo par permission** montrant : connexion sur yunoapp.eu →
   Réglages → Intégrations → Connecter avec Facebook → fenêtre Meta → retour
   → ce que le club obtient (carte santé, événements dans Events Manager).
   Fournis un **compte de test** utilisable par le reviewer : le club démo
   `womber` (identifiants dans le secret `DEMO_LOGIN_PASSWORD`), rattaché à
   un Business Manager démo avec un pixel de test.
   Rejets fréquents : vidéo commune à plusieurs permissions, texte
   générique, URL de suppression absente (déjà posée), reviewer qui ne peut
   pas reproduire.
3. **Marketing API → niveau « Full Access »** (pour les phases 3-4 : audiences,
   campagnes). Éligible après **500 appels API sur 15 jours** avec moins de
   15 % d'erreurs : le pixel Yuno connecté + le bouton « Vérifier
   maintenant » quotidien y suffisent en deux semaines. Pas de vidéo exigée
   depuis mai 2026.
4. Une fois l'accès avancé accordé : **Paramètres → Général → Mode de
   l'app : Live**.

## Étape 8 — Allumer pour les clubs (5 min)

```bash
# src/lib/metaIntegration.ts
export const META_INTEGRATION_LIVE = true;
```

Commit + push : Workers Build déploie. La sidebar perd le badge « Bientôt »,
la carte propose « Connecter avec Facebook » aux clubs et organisateurs.
Puis, pour l'app native : `npm run ota:beta` → test → `npm run ota:promote`
(le bandeau cookies est web-only, mais les pages pro de l'app suivent).

Annonce aux pros : le mode d'emploi (Réglages → Aide → « Meta ») et
l'assistant IA owner connaissent déjà la feature.

---

## En cas de problème

| Symptôme | Cause probable | Fix |
|---|---|---|
| Bouton renvoie « pas encore activée » | secrets absents | étape 4 |
| Fenêtre Meta : « URI de redirection invalide » | l'URI de l'étape 2 diffère d'un caractère | recopier exactement, `https`, sans `/` final |
| Fenêtre Meta : « L'app n'est pas disponible » | app en Développement et compte pas testeur | étape 2.4 ou étape 7.4 |
| Retour `meta=error&reason=discover_failed` | jeton sans `business_management` / actifs non partagés | vérifier les actifs cochés dans la fenêtre Meta |
| `meta=choose` sans pixel dans la liste | l'entreprise n'a pas de jeu de données | Events Manager → Connecter des sources de données → Web |
| « Jeton refusé » après quelques semaines | jeton utilisateur 60 j (pro sans Business Manager) | « Reconnecter avec Facebook » ; la notif part 7 j avant |
| « Domaine non vérifié » dans Events Manager | les ventes sont sur yunoapp.eu | normal ; le pro peut ajouter yunoapp.eu à ses domaines |
| Fenêtre Meta : formulaire e-mail + mot de passe, le pro n'en a pas | compte professionnel Meta créé DEPUIS Instagram (pas de compte Facebook) | ouvrir `business.facebook.com` → « Continuer avec Instagram », puis revenir cliquer sur « Connecter avec Facebook » : la session vaut pour tout `.facebook.com`, le dialogue passe directement à l'autorisation. Le rappel est affiché sous le bouton dans la carte Meta (`integ.meta.igLogin.*`). |
| 402 au déploiement | cap de fonctions | étape 5 |

### Pourquoi pas « Business Login for Instagram » ?

`instagram.com/oauth/authorize` existe, mais ses seules permissions sont
`instagram_business_basic`, `instagram_business_content_publish`,
`instagram_business_manage_messages` et `instagram_business_manage_comments` :
messages et contenus, jamais `ads_management`, jamais le pixel ni l'API
Conversions. Ce n'est donc pas une alternative à Facebook Login for Business
pour Yuno, et il ne faut pas le proposer comme porte d'entrée : il ne
brancherait rien. Le seul chemin pour un pro sans compte Facebook est
d'ouvrir sa session Meta avec Instagram (Business Suite), puis de passer par
le dialogue habituel.

Toutes les règles de code sont dans `CLAUDE.md` (section « Meta ») et le
détail d'architecture dans `docs/designs/META_ADS_INTEGRATION_PLAN.md`.
