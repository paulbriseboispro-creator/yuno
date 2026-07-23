# App iOS — configuration console restante (chantier « 19 corrections » 2026-07-10)

Tout le code des 19 corrections est commité et build-vert. Ce doc liste ce qui
ne peut PAS se faire depuis le code : consoles Apple/Google/Supabase, déploiement
des edge functions, et le rebuild Xcode.

## ✅ État au 2026-07-11 (déploiement fait)

- Migrations appliquées (`supabase db push`) : push_automations, event_ai_reports,
  pgvector « Pour toi », venue_ai_actions, push_campaigns i18n, hype_baseline staff
  (+ night_ops_events et drinks_out_of_stock de la session parallèle).
- Edge déployées : mfa, send-push-campaign, yuno-assistant, owner-assistant,
  process-scheduled-campaigns, translate-text.
- Front : poussé sur main → build Cloudflare Workers.
- Supabase Auth : Apple OK (client eu.yunoapp.app) ; Google
  `external_google_client_id` = « client_web,client_iOS » (liste — ne pas écraser).
  ⚠️ **La virgule a sauté depuis** : au 2026-07-23 la valeur live est
  `<client_web><client_iOS>` collés, donc Google reçoit un client_id inexistant et
  répond `401 invalid_client` sur yunoapp.eu. Voir §3 bis.
