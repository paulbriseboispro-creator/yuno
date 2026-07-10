/**
 * Pure computation helpers for the extended live-ops data (owner command
 * center). Everything here transforms already-fetched rows into
 * station-ready aggregates — no Supabase calls, no React.
 */

export interface VipTableLive {
  id: string;
  name: string;
  status: string;
  checkedInAt: string | null;
  minimumSpend: number;
  guestCount: number | null;
  consumedTotal: number;
  createdAt: string;
}

export interface TopItemLive {
  name: string;
  count: number;
}

export interface ServiceMomentLive {
  id: string;
  kind: string;
  label: string | null;
  scheduledAt: string | null;
  tableName: string | null;
}

export interface IncidentLive {
  id: string;
  kind: string;
  reason: string | null;
  createdAt: string;
}

export interface DoorStats {
  ticketScans: number;
  vipScans: number;
  glScans: number;
  glTotal: number;
  glQuota: number;
  entriesLast10Min: number;
  /** Entries per 5-min bucket over the last hour, oldest first (12 buckets). */
  paceBuckets: number[];
  /** VIP reservations with no check-in 2h+ after event start (null when no event). */
  vipNoShows: number;
}

export interface BarStats {
  /** Paid orders the bar hasn't served yet (queue + preparing + ready). */
  backlogCount: number;
  /** Age in minutes of the oldest paid order still not served. */
  oldestUnservedMinutes: number | null;
  topDrinksLastHour: TopItemLive[];
  barRevenueLastHour: number;
}

export interface VipStats {
  tables: VipTableLive[];
  arrivedCount: number;
  bottlesServed: number;
  consumedTotal: number;
  upcomingMoments: ServiceMomentLive[];
}

export interface CloakroomStats {
  active: number;
  retrieved: number;
  revenue: number;
}

/** Everything the owner command center needs beyond the base live data. */
export interface LiveExtendedData {
  door: DoorStats;
  bar: BarStats;
  vip: VipStats;
  cloakroom: CloakroomStats;
  incidents: IncidentLive[];
}

interface OrderRow {
  id: string;
  total: number | string;
  status: string | null;
  prep_status: string | null;
  created_at: string;
  refunded_at: string | null;
  service_fee: number | string | null;
  items?: { name?: string; qty?: number; quantity?: number }[] | null;
}

interface TableRow {
  id: string;
  full_name: string | null;
  status: string | null;
  created_at: string;
  entry_scanned: boolean | null;
  checked_in_at?: string | null;
  minimum_spend?: number | string | null;
  guest_count?: number | null;
  finished_at?: string | null;
}

interface ConsumptionRow {
  table_reservation_id: string;
  item_type: string;
  quantity: number;
  total_price: number | string;
}

const num = (v: number | string | null | undefined): number => Number(v || 0);

const isUnservedPaid = (o: OrderRow): boolean =>
  o.status === 'paid' && !o.refunded_at && o.prep_status !== 'served';

export function computeBarStats(orders: OrderRow[], now: Date = new Date()): BarStats {
  const unserved = orders.filter(isUnservedPaid);
  const oldest = unserved.reduce<string | null>(
    (min, o) => (min === null || o.created_at < min ? o.created_at : min),
    null,
  );
  const oldestUnservedMinutes = oldest
    ? Math.max(0, Math.floor((now.getTime() - new Date(oldest).getTime()) / 60_000))
    : null;

  const oneHourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();
  const lastHourPaid = orders.filter(
    o => (o.status === 'paid' || o.status === 'served') && o.created_at >= oneHourAgo,
  );
  const barRevenueLastHour = lastHourPaid.reduce((s, o) => s + num(o.total) - num(o.service_fee), 0);

  const counts = new Map<string, number>();
  lastHourPaid.forEach(o => {
    (o.items || []).forEach(item => {
      if (!item?.name) return;
      const qty = Number(item.qty ?? item.quantity ?? 1) || 1;
      counts.set(item.name, (counts.get(item.name) || 0) + qty);
    });
  });
  const topDrinksLastHour = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return { backlogCount: unserved.length, oldestUnservedMinutes, topDrinksLastHour, barRevenueLastHour };
}

export function computeVipTables(tables: TableRow[], consumptions: ConsumptionRow[]): VipTableLive[] {
  const spendByTable = new Map<string, number>();
  consumptions.forEach(c => {
    spendByTable.set(c.table_reservation_id, (spendByTable.get(c.table_reservation_id) || 0) + num(c.total_price));
  });
  return tables
    .filter(t => t.status !== 'cancelled' && t.status !== 'denied')
    .map(t => ({
      id: t.id,
      name: t.full_name || 'VIP',
      status: t.status || '',
      checkedInAt: t.checked_in_at ?? (t.entry_scanned ? t.created_at : null),
      minimumSpend: num(t.minimum_spend),
      guestCount: t.guest_count ?? null,
      consumedTotal: spendByTable.get(t.id) || 0,
      createdAt: t.created_at,
    }))
    .sort((a, b) => b.minimumSpend - a.minimumSpend);
}

