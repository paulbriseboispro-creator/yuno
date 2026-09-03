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

// ── Sections à la demande ────────────────────────────────────────────
// Le dictionnaire principal ne contient que ce qu'un client ou un pro voit au
// quotidien. Les gros blocs réservés à une surface précise (mode d'emploi pro,
// 2 000 clés `ohelp.*`) vivent dans des chunks séparés, fusionnés dans le
// dictionnaire de la langue UNIQUEMENT quand la surface se monte.

export type LocaleSection = 'help';

const sectionCache: Partial<Record<Language, Partial<Record<LocaleSection, Record<string, string>>>>> = {};

/** Sections déjà fusionnées dans une langue (lecture synchrone). */
export function hasLocaleSection(lang: Language, section: LocaleSection): boolean {
  return !!sectionCache[lang]?.[section];
}

/**
 * Charge une section et la FUSIONNE dans le dictionnaire de la langue. Retourne
 * le dictionnaire fusionné (nouvel objet : React peut détecter le changement).
 */
export async function loadLocaleSection(lang: Language, section: LocaleSection): Promise<Record<string, string>> {
  const base = await loadLocale(lang);
  const already = sectionCache[lang]?.[section];
  if (already) return cache[lang] ?? base;
  let mod: { default: Record<string, string> };
  // Imports explicites (pas de template string) : un chunk par langue.
  switch (lang) {
    case 'fr':
      mod = await import('./locales/help/fr');
      break;
    case 'es':
      mod = await import('./locales/help/es');
      break;
    default:
      mod = await import('./locales/help/en');
      break;
  }
  (sectionCache[lang] ??= {})[section] = mod.default;
  const merged = { ...(cache[lang] ?? base), ...mod.default };
  cache[lang] = merged;
  return merged;
}
