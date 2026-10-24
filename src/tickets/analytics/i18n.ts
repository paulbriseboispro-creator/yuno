/**
 * Textes et formats des Analyses de Yuno Tickets — même API que `useCrmT`
 * (Yuno CRM), clés `ya.*` de la section `tixana`
 * (src/i18n/locales/tixana/modules/*, triplets EN/FR/ES), chargée par la page.
 *
 *   const { t, tp, n, eur } = useTixT();
 *
 * Les aides pures du CRM réutilisées ici (verdicts de guest list, cycle de
 * vie, courbe d'une soirée) rendent des clés `yc.*` : elles sont lues sous leur
 * nom `ya.*`, jamais dans la section du CRM (non chargée dans la Console).
 */
import { useCallback, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { interpolate, makeFormatters, pluralKey, type CrmFormatters, type CrmLang } from '@/crm/i18n';

export type TixFormatters = CrmFormatters;

const tixKey = (k: string) => (k.startsWith('yc.') ? `ya.${k.slice(3)}` : k);

export function useTixT() {
  const { t: raw, language } = useLanguage();
  const lang = (['en', 'fr', 'es'].includes(language) ? language : 'en') as CrmLang;
  const t = useCallback(
    (key: string, vars?: Record<string, string | number | null | undefined>) => interpolate(raw(tixKey(key)), vars),
    [raw],
  );
  const tp = useCallback(
    (key: string, count: number, vars?: Record<string, string | number | null | undefined>) =>
      interpolate(raw(`${tixKey(key)}.${pluralKey(lang, count)}`), { n: count, ...vars }),
    [raw, lang],
  );
  const fmt = useMemo(() => makeFormatters(lang), [lang]);
  return { t, tp, ...fmt };
}
