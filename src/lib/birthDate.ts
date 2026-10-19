// Date de naissance saisie en trois cases Jour / Mois / Année (modèle « memorable
// date » de GOV.UK) : le calendrier natif oblige à remonter vingt ans mois par
// mois, et 27 % des acheteurs hésitent déjà à donner cette date (Baymard). La
// lecture vit ici, pure et testée, pour que l'écran ne dise jamais « invalide »
// à une date juste ni « valide » au 31 février.

export interface BirthDateParts {
  day: string;
  month: string;
  year: string;
}

export type BirthDateField = 'day' | 'month' | 'year';

export type BirthDateState =
  | { status: 'empty' }
  /** Une case vide ou trop courte : la première qui manque. */
  | { status: 'incomplete'; field: BirthDateField }
  /** Date impossible (31/02), dans le futur ou avant 1900. */
  | { status: 'invalid' }
  | { status: 'valid'; iso: string };

const MIN_YEAR = 1900;

const digits = (s: string) => s.replace(/\D/g, '');

/** Ne garde que des chiffres, au plus `max`. */
export function clampDigits(raw: string, max: number): string {
  return digits(raw).slice(0, max);
}

export function readBirthDate(parts: BirthDateParts, now: Date = new Date()): BirthDateState {
  const day = digits(parts.day);
  const month = digits(parts.month);
  const year = digits(parts.year);
  if (!day && !month && !year) return { status: 'empty' };
  if (!day) return { status: 'incomplete', field: 'day' };
  if (!month) return { status: 'incomplete', field: 'month' };
  if (year.length < 4) return { status: 'incomplete', field: 'year' };

  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < MIN_YEAR) return { status: 'invalid' };
  // Le constructeur UTC « déborde » sur le mois suivant pour un 31 février :
  // on relit la date pour savoir si elle existe.
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { status: 'invalid' };
  }
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (date.getTime() > today) return { status: 'invalid' };

  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { status: 'valid', iso };
}

/** « 2001-03-14 » → cases ; toute autre forme → cases vides. */
export function splitIsoBirthDate(iso: string | null | undefined): BirthDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!match) return { day: '', month: '', year: '' };
  return { day: match[3], month: match[2], year: match[1] };
}

/**
 * Une date collée d'un coup (« 14/03/2001 », « 14.03.2001 », « 2001-03-14 »,
 * « 14032001 ») remplit les trois cases. Rien de reconnaissable → null, et la
 * case garde la saisie normale.
 */
export function partsFromPaste(text: string): BirthDateParts | null {
  const s = text.trim();
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (iso) return { day: iso[3].padStart(2, '0'), month: iso[2].padStart(2, '0'), year: iso[1] };
  const dmy = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/.exec(s);
  if (dmy) return { day: dmy[1].padStart(2, '0'), month: dmy[2].padStart(2, '0'), year: dmy[3] };
  const packed = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (packed) return { day: packed[1], month: packed[2], year: packed[3] };
  return null;
}

/** Âge révolu à une date donnée (même règle que la porte de MinorAuthGate). */
export function ageOn(iso: string, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  let age = now.getFullYear() - y;
  const monthDiff = now.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d)) age--;
  return age;
}
