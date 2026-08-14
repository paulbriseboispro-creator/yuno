# OTA Capgo — mises à jour Over-The-Air auto-hébergées sur Supabase

Mettre à jour le code web des apps **Yuno** (`eu.yunoapp.app`) et **Yuno Pro**
(`eu.yunoapp.pro`) **déjà installées**, sans repasser par une review App Store.
Auto-hébergé sur Supabase : **aucun abonnement Capgo Cloud**.

> Apple l'autorise (Guidelines 2.5.2 / 3.3.2) : on ne met à jour que du code
> **interprété** (JS/HTML/CSS) livré dans le conteneur WebView, sans changer la
> nature de l'app. Aucun code natif n'est téléchargé. Un changement natif
> (plugin, permission, écran natif) exige toujours une soumission App Store.

---

## Comment ça marche

```
 App installée (plugin @capgo/capacitor-updater, autoUpdate:true)
        │  au lancement / retour au 1er plan : POST InfoObject
        ▼
 ┌───────────────────────────────────────────────────────────────┐
 │ edge function  capgo-updates   (updateUrl)                     │
 │   → cherche le bundle ACTIF du canal de l'appareil            │
 │     compatible avec sa version NATIVE (native_version)        │
 │   → répond { version, url, checksum }  ou  "no_new_version"   │
 └───────────────────────────────────────────────────────────────┘
        │  si MàJ : télécharge le zip depuis Storage `ota-bundles`
        │  vérifie SHA-256 == checksum, applique au prochain démarrage
        ▼
 notifyAppReady()  (NativeBridge.tsx) confirme que le bundle démarre.
   Sans cet appel sous ~10s → ROLLBACK AUTO au bundle précédent.
```