export function computeVipStats(
  tables: TableRow[],
  consumptions: ConsumptionRow[],
  moments: { id: string; kind: string; label: string | null; scheduled_at: string | null; table_reservation_id: string | null }[],
): VipStats {
  const vipTables = computeVipTables(tables, consumptions);
  const nameByTable = new Map(vipTables.map(t => [t.id, t.name]));
  return {
    tables: vipTables,
    arrivedCount: vipTables.filter(t => t.checkedInAt).length,
    bottlesServed: consumptions
      .filter(c => c.item_type === 'bottle')
      .reduce((s, c) => s + (Number(c.quantity) || 0), 0),
    consumedTotal: consumptions.reduce((s, c) => s + num(c.total_price), 0),
    upcomingMoments: moments.map(m => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      scheduledAt: m.scheduled_at,
      tableName: m.table_reservation_id ? nameByTable.get(m.table_reservation_id) ?? null : null,
    })),
  };
}

export function computeDoorStats(
  scannedTickets: { entry_scanned_at?: string | null }[],
  scannedTables: { entry_scanned_at?: string | null }[],
  glEntries: { entry_scanned: boolean | null; entry_scanned_at: string | null; guest_list_id: string; guest_lists?: { quota: number } | null }[],
  vipTables: VipTableLive[],
  eventStartAt: string | null,
  now: Date = new Date(),
): DoorStats {
  const glScanned = glEntries.filter(e => e.entry_scanned);
  const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
  const recent = (rows: { entry_scanned_at?: string | null }[]) =>
    rows.filter(r => r.entry_scanned_at && r.entry_scanned_at >= tenMinAgo).length;

  // Entries per 5-min bucket over the last hour (sparkline food).
  const paceBuckets = new Array(12).fill(0) as number[];
  const oneHourAgoMs = now.getTime() - 60 * 60_000;
  [...scannedTickets, ...scannedTables, ...glScanned].forEach(r => {
    if (!r.entry_scanned_at) return;
    const ms = new Date(r.entry_scanned_at).getTime();
    if (ms < oneHourAgoMs || ms > now.getTime()) return;
    const bucket = Math.min(11, Math.floor((ms - oneHourAgoMs) / (5 * 60_000)));
    paceBuckets[bucket]++;
  });

  // One quota per guest list (entries repeat their parent list's quota).
  const quotaByList = new Map<string, number>();
  glEntries.forEach(e => {
    if (e.guest_lists) quotaByList.set(e.guest_list_id, Number(e.guest_lists.quota) || 0);
  });
  const glQuota = [...quotaByList.values()].reduce((s, q) => s + q, 0);

  let vipNoShows = 0;
  if (eventStartAt) {
    const twoHoursAfterStart = new Date(new Date(eventStartAt).getTime() + 2 * 3600_000);
    if (now >= twoHoursAfterStart) {
      vipNoShows = vipTables.filter(t => !t.checkedInAt).length;
    }
  }

  return {
    ticketScans: scannedTickets.length,
    vipScans: scannedTables.length,
    glScans: glScanned.length,
    glTotal: glEntries.length,
    glQuota,
    entriesLast10Min: recent(scannedTickets) + recent(scannedTables) + recent(glScanned),
    paceBuckets,
    vipNoShows,
  };
}

export function computeCloakroomStats(
  rows: { retrieved?: boolean | null; price?: number | string | null }[],
): CloakroomStats {
  const retrieved = rows.filter(r => r.retrieved).length;
  return {
    active: rows.length - retrieved,
    retrieved,
    revenue: rows.reduce((s, r) => s + num(r.price), 0),
  };
}

/** A VIP table is "at risk" when past midnight-Paris-ish (spend deadline
 * pressure) it has consumed less than 60% of its minimum spend. The caller
 * passes the event end so the check tightens near closing. */
export function isMinSpendAtRisk(table: VipTableLive, eventEndAt: string | null, now: Date = new Date()): boolean {
  if (!table.checkedInAt || table.minimumSpend <= 0) return false;
  if (table.consumedTotal >= table.minimumSpend * 0.6) return false;
  if (!eventEndAt) return false;
  const remainingMs = new Date(eventEndAt).getTime() - now.getTime();
  return remainingMs > 0 && remainingMs <= 90 * 60_000;
}
