import { getLoadedLocale, type Language } from './data';

/**
 * Translation helper for the organizer app, where call sites pass the French
 * source text inline as the lookup key plus an English (and optionally Spanish)
 * fallback: `t('Bonjour', 'Hello', 'Hola')`.
 *
 * Resolution order for a given language:
 *  1. If Spanish is requested and an inline `es` argument was provided, use it
 *     (covers dynamic strings with `${}` interpolation that can't live in the
 *     dictionary).
 *  2. The shared dictionary in `i18n/data.ts`, keyed by the French source. This
 *     is the single source of truth — every organizer string is mirrored there
 *     in en/es/fr.
 *  3. The inline fallbacks, so a missing dictionary key can never regress to
 *     showing French in English or Spanish: French keeps `fr`, Spanish takes
 *     `es ?? en`, everything else takes `en`.
 */
export function translate(
  language: string,
  fr: string,
  en: string,
  es?: string,
): string {
  if (language === 'es' && es !== undefined) return es;
  // Dictionnaires en chunks dynamiques : lecture du cache chargé (la langue
  // active l'est toujours une fois l'app démarrée) — sinon fallbacks inline.
  const dict = getLoadedLocale(language as Language);
  const hit = dict?.[fr];
  if (hit !== undefined) return hit;
  if (language === 'fr') return fr;
  if (language === 'es') return es ?? en;
  return en;
}
