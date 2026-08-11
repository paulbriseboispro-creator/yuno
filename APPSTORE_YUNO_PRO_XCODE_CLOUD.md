# Yuno Pro — Guide Xcode Cloud (build → TestFlight → App Store)

Pas à pas pour construire l'app **Yuno Pro** (`eu.yunoapp.pro`) avec Xcode Cloud, comme
pour l'app client. Suppose que l'app client est déjà montée sur Xcode Cloud (mêmes réglages,
mêmes pièges). Rien à installer sur ton Mac : Xcode Cloud construit dans le cloud d'Apple.

> ⚠️ **Ordre** : la fiche **App Store Connect de Yuno Pro doit exister avant** de créer le
> workflow (Xcode Cloud rattache le workflow à un enregistrement d'app). Crée d'abord la
> fiche (`APPSTORE_YUNO_PRO_SUBMISSION.md`, Phase « App Store Connect »), puis reviens ici.

---

## Pré-requis (à vérifier une fois)

- [x] **Script CI Pro** présent et committé : `pro/ios/App/ci_scripts/ci_post_clone.sh`
      (fait le double `npm ci` racine + `pro/`, le build web, puis `cap sync` — sinon la
      résolution des packages SPM échoue au tout début du build).
- [x] **Scheme partagé** `App` déjà committé pour le projet Pro (`pro/ios/App/App.xcodeproj/
      xcshareddata/xcschemes/App.xcscheme`).
- [ ] **App ID** `eu.yunoapp.pro` enregistré avec les capabilities (Push, Sign in with Apple,
      Associated Domains) — voir `APPSTORE_YUNO_PRO_SUBMISSION.md`, Phase « Apple Developer ».
- [ ] **Fiche App Store Connect** de Yuno Pro créée (bundle `eu.yunoapp.pro`).

---

## Étape 1 — Ouvrir Xcode Cloud pour l'app Pro

Deux chemins possibles, prends le plus simple pour toi :

**A. Depuis App Store Connect (recommandé)**
1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps** → **Yuno Pro**.
2. Onglet **Xcode Cloud** (barre du haut) → **Set up / Create Workflow**.

**B. Depuis Xcode (sur ton Mac)**
1. Ouvre le projet Pro : `cd pro && npx cap open ios` (ou `npm run cap:open:pro`).
2. Barre latérale gauche → onglet **Report navigator** (icône ⚙️/horloge) → **Cloud** →
   **Get Started / Create Workflow**.

---

## Étape 2 — Choisir le bon dépôt, la bonne app, le bon scheme

⚠️ **Le piège n°1 du projet Pro** : les deux projets (client et Pro) ont un scheme nommé
`App` **avec le même UUID** (scaffold Capacitor). Il faut être sûr que le workflow pointe
bien sur le projet **Pro**, pas le client.

1. **Repository** : `yuno` (le même dépôt GitHub que le client).
2. **Product / App** : **Yuno Pro** (bundle `eu.yunoapp.pro`).
3. **Scheme** : `App` — mais celui du projet **`pro/ios/App/App.xcodeproj`**.
   - Vérification qui ne trompe pas : dans le résumé du workflow / l'archive produite, le
     **bundle identifier doit être `eu.yunoapp.pro`**. Si tu vois `eu.yunoapp.app`, tu es
     sur le mauvais projet — recommence en sélectionnant le projet Pro.
   - Piège « Alamofire » (vécu sur le client) : si l'assistant propose `Alamofire/Alamofire`
     comme dépôt principal, c'est qu'il ne voit pas de scheme partagé → vérifie que
     `App.xcscheme` du dossier `pro/` est bien poussé sur `main` (il l'est).

---

## Étape 3 — Déclencheur (Start Conditions)

- **Branch Changes** sur **`main`** (comme le client), ou un déclenchement manuel si tu
  préfères lancer les builds à la demande.
- Laisse les autres conditions par défaut.

---

## Étape 4 — Variables d'environnement (indispensable)

`vite build` lit les `VITE_*` **au moment du build**. Sans elles, l'app compile mais démarre
**vide / non connectée** (le code n'a aucun fallback). À mettre dans :
**Workflow → Edit → Environment → Environment Variables**.

Les **7** variables (les 6 du client + la variante Google propre au Pro) :

| Nom | Valeur |
|-----|--------|
| `VITE_SUPABASE_URL` | `https://fulawxvdlwtdlpkycixe.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | (l'anon key, comme le client) |
| `VITE_APP_BASE_URL` | `https://yunoapp.eu` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | la clé **`pk_live_…`** |
| `VITE_MAPBOX_TOKEN` | (le token Mapbox public) |
| `VITE_GOOGLE_IOS_CLIENT_ID_PRO` | le client OAuth iOS **propre à `eu.yunoapp.pro`** |
| `VITE_GOOGLE_IOS_CLIENT_ID` | (le client — présent aussi, le bundle partagé le lit) |

Deux règles apprises sur le client :
- **Valeurs SANS guillemets** (dans `.env.local` elles ont des `"` = syntaxe dotenv ; Vite
  les retire, Xcode Cloud non).
- **Ne coche PAS « Secret »** sur ces variables → le Save échoue (« invalid value »). Ces
  `VITE_*` sont publiques par conception (déjà dans le bundle livré ; anon key protégée par
  RLS, token Mapbox public). Les vrais secrets (`sk_`, `service_role`) ne sont jamais ici.

---

## Étape 5 — Action Archive → Distribution (le piège « No Builds »)

Dans l'action **Archive** du workflow, règle **Distribution Preparation** sur
**App Store Connect** (et non « None » ni « TestFlight Internal Only »).

> Piège vécu sur le client : par défaut ce réglage peut être sur **None** → le build archive
> « en vert » mais **n'arrive jamais sur TestFlight**. Après avoir changé ce réglage, il faut
> **relancer un build** (les builds antérieurs au changement ne remontent pas).

---

## Étape 6 — Lancer et surveiller

1. **Start Build**.
2. Regarde les logs. Si `ci_post_clone.sh` échoue, le build s'arrête tout au début
   (résolution SPM) — c'est le signe que le script n'a pas tourné ou qu'une dépendance
   manque. Le script attendu installe node@22, fait `npm ci` (racine), `npm run build`,
   puis `cd pro && npm ci && npx cap sync ios`.
3. Build vert → il apparaît dans **TestFlight** (onglet TestFlight de la fiche Pro) en
   quelques minutes. Installe-le sur ton iPhone pour un test réel avant de soumettre.

> Le numéro de build (`CURRENT_PROJECT_VERSION`, actuellement `1`) doit être **unique et
> croissant** à chaque soumission. Xcode Cloud peut l'incrémenter automatiquement ; sinon
> bump-le dans le projet Pro.

---

## Étape 7 — Soumettre

1. Sur la fiche **Yuno Pro** → section **Build** → attache le build remonté.
2. Remplis **App Review Information** (identifiants du compte démo + notes reviewer +
   les **QR datés** en pièce jointe) — tout est prêt dans `APPSTORE_YUNO_PRO_SUBMISSION.md`.
3. **Add for Review** → **Submit**.

---

## OTA (Capgo) — déjà branché sur l'app Pro ✅

Bonne nouvelle : le système de mises à jour Over-The-Air (comme sur l'app B2C) est **déjà
connecté et actif pour Yuno Pro**. Rien à construire.

- `pro/capacitor.config.ts` a déjà `CapacitorUpdater` (updateUrl / statsUrl / channelUrl →
  les 3 edge functions Supabase, canal `production`).
- `scripts/ota-publish.mjs` connaît l'app Pro (`APPS.pro = eu.yunoapp.pro`) et pousse les
  **deux** apps avec `--app both`. Le garde anti-downgrade lit `MARKETING_VERSION` du
  projet Pro.
- **État en base (vérifié)** : `eu.yunoapp.pro` a déjà **9 bundles OTA**, 2 canaux, un
  appareil enregistré et des stats — le canal a donc déjà servi.
- **L'`updateUrl` est bakée dans le natif Pro** par `cap sync`, exécuté à chaque build par
  le script CI de l'Étape 1. (Si un jour tu construis depuis Xcode en local, lance d'abord
  `npm run cap:sync:pro`, puis vérifie :
  `grep updateUrl pro/ios/App/App/capacitor.config.json`.)

**Pousser une mise à jour** (après le lancement, sans review App Store) — commandes existantes :

```bash
npm run ota:beta       # publie le build courant sur le canal beta (client + pro)
# … teste sur un appareil mis en beta …
npm run ota:promote    # beta → production (tout le monde, client + pro)
# ou, direct :
npm run ota:publish    # publie en production sur les deux apps
```

`npm run ota:list` / `ota:devices` / `ota:rollback` pour l'inspection et le retour arrière.
Détails complets : `docs/OTA_CAPGO.md`.

---

## Récap des pièges (tous vécus sur le client)

| Piège | Symptôme | Fix |
|-------|----------|-----|
| Mauvais projet | l'archive montre `eu.yunoapp.app` | re-sélectionner le scheme `App` du projet `pro/ios/App` |
| Alamofire comme dépôt | l'assistant ne voit pas `yuno` | scheme partagé Pro poussé sur `main` (déjà fait) |
| Variables manquantes | app vide / non connectée | mettre les 7 `VITE_*` dans le workflow |
| Case « Secret » cochée | Save échoue (« invalid value ») | ne pas cocher Secret |
| « No Builds » sur TestFlight | build vert mais absent de TestFlight | Distribution Preparation = App Store Connect, puis relancer |
| OTA muet | l'app ne se met pas à jour | `updateUrl` bakée (CI le fait) + un bundle actif (`ota:list`) |
