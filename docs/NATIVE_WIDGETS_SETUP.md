# Live Activities + Widget « Prochaine soirée » — état & vérification (Phase 3)

**Tout le setup Xcode du runbook original a été fait par script le 2026-07-11**
(gem `xcodeproj` — target extension, memberships, App Groups, storyboard).
Ce doc décrit ce qui est en place et ce qu'il reste à vérifier à la main.

## En place (fait, committé)

- **Target `YunoWidgets`** (extension WidgetKit, iOS 16.2, signing auto team
  A2WV4J86F9, bundle `eu.yunoapp.app.YunoWidgets`), appex embarqué dans App
  (« Embed Foundation Extensions »).
- **Fichiers Swift** :
  - `ios/App/App/Plugins/` → target App : `OrderActivityPlugin.swift`
    (Live Activity + push tokens ActivityKit), `WalletSheetPlugin.swift`
    (sheet PKAddPasses in-app — maison car le projet est 100 % SPM),
    `MyViewController.swift` (enregistrement Capacitor 8),
    `OrderAttributes.swift` (**membership App + YunoWidgets** — miroir exact
    du content-state serveur `{status, pin, items}`, NE PAS renommer).
  - `ios/App/YunoWidgets/` → target YunoWidgets : bundle, Live Activity
    (lock screen + Dynamic Island, DA éditoriale), widget NextEvent
    (App Group, compte à rebours, compat iOS 16 via `yunoWidgetBackground`).
- **App Groups** `group.eu.yunoapp.app` sur les DEUX entitlements
  (`App/App.entitlements` + `YunoWidgets/YunoWidgets.entitlements`).
- **Main.storyboard** → Custom Class `MyViewController` (module App). C'est ce
  qui fait exister `OrderActivity` et `WalletSheet` côté JS.
- **Info.plist App** : `NSSupportsLiveActivities` + `FrequentUpdates`.
- **SPM** : `capacitor-widget-bridge` câblé par `npx cap sync ios`.
  (`capacitor-pass-to-wallet` retiré : CocoaPods-only → remplacé par
  WalletSheetPlugin maison.)
- Serveur + JS : voir le plan — actions `live_activity_update` /
  `wallet_pass_update` déployées, triggers DB actifs, `liveActivity.ts` /
  `widgetData.ts` / `wallet.ts` branchés.

## À vérifier à la première ouverture d'Xcode

1. **Signing** : Xcode va provisionner `eu.yunoapp.app.YunoWidgets` + l'App
   Group sur le portail (signing automatique, compte connecté requis).
   Si prompt « register App ID » → accepter.
2. Build & Run sur simulateur : l'app boote, aucun changement visible (les
   plugins sont dormants tant qu'aucune commande/billet n'existe).

## Tests device (TestFlight)

- **Live Activity** : mode démo (`owner@womber.fr` → Live) → payer une conso →
  l'activité apparaît sur l'écran verrouillé ; vérifier une ligne dans
  `live_activity_tokens` ; marquer « prête » dans Barman → île dynamique
  verte + PIN **app fermée** (push serveur).
- **Widget** : Mes commandes avec un billet à venir → ajouter le widget Yuno →
  compte à rebours ; tap → ouvre l'app.
- **Wallet in-app** : « Add to Apple Wallet » sur une confirmation → sheet
  PKAddPasses sans passer par Safari.

## Pièges connus

- `OrderAttributes.ContentState` = miroir EXACT du content-state serveur —
  champ renommé = activité qui ne se met plus à jour à distance, sans erreur.
- Topic Live Activities : `eu.yunoapp.app.push-type.liveactivity` — déjà géré
  par `_shared/apns.ts`, rien à créer côté Apple (clé .p8 team-wide).
- L'app Pro (`pro/`) n'est pas concernée.
- Jamais de promo dans une Live Activity (guidelines Apple — Duolingo épinglé
  janv. 2026).
