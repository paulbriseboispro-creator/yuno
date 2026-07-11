# Runbook Xcode — Live Activities + Widget « Prochaine soirée » (Phase 3)

La SEULE release native du chantier iOS natif (plan « Apple niveau Duolingo »).
Tout le JS et le serveur sont déjà en place et no-op tant que ce build n'a pas
shippé. Les fichiers Swift sont PRÊTS dans `ios/native-staging/` — ce runbook
est du glisser-déposer Xcode, ~30 min.

## Ce qui est déjà fait (rien à refaire)

- Plugins npm installés : `capacitor-pass-to-wallet`, `capacitor-widget-bridge`
  (le pod/SPM arrive via `npx cap sync ios`).
- `Info.plist` : `NSSupportsLiveActivities` + `FrequentUpdates` ✅
- Serveur : action `live_activity_update` (statut commande → APNs
  `liveactivity`) + action `wallet_pass_update`, triggers DB, table
  `live_activity_tokens` — déployés.
- JS : `src/lib/liveActivity.ts` (contrat plugin `OrderActivity`),
  `src/lib/widgetData.ts` (App Group), branchés dans LiveOrderStatus/MyOrders.

## Étapes Xcode (dans l'ordre)

### 0. Sync des pods des nouveaux plugins
```bash
npx cap sync ios
```

### 1. Plugin OrderActivity (target App)
1. Glisser `ios/native-staging/App/OrderActivityPlugin.swift` et
   `ios/native-staging/App/MyViewController.swift` dans le groupe `App`
   (target membership : **App**).
2. Glisser `ios/native-staging/Shared/OrderAttributes.swift` dans `App` —
   target membership : **App ET YunoWidgets** (à cocher après l'étape 2).
3. `Main.storyboard` → sélectionner le View Controller → Identity Inspector →
   **Custom Class = MyViewController** (module App). Sans ça, Capacitor 8
   n'enregistre pas le plugin maison et `OrderActivity` n'existe pas côté JS.

### 2. Extension YunoWidgets
1. File → New → Target → **Widget Extension** ; nom exact **`YunoWidgets`**,
   ❌ décocher « Include Configuration App Intent », ❌ décocher Live Activity
   (on fournit le nôtre). Ne PAS activer « Embed in application » de schemes
   compliqués — le défaut suffit.
2. Supprimer les fichiers générés par le template (`YunoWidgets.swift`, etc.)
   et glisser à la place les 3 fichiers de `ios/native-staging/YunoWidgets/` :
   `YunoWidgetsBundle.swift`, `OrderActivityWidget.swift`,
   `NextEventWidget.swift` (target membership : **YunoWidgets**).
3. Cocher la membership **YunoWidgets** sur `OrderAttributes.swift` (étape 1.2).
4. Target YunoWidgets → General → **Minimum Deployment : iOS 16.2**.

### 3. App Group (les deux targets)
Target **App** → Signing & Capabilities → + Capability → **App Groups** →
`group.eu.yunoapp.app`. Répéter sur la target **YunoWidgets**.
(Le widget lit `yuno.nextEvent` dans ce groupe ; `widgetData.ts` y écrit.)

### 4. Build & tests
- Simulateur : payer une conso en mode démo (`owner@womber.fr` → Live) → la
  Live Activity apparaît sur l'écran verrouillé ; la passer « prête » depuis
  Barman → île dynamique verte + PIN.
- Push réels (device physique uniquement) : vérifier qu'une ligne arrive dans
  `live_activity_tokens` après le start, puis marquer la commande prête —
  l'activité se met à jour app fermée.
- Widget : ouvrir Mes commandes avec un billet à venir → ajouter le widget
  Yuno à l'écran d'accueil → compte à rebours.
- Wallet in-app : bouton « Add to Apple Wallet » sur une confirmation →
  sheet PKAddPasses SANS passer par Safari (le pod est dans le build).

### 5. Pièges connus
- `OrderAttributes.ContentState` doit rester le miroir EXACT du
  `content-state` serveur (`{status, pin, items}`) — champ renommé = activité
  qui ne se met plus à jour à distance, sans erreur visible.
- Le topic APNs des Live Activities est `eu.yunoapp.app.push-type.liveactivity`
  — déjà géré par `_shared/apns.ts`, rien à configurer côté Apple (la clé .p8
  team-wide signe tout).
- L'app Pro (`pro/`) n'est PAS concernée : aucun de ces fichiers, aucun de ces
  plugins.
- Jamais de contenu promotionnel dans la Live Activity (guidelines Apple —
  Duolingo s'est fait épingler pour ça en janv. 2026).
