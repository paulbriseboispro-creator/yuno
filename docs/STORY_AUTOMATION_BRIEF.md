# Yuno — Brief stories automatisées (pour Claude Design)

> Document à coller dans Claude Design pour générer le set de templates de stories
> automatiques. Tout est dérivé de l'identité réelle Yuno (site client + templates
> existants `EventPromoTemplate`, `TicketAvailabilityTemplate`, `VIPTablesTemplate`).

---

## 0. Contexte produit

Yuno est une plateforme nightlife (billets + tables VIP + boissons). Les **owners**
de venues génèrent des stories Instagram/Snapchat (vertical 9:16) pour promouvoir
leurs events. Aujourd'hui c'est manuel. On veut un **set de templates paramétrables**
que Yuno remplit tout seul à partir de la donnée temps réel (ventes billets, tables,
hype, lineup) et propose à l'owner prêt à poster.

**Livrable attendu :** un template par story (section 4), tous bâtis sur les mêmes
briques (section 3) et la même DA (section 1). Chaque template accepte des variables
(section 5) pour être rempli automatiquement.

---

## 1. Direction artistique (à respecter strictement)

| Élément | Valeur |
|---|---|
| **Format** | 1080 × 1920 px (9:16), safe-zone texte à 60px des bords |
| **Fond** | Noir profond `#050505` + dégradé vertical `linear-gradient(180deg, #150000 0%, #1c0505 18%, #200808 35%, #180303 50%, #0d0000 70%, #050505 90%)` |
| **Accent** | Rouge Yuno `#E8192C` (variantes gradient `#ef4444` → `#dc2626` → `#b91c1c`) |
| **Glow** | Halo radial rouge en haut : `radial-gradient(ellipse, rgba(180,20,20,0.22), transparent 75%)`, large, flou |
| **Texture** | Grain / fractal noise SVG à **4% d'opacité** par-dessus le fond |
| **Encadrement** | 2 lignes verticales rouges fines (3px) bords gauche+droite, fade haut/bas |
| **Carte centrale** | Glassmorphism : `rgba(255,255,255,0.04)`, bordure `1.5px rgba(255,255,255,0.1)`, radius 32, `backdrop-blur(8px)`, ombre `0 8px 60px rgba(0,0,0,0.4)` |
| **Typo display** | **Space Grotesk** ou **Inter 900**, UPPERCASE, letter-spacing 4–16px |
| **Typo corps** | **Inter** 600–700 |
| **Chiffres** | **JetBrains Mono** ou Inter 900, chiffres tabulaires |
| **Hiérarchie texte** | Blanc `96%` → `70%` → `40%` → `30%` (jamais de gris plat) |
| **CTA** | Pill gradient `135deg, #ef4444→#dc2626→#b91c1c`, radius 50, glow `0 0 50px rgba(220,38,38,0.5)`, texte Inter 900 UPPERCASE letter-spacing 4 |
| **Branding** | Footer obligatoire : « POWERED BY **YUNO** » + tagline « BUILT FOR NIGHTLIFE, MADE FOR YOUR NIGHT » |
| **Icônes** | Vectorielles uniquement (Lucide-style). **Zéro emoji** (remplacer le 📍 actuel par un pin propre) |

### Évolutions DA à intégrer (nouveautés vs templates actuels)

1. **Accent dynamique** — utiliser la couleur de marque du venue (`accentColor`) au
   lieu du rouge Yuno forcé. Le rouge `#E8192C` devient le **fallback** quand le venue
   n'a pas de couleur. Le but : la story ressemble au club, pas à Yuno.
2. **Slot logo venue** — réserver un emplacement image en haut (pas juste le nom en
   texte). Fallback = nom en texte uppercase si pas de logo.
3. **Mode clair optionnel** (`mode: dark | light`) — variante fond blanc cassé
   `#f5f3f0` + accent, pour les venues à identité non-dark. Dark reste le défaut.

---

## 2. Système de variables (toutes les stories)

```
accentColor   : couleur d'accent (hex). Défaut #E8192C
mode          : "dark" | "light". Défaut "dark"
venueName     : nom du venue (string)
venueLogo     : URL logo (optionnel)
eventTitle    : titre de l'event
eventDate     : date/heure de début (ISO)
eventEndDate  : date/heure de fin (ISO, optionnel)
eventImage    : URL poster/visuel (optionnel)
data          : objet métrique injecté par story (voir section 4)
ctaText       : texte du bouton
language      : "fr" | "en" | "es"
```

---

## 3. Bibliothèque de briques (composants réutilisables)

Chaque story assemble un sous-ensemble de ces 12 briques :

