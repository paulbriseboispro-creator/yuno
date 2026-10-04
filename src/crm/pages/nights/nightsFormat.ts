/**
 * Formats et constantes de l'écran Soirées : dates dans le fuseau de la
 * soirée, prix d'un tarif, lien d'un message, phrases de comparaison.
 */
import type { NightDetail, NightMsg } from '@/crm/data/nights';
import { CRM_ROUTES } from '@/crm/shell/nav';

export const SHOTGUN_URL = 'https://smartboard.shotgun.live';

export const ICO = {
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2',
  euro: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  sms: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  chart: 'M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
  sync: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
} as const;

/** Format d'un instant dans le fuseau de la soirée. */
export function inTz(locale: string, iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  try { return new Date(iso).toLocaleString(locale, { ...opts, timeZone: tz }); } catch { return new Date(iso).toLocaleString(locale, opts); }
}
export const tzTime = (locale: string, iso: string, tz: string) => inTz(locale, iso, tz, { hour: '2-digit', minute: '2-digit' });
export const tzWeek = (locale: string, iso: string, tz: string) => inTz(locale, iso, tz, { weekday: 'short', day: 'numeric', month: 'short' });
export const tzShort = (locale: string, iso: string, tz: string) => inTz(locale, iso, tz, { day: 'numeric', month: 'short' });
export const tzLong = (locale: string, iso: string, tz: string) => {
  const s = inTz(locale, iso, tz, { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const tzMonth = (locale: string, iso: string, tz: string) => inTz(locale, iso, tz, { month: 'short' }).replace('.', '');
export const tzDay = (iso: string, tz: string) => inTz('en-GB', iso, tz, { day: 'numeric' });

/** Le prix d'un tarif (« 12 € », « Gratuit », « — »). */
export function priceLabel(price: number | null, eur: (v: number) => string, eur2: (v: number) => string, free: string): string {
  if (price === null || price === undefined) return '—';
  if (price === 0) return free;
  return Number.isInteger(price) ? eur(price) : eur2(price);
}

/** Où mène un message : brouillon ou envoi planifié dans son éditeur, envoi parti dans ses résultats. */
export function messageHref(m: NightMsg): string {
  if (m.channel === 'sms') return m.state === 'sent' ? CRM_ROUTES.smsResults(m.id) : CRM_ROUTES.smsCompose(m.id);
  return m.state === 'sent' ? CRM_ROUTES.emailResults(m.id) : CRM_ROUTES.emailStudio(m.id);
}

/** Nom de la soirée comparée (« Techno Night du 12 sept., au même moment »). */
export function comparedName(detail: NightDetail, t: (k: string, v?: Record<string, string | number>) => string, locale: string): string {
  if (!detail.prev) return '';
  const date = new Date(detail.prev.start_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: detail.tz });
  return t(detail.prev.same_series ? 'yc.ni.curve.cmp' : 'yc.ni.curve.cmpPrev', { title: detail.prev.title, date });
}

/** Phrase de comparaison au même moment, ou '' sans soirée d'avant. */
export function comparedLine(detail: NightDetail, t: (k: string, v?: Record<string, string | number>) => string, n: (v: number) => string, locale: string): string {
  const last = detail.curve[detail.curve.length - 1];
  if (!detail.prev || !last || last.pv === null) return '';
  const date = new Date(detail.prev.start_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: detail.tz });
  const diff = last.v - last.pv;
  const key = diff > 0 ? 'yc.ni.curve.more' : diff < 0 ? 'yc.ni.curve.less' : 'yc.ni.curve.same';
  return t(key, { title: detail.prev.title, date, pv: n(last.pv), d: n(Math.abs(diff)) });
}
