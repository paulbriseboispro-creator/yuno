# Apple Wallet — setup des certificats (Phase 0, action Paul)

Prérequis unique de la Phase 2 (passes Wallet billets/VIP). ~20 min sur le
portail Apple Developer, une seule fois. Le certificat expire au bout d'un an
(Apple envoie un rappel email — le renouvellement suit les mêmes étapes).

## 1. Créer le Pass Type ID

1. [developer.apple.com/account](https://developer.apple.com/account) →
   **Certificates, Identifiers & Profiles** → **Identifiers** → `+`.
2. Choisir **Pass Type IDs** → Continue.
3. Description : `Yuno Wallet Passes` · Identifier : **`pass.eu.yunoapp.app`**
   (un seul Pass Type ID pour billets + VIP + crédits — décision D1 du plan).
4. Register.

## 2. Générer le certificat du Pass Type ID

1. Sur le Mac : **Trousseau d'accès** → menu Trousseau d'accès →
   Assistant de certification → **Demander un certificat à une autorité de
   certificat…** → email = ton email Apple Developer, nom = `Yuno Pass`,
   cocher **Enregistrée sur le disque** → sauvegarder `YunoPass.certSigningRequest`.
2. Portail Apple → Identifiers → `pass.eu.yunoapp.app` → **Create Certificate**
   → uploader le `.certSigningRequest` → télécharger `pass.cer`.
3. Double-cliquer `pass.cer` (il entre dans le Trousseau) → dans Trousseau,
   catégorie **Mes certificats**, déplier `Pass Type ID: pass.eu.yunoapp.app`
   → clic droit → **Exporter** → format **.p12** → choisir une passphrase
   (elle deviendra `WALLET_PASS_KEY_PASSPHRASE`).

## 3. Extraire cert + clé en PEM (Terminal)

```bash
# Certificat public
openssl pkcs12 -in YunoPass.p12 -clcerts -nokeys -legacy -out wallet-cert.pem
# Clé privée (garde la passphrase — ne pas utiliser -nodes)
openssl pkcs12 -in YunoPass.p12 -nocerts -legacy -out wallet-key.pem
```

## 4. Télécharger le WWDR **G4** (pas G5/G6)

```bash
curl -o wwdr-g4.cer https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform der -in wwdr-g4.cer -out wwdr-g4.pem
```

⚠️ Seul le **G4** valide les passes — les G2/G3/G5/G6 font échouer la
signature côté Wallet.

## 5. Pousser en secrets Supabase

```bash
supabase secrets set \
  WALLET_PASS_TYPE_ID="pass.eu.yunoapp.app" \
  WALLET_TEAM_ID="<TEAM_ID Apple (le même que APNS_TEAM_ID)>" \
  WALLET_PASS_KEY_PASSPHRASE="<passphrase du .p12>" \
  WALLET_PASS_CERT_PEM="$(cat wallet-cert.pem)" \
  WALLET_PASS_KEY_PEM="$(cat wallet-key.pem)" \
  WALLET_WWDR_PEM="$(cat wwdr-g4.pem)"
```

Puis **supprimer les fichiers locaux** (`YunoPass.p12`, `wallet-*.pem`,
`wwdr-g4.*`) — ne jamais les committer.

## 6. Outil de validation (spike signeur)

Télécharger « Wallet Support Materials » sur
[developer.apple.com/download](https://developer.apple.com/download/all/?q=wallet)
→ contient `signpass` (compiler le projet Xcode une fois). Utilisé par le
spike : `signpass -v monpass.pkpass`.

## Notes pour les phases suivantes

- Les pushes de mise à jour de passes (Phase 5) réutilisent la clé p8 APNs
  existante (`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_P8`) avec
  `apns-topic = pass.eu.yunoapp.app` — rien de plus à créer.
- Les Live Activities (Phases 3-4) n'ont besoin d'AUCUN certificat
  supplémentaire : extension widget dans Xcode + la même clé p8.
