# Métadonnées App Store Connect — Yuno (prêt à copier-coller)

Langue par défaut : **English (U.S.)**. Ajoute French et Spanish comme localisations.
Champs à remplir dans App Store Connect → ta version → « App Information » et la fiche de version.

---

## Nom / sous-titre

- **Name** : `Yuno`
- **Subtitle (EN, ≤30)** : `Skip the line. Own the night.`
- **Subtitle (FR, ≤30)** : `Zappe la file. Vis ta nuit.`
- **Subtitle (ES, ≤30)** : `Salta la cola. Vive la noche.`

## Promotional text (≤170, modifiable sans review)

- **EN** : `Book event tickets, reserve VIP tables and order drinks straight from your phone. No queue, no wait.`
- **FR** : `Réserve tes billets, tes tables VIP et commande tes boissons depuis ton téléphone. Sans file, sans attente.`
- **ES** : `Reserva entradas, mesas VIP y pide bebidas desde tu móvil. Sin colas, sin esperas.`

## Description

**EN**
```
Yuno is your nightlife companion. Three things, one app:

TICKETS — Find tonight's events and buy tickets in seconds. Your QR ticket lives in the app, ready at the door.

VIP TABLES — Reserve bottle service at the best clubs. Pick your table, set your party, arrive like a regular.

DRINKS — Order from the bar before you even get there and skip the queue. Show your code, grab your drink.

Discover clubs and events near you on the map, follow your favorite venues and DJs, and get your personalized picks for the night. Yuno is available in English, French and Spanish.

Payments are handled securely by Stripe. You must be of legal drinking age in your country to purchase.
```

**FR**
```
Yuno, c'est ton compagnon de sortie. Trois choses, une seule app :

BILLETS — Trouve les soirées du soir et achète tes billets en quelques secondes. Ton billet QR vit dans l'app, prêt à l'entrée.

TABLES VIP — Réserve ton bottle service dans les meilleurs clubs. Choisis ta table, compose ta tablée, arrive comme un habitué.

BOISSONS — Commande au bar avant même d'arriver et zappe la file. Montre ton code, récupère ton verre.

Découvre les clubs et soirées près de toi sur la carte, suis tes lieux et DJ préférés, et reçois tes recommandations pour la nuit. Yuno est disponible en anglais, français et espagnol.

Les paiements sont sécurisés par Stripe. Tu dois avoir l'âge légal pour consommer de l'alcool dans ton pays pour acheter.
```

**ES**
```
Yuno es tu compañero de fiesta. Tres cosas, una sola app:

ENTRADAS — Encuentra los eventos de esta noche y compra entradas en segundos. Tu entrada QR vive en la app, lista en la puerta.

MESAS VIP — Reserva bottle service en los mejores clubs. Elige tu mesa, arma tu grupo, llega como un habitual.

BEBIDAS — Pide en la barra antes de llegar y sáltate la cola. Muestra tu código, recoge tu copa.

Descubre clubs y eventos cerca de ti en el mapa, sigue tus locales y DJs favoritos y recibe tus recomendaciones para la noche. Yuno está disponible en inglés, francés y español.

Los pagos son seguros con Stripe. Debes tener la edad legal para consumir alcohol en tu país para comprar.
```

## Keywords (≤100 caractères, séparés par des virgules)

- **EN** : `nightlife,club,tickets,event,party,bottle service,VIP table,bar,drinks,DJ,night out,rave`
- **FR** : `nightlife,club,billets,soirée,fête,bottle service,table VIP,bar,boissons,DJ,sortie,concert`
- **ES** : `nightlife,discoteca,entradas,fiesta,evento,bottle service,mesa VIP,bar,bebidas,DJ,noche`

## URLs

- **Support URL** : `https://yunoapp.eu` (ou une page /support dédiée si tu en crées une)
- **Marketing URL** : `https://yunoapp.eu`
- **Privacy Policy URL** : `https://yunoapp.eu/legal/privacy`

---

## Age rating (questionnaire)

- Alcohol, Tobacco, or Drug Use or References : **Frequent/Intense** → donne **17+** (nouveau barème possible 18+).
- Toutes les autres catégories (violence, sexe, jeux d'argent, contenu mature…) : **None**, sauf si tu ajoutes du contenu concerné.
- Unrestricted Web Access : **No** (WebView cadrée sur ton domaine).

## App Privacy (étiquettes de confidentialité)

Réponds « Yes, we collect data ». Aucune donnée utilisée pour le **tracking** (pas de SDK cross-app).

| Type de donnée | Collectée | Liée à l'identité | Usage |
|---|---|---|---|
| Email Address | Oui | Oui | App Functionality |
| Name | Oui | Oui | App Functionality |
| Phone Number | Oui | Oui | App Functionality |
| Coarse Location | Oui | Oui | App Functionality (carte des clubs) |
| Purchase History | Oui | Oui | App Functionality |
| Photos (docs mineurs, si activé) | Oui | Oui | App Functionality |
| Product Interaction / Usage Data | Oui | Oui | Analytics (produit) |

« Data Used to Track You » : **rien**.

## Export compliance

`ITSAppUsesNonExemptEncryption = false` est déjà dans l'Info.plist → **aucun questionnaire de chiffrement** au moment de l'upload.

---

## App Review Information — Notes reviewer (copier-coller)

```
Yuno sells access to physical nightlife services (event tickets, VIP table reservations, and in-venue drink orders) that are consumed in person at partner venues. Per Guideline 3.1.3(e), these are physical goods and services paid via Stripe outside the app; no digital content is sold, so In-App Purchase does not apply.

Demo account: <EMAIL> / <PASSWORD>

Notes:
- Sign in with Apple, Google, and email/password are all supported.
- Account deletion is available in Settings > Delete my account.
- Professional/organizer dashboards are intentionally redirected to the web; this is a consumer app.
- The app is available in English, French, and Spanish.
```

Remplace `<EMAIL>` / `<PASSWORD>` par un vrai compte de démo (email/mot de passe, pas Apple/Google), idéalement avec un billet et une commande déjà présents.

## Captures d'écran (à produire toi-même depuis l'app)

- **iPhone 6,9"** (obligatoire) et **6,7"** : 3 à 5 écrans conseillés — Explore/carte, une page d'événement, l'achat de billet, le QR, une table VIP.
- Formats identiques pour EN/FR/ES ou localisés.
```
