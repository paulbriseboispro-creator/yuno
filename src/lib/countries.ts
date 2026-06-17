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
  { code: 'SA', dialCode: '+966', flag: '🇸🇦', format: '50 123 4567', isoNumeric: 682, names: { en: 'Saudi Arabia', es: 'Arabia Saudita', fr: 'Arabia Saudí' } },
];

export function getCountryName(country: Country, language: Language | string): string {
  return country.names[language as keyof Country['names']] || country.names.en;
}

// Dial codes sorted longest-first so "+351" matches before "+3x" collisions.
const BY_DIAL_LEN = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);

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
  for (const c of BY_DIAL_LEN) {
    if (normalized.startsWith(c.dialCode)) return c;
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
