import { translate } from './orgTranslate';

/**
 * Inline trilingual helper for the DJ dashboard app. Same resolution rules as the
 * organizer app's `translate` (dictionary-first, inline fr/en/es fallback) so new
 * DJ modules can ship fully translated without bloating the 1.5MB i18n/data.ts.
 *
 * Usage: const tt = useDjT(); tt('Bonjour', 'Hello', 'Hola')
 */
export { translate as djTranslate };

export function makeDjT(language: string) {
  return (fr: string, en: string, es?: string) => translate(language, fr, en, es);
}
