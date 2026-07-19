// Generate one .design-sync/docs/<Name>.md per component.
//
// Two jobs at once:
//  1. `category:` frontmatter groups the component in the Design System pane.
//     Note: design-sync only lets a doc category override a group that is
//     'general', so the explore/ components keep their dir-derived group
//     ('explore') — that's deliberate, they ARE the public Explore vocabulary.
//  2. The body becomes <Name>.prompt.md — the usage reference the Claude Design
//     agent reads. The generated "## Props" block is appended automatically from
//     the .d.ts, so bodies here cover intent and composition, not prop tables.
//
// Committed (durable). Re-run: node .design-sync/gen-docs.mjs
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.design-sync/docs';
mkdirSync(OUT, { recursive: true });

// category → [Name, one-line summary, optional composition note]
const DOCS = {
  actions: [
    ['Button', "Bouton d'action publique — CTA d'achat, ajout au panier, suivi d'un club.", "Sur les surfaces publiques, privilégier `variant=\"default\"` (rouge #E8192C) pour l'action principale d'un écran, une seule par vue. `size=\"lg\"` pour les CTA de checkout, `icon` pour les actions flottantes (favori, partage)."],
    ['Badge', "Pastille de statut éditorial — genre musical, « SOLD OUT », « LIVE », rareté.", "Le vocabulaire nightlife passe en mono uppercase tracké. Rouge = urgence/live, ambre = rareté, violet = partenaire/affilié."],
  ],
  surfaces: [
    ['Card', "Conteneur de surface générique.", "Attention : sur les surfaces publiques éditoriales, préférer les composants `Explore*Card` ou les classes CSS `.event-card` / `.yuno-card`, qui portent le radius tranchant (2–4px) et la trame du design system public. `Card` reste utile pour les blocs de formulaire et de checkout."],
    ['CardHeader', "En-tête d'une `Card` — titre + description."],
    ['CardTitle', "Titre d'une `Card`."],
    ['CardDescription', "Texte secondaire d'une `Card`."],
    ['CardContent', "Corps d'une `Card`."],
    ['CardFooter', "Pied d'une `Card` — actions de fin de bloc."],
    ['Avatar', "Photo de profil — client, DJ, organisateur, promoteur.", "Toujours composer avec `AvatarImage` + `AvatarFallback` : les photos de DJ/clubs viennent du Storage et manquent souvent."],
    ['AvatarImage', "Image d'un `Avatar`."],
    ['AvatarFallback', "Repli d'un `Avatar` quand l'image manque — initiales."],
    ['Separator', "Filet de séparation.", "Sur l'éditorial, la règle horizontale de marque est la classe CSS `.yuno-rule` ; `Separator` sert aux blocs de formulaire."],
    ['Skeleton', "Bloc de chargement.", "Le public charge beaucoup d'images (affiches d'events) : montrer la structure de la carte, jamais un écran vide."],
  ],
  formulaires: [
    ['Input', "Champ de saisie — recherche, email, code promo, quantité."],
    ['Textarea', "Saisie multi-lignes — demande spéciale sur une réservation de table."],
    ['Label', "Libellé de champ.", "Toujours lié à son champ via `htmlFor` — les parcours de checkout publics sont majoritairement mobiles."],
    ['Checkbox', "Case à cocher — CGV, opt-in marketing, filtres."],
    ['Select', "Liste déroulante — ville, genre musical, taille de table.", "Composé : `Select` > `SelectTrigger` > `SelectValue`, puis `SelectContent` > `SelectItem`."],
    ['SelectTrigger', "Déclencheur visible d'un `Select`."],
    ['SelectValue', "Valeur affichée dans le `SelectTrigger`."],
    ['SelectContent', "Panneau déroulant d'un `Select`."],
    ['SelectItem', "Option d'un `Select`."],
    ['SelectGroup', "Groupe d'options d'un `Select`."],
    ['SelectLabel', "Titre d'un `SelectGroup`."],
    ['SelectSeparator', "Séparateur entre groupes d'options."],
    ['SelectScrollUpButton', "Bouton de défilement haut d'un `SelectContent`."],
    ['SelectScrollDownButton', "Bouton de défilement bas d'un `SelectContent`."],
    ['Slider', "Curseur de plage — filtre de prix, distance, budget table."],
    ['Calendar', "Sélecteur de date — filtrer les events par soirée."],
    ['InputOTP', "Saisie de code à usage unique — vérification téléphone, récupération de commande.", "Composé : `InputOTP` > `InputOTPGroup` > `InputOTPSlot`, `InputOTPSeparator` entre les groupes."],
    ['InputOTPGroup', "Groupe de cases d'un `InputOTP`."],
    ['InputOTPSlot', "Case unique d'un `InputOTP`."],
    ['InputOTPSeparator', "Séparateur entre deux groupes d'`InputOTP`."],
  ],
  overlays: [
    ['Dialog', "Fenêtre modale centrée — confirmation, détail d'un billet, sélection de table.", "Composé : `Dialog` > `DialogTrigger` + `DialogContent` (> `DialogHeader` > `DialogTitle`/`DialogDescription`, puis `DialogFooter`). Sur mobile public, préférer `Drawer`."],
    ['DialogTrigger', "Élément qui ouvre un `Dialog`."],
    ['DialogContent', "Panneau d'un `Dialog`."],
    ['DialogHeader', "En-tête d'un `DialogContent`."],
    ['DialogTitle', "Titre d'un `Dialog`."],
    ['DialogDescription', "Sous-titre d'un `Dialog`."],
    ['DialogFooter', "Zone d'actions d'un `Dialog`."],
    ['DialogClose', "Élément qui ferme un `Dialog`."],
    ['DialogOverlay', "Voile derrière un `Dialog`."],
    ['DialogPortal', "Portail de rendu d'un `Dialog`."],
    ['Drawer', "Panneau glissant depuis le bas — le format modal par défaut du public mobile.", "Composé comme `Dialog` : `Drawer` > `DrawerTrigger` + `DrawerContent` > `DrawerHeader`/`DrawerFooter`. C'est le bon choix pour choisir une quantité de billets ou une bouteille."],
    ['DrawerTrigger', "Élément qui ouvre un `Drawer`."],
    ['DrawerContent', "Panneau d'un `Drawer`."],
    ['DrawerHeader', "En-tête d'un `DrawerContent`."],
    ['DrawerTitle', "Titre d'un `Drawer`."],
    ['DrawerDescription', "Sous-titre d'un `Drawer`."],
    ['DrawerFooter', "Zone d'actions d'un `Drawer`."],
    ['DrawerClose', "Élément qui ferme un `Drawer`."],
    ['DrawerOverlay', "Voile derrière un `Drawer`."],
    ['DrawerPortal', "Portail de rendu d'un `Drawer`."],
  ],
  navigation: [
    ['BottomNav', "Barre de navigation basse de la PWA publique — la navigation principale côté client.", "C'est le chrome de navigation du public (le pro utilise une sidebar verticale). Présente sur Explore, favoris, commandes, profil."],
    ['BottomNavBar', "Primitive de présentation de la barre basse."],
    ['Tabs', "Onglets de section — « Billets / Tables / Boissons » sur une fiche event.", "Composé : `Tabs` > `TabsList` > `TabsTrigger`, puis `TabsContent` par onglet."],
    ['TabsList', "Rail des déclencheurs d'un `Tabs`."],
    ['TabsTrigger', "Onglet cliquable d'un `Tabs`."],
    ['TabsContent', "Panneau associé à un `TabsTrigger`."],
  ],
  marque: [
    ['AnimatedOrb', "Orbe animée de l'assistant Yuno — signature de marque de la page /assistant."],
  ],
};

