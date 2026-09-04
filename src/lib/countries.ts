// Single source of truth for country metadata across the app:
// - phone input (dial code + flag picker)
// - customer origin mapping (derive nationality from the phone dial code,
//   match to the world-atlas choropleth via ISO 3166-1 numeric `id`).
import type { Language } from '@/i18n/data';

export interface Country {
  code: string;        // ISO 3166-1 alpha-2 (FR, ES, ...)
  dialCode: string;    // E.164 prefix ("+33")
  flag: string;        // emoji flag
  format: string;      // placeholder format for the phone input
  isoNumeric: number;  // ISO 3166-1 numeric — matches world-atlas geography ids
  names: { en: string; es: string; fr: string };
  /** Longer, more specific prefixes that also belong to this entry. Mayotte and
   *  La Réunion share +262, Porto Rico lives inside the +1 plan : c'est le
   *  préfixe le PLUS LONG qui gagne, donc un numéro mahorais ne tombe pas chez
   *  son voisin. */
  altDialCodes?: string[];
  /** Territoire rattaché : la France d'outre-mer compte comme une origine à
   *  part (un client de Fort-de-France n'est pas un client parisien), mais le
   *  club veut voir le lien. */
  parentCode?: string;
}

export const COUNTRIES: Country[] = [
  { code: 'FR', dialCode: '+33', flag: '🇫🇷', format: '6 12 34 56 78', isoNumeric: 250, names: { en: 'France', es: 'Francia', fr: 'France' } },
  { code: 'ES', dialCode: '+34', flag: '🇪🇸', format: '612 34 56 78', isoNumeric: 724, names: { en: 'Spain', es: 'España', fr: 'Espagne' } },
  { code: 'GB', dialCode: '+44', flag: '🇬🇧', format: '7911 123456', isoNumeric: 826, names: { en: 'United Kingdom', es: 'Reino Unido', fr: 'Royaume-Uni' } },
  { code: 'DE', dialCode: '+49', flag: '🇩🇪', format: '151 12345678', isoNumeric: 276, names: { en: 'Germany', es: 'Alemania', fr: 'Allemagne' } },
  { code: 'IT', dialCode: '+39', flag: '🇮🇹', format: '312 345 6789', isoNumeric: 380, names: { en: 'Italy', es: 'Italia', fr: 'Italie' } },
  { code: 'PT', dialCode: '+351', flag: '🇵🇹', format: '912 345 678', isoNumeric: 620, names: { en: 'Portugal', es: 'Portugal', fr: 'Portugal' } },
  { code: 'BE', dialCode: '+32', flag: '🇧🇪', format: '470 12 34 56', isoNumeric: 56, names: { en: 'Belgium', es: 'Bélgica', fr: 'Belgique' } },
  { code: 'NL', dialCode: '+31', flag: '🇳🇱', format: '6 12345678', isoNumeric: 528, names: { en: 'Netherlands', es: 'Países Bajos', fr: 'Pays-Bas' } },
  { code: 'CH', dialCode: '+41', flag: '🇨🇭', format: '76 123 45 67', isoNumeric: 756, names: { en: 'Switzerland', es: 'Suiza', fr: 'Suisse' } },
  { code: 'LU', dialCode: '+352', flag: '🇱🇺', format: '621 123 456', isoNumeric: 442, names: { en: 'Luxembourg', es: 'Luxemburgo', fr: 'Luxembourg' } },
  { code: 'MC', dialCode: '+377', flag: '🇲🇨', format: '6 12 34 56 78', isoNumeric: 492, names: { en: 'Monaco', es: 'Mónaco', fr: 'Monaco' } },
  { code: 'AT', dialCode: '+43', flag: '🇦🇹', format: '664 1234567', isoNumeric: 40, names: { en: 'Austria', es: 'Austria', fr: 'Autriche' } },
  { code: 'PL', dialCode: '+48', flag: '🇵🇱', format: '512 345 678', isoNumeric: 616, names: { en: 'Poland', es: 'Polonia', fr: 'Pologne' } },
  { code: 'IE', dialCode: '+353', flag: '🇮🇪', format: '85 123 4567', isoNumeric: 372, names: { en: 'Ireland', es: 'Irlanda', fr: 'Irlande' } },
  { code: 'SE', dialCode: '+46', flag: '🇸🇪', format: '70 123 45 67', isoNumeric: 752, names: { en: 'Sweden', es: 'Suecia', fr: 'Suède' } },
  { code: 'NO', dialCode: '+47', flag: '🇳🇴', format: '412 34 567', isoNumeric: 578, names: { en: 'Norway', es: 'Noruega', fr: 'Norvège' } },
  { code: 'DK', dialCode: '+45', flag: '🇩🇰', format: '20 12 34 56', isoNumeric: 208, names: { en: 'Denmark', es: 'Dinamarca', fr: 'Danemark' } },
  { code: 'FI', dialCode: '+358', flag: '🇫🇮', format: '40 1234567', isoNumeric: 246, names: { en: 'Finland', es: 'Finlandia', fr: 'Finlande' } },
  { code: 'GR', dialCode: '+30', flag: '🇬🇷', format: '691 234 5678', isoNumeric: 300, names: { en: 'Greece', es: 'Grecia', fr: 'Grèce' } },
  { code: 'CZ', dialCode: '+420', flag: '🇨🇿', format: '601 234 567', isoNumeric: 203, names: { en: 'Czech Republic', es: 'República Checa', fr: 'République tchèque' } },
  { code: 'RO', dialCode: '+40', flag: '🇷🇴', format: '712 345 678', isoNumeric: 642, names: { en: 'Romania', es: 'Rumania', fr: 'Roumanie' } },
  { code: 'HU', dialCode: '+36', flag: '🇭🇺', format: '20 123 4567', isoNumeric: 348, names: { en: 'Hungary', es: 'Hungría', fr: 'Hongrie' } },
  { code: 'US', dialCode: '+1', flag: '🇺🇸', format: '(201) 555-0123', isoNumeric: 840, names: { en: 'United States', es: 'Estados Unidos', fr: 'États-Unis' } },
  { code: 'CA', dialCode: '+1', flag: '🇨🇦', format: '(204) 555-0123', isoNumeric: 124, names: { en: 'Canada', es: 'Canadá', fr: 'Canada' } },
  { code: 'MA', dialCode: '+212', flag: '🇲🇦', format: '6 12 34 56 78', isoNumeric: 504, names: { en: 'Morocco', es: 'Marruecos', fr: 'Maroc' } },
  { code: 'DZ', dialCode: '+213', flag: '🇩🇿', format: '551 23 45 67', isoNumeric: 12, names: { en: 'Algeria', es: 'Argelia', fr: 'Algérie' } },
  { code: 'TN', dialCode: '+216', flag: '🇹🇳', format: '20 123 456', isoNumeric: 788, names: { en: 'Tunisia', es: 'Túnez', fr: 'Tunisie' } },
  { code: 'BR', dialCode: '+55', flag: '🇧🇷', format: '11 91234-5678', isoNumeric: 76, names: { en: 'Brazil', es: 'Brasil', fr: 'Brésil' } },
  { code: 'MX', dialCode: '+52', flag: '🇲🇽', format: '55 1234 5678', isoNumeric: 484, names: { en: 'Mexico', es: 'México', fr: 'Mexique' } },
  { code: 'AR', dialCode: '+54', flag: '🇦🇷', format: '11 1234-5678', isoNumeric: 32, names: { en: 'Argentina', es: 'Argentina', fr: 'Argentine' } },
  { code: 'CO', dialCode: '+57', flag: '🇨🇴', format: '310 1234567', isoNumeric: 170, names: { en: 'Colombia', es: 'Colombia', fr: 'Colombie' } },
  { code: 'JP', dialCode: '+81', flag: '🇯🇵', format: '90 1234 5678', isoNumeric: 392, names: { en: 'Japan', es: 'Japón', fr: 'Japon' } },
  { code: 'CN', dialCode: '+86', flag: '🇨🇳', format: '131 2345 6789', isoNumeric: 156, names: { en: 'China', es: 'China', fr: 'Chine' } },
  { code: 'IN', dialCode: '+91', flag: '🇮🇳', format: '91234 56789', isoNumeric: 356, names: { en: 'India', es: 'India', fr: 'Inde' } },
  { code: 'AU', dialCode: '+61', flag: '🇦🇺', format: '412 345 678', isoNumeric: 36, names: { en: 'Australia', es: 'Australia', fr: 'Australie' } },
  { code: 'RU', dialCode: '+7', flag: '🇷🇺', format: '912 345-67-89', isoNumeric: 643, names: { en: 'Russia', es: 'Rusia', fr: 'Russie' } },
  { code: 'TR', dialCode: '+90', flag: '🇹🇷', format: '532 123 45 67', isoNumeric: 792, names: { en: 'Turkey', es: 'Turquía', fr: 'Turquie' } },
  { code: 'AE', dialCode: '+971', flag: '🇦🇪', format: '50 123 4567', isoNumeric: 784, names: { en: 'United Arab Emirates', es: 'Emiratos Árabes Unidos', fr: 'Émirats arabes unis' } },
  { code: 'SA', dialCode: '+966', flag: '🇸🇦', format: '50 123 4567', isoNumeric: 682, names: { en: 'Saudi Arabia', es: 'Arabia Saudita', fr: 'Arabie saoudite' } },

  // ── Territoires : une origine à part entière ────────────────────────────────
  // Un client guadeloupéen n'est pas un client parisien — pour un club, savoir
  // qu'une partie de sa salle vient des Antilles ou de La Réunion vaut autant
  // que de savoir qu'elle vient d'Espagne. Chacun porte son propre code ISO,
  // donc sa propre couleur sur la carte des origines.
  //
  // On ne liste QUE les territoires qui ont leur propre indicatif : l'origine
  // se déduit du numéro de téléphone. Les Canaries (+34), Madère et les Açores
  // (+351), la Corse (+33), Jersey (+44) ou l'Alaska (+1) partagent celui de
  // leur métropole — les distinguer est impossible depuis un numéro, et
  // inventer une répartition serait pire que de ne rien dire.
  { code: 'GP', dialCode: '+590', flag: '🇬🇵', format: '690 12 34 56', isoNumeric: 312, parentCode: 'FR', names: { en: 'Guadeloupe', es: 'Guadalupe', fr: 'Guadeloupe' } },
  { code: 'MQ', dialCode: '+596', flag: '🇲🇶', format: '696 12 34 56', isoNumeric: 474, parentCode: 'FR', names: { en: 'Martinique', es: 'Martinica', fr: 'Martinique' } },
  { code: 'GF', dialCode: '+594', flag: '🇬🇫', format: '694 12 34 56', isoNumeric: 254, parentCode: 'FR', names: { en: 'French Guiana', es: 'Guayana Francesa', fr: 'Guyane' } },
  // La Réunion passe AVANT Mayotte : à préfixe de même longueur, c'est l'ordre
  // de la liste qui tranche, et +262 seul est réunionnais dans l'immense
  // majorité des cas. Un vrai numéro mahorais (269/639) est capté ci-dessous.
  { code: 'RE', dialCode: '+262', flag: '🇷🇪', format: '692 12 34 56', isoNumeric: 638, parentCode: 'FR', names: { en: 'Réunion', es: 'Reunión', fr: 'La Réunion' } },
  { code: 'YT', dialCode: '+262', altDialCodes: ['+262269', '+262639'], flag: '🇾🇹', format: '639 12 34 56', isoNumeric: 175, parentCode: 'FR', names: { en: 'Mayotte', es: 'Mayotte', fr: 'Mayotte' } },
  { code: 'PM', dialCode: '+508', flag: '🇵🇲', format: '55 12 34', isoNumeric: 666, parentCode: 'FR', names: { en: 'Saint Pierre and Miquelon', es: 'San Pedro y Miquelón', fr: 'Saint-Pierre-et-Miquelon' } },
  { code: 'NC', dialCode: '+687', flag: '🇳🇨', format: '75 12 34', isoNumeric: 540, parentCode: 'FR', names: { en: 'New Caledonia', es: 'Nueva Caledonia', fr: 'Nouvelle-Calédonie' } },
  { code: 'PF', dialCode: '+689', flag: '🇵🇫', format: '87 12 34 56', isoNumeric: 258, parentCode: 'FR', names: { en: 'French Polynesia', es: 'Polinesia Francesa', fr: 'Polynésie française' } },
  { code: 'WF', dialCode: '+681', flag: '🇼🇫', format: '82 12 34', isoNumeric: 876, parentCode: 'FR', names: { en: 'Wallis and Futuna', es: 'Wallis y Futuna', fr: 'Wallis-et-Futuna' } },
  { code: 'GL', dialCode: '+299', flag: '🇬🇱', format: '22 12 34', isoNumeric: 304, parentCode: 'DK', names: { en: 'Greenland', es: 'Groenlandia', fr: 'Groenland' } },
  { code: 'FO', dialCode: '+298', flag: '🇫🇴', format: '21 12 34', isoNumeric: 234, parentCode: 'DK', names: { en: 'Faroe Islands', es: 'Islas Feroe', fr: 'Îles Féroé' } },
  { code: 'AW', dialCode: '+297', flag: '🇦🇼', format: '560 1234', isoNumeric: 533, parentCode: 'NL', names: { en: 'Aruba', es: 'Aruba', fr: 'Aruba' } },
  { code: 'CW', dialCode: '+599', flag: '🇨🇼', format: '9 518 1234', isoNumeric: 531, parentCode: 'NL', names: { en: 'Curaçao', es: 'Curazao', fr: 'Curaçao' } },
  { code: 'PR', dialCode: '+1787', altDialCodes: ['+1939'], flag: '🇵🇷', format: '(787) 555-0123', isoNumeric: 630, parentCode: 'US', names: { en: 'Puerto Rico', es: 'Puerto Rico', fr: 'Porto Rico' } },
];

