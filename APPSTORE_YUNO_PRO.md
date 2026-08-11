# Yuno Pro — Brief screenshots App Store

**Prompt prêt à coller dans Claude Design.** 6 screenshots, 3 langues (EN / FR / ES).
Style éditorial (gros titres + chips-stickers inline + mockups qui flottent) en palette
**Yuno Dark Premium** (noir + rouge `#E8192C`).

---

## Yuno Pro en une phrase

**L'app de toute l'équipe qui fait la nuit — staff club, promoteurs, DJ.**
Chacun ouvre l'app et retrouve son espace. L'argent affiché est toujours celui de la
personne (commission du promoteur, cachet du DJ), jamais la caisse du club.

## Lineup — 6 écrans (une seule fiche App Store, 3 publics)

| # | Public | Écran montré |
|---|---|---|
| 1 | **Tous** (hero fédérateur) | Home « ce soir » — l'événement + accès rapides (porte / tables / bar / guest list) |
| 2 | **Staff** | Scan à l'entrée + check-in guest list (« ✓ access granted ») |
| 3 | **Staff** | Placement des tables VIP sur le plan de salle |
| 4 | **Staff** | File des commandes de boissons au bar |
| 5 | **Promoteur** | Lien de vente, ventes en direct, commission, guest list |
| 6 | **DJ** | Planning des sets, cachets dû / reçu, bookings, EPK |

Staff pèse plus (3 écrans) : c'est le public le plus large (videur, barman, vestiaire,
hôte VIP, manager). Promoteur et DJ ont chacun leur écran pour se reconnaître dans la
fiche. Le hero est fédérateur, pas staff-only. Écrans les plus vus à soigner en
priorité : **1, 2, 5**.

---

# LE PROMPT (copier tel quel)

## Rôle

Directeur artistique. Crée **6 screenshots App Store** pour **Yuno Pro** (app iOS).
Format **portrait 1290 × 2796 px**. Produis **3 versions localisées** (EN défaut, FR, ES)
→ 18 images cohérentes comme une seule série.

## L'app

Yuno Pro est l'app de terrain des professionnels de la nuit. **Trois publics, une seule app :**

- **Staff club** (videur, barman, vestiaire, hôte VIP, manager) → exécuter la soirée :
  scanner les billets à l'entrée, valider la guest list, placer les tables VIP sur le
  plan de salle, servir les commandes de boissons, suivre le brief de la nuit.
- **Promoteur** → remplir la salle et suivre son argent : son lien / QR de vente, ses
  ventes en temps réel, sa commission (en attente / payée), sa guest list, son linktree.
- **DJ** → gérer ses dates : planning des sets, demandes de booking, cachets (dû / reçu),
  abonnés, EPK à partager.

Chacun ouvre l'app et retrouve **son** espace. L'argent affiché est toujours celui de la
personne (commission promoteur, cachet DJ), jamais la caisse du club.

## Système visuel (obligatoire — « Yuno Dark Premium »)

- **Fond canvas** : graphite quasi-noir, dégradé `#0a0a0c → #000`. Jamais de gris chaud
  ni de bleu.
- **Accent unique** : rouge `#E8192C` — seul accent systémique, à doser (chip de titre
  + 1 élément clé par mockup).
- **Vert `#34D399`** uniquement pour « en direct / online / validé ». Texte blanc
  96 % / 58 % / 36 %. Cartes `rgba(255,255,255,0.045)` sur noir, bordures
  `rgba(255,255,255,0.085)`, coins 14–18 px.
- **Éclairage** : spotlight radial doux derrière le téléphone + blob de glow rouge
  diffus en haut à droite (flou 56 px) + rim light sur le bord du tel → détache le
  mockup sombre du fond dark.
- **Titres** : grotesque lourde 700–800, tracking serré (-0.03em) (style Neue Haas
  Grotesk / PP Neue Montreal / Söhne), blanc 96 %, 2–3 lignes. Icônes **Lucide** (line
  icons), zéro emoji dans l'UI.
- **Chip-sticker inline** dans le titre : petit chip arrondi, fond rouge, icône Lucide
  blanche, à côté du mot-clé (le mot entre crochets). **Un seul par titre**, toujours rouge.
- **Mockup iPhone** titane sombre, droit, flottant, ombre profonde ; bas peut déborder.
  L'écran = vraie UI Yuno Pro sombre (voir chaque écran).
- **1–2 stickers flottants** par écran (verre sombre, ou pastille rouge / verte « live »)
  qui débordent les bords du tel. Ne pas surcharger.
