import { COUNTRIES, countryByCode, countryFromTimezone } from '@/lib/countries';
import { marketCountry } from '@/lib/geo';

/**
 * Pays d'immatriculation d'un compte Stripe connecté — côté Console.
 *
 * Le pays d'un compte Stripe ne change JAMAIS après sa création, et c'est lui
 * qui décide de ce que le formulaire Stripe réclame (identité, adresse, IBAN du
 * pays). Tous les comptes naissaient en France : un club de Madrid se voyait
 * demander une adresse et un IBAN français. Le pro choisit donc son pays AVANT
 * « Activer les paiements », prérempli depuis ce que Yuno sait de lui.
 *
 * Miroir de STRIPE_CONNECT_COUNTRY_CURRENCIES
 * (supabase/functions/_shared/stripe-connect-accounts.ts) : même liste, testée
 * par src/lib/__tests__/stripeConnectCountry.test.ts. Le serveur revérifie.
 */
export const STRIPE_CONNECT_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB',
  'GI', 'GR', 'HR', 'HU', 'IE', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO',
  'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
];

export const DEFAULT_CONNECT_COUNTRY = 'FR';

/** Valeur du sélecteur quand le pays n'est pas dans la liste (« Autre pays »). */
export const OTHER_CONNECT_COUNTRY = 'OTHER';

export function isSupportedConnectCountry(code: string | null | undefined): boolean {
  return !!code && STRIPE_CONNECT_COUNTRIES.includes(code.trim().toUpperCase());
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const displayNamesCache: Record<string, Intl.DisplayNames | null> = {};
function displayNames(language: string): Intl.DisplayNames | null {
  if (!(language in displayNamesCache)) {
    try {
      displayNamesCache[language] = new Intl.DisplayNames([language], { type: 'region' });
    } catch {
      displayNamesCache[language] = null;
    }
  }
  return displayNamesCache[language];
}

/** Nom du pays dans la langue de la Console (Intl d'abord, table Yuno en repli). */
export function connectCountryName(code: string, language: string): string {
  const upper = code.trim().toUpperCase();
  const known = countryByCode(upper);
  const fromTable = known ? (known.names[language as 'en' | 'es' | 'fr'] || known.names.en) : null;
  if (fromTable) return fromTable;
  try {
    return displayNames(language)?.of(upper) || upper;
  } catch {
    return upper;
  }
}

/**
 * Code ISO alpha-2 d'un texte libre : « ES », « España », « Spain », « Espagne »,
 * « Maroc »… Null quand rien ne correspond. Sert à lire `djs.country` et la fin
 * d'une adresse Mapbox (« …, 08800 Vilanova i la Geltrú, Spain »).
 */
export function countryCodeFromText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = fold(raw);
  if (!text) return null;
  if (/^[a-z]{2}$/.test(text)) {
    const upper = text.toUpperCase();
    return (countryByCode(upper) || STRIPE_CONNECT_COUNTRIES.includes(upper)) ? upper : null;
  }
  for (const c of COUNTRIES) {
    if ([c.names.en, c.names.es, c.names.fr].some((n) => fold(n) === text)) return c.code;
  }
  for (const code of STRIPE_CONNECT_COUNTRIES) {
    for (const lang of ['fr', 'en', 'es']) {
      const name = displayNames(lang)?.of(code);
      if (name && fold(name) === text) return code;
    }
  }
  return null;
}

export interface ConnectCountrySignals {
  /** Pays déjà déclaré en toutes lettres ou en code (profil DJ). */
  countryText?: string | null;
  city?: string | null;
  /** Adresses du club (postale, légale) : Mapbox finit par le pays. */
  addresses?: (string | null | undefined)[];
  /** Fuseau du lieu (`venues.timezone`, dernière soirée). */
  timezone?: string | null;
  /** Fuseau de l'appareil du pro. */
  deviceTimezone?: string | null;
}

export type ConnectCountrySource = 'profile' | 'place' | 'device' | 'default';

/**
 * Pays proposé par défaut, et d'où il vient. Peut rendre un pays NON pris en
 * charge (Maroc…) : l'écran l'affiche alors avec son explication, au lieu de
 * glisser en silence vers la France.
 *
 * `Europe/Paris` est un signal faible : c'est le fuseau posé par défaut sur un
 * club dont la ville n'était pas reconnue. On lui préfère la ville, l'adresse,
 * puis le fuseau de l'appareil.
 */
export function suggestConnectCountry(s: ConnectCountrySignals): { code: string; source: ConnectCountrySource } {
  const fromProfile = countryCodeFromText(s.countryText);
  if (fromProfile) return { code: fromProfile, source: 'profile' };

  const cityParts = (s.city || '').split(',').map((p) => p.trim()).filter(Boolean);
  const fromCity = marketCountry(null, cityParts[0] ?? null)
    ?? cityParts.slice(1).map(countryCodeFromText).find(Boolean)
    ?? null;
  if (fromCity) return { code: fromCity, source: 'place' };

  for (const address of s.addresses ?? []) {
    const parts = (address || '').split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts.length > 1 ? countryCodeFromText(parts[parts.length - 1]) : null;
    if (last) return { code: last, source: 'place' };
  }

  const tz = (s.timezone || '').trim();
  if (tz && tz !== 'Europe/Paris') {
    const fromTz = countryFromTimezone(tz)?.code;
    if (fromTz) return { code: fromTz, source: 'place' };
  }

  const fromDevice = countryFromTimezone(s.deviceTimezone)?.code;
  if (fromDevice) return { code: fromDevice, source: 'device' };

  if (tz === 'Europe/Paris') return { code: 'FR', source: 'place' };
  return { code: DEFAULT_CONNECT_COUNTRY, source: 'default' };
}

export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Options du sélecteur : pays pris en charge triés par nom, plus le pays courant s'il ne l'est pas. */
export function connectCountryOptions(
  language: string,
  current?: string | null,
): { code: string; name: string; supported: boolean }[] {
  const options = STRIPE_CONNECT_COUNTRIES.map((code) => ({ code, name: connectCountryName(code, language), supported: true }));
  options.sort((a, b) => a.name.localeCompare(b.name, language));
  const cur = (current || '').toUpperCase();
  if (cur && cur !== OTHER_CONNECT_COUNTRY && !isSupportedConnectCountry(cur)) {
    options.unshift({ code: cur, name: connectCountryName(cur, language), supported: false });
  }
  return options;
}
