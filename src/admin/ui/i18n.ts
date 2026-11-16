/**
 * Textes de l'admin : `t(key, { n: 3 })` remplace `{n}` dans la traduction.
 * Le dictionnaire est la section `admin` (src/i18n/locales/admin/modules),
 * triplets [EN, FR, ES], chargée par la coquille avant le premier rendu.
 */
import { useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Language } from '@/i18n/data';

export function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function useAdminT(): { t: (key: string, vars?: Record<string, string | number>) => string; lang: Language } {
  const { t: raw, language } = useLanguage();
  const t = useCallback((key: string, vars?: Record<string, string | number>) => fill(raw(key), vars), [raw]);
  return { t, lang: language };
}