- **Layout constant** : titre dans le tiers haut, tel dominant au centre / bas, stickers
  en débordement, petit lockup logo **Yuno + « Pro »** discret en bas. Même grille sur les 6.
- **Preuve sociale honnête** : autorisé un badge type « Staff · Promoters · DJs — one app »
  ou « Built for nightlife ». Interdit : « #1 app », nombres d'utilisateurs, notes
  (produit en pré-lancement).

## Les 6 écrans

Format par écran : titre EN / FR / ES · chip · écran dans le tel · stickers.

### 1 — Hero fédérateur

- **EN** : "The whole crew that runs the **[night]**. One app."
- **FR** : « Toute l'équipe qui fait la **[nuit]**. Une seule app. »
- **ES** : "Todo el equipo que hace la **[noche]**. Una sola app."
- **Chip** : rouge, icône Lucide `moon` (ou `sparkles`).
- **Écran** : home « ce soir » — nom de l'événement + date, badge vert « • 214 inside »,
  4 tuiles d'accès rapide (Door · Tables · Bar · Guest list) qui suggèrent la largeur de
  l'app, une ligne de brief. Fond noir, un chiffre en rouge.
- **Stickers** : pastille verte « • live tonight », chip rouge « Doors 23:00 ».

### 2 — Staff · Scan à l'entrée

- **EN** : "Scan at the **[door]**, instantly"
- **FR** : « Scan à l'**[entrée]**, direct »
- **ES** : "Escanea en la **[puerta]**, al instante"
- **Chip** : rouge, icône Lucide `scan-line`.
- **Écran** : plein écran caméra avec ligne de scan rouge, grosse carte succès **verte**
  « ✓ Valid — Guest list · 2 pax » + nom de l'invité. En bas, compteur « 312 checked in ».
- **Stickers** : sticker QR code, burst vert « ✓ Access granted ».

### 3 — Staff · Tables VIP

- **EN** : "Seat every **[VIP]** on the floor plan"
- **FR** : « Placez chaque **[VIP]** sur le plan »
- **ES** : "Coloca cada **[VIP]** en el plano"
- **Chip** : rouge, icône Lucide `crown` (ou `armchair`).
- **Écran** : plan de salle interactif sombre — formes de tables sur fond noir, une table
  sélectionnée qui glow rouge, panneau de résa (nom, nb de personnes, heure d'arrivée
  limite), bouton « Place / Assign ».
- **Stickers** : mini-sticker seau à champagne (line icon), pastille rouge « Reserved ».

### 4 — Staff · Bar sans file

- **EN** : "Every **[order]**, straight to the bar"
- **FR** : « Chaque **[commande]**, filée au bar »
- **ES** : "Cada **[pedido]**, directo a la barra"
- **Chip** : rouge, icône Lucide `martini` (ou `cup-soda`).
- **Écran** : file de commandes entrantes — cartes empilées (articles + emplacement /
  table), toggle rouge « Preparing → Ready », compteur de file en haut.
- **Stickers** : sticker verre / cocktail, chip « order #218 ✓ ».

### 5 — Promoteur · Vends & suis ta commission

- **EN** : "Fill the room. Track every **[commission]**."
- **FR** : « Remplis la salle. Suis chaque **[commission]**. »
- **ES** : "Llena la sala. Controla cada **[comisión]**."
- **Chip** : rouge, icône Lucide `trending-up` (ou signe €).
- **Écran** : header profil promoteur, onglet club, tuiles de stats (Clicks / Sales /
  Commission), commission « pending » en muted + « paid » en vert, part de guest list,
  bouton « Share link / QR ». Un toast en direct « New sale · +€24 » qui apparaît.
- **Stickers** : sticker QR « my link », chip vert « commission paid ».

### 6 — DJ · Tes dates & tes cachets

- **EN** : "Your gigs, your **[fee]**, all tracked"
- **FR** : « Tes dates, ton **[cachet]**, suivis »
- **ES** : "Tus fechas, tu **[caché]**, al día"
- **Chip** : rouge, icône Lucide `headphones`.
- **Écran** : home DJ — tuiles (Upcoming sets · Pending € · Received € avec petite
  sparkline rouge), liste des prochains sets (date · lieu) avec pastille de cachet
  (payé = vert, en attente = muted), carte « Share EPK / linktree ».
- **Stickers** : sticker vinyle / casque, chip « next gig Sat ».

## Livrable

18 images (6 × EN / FR / ES), 1290 × 2796 px, série cohérente, ordre 1 → 6.
Écrans 1, 2, 5 = les plus vus, à soigner en priorité.
