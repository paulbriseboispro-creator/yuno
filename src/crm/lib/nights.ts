/**
 * Règles d'affichage de l'écran Soirées (maquette « Soirees.dc.html ») :
 * état d'une soirée à venir, verdict d'une soirée passée, période et séries de
 * l'onglet Passées, écarts « vs la période d'avant ». Pures et testées.
 */
import type { NightRow } from '@/crm/data/nights';

export type UpKind = 'soon' | 'full' | 'almost' | 'sale';
export type PastKind = 'full' | 'good' | 'fair' | 'low' | 'unknown';

/** Remplissage 0-1, ou null si la capacité est inconnue. */
export function fillOf(n: Pick<NightRow, 'sold' | 'cap'>): number | null {
  return n.cap && n.cap > 0 ? Math.min(1, n.sold / n.cap) : null;
}

/** État d'une soirée à venir (ordre de la maquette : complet, pas ouvert, presque, en vente). */
export function upKind(n: Pick<NightRow, 'sold' | 'cap' | 'sold_out' | 'sale_opens_at'>, now = Date.now()): UpKind {
  if (n.sold_out || (n.cap !== null && n.cap > 0 && n.sold >= n.cap)) return 'full';
  if (n.sale_opens_at && new Date(n.sale_opens_at).getTime() > now && n.sold === 0) return 'soon';
  const f = fillOf(n);
  return f !== null && f >= 0.8 ? 'almost' : 'sale';
}

/** Verdict d'une soirée passée : complet ≥ 100 %, bien ≥ 75 %, correcte ≥ 55 %, peu remplie. */
export function pastKind(n: Pick<NightRow, 'sold' | 'cap' | 'sold_out'>): PastKind {
  if (n.sold_out && n.sold > 0) return 'full';
  const f = fillOf(n);
  if (f === null) return 'unknown';
  return f >= 1 ? 'full' : f >= 0.75 ? 'good' : f >= 0.55 ? 'fair' : 'low';
}

/** Une soirée à venir sans message prévu (et qui a encore des places à vendre). */
export function lacksMessage(n: Pick<NightRow, 'msgs'>, kind: UpKind): boolean {
  return (n.msgs?.length ?? 0) === 0 && kind !== 'full';
}

/** Le message à montrer dans la liste : brouillon, sinon planifié, sinon le dernier envoyé. */
export function pickMessage<M extends { state: string }>(msgs: M[] | null | undefined): M | null {
  if (!msgs?.length) return null;
  return msgs.find((m) => m.state === 'draft') ?? msgs.find((m) => m.state === 'plan') ?? msgs[0];
}

export const PERIOD_MONTHS = [3, 6, 12] as const;
export type PeriodMonths = (typeof PERIOD_MONTHS)[number];

function monthsBefore(d: Date, m: number): Date {
  const x = new Date(d.getTime());
  x.setMonth(x.getMonth() - m);
  return x;
}

/** Soirées passées de la période choisie et de la même durée juste avant. */
export function splitPeriods(past: NightRow[], months: PeriodMonths, now = new Date()) {
  const w0 = monthsBefore(now, months).getTime();
  const pw0 = monthsBefore(now, months * 2).getTime();
  const inW: NightRow[] = [];
  const prevW: NightRow[] = [];
  for (const n of past) {
    const t = new Date(n.start_at).getTime();
    if (t >= w0) inW.push(n);
    else if (t >= pw0) prevW.push(n);
  }
  return { inW, prevW };
}

/** Séries à proposer en filtre : celles qui reviennent (≥ 2 soirées), les plus fréquentes d'abord. */
export function seriesChips(nights: NightRow[], max = 5): { key: string; label: string; n: number }[] {
  const by = new Map<string, { label: string; n: number; last: number }>();
  for (const e of nights) {
    const key = e.series.toLowerCase();
    const t = new Date(e.start_at).getTime();
    const cur = by.get(key);
    if (!cur) by.set(key, { label: e.series, n: 1, last: t });
    else { cur.n += 1; if (t > cur.last) { cur.last = t; cur.label = e.series; } }
  }
  return [...by.entries()]
    .filter(([, v]) => v.n >= 2)
    .sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)
    .slice(0, max)
    .map(([key, v]) => ({ key, label: v.label, n: v.n }));
}

export interface PeriodTotals { nights: number; sold: number; cap: number; capKnown: number; revenue: number; fill: number | null }

/** Totaux d'une liste de soirées ; le remplissage ne compte que les soirées à capacité connue. */
export function totals(list: NightRow[]): PeriodTotals {
  let sold = 0, cap = 0, capKnown = 0, soldKnown = 0, revenue = 0;
  for (const e of list) {
    sold += e.sold;
    revenue += e.revenue;
    if (e.cap && e.cap > 0) { cap += e.cap; capKnown += 1; soldKnown += e.sold; }
  }
  return { nights: list.length, sold, cap, capKnown, revenue, fill: cap > 0 ? soldKnown / cap : null };
}

/** Écart en % vs la période d'avant ; null sous 3 soirées de comparaison. */
export function deltaPct(cur: number, prev: number, prevNights: number): number | null {
  if (prevNights < 3 || !prev) return null;
  return ((cur - prev) / prev) * 100;
}

/** Jour calendaire (YYYY-MM-DD) d'un instant dans un fuseau. */
export function dayIn(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Jours calendaires entre aujourd'hui et la soirée, dans son fuseau (0 = ce soir). */
export function daysUntil(startIso: string, tz: string, now = new Date()): number {
  const a = Date.parse(dayIn(now, tz) + 'T00:00:00Z');
  const b = Date.parse(dayIn(startIso, tz) + 'T00:00:00Z');
  return Math.round((b - a) / 86_400_000);
}