1. **Header venue** — logo (ou nom uppercase, letter-spacing 10) centré, haut de carte
2. **Badge urgence** — pill accent pulsante : « SELLING OUT FAST » / « LAST TABLES » / « SOLD OUT » / « IT'S HEATING UP »
3. **Bloc date** — jour (EEEE) · N° · mois en gros uppercase + ligne heures (DOORS OPEN / UNTIL)
4. **Visuel event** — image poster, radius 20, gradient fade noir en bas
5. **Jauge** — barre de progression (track `rgba(255,255,255,0.06)`, fill gradient accent), % ou ratio
6. **Gros chiffre hero** — métrique géante centrée (ex. `347`, `J-3`, `92%`) en JetBrains Mono/Inter 900
7. **Line-up** — chips DJ : avatar circulaire bordure accent + nom uppercase
8. **Presented by** — chips organisateurs (logo + nom)
9. **Compte à rebours** — badge géant `J-7 / J-3 / J-1 / CE SOIR`
10. **CTA pill** — bouton gradient accent
11. **Footer Yuno** — branding (obligatoire sur toutes)
12. **Grille photos** — mosaïque 2×3, coins arrondis, pour recap

---

## 4. Composition par story (9 templates)

Chaque story = déclencheur métier + briques + données injectées dans `data`.

### 4.1 — Round sold out
- **Déclencheur** : un round de billets atteint 100%
- **Briques** : Header · Badge « SOLD OUT » · Nom round · Jauge (pleine) · Bloc date · CTA « NEXT ROUND » · Footer
- **data** : `{ roundName, nextRoundName?, price? }`

### 4.2 — Plus que N billets
- **Déclencheur** : stock global sous un seuil (ex. < 10%)
- **Briques** : Header · Badge « SELLING FAST » · **Gros chiffre (N restants)** · Jauge · Bloc date · CTA « GET TICKETS NOW » · Footer
- **data** : `{ remaining, total }`

### 4.3 — Last tables
- **Déclencheur** : une zone VIP quasi pleine
- **Briques** : Header · Badge « LAST TABLES » · Nom zone · Jauge tables · Visuel (ou mini floorplan) · CTA « BOOK YOUR TABLE » · Footer
- **data** : `{ zoneName, tablesLeft, totalTables }`

### 4.4 — Palier de ventes
- **Déclencheur** : palier rond franchi (100 / 250 / 500 billets)
- **Briques** : Header · **Gros chiffre (vendus)** · Bloc date · Line-up (mini) · CTA · Footer
- **data** : `{ ticketsSold }`

### 4.5 — Compte à rebours
- **Déclencheur** : J-7 / J-3 / J-1 / ce soir (relatif à `eventDate`)
- **Briques** : Header · **Badge countdown géant** · Visuel event · Bloc date+heures · CTA · Footer
- **data** : `{ daysLeft }` (0 = « CE SOIR »)

### 4.6 — Lineup reveal
- **Déclencheur** : un DJ ajouté à l'event
- **Briques** : Header · Visuel · Titre event · **Line-up (focus, grand)** · Bloc date · CTA · Footer
- **data** : `{ djs: [{ name, photo? }] }`

### 4.7 — This week
- **Déclencheur** : récap des events des 7 prochains jours
- **Briques** : Header · Liste 2–4 events (date + titre + mini visuel) · CTA « SEE ALL » · Footer
- **data** : `{ events: [{ title, date, image? }] }`

### 4.8 — Hype monte
- **Déclencheur** : hype score franchit un seuil
- **Briques** : Header · Visuel · **Badge « IT'S HEATING UP »** · jauge hype · Bloc date · CTA · Footer
- **data** : `{ hypePct }`

### 4.9 — Recap de la nuit
- **Déclencheur** : event terminé + photos uploadées
- **Briques** : Header · **Grille photos 2×3** · titre « LAST NIGHT AT [venue] » · CTA « NEXT EVENT » · Footer
- **data** : `{ photos: [url], nextEventDate? }`

---

## 5. Contraintes techniques

- **1080 × 1920 strict.** Tout le texte critique dans la safe-zone (marge 60px) pour
  ne pas être masqué par l'UI Instagram (avatar haut, barre de réponse bas).
- **Images cross-origin** : prévoir `crossOrigin="anonymous"` (export canvas).
- **Footer Yuno identique** sur toutes les stories.
- **Accent paramétrable** partout où il y a du rouge aujourd'hui → variable `accentColor`.
- **Lisibilité mobile** : tester rendu à taille réelle écran téléphone, pas seulement aperçu.

---

## 6. Priorité de production

Si production échelonnée, faire dans cet ordre (impact ventes le plus direct) :

1. **Compte à rebours** (4.5) — utile sur 100% des events, déclencheur calendaire simple
2. **Last tables** (4.3) — pousse la marge la plus haute (tables VIP)
3. **Plus que N billets** (4.2) — urgence ventes, gros levier de conversion

Le reste suit une fois la DA validée sur ces trois-là.