- Info.plist : URL scheme Google inversé ajouté ; `VITE_GOOGLE_IOS_CLIENT_ID`
  dans .env.local (build local de l'app).
- **RESTE** : rebuild Xcode (§1) + secrets VAPID (§5 — commande prête ci-dessous,
  refusée en mode auto).

## 1. Rebuild Xcode (obligatoire — plugins natifs ajoutés)

```bash
npm run cap:sync        # déjà fait, à refaire après tout npm install
npx cap open ios        # puis Build sur device
```

Nouveaux plugins câblés dans `ios/App/CapApp-SPM/Package.swift` :
`@capacitor/share`, `@capacitor/filesystem`, `@capacitor/geolocation`,
`@ebarooni/capacitor-calendar`, `@capgo/capacitor-social-login`.

Dans Xcode → target App → Signing & Capabilities, vérifier que la capability
**Sign In with Apple** apparaît (l'entitlement `com.apple.developer.applesignin`
est déjà dans `App.entitlements` ; Xcode doit régénérer le provisioning profile).

## 2. Sign in with Apple (item 6)

- **Apple Developer** : App ID `eu.yunoapp.app` → activer « Sign In with Apple »
  (le provisioning se met à jour au build).
- **Supabase Dashboard** → Authentication → Providers → Apple :
  - Enable.
  - `Client IDs` (authorized) : ajouter **`eu.yunoapp.app`** (le bundle id — c'est
    lui que porte l'identity token natif).

### 2 bis. Apple web (bouton « Continuer avec Apple » sur yunoapp.eu)

Le bouton web est actif dans `Auth.tsx` depuis 2026-07-23, mais il ne peut pas
fonctionner tant que le provider Apple n'a pas de **secret OAuth** : `/auth/v1/authorize?provider=apple`
répond aujourd'hui `400 {"error_code":"validation_failed","msg":"Unsupported provider: missing OAuth secret"}`,
et comme `signInWithOAuth` navigue la page sans requête préalable, l'utilisateur
atterrirait sur ce JSON. **Faire la config ci-dessous AVANT de déployer le front.**

1. **Apple Developer → Identifiers → Services IDs** : créer `eu.yunoapp.web`
   (description libre), cocher « Sign In with Apple » → Configure :
   - Primary App ID : `eu.yunoapp.app`
   - Domains and Subdomains : `fulawxvdlwtdlpkycixe.supabase.co`
   - Return URLs : `https://fulawxvdlwtdlpkycixe.supabase.co/auth/v1/callback`

   Le domaine est celui de **Supabase**, pas `yunoapp.eu` : c'est Supabase qui
   reçoit le callback puis redirige vers `https://yunoapp.eu/auth`.

2. **Apple Developer → Keys** : créer une clé « Sign In with Apple » → télécharger
   le `AuthKey_XXXXXXXXXX.p8` (téléchargeable une seule fois). Noter le **Key ID**
   et le **Team ID** (coin haut-droit de la console).

3. **Supabase → Authentication → Providers → Apple** :
   - `Client IDs` : **`eu.yunoapp.web,eu.yunoapp.app,eu.yunoapp.pro`** — le
     Services ID en PREMIER. Supabase prend `ClientID[0]` pour le flux web
     `signInWithOAuth`, alors que `signInWithIdToken` (natif) accepte n'importe
     quelle entrée de la liste comme audience. Si un bundle id passe devant, le
     natif continue de marcher et le web se fait rejeter par Apple.
   - `Secret Key (for OAuth)` : générer via l'outil du dashboard (Team ID + Key ID
     + contenu du `.p8`).

4. **Apple impose de régénérer ce secret tous les 6 mois** — sinon le bouton web
   casse du jour au lendemain. Prochaine échéance à noter au moment de la création.

Vérification une fois configuré (doit renvoyer un `location:` vers `appleid.apple.com`) :

```bash
curl -sS -o /dev/null -D - \
  "https://fulawxvdlwtdlpkycixe.supabase.co/auth/v1/authorize?provider=apple&redirect_to=https%3A%2F%2Fyunoapp.eu%2Fauth" \
  | grep -i '^location'
```

## 3. Google Sign-In natif (item 6)

- **Google Cloud Console** → APIs & Services → Credentials → Create OAuth client ID
  → type **iOS**, bundle id `eu.yunoapp.app` → récupérer le client id
  (`xxxx.apps.googleusercontent.com`).
- `.env.local` + variables de build : `VITE_GOOGLE_IOS_CLIENT_ID=<client id iOS>`.
  Sans cette variable, le bouton Google reste en « SOON » dans l'app (voulu).
- **Info.plist** : ajouter l'URL scheme INVERSÉ du client iOS
  (`com.googleusercontent.apps.xxxx`) dans `CFBundleURLTypes`.
- **Supabase Dashboard** → Providers → Google : ajouter le client id iOS dans
  « Authorized Client IDs » (en plus du client web existant).

### 3 bis. Panne « Accès bloqué / 401 invalid_client » sur yunoapp.eu (2026-07-23)

Symptôme : « Continuer avec Google » sur le web renvoie vers
`accounts.google.com/signin/oauth/error` → « The OAuth client was not found.
Erreur 401 : invalid_client ».

Cause : les client IDs du provider Google Supabase ont été saisis **sans virgule**.
Le champ est une LISTE ; collés, les deux ids ne forment qu'une seule chaîne que
Google ne connaît pas. Constat direct :

```bash
curl -sS -o /dev/null -D - \
  "https://fulawxvdlwtdlpkycixe.supabase.co/auth/v1/authorize?provider=google" \
  | grep -i '^location'
# → client_id=909249484986-fumq7…googleusercontent.com909249484986-9q4p8…googleusercontent.com
#                                                     ↑ virgule manquante
```

Correctif — **Supabase → Authentication → Providers → Google → `Client IDs`**,
remettre la liste séparée par des virgules, **client web en premier** (c'est
`ClientID[0]` qui sert au flux redirect web ; les suivants ne sont que des
audiences acceptées pour `signInWithIdToken`) :

```
909249484986-fumq7eg2fccjepekqm9fie27sg5ds853.apps.googleusercontent.com,909249484986-9q4p8vbsqaq5mbhbl2efr8859bac0147.apps.googleusercontent.com,909249484986-bsp4od93uuus00atpcq7gsctoqrj5tpl.apps.googleusercontent.com
```

Dans l'ordre : client **web**, client **iOS app client** (`eu.yunoapp.app`,
= `VITE_GOOGLE_IOS_CLIENT_ID`), client **iOS app Pro** (`eu.yunoapp.pro`,
= `VITE_GOOGLE_IOS_CLIENT_ID_PRO`). Ce dernier était absent de la liste : le
Google natif de l'app Pro échouait donc aussi, sur une audience non reconnue.

Vérification : rejouer le `curl` ci-dessus, le `client_id=` doit s'arrêter au
premier `.apps.googleusercontent.com`.

## 4. Edge functions à redéployer (fonctions EXISTANTES — pas de blocage 402)

```bash
supabase functions deploy mfa                  # action web-handoff (item 8)
supabase functions deploy send-push-campaign   # segmentation RFM/manager/pagination (item 1)
supabase functions deploy yuno-assistant       # pertinence genre + KB app iOS (item 16)
```

⚠️ Vérifier avant deploy que le code local de ces 3 fonctions ne dépend d'aucune
migration retenue d'un autre chantier (au 2026-07-10 : aucun des 3 diffs n'ajoute
de dépendance DB — web-handoff n'utilise que `security_logs` et l'admin API).

## 5. Push (items 1, 5 et 9) — état réel constaté en prod

`push_subscriptions` est **VIDE (0 lignes)** au 2026-07-10 : personne n'a de
token. C'est LA cause commune du « Portée : … / 0 » owner ET des push super
admin jamais délivrés. Deux trous corrigés côté code :

- permission accordée AVANT login → le token n'était jamais stocké. L'app
  s'auto-répare maintenant à chaque ouverture (permission accordée + user
  connecté → re-register + upsert du token).
