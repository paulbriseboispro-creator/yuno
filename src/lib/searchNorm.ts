// Normalisation du terme tapé dans la barre de recherche : minuscules + accents
// supprimés.
//
// Pendant front de `public.search_norm(text)` côté Postgres (migration
// 20260717150000_search_accent_insensitive.sql), qui génère les colonnes
// `search_*` des tables cherchées (venues, events, djs, affiliate_*,
// organizer_profiles). Le front normalise la REQUÊTE, Postgres a normalisé la
// DONNÉE : si les deux transformations divergent sur un caractère, ce caractère
// cesse silencieusement de matcher. Toucher l'une = toucher l'autre.
//
// NFD décompose une lettre accentuée en (lettre + diacritique combinant), et la
// plage U+0300..U+036F couvre tous les diacritiques FR/ES : é è ê ë à â ä ï î ô
// ö ù û ü á í ó ú, y compris ç (c + cédille) et ñ (n + tilde). Sur ces
// caractères — les seuls que tape un utilisateur FR/ES — les deux côtés donnent
// le même résultat.
//
// Équivalence volontairement partielle : `unaccent` replie aussi de la
// ponctuation (« Jeudi Étudiant — 14/05 » est stocké « jeudi etudiant - 14/05 » :
// tiret cadratin → tiret simple), ce que NFD ne fait pas. Sans effet en pratique,
// personne ne tape de tiret cadratin dans une recherche et « jeudi etudiant »
// matche de toute façon. Répliquer toute la table unaccent.rules en JS coûterait
// plus cher que le cas qu'elle couvrirait.
export function searchNorm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
