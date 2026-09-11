/**
 * Formatage partagé du super admin — chiffres, dates, durées. Toujours passer
 * par ici : une page qui formate seule finit avec `toFixed(2)` d'un côté et
 * `fr-FR` codé en dur de l'autre.
 */
import type { Language } from '@/i18n/data';

const LOCALE: Record<Language, string> = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES' };

export function localeOf(lang: Language): string {
  return LOCALE[lang] ?? 'en-GB';
}

export function fmtNum(n: number | null | undefined, lang: Language = 'en', digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(n));
}

/** 12 400 → « 12,4k », 1 250 000 → « 1,25M ». En dessous de 10 000 : entier. */
export function fmtCompact(n: number | null | undefined, lang: Language = 'en'): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) < 10_000) return fmtNum(v, lang);
  return new Intl.NumberFormat(localeOf(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function fmtEur(n: number | null | undefined, lang: Language = 'en', opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (opts.compact && Math.abs(v) >= 10_000) {
    return `${new Intl.NumberFormat(localeOf(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(v)} €`;
  }
  const digits = opts.cents ?? Math.abs(v) < 100 ? 2 : 0;
  return new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

export function fmtUsd(n: number | null | undefined, lang: Language = 'en'): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const usd = (x: number, digits: number) => new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(x);
  // Un coût IA de quelques dixièmes de centime existe : l'arrondir à zéro
  // ferait croire que rien n'est consommé. Zéro exact reste « 0,00 ».
  if (v !== 0 && Math.abs(v) < 0.001) return `< ${usd(Math.sign(v) * 0.001, 3)}`;
  return usd(v, v !== 0 && Math.abs(v) < 1 ? 3 : 2);
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(digits)} %`;
}

export function fmtTokens(n: number | null | undefined, lang: Language = 'en'): string {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (v < 1000) return fmtNum(v, lang);
  if (v < 1_000_000) return `${fmtNum(v / 1000, lang, 1)}k`;
  return `${fmtNum(v / 1_000_000, lang, 2)}M`;
}

export function fmtMs(ms: number | null | undefined, lang: Language = 'en'): string {
  if (ms === null || ms === undefined) return '—';
  const v = Number(ms);
  if (v < 1000) return `${fmtNum(Math.round(v), lang)} ms`;
  return `${fmtNum(v / 1000, lang, 1)} s`;
}

/**
 * Accord singulier / pluriel. Deux formes suffisent aux trois langues du
 * projet ; `Intl.PluralRules` choisit la bonne pour chacune.
 */
export function fmtPlural(n: number, lang: Language, one: string, many: string): string {
  const form = new Intl.PluralRules(localeOf(lang)).select(n);
  return (form === 'one' ? one : many).replace('{n}', fmtNum(n, lang));
}

export function fmtDate(iso: string | null | undefined, lang: Language = 'en', style: 'short' | 'long' | 'time' | 'datetime' | 'day' = 'short'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const l = localeOf(lang);
  switch (style) {
    case 'long': return d.toLocaleDateString(l, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    case 'time': return d.toLocaleTimeString(l, { hour: '2-digit', minute: '2-digit' });
    case 'datetime': return d.toLocaleString(l, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    case 'day': return d.toLocaleDateString(l, { weekday: 'short', day: 'numeric', month: 'short' });
    default: return d.toLocaleDateString(l, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
}

/** « il y a 3 h », « in 2 days » — via Intl.RelativeTimeFormat, donc traduit. */
export function fmtRelative(iso: string | null | undefined, lang: Language = 'en', now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day');
  if (abs < 86_400 * 365) return rtf.format(Math.round(diff / (86_400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86_400 * 365)), 'year');
}

/** Variation en % entre deux valeurs ; null quand la base est nulle. */
export function deltaPct(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}

/** Libellé d'une clé jour « YYYY-MM-DD » pour un axe de graphique. */
export function fmtAxisDay(key: string, lang: Language = 'en'): string {
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short' });
}

export function periodRange(period: '24h' | '7d' | '30d' | '90d' | '12m'): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  switch (period) {
    case '24h': from.setHours(from.getHours() - 24); break;
    case '7d': from.setDate(from.getDate() - 7); break;
    case '30d': from.setDate(from.getDate() - 30); break;
    case '90d': from.setDate(from.getDate() - 90); break;
    case '12m': from.setFullYear(from.getFullYear() - 1); break;
  }
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export type AdminPeriod = '24h' | '7d' | '30d' | '90d' | '12m';