- premier lancement natif : dialogue de permission APPLE directement (plus de
  carte custom PWA).

**Stratégie app-first (décision 2026-07-11) : le web push est ABANDONNÉ.**
Les notifications (auto + manuelles owner, super admin, line-up DJ) ciblent
uniquement les utilisateurs de l'app iOS :

- `send-push-campaign` : audiences = abonnés `platform='ios'` uniquement
  (jamais 'web', jamais 'ios_pro' staff) ; le param `platform` est déprécié.
- `send-push-notification` : les clés VAPID sont optionnelles et ne bloquent
  plus les envois APNs ; les lignes 'web' héritées sont ignorées partout.
- Front : plus aucun prompt/toggle push sur web ou PWA (`usePushNotifications`
  → isSupported=false hors natif) ; le sélecteur de plateforme de
  /admin/push a été retiré.

Secrets vérifiés au 2026-07-11 : `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_P8`,
`APNS_TOPIC`, `APNS_TOPIC_PRO` présents — la chaîne iOS est complète, rien à
configurer. `aps-environment` est en `development` dans App.entitlements :
les builds Xcode/TestFlight passent par le sandbox (le relay retente le
sandbox sur BadDeviceToken, rien à changer pour tester).

## 6. Calendrier Apple (item 18)

Rien à configurer : clés `NSCalendarsWriteOnlyAccessUsageDescription` /
`NSCalendarsUsageDescription` déjà dans Info.plist. Premier usage → prompt
système « écriture seule » puis feuille EventKit pré-remplie.

## 7. Social login sur l'app Pro (eu.yunoapp.pro) — 2026-07-19

Symptôme : `"SocialLogin" plugin is not implemented on ios` sur l'écran de
connexion de l'app Pro. La coquille Pro n'avait jamais été câblée — les §2/§3
ci-dessus ne couvraient que le bundle B2C `eu.yunoapp.app`.

Fait côté code (commité) :

- `pro/package.json` : `@capgo/capacitor-social-login` ajouté, épinglé sur la
  MÊME version que la racine (8.3.35) — le CLI Capacitor résout les plugins
  natifs depuis `pro/node_modules`, une dérive de version y passerait inaperçue.
- `pro/ios/App/CapApp-SPM/Package.swift` : régénéré par `cap sync` (8 plugins).
- `pro/ios/App/App/App.entitlements` : `com.apple.developer.applesignin` ajouté.
- `pro/ios/App/App/Info.plist` : entrée `google-signin` avec le scheme inversé du
  client iOS Pro (`...bsp4od93uuus00atpcq7gsctoqrj5tpl`).
- `src/lib/nativeAuth.ts` : le client OAuth iOS Google est choisi au RUNTIME via
  `isProApp()`. Raison : un client Google est lié à son bundle id, mais les deux
  coquilles servent le même bundle web (`webDir: '../dist'`) — impossible de
  trancher au build avec une seule variable.

Client OAuth iOS Pro créé le 2026-07-19 (bundle `eu.yunoapp.pro`) :
`909249484986-bsp4od93uuus00atpcq7gsctoqrj5tpl.apps.googleusercontent.com`.
Posé dans `.env.local` (`VITE_GOOGLE_IOS_CLIENT_ID_PRO`) et dans le Info.plist Pro
sous forme de scheme inversé — les deux vérifiés cohérents, `cap sync` rejoué.

⚠️ `VITE_GOOGLE_IOS_CLIENT_ID_PRO` doit aussi être ajoutée aux variables de build
Cloudflare Workers, sinon le bouton Google repasse en « SOON » sur les bundles
livrés par Capgo (le `.env.local` n'existe que sur la machine de dev).

**Reste à faire en console — non automatisable, et non vérifié à ce stade :**

1. **Supabase** → Authentication → Providers → **Google** → `Authorized Client IDs` :
   AJOUTER le client Pro à la liste existante (« client_web,client_iOS ») — c'est
   une liste séparée par virgules, ne pas écraser. Sans ça, `signInWithIdToken`
   rejette le token de l'app Pro alors que la feuille Google s'ouvre normalement.
2. **Apple Developer** → App ID `eu.yunoapp.pro` → activer « Sign In with Apple ».
3. **Supabase** → Providers → **Apple** → `Client IDs` : ajouter **`eu.yunoapp.pro`**
   à côté de `eu.yunoapp.app` (l'identity token natif porte le bundle id).
4. Dans Xcode (`npx cap open ios` depuis `pro/`) : vérifier que la capability
   **Sign In with Apple** apparaît sur la target App — l'entitlement est en place,
   mais Xcode doit régénérer le provisioning profile — puis build sur device.
