/**
 * Analytics v3 — comment un chiffre s'écrit (spec §3.7, §3.8).
 *
 *   • abrégé : « 50,6 k € », « 12,8 k », jamais « 50 633,00 € » dans l'Analyse
 *     (la Compta garde ses deux décimales) ;
 *   • entier par défaut, une décimale sous 10 (« 8,4 € ») et dans les milliers abrégés ;
 *   • pourcentage sans décimale (« 27 % »), une décimale seulement sous 1 % ;
 *   • delta : signe + flèche, en % au-dessus d'une base de 20, en absolu sinon
 *     (« +3 billets »), et jamais au-delà de ±300 % ;
 *   • polarité PAR MÉTRIQUE : un no-show qui baisse est bon.
 *
 * Tout est pur et testé (`__tests__/an3Format.test.ts`).
 */

export type An3Locale = 'fr-FR' | 'es-ES' | 'en-GB';

export function an3Locale(language: string | undefined): An3Locale {
  return language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
}

const nf = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = nf.get(key);
  if (!f) { f = new Intl.NumberFormat(locale, opts); nf.set(key, f); }
  return f;
}

/** Nombre abrégé : 950 → « 950 », 12 800 → « 12,8 k », 1 250 000 → « 1,25 M ». */
export function compactNumber(value: number, locale: An3Locale): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return '—';
  if (abs < 1000) return numberFormat(locale, { maximumFractionDigits: abs < 10 && abs !== Math.floor(abs) ? 1 : 0 }).format(value);
  if (abs < 1_000_000) return `${numberFormat(locale, { maximumFractionDigits: abs < 10_000 ? 1 : abs < 100_000 ? 1 : 0 }).format(value / 1000)}\u202fk`;
  return `${numberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000_000)}\u202fM`;
}

/** Montant abrégé en euros : « 50,6 k € » (fr / es) · « €50.6k » (en). */
export function compactMoney(value: number | null | undefined, locale: An3Locale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const body = compactNumber(Math.abs(value) < 0.005 ? 0 : value, locale);
  return locale === 'en-GB' ? `€${body}` : `${body}\u00a0€`;
}

/** Montant exact (deux décimales) pour les tableaux et les infobulles. */
export function exactMoney(value: number | null | undefined, locale: An3Locale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return numberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** Entier au format de la langue (« 12 883 »). */
export function wholeNumber(value: number | null | undefined, locale: An3Locale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** Pourcentage : « 27 % » ; sous 1 %, une décimale (« 0,4 % »). `null` → « — ». */
export function pct(value: number | null | undefined, locale: An3Locale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) < 1 && value !== 0 ? 1 : 0;
  return numberFormat(locale, { style: 'percent', maximumFractionDigits: digits }).format(value / 100);
}

export type An3Format = 'money' | 'n' | 'pct' | 'ratio';

export function formatValue(value: number | null | undefined, format: An3Format, locale: An3Locale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (format === 'money') return compactMoney(value, locale);
  if (format === 'pct') return pct(value, locale);
  if (format === 'ratio') return `×${numberFormat(locale, { maximumFractionDigits: 1 }).format(value)}`;
  return compactNumber(value, locale);
}

/** Seuil de « petite base » : en dessous, un delta se dit en absolu. */
export const SMALL_BASE = 20;
export const MAX_READABLE_PCT = 300;

export type DeltaShape =
  | { kind: 'pct'; value: number; up: boolean }
  | { kind: 'abs'; value: number; up: boolean }
  | { kind: 'same' }
  | { kind: 'none' };

/**
 * La forme lisible d'un écart entre une valeur et sa référence.
 * `pointDiff` : pour deux pourcentages, l'écart est en points, jamais en % de %.
 */
export function deltaShape(current: number | null | undefined, reference: number | null | undefined, opts: { pointDiff?: boolean } = {}): DeltaShape {
  if (current == null || reference == null || !Number.isFinite(current) || !Number.isFinite(reference)) return { kind: 'none' };
  const diff = current - reference;
  if (Math.abs(diff) < 1e-9) return { kind: 'same' };
  const up = diff > 0;
  if (opts.pointDiff) return { kind: 'abs', value: diff, up };
  if (reference < SMALL_BASE || reference <= 0) return { kind: 'abs', value: diff, up };
  const rel = (diff / reference) * 100;
  if (Math.abs(rel) > MAX_READABLE_PCT) return { kind: 'abs', value: diff, up };
  return { kind: 'pct', value: rel, up };
}

/** Texte d'un delta : « ▲ +18 % », « ▼ −3 billets », « ▲ +2 pt ». */
export function deltaText(shape: DeltaShape, format: An3Format, locale: An3Locale, unit?: string): string {
  if (shape.kind === 'none') return '';
  if (shape.kind === 'same') return '=';
  const arrow = shape.up ? '▲' : '▼';
  const sign = shape.up ? '+' : '−';
  if (shape.kind === 'pct') return `${arrow} ${sign}${numberFormat(locale, { maximumFractionDigits: 0 }).format(Math.abs(shape.value))}\u00a0%`;
  const abs = Math.abs(shape.value);
  if (format === 'pct') return `${arrow} ${sign}${numberFormat(locale, { maximumFractionDigits: abs < 1 ? 1 : 0 }).format(abs)}\u00a0pt`;
  const body = format === 'money' ? compactMoney(abs, locale) : compactNumber(abs, locale);
  return `${arrow} ${sign}${body}${unit ? `\u00a0${unit}` : ''}`;
}

/** Polarité : `up` = plus c'est haut, mieux c'est ; `down` = l'inverse (no-show, remboursements). */
export type Polarity = 'up' | 'down' | 'neutral';

/** Bon ou mauvais, selon la polarité de la métrique. `null` = neutre. */
export function deltaTone(shape: DeltaShape, polarity: Polarity): 'good' | 'bad' | null {
  if (shape.kind !== 'pct' && shape.kind !== 'abs') return null;
  if (polarity === 'neutral') return null;
  return (shape.up === (polarity === 'up')) ? 'good' : 'bad';
}

/** Heure locale « 01 h 15 » (fr) / « 1:15 am » (en) à partir de minutes depuis midi de la nuit. */
export function minutesSinceNoonLabel(m: number, locale: An3Locale): string {
  const total = (12 * 60 + m) % (24 * 60);
  const h = Math.floor(total / 60), mi = total % 60;
  if (locale === 'en-GB') {
    const d = new Date(Date.UTC(2000, 0, 1, h, mi));
    return new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(d);
  }
  return `${String(h).padStart(2, '0')}\u202fh\u202f${String(mi).padStart(2, '0')}`;
}
