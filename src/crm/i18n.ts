/**
 * Textes et formats de la Console CRM.
 *
 *   const { t, tp, n, eur } = useCrmT();
 *   t('yc.home.hello', { name: 'Nina' })   → « Bonjour Nina »
 *   tp('yc.home.actions', 5)              → « 5 actions » (clés `.one` / `.other`)
 *   n(14260)                               → « 14 260 » (fr) · « 14,260 » (en)
 *   eur(38940)                             → « 38 940 € » (fr) · « €38,940 » (en)
 *
 * Les clés vivent dans src/i18n/locales/crm/modules/* (triplets EN/FR/ES).
 */
import { useCallback, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

export type CrmLang = 'en' | 'fr' | 'es';

const LOCALE: Record<CrmLang, string> = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES' };

/** Espaces fines insécables → espaces ordinaires (rendu identique au prototype). */
const unspace = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');

export function interpolate(s: string, vars?: Record<string, string | number | null | undefined>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

export function pluralKey(lang: CrmLang, count: number): 'one' | 'other' {
  // Français : 0 et 1 au singulier ; anglais et espagnol : 1 seulement.
  if (lang === 'fr') return Math.abs(count) < 2 ? 'one' : 'other';
  return Math.abs(count) === 1 ? 'one' : 'other';
}

export function makeFormatters(lang: CrmLang) {
  const loc = LOCALE[lang];
  const nf0 = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(loc, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat(loc, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const cur0 = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const cur2 = new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    lang,
    locale: loc,
    /** Entier groupé. */
    n: (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : unspace(nf0.format(Math.round(v)))),
    /** Une décimale au plus (« 7,8 »). */
    n1: (v: number) => unspace(nf1.format(v)),
    /** Deux décimales (« 2,40 »). */
    n2: (v: number) => unspace(nf2.format(v)),
    /** Montant en euros sans centimes (« 38 940 € »). */
    eur: (v: number | null | undefined) => (v === null || v === undefined ? '—' : unspace(cur0.format(Math.round(v)))),
    /** Montant en euros au centime. */
    eur2: (v: number) => unspace(cur2.format(v)),
    /** Pourcentage arrondi (« 86 % »), `v` en points (0-100). */
    pct: (v: number | null | undefined, digits = 0) => {
      if (v === null || v === undefined || Number.isNaN(v)) return '—';
      const s = digits ? unspace(new Intl.NumberFormat(loc, { maximumFractionDigits: digits }).format(v)) : String(Math.round(v));
      return lang === 'en' ? `${s}%` : `${s} %`;
    },
    /** Date courte « 3 oct. ». */
    dShort: (d: Date | string) => new Date(d).toLocaleDateString(loc, { day: 'numeric', month: 'short' }),
    /** Date « samedi 3 octobre ». */
    dLong: (d: Date | string) => new Date(d).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' }),
    /** Date « sam. 3 oct. ». */
    dWeek: (d: Date | string) => new Date(d).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' }),
    /** Heure « 18:38 ». */
    time: (d: Date | string) => new Date(d).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
  };
}

export type CrmFormatters = ReturnType<typeof makeFormatters>;

export function useCrmT() {
  const { t: raw, language } = useLanguage();
  const lang = (['en', 'fr', 'es'].includes(language) ? language : 'en') as CrmLang;
  const t = useCallback(
    (key: string, vars?: Record<string, string | number | null | undefined>) => interpolate(raw(key), vars),
    [raw],
  );
  const tp = useCallback(
    (key: string, count: number, vars?: Record<string, string | number | null | undefined>) =>
      interpolate(raw(`${key}.${pluralKey(lang, count)}`), { n: count, ...vars }),
    [raw, lang],
  );
  const fmt = useMemo(() => makeFormatters(lang), [lang]);
  return { t, tp, ...fmt };
}
