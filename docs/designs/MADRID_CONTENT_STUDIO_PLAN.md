# Studio de contenu Yuno Madrid : plan (04/10/2026, à valider par Paul)

But : chaque semaine, les posts et stories du compte Instagram Yuno Madrid sont
fabriqués automatiquement à partir des soirées vendues via Mad by Night. Ils
reprennent les 6 styles officiels du projet Claude Design « Yuno Madrid - Studio
13 posts », utilisent des photos des clubs (pas seulement leurs affiches) et
arrivent prêts à publier dans Yuno Cockpit : images, légende, tags, consignes de
story. Paul relit, publie depuis son téléphone et coche « publié ».

Plan validé par Paul le 05/10/2026, avec ces décisions :

- Les posts sont pour **Yuno uniquement**. On ne mentionne JAMAIS Mad by Night
  (ni sur l'image, ni en légende, ni en tag) : c'est l'agence partenaire qui
  fournit les soirées, pas une marque affichée.
- Photos des clubs : toutes utilisables (les patrons connaissent Yuno et ont
  dit oui). Pas besoin de demander d'accord.
- Collecte : on prend le lien Instagram du club et on télécharge les photos
  par un outil type saveclip.app, sans se connecter à Instagram.
- On ne parle que des soirées en ligne sur Yuno.
- Posts en anglais. Contenu de la semaine prêt le dimanche à 16:00.
- **C'est Paul qui choisit** chaque dimanche les soirées et clubs mis en avant la
  semaine suivante (ordre = son classement). Le Studio ne sélectionne rien seul :
  il ne fait que mettre en forme sa sélection. Un post dont le choix manque est
  sauté, jamais rempli automatiquement.
- Mad by Night reste affiché sur les pages publiques de Yuno (agence de
  promoteurs) ; seuls nos posts, légendes et stories ne le nomment jamais.
- Stories : chaque post a sa story compagne (15 min après), et le Top 5 revient
  plusieurs fois dans la semaine (lun, mar, jeu, puis Top 3 ven/sam, Top 5 de la
  semaine suivante le dimanche), refait à chaque fois avec les soirées restantes.

---

## 1. État des lieux (mesuré le 04/10)

### Les gabarits (Claude Design, projet « Carrousels templates »)

- `Yuno Madrid - Studio 13 posts.html` = 14 posts (`plan13.jsx`, le 14 « Week by
  night » ajouté le 04/10) × 6 styles (T1 Semaine, T2 Affiche club, T3 Club plein
  cadre, T4 Légende N&B, T5 Vitrine floutée, T6 Weekender) + 11 types de stories
  × 6 styles (`stories-studio.jsx`). Formats 1080 × 1350 et 1080 × 1920.
- Les données de démo sont dans `plan13.jsx` (`NIGHTS13`, semaine du 30.09) et
  `s14-a.jsx` (`NIGHTS14`). Beaucoup de textes sont écrits en dur dans chaque
  gabarit (« Kapital 7 floors », « Seven floors, seven vibes »…). Ce sont des
  exemples, pas des données justes.
- Chaque texte (`Edit`) et chaque image (`ImgSlot`) a une clé (`storeKey`). Une
  modification à la main est enregistrée sous cette clé. L'export PNG se fait à
  la main, slide par slide (`html-to-image`).
- La DA est écrite dans `DA-Yuno-Madrid-6-styles.md` et les règles du plan dans
  `uploads/plan-posts.txt` (PDF du 30.09) : anglais, « Find it on Yuno », aucun
  chiffre inventé, 4 posts feed par semaine.

### Les soirées (base Yuno, agence Mad by Night)

- 24 clubs rattachés à Mad by Night, tous avec leur compte Instagram en base
  (`affiliate_venues.instagram`), une photo de couverture et 1 à 8 photos de
  galerie.
- Semaine du 05 au 11.10 : 66 soirées en base, mais seulement **30 ont un lien
  de vente** (statut publié). Elles viennent de 7 clubs : Los Amantes (6),
  Istar (6), Rubicon (5), Teatro Kapital (5), Todos Santos (4), Victoria (3),
  Nômada (1). Les 36 autres sont des brouillons sans lien : on ne peut pas les
  acheter, donc elles n'iront jamais dans un post.
- Liens : Whan pour 6 clubs (synchro automatique tous les jours à 18 h,
  `affiliate-ticket-sync`, comptes `paul-brisebois-2` et `milo-madbynight`).
  Teatro Kapital passe par **ton lien ticketclub.es** (`c=tkpaulbrisebois`),
  posé sur les modèles récurrents.
- Ce que la base donne pour chaque soirée : nom, date, heure de début et de fin,
  affiche, lien, prix « à partir de », genres (8 étiquettes larges), tables /
  guest list. Ce qu'elle ne donne pas : DJ (vide partout), description, dress
  code. Les noms Whan sont souvent en capitales (« FITZ MONDAY »). Un prix à 0
  sans `is_free` veut dire « prix inconnu » (Istar).

### Les photos (`~/Desktop/Yuno/Site Web/Clubs/`)

- 24 dossiers, environ 200 fichiers. Le type de photo voulu est clair : foule
  qui danse, clients bien habillés qui posent, la salle avec ses lumières
  (lasers, lustres, néons), le DJ, les bouteilles à étincelles, les shows.
  Aucune affiche, presque pas de texte, format portrait.
- Problèmes : la plupart des fichiers sont dans iCloud et pas sur le Mac (ils se
  téléchargent à la demande, lentement) ; beaucoup font 640 px de large (copies
  de la grille Instagram), trop petits pour un fond plein cadre en 1080 px ; 6
  dossiers ne correspondent pas aux clubs Mad by Night (Houdini, Icon, Shoko,
  dossier sans nom) et Nômada n'a pas de dossier.

### Instagram

- Lecture anonyme bloquée : l'appel public au profil de `teatrokapitaloficial`
  répond « require_login » (testé le 04/10 depuis le Mac). Il faut un navigateur
  connecté à un compte Instagram.

### Yuno Cockpit (`~/Desktop/yuno-cockpit.nosync`)

- Next 16 sur Vercel, Postgres, un seul utilisateur. La page « Insta & site »
  (`/contenu`) compte les posts, reels et stories par compte (`ig_madrid`) contre
  un rythme hebdo, avec des « chantiers » (listes à cocher).
- Pas de calendrier de publication, pas d'images, pas de légendes. Règle posée
  le 23/09 : pas d'IA ni d'API tierce dans le Cockpit. Le plan la respecte :
  l'IA travaille sur le Mac, le Cockpit ne fait que recevoir et afficher.

---

## 2. Quels posts on peut automatiser

| | Post | Données nécessaires | Verdict |
|---|---|---|---|
| 1 | This week in Madrid | 4 soirs forts de la semaine | Automatique |
| 14 | Week by night | 2 soirées mer/jeu/ven + 1 samedi | Automatique |
| 2 | The One | la soirée phare + photo | Automatique |
| 3 | Weekend at [club] | un club avec 3 soirs (Kapital, Istar, Rubicon, Los Amantes en ont) | Automatique |
| 7 | This or That | 2 clubs le samedi, prix, heures | Automatique |
| 5 | Club spotlight | photos (auto) + fiche du club : salle, son, étages, quartier | Semi : fiche écrite une fois par club, validée par Paul |
| 4 | Radar | 5 noms d'artistes | Semi : Whan ne donne pas les DJ ; on peut tirer les collectifs des titres (« Fever Room x FREi », « HOUSEO X KORA ») ou Paul donne les noms |
| 6 | Last night | photos du week-end écoulé | Semi : photos de récap publiées par les clubs le lundi (avec crédit), ou celles de Paul |
| 8 | Special night | soirée Yuno × Madrid No Descansa | Semi : pré-rempli depuis la soirée, line-up par Paul |
| 11 | Now on Yuno | un club qui signe | Semi : pré-rempli depuis la fiche du club, déclenché par Paul |
| 9, 10 | What is Yuno, How it works | captures de l'app | Fait une fois, republié chaque mois |
| 12, 13 | Agency spotlight, Call for agencies | décision B2B | Manuel |

Stories :

| | Story | Verdict |
|---|---|---|
| S1 | Week Opener (1 club par frame) | Automatique |
| S2 | Venue Focus (un club, ses soirs) | Automatique |
| S9 | Top 5 of the week | Automatique |
| S10 | Top 3 tonight | Automatique, refait le jour même |
| S11 | Tonight | Automatique, refait le jour même |
| S5 | Artists list | Semi (même limite que Radar) |
| S3, S4, S6 | Takeover, Reveal, Reel relay | Manuel |
| S7, S8 | Partners, The App | Fait une fois |

Bilan : 5 posts sur 14 et 5 stories sur 11 tournent seuls ; ce sont ceux qui
font le gros du rythme hebdo (lundi, jeudi, dimanche, et les stories de vente).

---

## 3. Comment ça marche (vue d'ensemble)

```
Base Yuno (soirées Mad by Night, liens Whan + Kapital)
        │
        ▼
Studio, sur le Mac de Paul (Claude)                Banque photos par club
  1. lit le calendrier de la semaine (Cockpit)  ◄── ~/Desktop/Yuno/Site Web/Clubs
  2. choisit les soirées et les photos
  3. écrit les textes et la légende
  4. remplit le gabarit Claude Design du bon style
  5. rend les PNG (Chrome sans écran), les regarde, corrige
        │
        ▼
Yuno Cockpit → page « Publications »
  calendrier · images · légende · tags · consignes story
  → Paul enregistre dans Photos, publie, coche « publié »
```

---

## 4. Banque photos par club

1. **Source** : le compte Instagram de chaque club, lu en base
   (`affiliate_venues.instagram`). Pas de connexion à Instagram.
2. **Collecte** : par un outil de téléchargement type saveclip.app, qui
   récupère les images en pleine taille (1080 px), carrousels compris, sur les
   30 à 40 derniers posts. Rythme lent, un club à la fois. Ordre : les 7 clubs
   qui ont des liens cette semaine, puis les 17 autres.
3. **Tri automatique sur le Mac** (gratuit, sans service extérieur) :
   - plus petit côté ≥ 1080 px, sinon écartée ;
   - texte détecté par l'OCR de macOS (Vision) : une image couverte de texte est
     une affiche, elle va dans `affiches/` et pas dans la banque ;
   - doublons écartés (empreinte d'image), y compris avec les photos existantes.
4. **Tri par moi** : je regarde chaque club en planche contact et je garde les
   25 à 40 meilleures, réparties en catégories : salle et lumières, foule, gens
   (portraits, groupes), DJ et scène, détails (bouteilles, déco), extérieur.
5. **Rangement** : dans le dossier existant du club, sans toucher à ce qui y
   est. Fichiers `ig-AAAAMMJJ-<code>.jpg`, un index `_photos.json` par club
   (lien du post source, date, catégorie, orientation, dates d'utilisation). Le
   dossier Nômada est créé. Les dossiers hors Mad by Night (Houdini, Icon,
   Shoko) ne bougent pas.
6. **Copie de travail hors iCloud** : le Studio garde une copie locale (dossier
   `.nosync`), parce qu'un fichier resté dans iCloud bloque le rendu.
7. **Rafraîchissement** : une fois par mois (nouvelles photos des clubs).
8. Bonus possible, à décider : remplacer les galeries des pages clubs de Yuno
   (photos en 640 px aujourd'hui) par les versions 1080.

Droits : accord des patrons (Paul, 05/10). Chaque post crédite quand même le
club (tag + 📸 @club en légende), ce qui aide au repost.

---

## 5. Règles éditoriales (appliquées à chaque génération)

### Quelles soirées

- Seulement les soirées publiées, avec un lien de vente, dans la semaine visée.
- Classement : club phare (Kapital, Rubicon, Victoria, Todos Santos, Istar,
  Los Amantes…), vendredi et samedi d'abord, édition spéciale ou soirée invitée
  en bonus, photos disponibles en bonus, club déjà mis en avant la semaine
  d'avant en malus.
- 2 soirées maximum par jour dans les agendas (les gabarits sont faits pour ça).

### Quels textes

- Nom affiché nettoyé : « Thursdays at Rubicon - Committee » devient
  « Committee at Rubicon », « Teatro Kapital SATURDAY » devient « Kapital
  Saturday ».
- Prix : « From 25€ » si connu, « Free entry » si gratuit, rien si inconnu. Jamais
  un prix inventé.
- Genre : étiquette de la base, précisée par la fiche du club.
- Une phrase d'accroche par soirée, écrite par moi à partir de la fiche club,
  sans invention (pas de DJ, d'étage ou de chiffre qui n'est pas dans les
  données ; une donnée manquante reste vide, pas entre crochets à l'écran).
- Langue : anglais (règle de la DA).

### Quelles photos (la règle « diversité »)

- La couverture d'un post n'est jamais une affiche.
- Les styles qui recolorent l'image (T2 N&B, T3 teinte rouge, T4 N&B) ne
  prennent que des photos de club : une affiche y devient illisible.
- Une affiche n'est permise qu'en vignette d'agenda (T1, T6) ou pour une
  soirée spéciale ou un artiste invité, et au plus 1 slide sur 3.
- Une photo ne sert pas deux fois dans la même semaine, ni de nouveau sur le
  feed avant 6 semaines. On alterne les catégories d'une slide à l'autre.
- La photo d'une soirée vient du club de cette soirée.

### Légende (format du plan du 30.09)

1. Une accroche qui affirme (« Madrid stays up this week »).
2. La liste des soirées, une ligne chacune (« FRI 10.10 · Rubicon · Reggaeton »).
3. Une question (« Which night is yours? »).
4. « Find it on Yuno, link in bio. »
5. Crédits photo et tags des clubs, 8 à 12 hashtags (un socle fixe + quelques
   tournants).

Stories : consignes prêtes à suivre (texte du sticker lien et l'URL à coller,
choix du sondage, heure du compte à rebours). Le lien d'une story pointe sur la
page Yuno de la soirée avec `utm_source=instagram&utm_medium=story`, ce qui
permet de lire les clics dans le trafic Mad by Night.

---

## 6. Moteur de rendu (le « Studio »)

- Nouveau dossier `~/Desktop/yuno-studio.nosync` (dépôt git à part), sur le Mac.
- On copie les fichiers du projet Claude Design **sans les modifier**. Les
  données sont injectées de deux façons :
  - les tableaux de démo (`NIGHTS13`, `NIGHTS14`, `RADAR13`, `WK13`) sont
    remplacés par ceux de la vraie semaine avant le chargement des gabarits ;
  - les textes et images écrits en dur sont remplis par leur clé (`storeKey`),
    exactement comme une modification faite à la main dans l'éditeur. Une table
    de correspondance par gabarit dit quelle clé reçoit quoi.
  Si Paul retouche un gabarit dans Claude Design, je le réimporte et rien
  d'autre ne change. Première tâche de l'étape 2 : vérifier ce mécanisme sur un
  gabarit avant de l'étendre aux autres.
- Rendu : Chrome sans écran piloté par Node (pas de Playwright, déjà fait dans
  le projet), polices téléchargées en local, PNG 1080 × 1350 et 1080 × 1920.
- Texte trop long : réduction automatique de la taille jusqu'à ce qu'il tienne,
  puis je regarde chaque image avant l'envoi. Un rendu raté n'est jamais envoyé.
- Cadrage des photos : point d'intérêt calculé par macOS (visages, saillance).

---

## 7. Le calendrier

Point de départ, le rythme du 30.09 :

| Jour | Feed | Stories |
|---|---|---|
| Lun 19:30 | Post 1 This week ou 14 Week by night | S1 Week Opener (4 à 5 frames) |
| Mar | pas de post | question « Where are you going this week? » |
| Mer 19:30 | Post 5 Spotlight ou 4 Radar (B2B / concept en semaine 4) | relais du post |
| Jeu 13:00 | Post 2 The One ou 3 Weekend at | relais + sticker lien |
| Ven 17:00 | pas de post | Friday Drop : S10 Top 3 tonight + 1 frame par soirée |
| Sam 21:00 | pas de post | S11 Tonight + compte à rebours |
| Dim 18:00 | Post 7 This or That ou 6 Last night | relais |

On le construit ensemble (étape 3) sur 4 semaines, avec :

- la rotation des posts (S1 à S4 du plan du 30.09) ;
- la rotation des styles : chaque post reçoit un style, jamais deux fois le même
  style d'affilée sur le feed, les 6 styles reviennent toutes les 2 semaines ;
- la rotation des clubs en spotlight, limitée aux clubs qui ont des liens.

Le calendrier vit dans le Cockpit (Paul peut changer un post, un style, un
horaire ; le Studio suit).

---

## 8. Yuno Cockpit : page « Publications »

- Nouvelle table `ck_publications` : date, heure, compte (`ig_madrid`), type
  (post, story), numéro du plan (1 à 14, S1 à S11), style (T1 à T6), soirées
  concernées, statut (prévu, prêt, publié, sauté), légende, hashtags, comptes à
  taguer, consignes story, images, remarque de Paul.
- Page calendrier (semaine et 4 semaines) : chaque jour montre ses posts avec
  leurs miniatures et leur statut.
- Fiche d'un post : toutes les slides, **« Enregistrer dans Photos »** (feuille
  de partage de l'iPhone, pour publier depuis le téléphone), « Copier la
  légende », comptes à taguer, consignes de story.
- **« C'est publié »** enregistre l'activité dans le compteur existant
  (`ig_madrid`, post ou story) : le rythme hebdo et l'XP suivent sans double
  saisie.
- Un champ remarque (« photo trop sombre slide 3 ») : je le lis au passage
  suivant et je refais le post.
- Images hébergées dans un dossier de stockage du projet Supabase de Yuno (les
  posts sont destinés à être publics). Le Studio écrit dans le Cockpit par une
  route protégée par un jeton secret, comme les crons existants.

---

## 9. Quand ça tourne

Tâches planifiées de l'app Claude sur le Mac (le Mac doit être allumé, l'app
ouverte) :

- **Dimanche 16:00** : posts et stories de la semaine suivante, envoyés au
  Cockpit, notification « contenu de la semaine prêt » (le Cockpit a déjà les
  notifications).
- **Chaque jour 12:00** : stories du jour recalculées (Tonight, Top 3) avec les
  liens arrivés entre-temps (la synchro Whan tourne à 18 h la veille).
- **Le 1er du mois** : rafraîchissement de la banque photos (session Instagram
  à garder ouverte dans le navigateur intégré).

---

## 10. Étapes et livrables

| Étape | Ce qui est fait | Ce que Paul reçoit |
|---|---|---|
| 1. Banque photos | collecte, tri, rangement des 24 clubs | une planche contact par club, à barrer si une photo ne va pas |
| 2. Studio | import des gabarits, injection des données, rendu | la semaine du 12 au 18.10 rendue pour de vrai : posts 1, 14, 2, 3, 7 et 5 stories, dans les 6 styles, pour juger la qualité |
| 3. Calendrier | 4 semaines construites ensemble | le calendrier validé, dans le Cockpit |
| 4. Cockpit | page Publications, stockage, route du Studio | la page en ligne, testée sur iPhone |
| 5. Automatisation | tâches planifiées, deux semaines de rodage | le contenu qui arrive seul chaque dimanche |

Les étapes 1 et 2 peuvent avancer en parallèle. Les fiches clubs (pour le post
5) sont écrites pendant l'étape 1.

---

## 11. Décisions (prises le 05/10)

Voir l'en-tête : posts Yuno uniquement sans jamais nommer Mad by Night, photos
libres d'usage, collecte sans connexion Instagram, soirées en ligne seulement,
anglais, prêt le dimanche à 16:00.

Suite du 05/10 : Paul choisit chaque dimanche les soirées et clubs mis en avant
(Cockpit › Choix de la semaine), le Studio ne choisit jamais. Calendrier
« informer, convertir, fidéliser » validé, avec deux consignes de Paul : il publie
tout lui-même à la main, et pas de Reel dans l'automatisation pour l'instant (le
Spotlight du mercredi reste un carrousel). Rythme détaillé dans le README du Studio
(`~/Desktop/yuno-studio.nosync/README.md`, section « Le calendrier »).

## 12. Risques

- L'outil de téléchargement peut changer ou bloquer : on garde le rythme lent,
  la collecte mensuelle, et un outil de rechange.
- Données Whan incomplètes (pas de DJ, prix parfois inconnus) : on n'invente
  rien, le texte s'adapte.
- Un gabarit pensé pour 2 soirées par jour : une semaine creuse ou pleine
  change la structure ; la sélection s'y adapte, et je vérifie chaque rendu.
- Le Mac doit être allumé aux heures prévues ; sinon la tâche tourne au
  prochain réveil.
- Publication automatique sur Instagram : hors périmètre (elle passe par l'App
  Review Meta). Paul publie lui-même depuis son téléphone.
