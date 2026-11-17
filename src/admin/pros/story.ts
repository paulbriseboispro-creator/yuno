/**
 * Ce que racontent les pages Pros (v3), en fonctions pures (testées) :
 * comptes par étape du cycle de vie, phrase-réponse de la liste, histoire
 * d'un compte (vend depuis quand, ce qu'il prépare), nuits d'un compte.
 */
import type { AccountRow, Lifecycle } from './accounts';
import type { AccountCard, EventRow, MonthRow } from './data';

/** Ordre de lecture de la barre : du premier contact à la pause. */
export const LIFE_ORDER: Lifecycle[] = ['invited', 'signed_up', 'configured', 'selling', 'at_risk', 'paused', 'closed'];

export function lifecycleCounts(rows: AccountRow[]): Record<Lifecycle, number> {
  const out = Object.fromEntries(LIFE_ORDER.map((s) => [s, 0])) as Record<Lifecycle, number>;
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/** Le premier mois où le compte a vendu (billets ou tables), `AAAA-MM`, ou null. */
export function firstSaleMonth(monthly: MonthRow[] | null | undefined): string | null {
  const m = [...(monthly ?? [])].sort((a, b) => a.month.localeCompare(b.month))
    .find((x) => Number(x.tickets || 0) + Number(x.tables || 0) > 0);
  return m ? m.month : null;
}

/** Les 12 derniers mois (AAAA-MM) se terminant au mois de `now`, trous compris. */
export function last12Months(now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** CA club et ventes par mois sur 12 mois, un zéro là où le mois manque. */
export function monthlySeries(monthly: MonthRow[] | null | undefined, now: Date = new Date()) {
  const by = new Map((monthly ?? []).map((m) => [m.month.slice(0, 7), m]));
  return last12Months(now).map((m) => {
    const r = by.get(m);
    return {
      month: m,
      revenue: r ? Number(r.tickets_rev || 0) + Number(r.tables_rev || 0) : 0,
      sales: r ? Number(r.tickets || 0) + Number(r.tables || 0) : 0,
      guestlist: r ? Number(r.guestlist || 0) : 0,
    };
  });
}

/** Les soirées (non annulées) en jours, pour un calendrier : ventes de la soirée = billets + tables + guest list. */
export function nightsByDay(events: EventRow[], from: Date, to: Date): Array<{ d: string; v: number }> {
  const by = new Map<string, number>();
  for (const e of events) {
    if (e.cancelled) continue;
    const d = e.start_at.slice(0, 10);
    by.set(d, (by.get(d) ?? 0) + Number(e.tickets || 0) + Number(e.tables || 0) + Number(e.guestlist || 0));
  }
  const out: Array<{ d: string; v: number }> = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let i = 0; cur.getTime() <= end && i < 800; i += 1) {
    const d = cur.toISOString().slice(0, 10);
    out.push({ d, v: by.get(d) ?? 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Ce que la phrase du compte peut dire, sans rien inventer. */
export function accountStory(card: Pick<AccountCard, 'row' | 'monthly' | 'events' | 'crm'>, now: number = Date.now()) {
  const row = card.row;
  const upcoming = (card.events ?? []).filter((e) => !e.cancelled && new Date(e.start_at).getTime() > now).length;
  const acc = card.crm?.account;
  return {
    since: firstSaleMonth(card.monthly),
    sales30: row?.sales_30d ?? 0,
    revenuePeriod: row?.revenue_period ?? null,
    upcoming: row ? Math.max(upcoming, row.upcoming) : upcoming,
    crmState: acc?.state ?? row?.crm?.state ?? null,
    trialEndsAt: acc?.trial_ends_at ?? null,
    lastSaleAt: row?.last_sale_at ?? null,
  };
}