// Editorial components keep their dir-derived group ('explore'); no category
// is emitted for them, only the body.
const EDITORIAL = [
  ['EventCard', "Carte d'event — l'unité éditoriale centrale du public : affiche pleine, titre, club, date mono, prix « from ».", "Prend un objet `event` (`EventCardData`) complet. C'est le composant à réutiliser dès qu'un event est listé ; ne pas le reconstruire à la main."],
  ['ExploreVenueCard', "Carte de club dans Explore — visuel, nom, ville, signaux d'affluence."],
  ['ExploreDJCard', "Carte de DJ — portrait, nom, genres."],
  ['ExploreRailCard', "Carte compacte pour rail horizontal scrollable."],
  ['ExploreRankCard', "Carte de classement — clubs ou events les plus demandés, avec rang."],
  ['ExplorePopularClubCard', "Carte de club populaire, format mis en avant."],
  ['ExploreListRow', "Ligne de liste dense — alternative verticale aux cartes."],
  ['ExploreSeeAllCard', "Carte terminale « voir tout » en fin de rail."],
  ['ExploreEventCarousel', "Carrousel horizontal d'`EventCard`.", "Le motif de mise en page dominant d'Explore : une `ExploreSectionTitle` suivie d'un carrousel."],
  ['ExploreSectionTitle', "Titre de section éditoriale — en display, souvent uppercase."],
  ['ExploreChipRow', "Rangée de filtres en pastilles — genre, soirée, quartier."],
  ['ExploreDayTabs', "Sélecteur de jour — « ce soir », « demain », « week-end »."],
];

let n = 0;
const write = (name, category, summary, note) => {
  const fm = category ? `---\ncategory: ${category}\n---\n\n` : '';
  const body = `${summary}\n${note ? `\n${note}\n` : ''}`;
  writeFileSync(join(OUT, `${name}.md`), fm + body);
  n++;
};

for (const [category, rows] of Object.entries(DOCS))
  for (const [name, summary, note] of rows) write(name, category, summary, note);
for (const [name, summary, note] of EDITORIAL) write(name, null, summary, note);

// Guard: every component in the last build must have a doc, or it silently
// lands in 'general' with a synthesized prompt.
const built = 'ds-bundle/components';
if (existsSync(built)) {
  const all = readdirSync(built).flatMap((g) => readdirSync(join(built, g)));
  const missing = all.filter((c) => !existsSync(join(OUT, `${c}.md`)));
  if (missing.length) console.error(`! sans doc (${missing.length}): ${missing.join(' ')}`);
}
console.error(`  docs: ${n} fichiers -> ${OUT}`);
