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
  - Le Services ID / secret key ne sont nécessaires QUE pour le bouton Apple web
    (encore en « SOON » côté web, rien à faire pour l'app).

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

Secrets vérifiés au 2026-07-11 : `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_P8`,
`APNS_TOPIC`, `APNS_TOPIC_PRO` présents (iOS OK). **`VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` ABSENTS** → le push WEB ne peut ni s'abonner ni délivrer.
Aucune subscription n'existe encore (0 ligne), donc générer les clés est sans
risque. À lancer à la main (refusé au mode auto de l'agent) :

```bash
node -e "
const c = require('crypto');
const { publicKey, privateKey } = c.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
const p65 = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
require('fs').writeFileSync('/tmp/vapid.env',
  'VAPID_PUBLIC_KEY=' + p65.toString('base64url') + '\nVAPID_PRIVATE_KEY=' + priv.d + '\n', { mode: 0o600 });
console.log('ok');
"
supabase secrets set --env-file /tmp/vapid.env --project-ref fulawxvdlwtdlpkycixe && rm /tmp/vapid.env
```

`aps-environment` est en `development` dans App.entitlements : les builds
Xcode/TestFlight passent par le sandbox (le relay retente le sandbox sur
BadDeviceToken, rien à changer pour tester).

## 6. Calendrier Apple (item 18)

Rien à configurer : clés `NSCalendarsWriteOnlyAccessUsageDescription` /
`NSCalendarsUsageDescription` déjà dans Info.plist. Premier usage → prompt
système « écriture seule » puis feuille EventKit pré-remplie.
