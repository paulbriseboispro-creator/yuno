/**
 * Chiffres de vente des soirées à venir — liste des soirées + tableau de bord
 * (club et organisateur). Tous les chiffres viennent de la RPC
 * `get_events_sales_summary` (migration 20260924160000) : ce module type la
 * réponse et la met en forme (compte à rebours J-N, jauges, piliers à
 * montrer). Il n'agrège jamais une vente.
 */

export interface PillarCount {
  enabled: boolean;
  soldOut: boolean;
  /** `null` = pas de jauge connue (palier sans plafond, liste sans quota…). */
  capacity: number | null;
}

export interface EventSales {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  poster: string | null;
  status: 'active' | 'postponed' | string;
  isActive: boolean;
  publishedAt: string | null;
  /** Minuit du jour en cours, dans le fuseau de la soirée. */
  dayStart: string;
  tickets: PillarCount & { sold: number; today: number };
  tables: PillarCount & { booked: number; today: number; guests: number };
  guestList: PillarCount & { registered: number; today: number };
  /** Précommandes du bar — portée club seulement. */
  drinks: { orders: number; today: number } | null;
  visits: { total: number; today: number };
  /** `null` = l'appelant ne voit pas l'argent (ou soirée seulement accueillie). */
  revenue: { total: number; today: number; tickets: number; tables: number; drinks: number } | null;
}

export interface EventsSalesSummary {
  ok: true;
  now: string;
  money: boolean;
  events: EventSales[];
}

// ── Compte à rebours ────────────────────────────────────────────────────────

export type Countdown =
  | { kind: 'live' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'days'; days: number }
  | { kind: 'past' };

const PARIS = 'Europe/Paris';

/** « 2026-09-26 » dans le fuseau donné. */
function dayKey(d: Date, timeZone: string): string {
  // en-CA rend AAAA-MM-JJ, sans dépendre de la locale de l'utilisateur.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.UTC(+fromKey.slice(0, 4), +fromKey.slice(5, 7) - 1, +fromKey.slice(8, 10));
  const b = Date.UTC(+toKey.slice(0, 4), +toKey.slice(5, 7) - 1, +toKey.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/**
 * J-N en jours CALENDAIRES du fuseau de la soirée, comme Shotgun : une soirée
 * samedi 23 h vue jeudi 10 h est à J-2, pas à « dans 2 jours et 13 heures ».
 * Une soirée commencée et pas finie est « en cours ».
 */
export function countdownFor(startAt: string, endAt: string, now: Date = new Date(), timeZone: string = PARIS): Countdown {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (now >= end) return { kind: 'past' };
  if (now >= start) return { kind: 'live' };
  const days = daysBetween(dayKey(now, timeZone), dayKey(start, timeZone));
  if (days <= 0) return { kind: 'today' };
  if (days === 1) return { kind: 'tomorrow' };
  return { kind: 'days', days };
}

/** Le libellé du compte à rebours (« J-2 », « Ce soir »…). */
export function countdownLabel(c: Countdown, t: (k: string) => string): string {
  switch (c.kind) {
    case 'live': return t('evs.cd.live');
    case 'today': return t('evs.cd.today');
    case 'tomorrow': return t('evs.cd.tomorrow');
    case 'days': return t('evs.cd.days').replace('{n}', String(c.days));
    default: return t('evs.cd.past');
  }
}

// ── Jauges ─────────────────────────────────────────────────────────────────

/** Remplissage en % (0-100, arrondi), ou `null` sans jauge connue. */
export function fillPct(count: number, capacity: number | null): number | null {
  if (!capacity || capacity <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((count / capacity) * 100)));
}

export type PillarKey = 'tickets' | 'tables' | 'guestList';

export interface PillarLine {
  key: PillarKey;
  count: number;
  today: number;
  capacity: number | null;
  pct: number | null;
  soldOut: boolean;
}

/**
 * Les piliers à montrer pour une soirée, dans l'ordre billets → tables →
 * guest list. Un pilier fermé qui n'a jamais rien vendu se tait ; un pilier
 * qui a vendu reste visible même éteint depuis (les ventes existent).
 */
export function pillarLines(ev: EventSales): PillarLine[] {
  const lines: PillarLine[] = [];
  if (ev.tickets.enabled || ev.tickets.sold > 0) {
    lines.push({
      key: 'tickets', count: ev.tickets.sold, today: ev.tickets.today,
      capacity: ev.tickets.capacity, pct: fillPct(ev.tickets.sold, ev.tickets.capacity), soldOut: ev.tickets.soldOut,
    });
  }
  if (ev.tables.enabled || ev.tables.booked > 0) {
    lines.push({
      key: 'tables', count: ev.tables.booked, today: ev.tables.today,
      capacity: ev.tables.capacity, pct: fillPct(ev.tables.booked, ev.tables.capacity), soldOut: ev.tables.soldOut,
    });
  }
  if (ev.guestList.enabled || ev.guestList.registered > 0) {
    lines.push({
      key: 'guestList', count: ev.guestList.registered, today: ev.guestList.today,
      capacity: ev.guestList.capacity, pct: fillPct(ev.guestList.registered, ev.guestList.capacity), soldOut: ev.guestList.soldOut,
    });
  }
  return lines;
}

/**
 * Une soirée gratuite (guest list seule, ou billets à 0 €) n'a pas de chiffre
 * d'affaires à montrer : afficher « 0 € » à côté de 112 inscrits dit le
 * contraire de ce qui se passe. Shotgun le fait ; pas nous.
 */
export function showsRevenue(ev: EventSales): boolean {
  if (!ev.revenue) return false;
  if (ev.revenue.total > 0) return true;
  return ev.tickets.enabled || ev.tables.enabled;
}

/** Ce qui a bougé aujourd'hui, tous piliers confondus (billets + tables + inscrits). */
export function todayActivity(ev: EventSales): number {
  return ev.tickets.today + ev.tables.today + ev.guestList.today;
}
