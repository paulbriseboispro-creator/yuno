/**
 * Loader i18n — les dictionnaires vivent dans src/i18n/locales/{en,fr,es}.ts
 * et sont chargés en CHUNKS DYNAMIQUES : seule la langue active est téléchargée
 * au démarrage (~700 Ko au lieu de 2,2 Mo bloquants dans le bundle initial).
 *
 * Trois imports explicites (pas de template string) : Rollup doit pouvoir
 * créer un chunk par langue statiquement.
 *
 * Pour ajouter une clé : l'ajouter dans LES TROIS fichiers de locales/.
 */

export type Language = 'en' | 'es' | 'fr';

const cache: Partial<Record<Language, Record<string, string>>> = {};

/** Accès synchrone aux dictionnaires déjà chargés (ErrorBoundary, orgTranslate, fallbacks). */
export function getLoadedLocale(lang: Language): Record<string, string> | undefined {
  return cache[lang];
}

export async function loadLocale(lang: Language): Promise<Record<string, string>> {
  const cached = cache[lang];
  if (cached) return cached;
  let mod: { default: Record<string, string> };
  switch (lang) {
    case 'fr':
      mod = await import('./locales/fr');
      break;
    case 'es':
      mod = await import('./locales/es');
      break;
    default:
      mod = await import('./locales/en');
      break;
  }
  cache[lang] = mod.default;
  return mod.default;
}