Trois edge functions (toutes `verify_jwt = false`, le plugin n'envoie pas de JWT) :

| Function        | Rôle plugin | Ce qu'elle fait |
|-----------------|-------------|-----------------|
| `capgo-updates` | `updateUrl` | Décide s'il y a une MàJ pour (app, canal, version native). |
| `capgo-stats`   | `statsUrl`  | Journalise la télémétrie (adoption, échecs de MàJ, santé). |
| `capgo-channel` | `channelUrl`| get/set du canal d'un appareil (opt-in beta). |

État serveur = 4 tables (migration `20260809190000_ota_capgo_selfhosted.sql`) :
`ota_channels`, `ota_bundles`, `ota_devices`, `ota_stats`. **RLS totale, aucune
policy anon** → invisibles depuis la clé anon ; seules les edge functions et le
script (service_role) y touchent. Les zips vivent dans le bucket public
`ota-bundles` (content-addressed : `bundles/<sha256>.zip`).

### Le garde-fou anti-downgrade (`native_version`)

Chaque bundle est tagué avec la `MARKETING_VERSION` de la coquille native pour
laquelle il a été buildé. `capgo-updates` **ne sert un bundle que si
`native_version == version_build` de l'appareil**. Conséquence :

- Un bundle web `1.0.x` ne peut JAMAIS atterrir sur une future app native `2.0`.
- Quand tu publieras l'app native `2.0` sur l'App Store, commence à publier des
  bundles OTA sous native `2.0` — les appareils `1.0` cessent d'en recevoir
  (normal : ils doivent faire la MàJ App Store). Le script lit la
  `MARKETING_VERSION` automatiquement, donc c'est transparent.

---

## Pré-requis (une fois, avant soumission App Store)

Les URLs OTA doivent être **compilées dans l'app**. Après tout changement de
`capacitor.config.ts`, resync AVANT de builder pour le store :

```bash
npm run cap:sync        # client → régénère ios/App/App/capacitor.config.json
npm run cap:sync:pro    # pro    → régénère pro/ios/App/App/capacitor.config.json
```

Vérifier que le JSON natif contient bien `updateUrl` :
```bash
grep updateUrl ios/App/App/capacitor.config.json pro/ios/App/App/capacitor.config.json
```

---

## Pousser une mise à jour (le geste courant)

Le workflow sûr = **beta d'abord, puis promotion**.

```bash
# 1. publier le build courant sur le canal beta (client + pro)
npm run ota:beta

# 2. mettre TON appareil sur beta pour tester (voir son device_id)
npm run ota:devices
node scripts/ota-publish.mjs channel --device <device_id> --set beta
#   → relance l'app : elle télécharge le bundle beta. Teste.

# 3. si OK, promouvoir beta → production (tout le monde)
npm run ota:promote

# 4. remettre ton appareil en production
node scripts/ota-publish.mjs channel --device <device_id> --clear
```

Pousser **directement** en production (sans étape beta) :
```bash
npm run ota:publish
```

Inspecter :
```bash
npm run ota:list                 # bundles + lequel est ACTIF, par app/canal
npm run ota:devices              # parc d'appareils, version installée, canal
```

Rollback (ré-active le bundle précédent, ou une version précise) :
```bash
npm run ota:rollback                                   # both, production, → précédent
node scripts/ota-publish.mjs rollback --app client --to 1.0.3
```

Toutes les commandes acceptent `--app both|client|pro`. `node scripts/ota-publish.mjs help`
pour le détail.

---

## Canaux

| Canal        | `allow_self_set` | Usage |
|--------------|------------------|-------|
| `production` | non (verrouillé) | Défaut de tous les appareils. On n'y accède pas en le demandant. |
| `beta`       | oui              | Test. Un appareil s'y met via `setChannel` OU via le script (override serveur `ota_devices.channel`). |

Deux façons de mettre un appareil sur beta :
1. **Côté serveur (recommandé, zéro code app)** : `channel --device <id> --set beta`.
2. **Côté app** : appeler `CapacitorUpdater.setChannel({ channel: 'beta' })` depuis
   le JS (à câbler sur un bouton debug si besoin). `setChannel('production')` ou
   `--clear` pour revenir.

> ⚠️ **Un canal beta périmé RÉTROGRADE.** `capgo-updates` sert le bundle actif
> du canal de l'appareil sans comparer sa fraîcheur à production : un appareil
> oublié sur beta reçoit le vieux bundle beta même si production a 10 versions
> d'avance. Vécu le 2026-08-14 : une install neuve s'est fait « mettre à jour »
> vers le bundle beta 1.0.4 du 9 août — ressuscitant des bugs corrigés depuis
> (permissions empilées, bannière cookies). Deux disciplines :
> après un test beta, **toujours** remettre l'appareil en production
> (`channel --device <id> --clear`) ; et à chaque publication production,
> réaligner beta (`promote --app both --from production --to beta`) s'il n'est
> pas en cours d'utilisation pour un vrai test.

---

## Versioning des bundles

`version` = `<native>.<n>` auto-incrémenté par app : `1.0.1`, `1.0.2`, … Le
serveur sert un bundle dès que sa `version` **diffère** de celle installée sur
l'appareil (pas de comparaison sémantique) — c'est ce qui rend le rollback
trivial (ré-activer une ligne antérieure suffit). Le stockage est
content-addressed : republier un contenu identique ne recrée pas d'objet, et le
script **saute** une publication si le bundle actif a déjà le même contenu
(`--force` pour outrepasser).

---

### Premier lancement : le bundle baké se déclare « builtin »

Le bundle web embarqué dans le binaire App Store se déclare **toujours**
`version_name = "builtin"` (constante `ID_BUILTIN` du plugin), jamais son numéro
de version. Conséquence : dès qu'un bundle est **actif en production**, une
nouvelle installation le télécharge **une fois** (en arrière-plan, non bloquant :
le 1er lancement utilise le bundle baké, la MàJ s'applique au lancement suivant),
même si le contenu est identique.

Deux postures, au choix :
- **Production active en permanence** (état actuel) : chaque install fait un
  download OTA initial. Garantit que tout le monde tourne sur le bundle servi.
- **Production vide entre deux vraies MàJ** : les installs utilisent le bundle
  baké, zéro download tant qu'aucun `ota:publish` n'a livré de nouveauté. Pour
  revenir à cet état : désactiver le bundle actif (ré-publier plus tard livrera
  la 1re vraie MàJ). Utile si on veut éviter tout transfert redondant tant que le
  contenu OTA == le contenu baké.

Le numéro `native_version` (garde anti-downgrade), lui, vient bien de la
`MARKETING_VERSION` native (`version_build`), indépendant de ce `"builtin"`.

## Sécurité

- Tables `ota_*` : RLS activée, **aucune** policy → la clé anon ne lit/écrit rien.
- Bucket `ota-bundles` : **lecture** publique (le code web est déjà public sur
  yunoapp.eu), **écriture** réservée au service_role du script.
- Les edge functions sont publiques (`verify_jwt=false`) mais ne renvoient que
  des métadonnées de bundle + une URL publique — aucune donnée sensible.
- Le checksum SHA-256 garantit l'intégrité du bundle téléchargé ; un zip corrompu
  ou substitué est rejeté, et `notifyAppReady()` fait un rollback auto si un
  bundle démarre mal.

---

## Déploiement de l'infra (déjà fait une fois)

```bash
supabase db push                                              # tables + bucket + seed canaux
supabase functions deploy capgo-updates capgo-stats capgo-channel
```

Re-déployer une fonction après édition : même commande `functions deploy`.

---

## Dépannage

- **L'app ne se met pas à jour.** Vérifier : (1) `updateUrl` bien compilé
  (`grep updateUrl ios/App/App/capacitor.config.json`), (2) un bundle ACTIF
  existe pour (app, canal, **bonne native_version**) → `npm run ota:list`,
  (3) l'appareil est sur le bon canal → `npm run ota:devices`.
- **`capgo-updates` répond toujours "no_new_version".** La `native_version` du
  bundle ne matche pas le `version_build` de l'app. Republier après avoir bumpé
  la coquille native, ou vérifier la `MARKETING_VERSION` lue par le script.
- **401 sur les endpoints.** `verify_jwt` a sauté dans `config.toml` → remettre
  `verify_jwt = false` et redéployer.
- **Le bundle démarre puis rollback.** `notifyAppReady()` (dans
  `src/components/NativeBridge.tsx`) n'est pas atteint (erreur JS au boot du
  nouveau bundle). Regarder `ota_stats` (actions `*_fail`) et les logs de la
  fonction.
- **Checksum fail au téléchargement.** Le zip en Storage ne correspond plus au
  `checksum` stocké. Republier (`--force`).

---

## Règle de maintenance

Toute modif du protocole (schéma des tables, format de réponse des fonctions,
config du plugin) doit être répercutée ici ET dans la section OTA de `CLAUDE.md`.
Le contrat exact du plugin est figé dans son code natif
(`node_modules/@capgo/capacitor-updater/ios/Sources/CapacitorUpdaterPlugin/`) —
`InfoObject` (requête) et `AppVersionDec` (réponse) en sont la source de vérité.
