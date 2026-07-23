/**
 * Vocabulaire musical Yuno — source de vérité unique.
 *
 * Ces 8 libellés sont EXACTEMENT ceux proposés dans le filtre public
 * (Explorer > Filtres > Genre musical). Tout sélecteur de genre, quelle que
 * soit la surface (owner, organisateur, affilié, DJ, quiz de goûts), doit
 * piocher ici : un libellé inventé ailleurs produit une soirée que personne
 * ne peut retrouver au filtre.
 *
 * Le filtre compare les libellés stockés à ceux du filtre. Il n'y a pas de
 * table de correspondance côté explore : « Reggaeton » stocké ne remonte PAS
 * sur le filtre « Reggaeton / Latino ». D'où `canonicalGenre()` ci-dessous,
 * qui ramène tout l'existant (imports en minuscules, anciens libellés
 * affiliés, saisie libre) sur le vocabulaire officiel.
 */
export const MUSIC_GENRES = [
  'House',
  'Techno',
  'Rap / Hip-Hop',
  'Afro / Shatta',
  'Reggaeton / Latino',
  'Commercial / Hits',
  'Electro / EDM',
  'Open Format',
] as const;

export type MusicGenre = (typeof MUSIC_GENRES)[number];

/**
 * Clé de comparaison : minuscules, sans accents, sans ponctuation.
 * « R&B », « r and b », « R & B » → « r b ». « Électro » → « electro ».
 */
export function genreKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Anciens libellés → libellé officiel. Chaque clé est déjà passée au
 * `genreKey()`. Couvre les listes affiliées historiques (Afrobeats, Latin,
 * R&B, Drum & Bass, Hip-Hop, Electronic), la liste owner FR (Électro, Latino,
 * Commercial, Afro) et les imports en minuscules/slug (open-format, house).
 */
const GENRE_ALIASES: Record<string, MusicGenre> = {
  // House
  'house': 'House',
  'deep house': 'House',
  'tech house': 'House',
  'afro house': 'House',
  // Techno
  'techno': 'Techno',
  'hard techno': 'Techno',
  // Rap / Hip-Hop
  'rap': 'Rap / Hip-Hop',
  'hip hop': 'Rap / Hip-Hop',
  'hiphop': 'Rap / Hip-Hop',
  'rap hip hop': 'Rap / Hip-Hop',
  'r b': 'Rap / Hip-Hop',
  'rnb': 'Rap / Hip-Hop',
  'urban': 'Rap / Hip-Hop',
  'trap': 'Rap / Hip-Hop',
  // Afro / Shatta
  'afro': 'Afro / Shatta',
  'afro shatta': 'Afro / Shatta',
  'afrobeat': 'Afro / Shatta',
  'afrobeats': 'Afro / Shatta',
  'shatta': 'Afro / Shatta',
  'dancehall': 'Afro / Shatta',
  'amapiano': 'Afro / Shatta',
  // Reggaeton / Latino
  'reggaeton': 'Reggaeton / Latino',
  'reggaeton latino': 'Reggaeton / Latino',
  'latino': 'Reggaeton / Latino',
  'latin': 'Reggaeton / Latino',
  'latina': 'Reggaeton / Latino',
  'salsa': 'Reggaeton / Latino',
  'bachata': 'Reggaeton / Latino',
  // Commercial / Hits
  'commercial': 'Commercial / Hits',
  'commercial hits': 'Commercial / Hits',
  'hits': 'Commercial / Hits',
  'mainstream': 'Commercial / Hits',
  'pop': 'Commercial / Hits',
  'top 40': 'Commercial / Hits',
  'disco': 'Commercial / Hits',
  // Electro / EDM
  'electro': 'Electro / EDM',
  'electro edm': 'Electro / EDM',
  'electronic': 'Electro / EDM',
  'electronique': 'Electro / EDM',
  'edm': 'Electro / EDM',
  'trance': 'Electro / EDM',
  'drum bass': 'Electro / EDM',
  'drum and bass': 'Electro / EDM',
  'dnb': 'Electro / EDM',
  // Open Format
  'open': 'Open Format',
  'open format': 'Open Format',
  'openformat': 'Open Format',
  'all styles': 'Open Format',
  'varie': 'Open Format',
  'multi': 'Open Format',
};

/** Libellé officiel correspondant, ou `null` si le genre est inconnu. */
export function canonicalGenre(raw: string | null | undefined): MusicGenre | null {
  if (!raw) return null;
  return GENRE_ALIASES[genreKey(raw)] ?? null;
}

/**
 * Ramène une liste stockée sur le vocabulaire officiel, dédupliquée et
 * ordonnée comme `MUSIC_GENRES`. Les valeurs sans correspondance sont
 * écartées : un sélecteur est un vocabulaire fermé, et une valeur qu'aucune
 * puce ne peut afficher serait réenregistrée en aveugle au prochain save.
 */
export function canonicalGenres(raw: readonly string[] | null | undefined): MusicGenre[] {
  if (!raw?.length) return [];
  const found = new Set<MusicGenre>();
  for (const g of raw) {
    const c = canonicalGenre(g);
    if (c) found.add(c);
  }
  return MUSIC_GENRES.filter((g) => found.has(g));
}

/**
 * Un genre stocké correspond-il à un genre sélectionné au filtre ?
 * Passe d'abord par les alias (donc « reggaeton » en base remonte bien sur
 * « Reggaeton / Latino »), avec repli sur l'égalité normalisée pour les
 * valeurs hors vocabulaire.
 */
export function genresMatch(stored: string, selected: string): boolean {
  const a = canonicalGenre(stored);
  const b = canonicalGenre(selected);
  if (a && b) return a === b;
  return genreKey(stored) === genreKey(selected);
}
