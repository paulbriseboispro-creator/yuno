/**
 * Jetons et formats du kit d'analyse (`kit.tsx`) — à part pour que le fichier
 * des composants n'exporte que des composants (fast refresh).
 */
import { useLanguage } from '@/contexts/LanguageContext';

export const KIT = {
  T1: 'rgb(var(--ink)/var(--ink-a96,0.96))',
  T2: 'rgb(var(--ink)/var(--ink-a58,0.58))',
  T3: 'rgb(var(--ink)/var(--ink-a36,0.36))',
  POS: 'var(--acc-34d399)',
  RED: '#E8192C',
  BORDER: 'rgb(var(--ink)/0.085)',
  TRACK: 'rgb(var(--ink)/0.07)',
} as const;

/** Nombre au format de la langue (espaces fines en français). */
export function useNumberFormat() {
  const { language } = useLanguage();
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const n = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
  const eur = (v: number) => new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'EUR', maximumFractionDigits: Math.abs(v) >= 1000 || Number.isInteger(v) ? 0 : 2,
  }).format(v);
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  return { n, eur, time, locale };
}

/** Pourcentage entier (0-100) à la typographie de la langue : « 12 % », « 12% ». */
export function pctFmt(pct: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(pct / 100);
}

/** Formate une valeur de tuile ; `null` = « — » (jamais un faux zéro). */
export type DeltaFormat = 'eur' | 'n' | 'pct' | 'min';

export function useKpiFormat() {
  const { n, eur, locale } = useNumberFormat();
  return (v: number | null, format: DeltaFormat) => {
    if (v === null || !Number.isFinite(v)) return '—';
    if (format === 'eur') return eur(v);
    if (format === 'pct') return pctFmt(v, locale);
    if (format === 'min') return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)} min`;
    return n(v);
  };
}


