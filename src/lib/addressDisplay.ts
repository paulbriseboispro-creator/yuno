/**
 * Adresse lisible d'une fiche soirée : « rue, numéro, ville ».
 *
 * L'adresse enregistrée est celle de la recherche d'adresse
 * (« C. Escuderos, 5, 40001 Segovia, España ») : code postal, région et pays
 * y sont, et la ville y est déjà — la fiche l'affichait en plus sur une ligne
 * « Ville ». Ici on garde ce qui sert à trouver la porte et on ne répète rien.
 * L'itinéraire, lui, part toujours de l'adresse COMPLÈTE (bouton Maps).
 */

const COUNTRIES = new Set([
  'france', 'espana', 'spain', 'espagne', 'portugal', 'italia', 'italy', 'italie',
  'deutschland', 'germany', 'allemagne', 'alemania', 'belgique', 'belgium', 'belgica',
  'suisse', 'switzerland', 'schweiz', 'suiza', 'united kingdom', 'royaume-uni', 'reino unido', 'uk',
  'netherlands', 'nederland', 'pays-bas', 'paises bajos', 'luxembourg', 'luxemburgo',
  'monaco', 'andorra', 'andorre',
]);

/** Minuscules, sans accent : « España » = « espana ». */
const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** « 40001 Segovia » → « Segovia » ; « 28010 » seul → rien. Un numéro de rue (1 à 3 chiffres) reste. */
function withoutPostalCode(part: string): string {
  const m = part.match(/^\d{4,5}(?:\s+(.+))?$/);
  if (!m) return part;
  return (m[1] ?? '').trim();
}

export function shortAddress(
  address: string | null | undefined,
  city: string | null | undefined,
): string | null {
  const raw = (address ?? '').trim();
  if (!raw) return null;

  let parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  // Le pays ferme l'adresse : il n'aide personne à trouver la porte.
  if (parts.length > 1 && COUNTRIES.has(fold(parts[parts.length - 1]))) parts = parts.slice(0, -1);

  parts = parts.map(withoutPostalCode).filter(Boolean);

  const cityName = (city ?? '').trim();
  if (cityName) {
    const cityKey = fold(cityName);
    const at = parts.findIndex((p) => fold(p) === cityKey);
    if (at >= 0) {
      // Ce qui suit la ville (région, province) est du bruit ; la ville elle-même reste, une fois.
      parts = parts.slice(0, at + 1);
    } else if (parts.length > 0) {
      parts.push(cityName);
    }
  }

  const line = parts.join(', ');
  return line || null;
}