export function getCountryName(country: Country, language: Language | string): string {
  return country.names[language as keyof Country['names']] || country.names.en;
}

// Tous les préfixes (indicatif + variantes longues), triés du plus long au plus
// court : "+351" gagne sur "+3x", "+262639" sur "+262", "+1787" sur "+1". À
// longueur égale, l'ordre de COUNTRIES tranche (le tri est stable).
const BY_DIAL_LEN: { prefix: string; country: Country }[] = COUNTRIES
  .flatMap(c => [c.dialCode, ...(c.altDialCodes ?? [])].map(prefix => ({ prefix, country: c })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Derive a customer's country of origin from their stored phone number.
 * Phones are stored as "{dialCode} {number}" (e.g. "+33 6 12 34 56 78").
 * Returns null when no phone / no matching dial code.
 * Note: "+1" resolves to the US (shared with Canada — first match wins).
 */
export function countryFromPhone(phone: string | null | undefined): Country | null {
  if (!phone) return null;
  const normalized = phone.replace(/\s+/g, '');
  if (!normalized.startsWith('+')) return null;
  for (const { prefix, country } of BY_DIAL_LEN) {
    if (normalized.startsWith(prefix)) return country;
  }
  return null;
}

export const COUNTRY_BY_NUMERIC = new Map<number, Country>(COUNTRIES.map(c => [c.isoNumeric, c]));

// Countries that KEEP the leading trunk "0" in international format.
// Italy is the classic exception: "+39 06 ..." is correct (landlines retain
// the 0). For everyone else (FR, ES, GB, DE, ...), the leading 0 is a national
// trunk prefix that must be dropped after the dial code.
const KEEP_LEADING_ZERO = new Set(['IT']);

/**
 * Extract the clean national digits a user typed for a given country.
 * Handles the common ways people mistype a number into a field that already
 * shows the dial code:
 *  - leading trunk "0"        ("06 44 ..." -> "6 44 ...")   [dropped unless Italy]
 *  - the dial code itself     ("+33 6 ...", "0033 6 ...")  [stripped]
 *  - any non-digit separators (spaces, dashes, parens)      [removed]
 * Returns digits only (no separators).
 */
export function nationalDigits(
  raw: string,
  country: Pick<Country, 'code' | 'dialCode'>,
): string {
  const dial = country.dialCode.slice(1); // "+33" -> "33"
  const hadPlus = raw.trimStart().startsWith('+');
  let digits = raw.replace(/\D/g, '');

  // International prefix accidentally typed into the national field.
  if (hadPlus && digits.startsWith(dial)) {
    digits = digits.slice(dial.length);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
    if (digits.startsWith(dial)) digits = digits.slice(dial.length);
  }

  // National trunk prefix "0" (kept for Italy and the like).
  if (!KEEP_LEADING_ZERO.has(country.code)) {
    digits = digits.replace(/^0+/, '');
  }

  return digits;
}

/**
 * Normalize + pretty-group a national number for display, using the country's
 * `format` placeholder as the grouping template. Digit slots in the template are
 * filled left-to-right; literal characters (space, "-", "(", ")") are inserted
 * between groups. Overflow digits beyond the template are appended.
 *
 * "06 44 21 66 89" with FR -> "6 44 21 66 89".
 */
export function formatNationalNumber(
  raw: string,
  country: Pick<Country, 'code' | 'dialCode' | 'format'>,
): string {
  const digits = nationalDigits(raw, country);
  if (!digits) return '';

  let out = '';
  let di = 0;
  for (const ch of country.format) {
    if (di >= digits.length) break; // stop before emitting a trailing separator
    if (/\d/.test(ch)) out += digits[di++];
    else out += ch;
  }
  if (di < digits.length) out += (out ? ' ' : '') + digits.slice(di);
  return out;
}
