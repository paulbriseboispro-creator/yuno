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

## Étape 2 — Facebook Login for Business (15 min)

1. Dans le tableau de bord de l'app, « Ajouter un produit » →
   **Facebook Login for Business** (PAS « Facebook Login » classique).
2. **Paramètres** du produit :
   - **URI de redirection OAuth valides** :
     `https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/oauth/callback`
   - **URL de rappel de désautorisation** :
     `https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/deauthorize`
   - Connexion OAuth client : oui. Connexion OAuth web : oui.
   - Enregistre.
3. **Configurations → Créer une configuration** :
   - Nom : `Yuno — connexion club / organisateur`
   - Type de jeton : **Utilisateur système d'intégration d'entreprise**
     (« Business Integration System User ») — c'est le jeton qui n'expire
     pas. Le code gère aussi le repli jeton utilisateur 60 jours pour les
     pros sans Business Manager.
   - Expiration du jeton : **Jamais**.
   - Actifs à demander : **Comptes publicitaires**, **Pages**, **Pixels /
     jeux de données**, **Comptes Instagram** (facultatif).
   - Permissions : `ads_read`, `ads_management`, `business_management`,
     `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`,
     `pages_manage_ads`, `leads_retrieval`, `instagram_basic`.
     (Pour la phase 1+2 seules, `ads_read` + `business_management` +
     `pages_read_engagement` suffisent ; demande tout maintenant pour ne pas
     refaire une App Review aux phases 3-4.)
   - Enregistre, puis copie l'**ID de configuration** → `META_LOGIN_CONFIG_ID`.
4. Ajoute-toi comme **testeur** (Rôles de l'app → Testeurs) : en mode
   Développement, seuls les comptes avec un rôle peuvent se connecter — c'est
   ce qui te permet de tester avant l'App Review.

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

## Étape 7 — App Review (5 à 20 jours ouvrés par cycle)

Tant que l'app est en mode **Développement**, seuls les testeurs peuvent
se connecter. Pour les clubs, il faut :

1. **Access Verification** (« Vérification d'accès », dossier « tech
   provider ») : App Dashboard → Vérification de l'accès. Décris que Yuno
   traite des données d'autres entreprises (clubs, organisateurs) pour
   envoyer leurs conversions à leur pixel. ~5 jours.
2. **App Review** : Dashboard → Révision de l'app → Permissions et
   fonctionnalités → demander **l'accès avancé** pour chaque permission de
   l'étape 2. Pour chacune : un texte d'usage précis (pas générique) et
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
| 402 au déploiement | cap de fonctions | étape 5 |

Toutes les règles de code sont dans `CLAUDE.md` (section « Meta ») et le
détail d'architecture dans `docs/designs/META_ADS_INTEGRATION_PLAN.md`.
