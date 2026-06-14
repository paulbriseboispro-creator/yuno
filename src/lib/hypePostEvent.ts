/**
 * ════════════════════════════════════════════════════════════════════════════
 *  POST-EVENT NIGHT REPORT ENGINE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  The old post-event analysis fabricated most of what it showed: a "simulated"
 *  wait time, a hardcoded 78% satisfaction, a made-up "23:15" average arrival,
 *  "35% of revenue at peak", "+22% before midnight". None of it was real.
 *
 *  This engine throws all of that out and computes a real Night Report from the
 *  actual data the club generated on Yuno that night:
 *
 *    - Door scans (ticket_attendees.entry_scanned / entry_scanned_at) → the real
 *      number of people who actually showed up, when they arrived, the no-show
 *      rate, and whether the included drink was redeemed.
 *    - Drink orders (orders.items + created_at) → real bar volume, attach rate,
 *      average basket, the real peak hour and the real top seller.
 *    - Tickets + tables + refunds → real gross / net revenue and revenue/head.
 *    - venue_customers → real new vs returning split and customer segments.
 *    - visitor_sessions → the realized page-view → buyer conversion.
 *
 *  Everything here is pure and deterministic (no network, no Date.now, no React)
 *  so it can be unit-tested and reused server-side. The hook feeds it shaped
 *  rows; the engine returns numbers and a grounded 0-10 night score.
 */

// ─── Inputs (already shaped from Supabase rows) ──────────────────────────────

export interface AttendeeLite {
  scanned: boolean;
  scannedAt: number | null; // ms
  drinkRedeemed: boolean;
}

export interface TicketLite {
  quantity: number;
  revenue: number; // total_price (gross)
  createdAt: number; // sale time
  refunded: boolean;
  refundAmount: number;
  isGuest: boolean;
  email: string | null;
  attendees: AttendeeLite[];
}

export interface OrderLite {
  total: number;
  createdAt: number;
  refunded: boolean;
  refundAmount: number;
  items: { name: string; qty: number }[];
  email: string | null;
}

export interface TableLite {
  revenue: number;
  guests: number;
  createdAt: number;
  refunded: boolean;
  refundAmount: number;
  scanned: boolean;
}

/** Venue per-event averages, used for "vs average" deltas and relative scoring. */
export interface VenueBenchmark {
  eventsCount: number;
  avgAttendance: number | null;
  avgRevenuePerHead: number | null;
  avgDrinksPerHead: number | null;
}

export interface NightInput {
  eventStart: number;
  eventEnd: number;
  capacity: number | null;
  tickets: TicketLite[];
  orders: OrderLite[];
  tables: TableLite[];
  /** Unique visitors to the event page (conversion denominator). */
  pageViews: number;
  /** Audience split from venue_customers. */
  newCustomers: number;
  returningCustomers: number;
  topSegment: string | null;
  benchmark: VenueBenchmark;
  /** Number of events folded into this report (1 for a single event). */
  numEvents: number;
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface TimelineBucket {
  time: string;
  orders: number;
  entries: number;
}

export interface NightSubScores {
  fill: number;
  showUp: number;
  bar: number;
  spend: number;
  audience: number;
  conversion: number;
}

export interface NightStats {
  // Attendance
  ticketsSold: number;
  attendance: number; // real scanned people (+ scanned table guests)
  capacity: number | null;
  sellThroughPct: number | null; // sold / capacity
  fillPct: number | null; // attendance / capacity
  showUpRatePct: number | null; // attendance / sold (null if no scan data)
  noShowRatePct: number | null;
  hasScanData: boolean;
  guestListSharePct: number;

  // Revenue
  ticketRevenue: number;
  drinkRevenue: number;
  tableRevenue: number;
  tablesBooked: number;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  revenuePerHead: number; // net / attendance (falls back to sold)
  avgOrderValue: number; // drink basket

  // Bar
  drinkCount: number;
  drinksPerHead: number;
  drinkRedemptionRatePct: number | null; // redeemed / entitled (null if n/a)
  topDrink: string | null;
  topDrinkCount: number;

  // Timing (real)
  peakHourLabel: string;
  peakHourRevenue: number;
  medianArrivalLabel: string | null;
  pctBeforeMidnight: number | null;

  // Audience
  newCustomers: number;
  returningCustomers: number;
  returningRatePct: number;
  topSegment: string | null;

  // Funnel
  conversionRatePct: number | null; // buyers / page views

  // Deltas vs venue average (per-event)
  attendanceChangePct: number | null;
  revenuePerHeadChangePct: number | null;
  drinksPerHeadChangePct: number | null;

  // Timeline
  timeline: TimelineBucket[];

  // Score
  overallScore: number; // 0..10
  tier: 'excellent' | 'good' | 'average' | 'low';
  subScores: NightSubScores;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sat = (x: number, mid: number) => (x <= 0 ? 0 : x / (x + mid));
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const logRatioScore = (r: number, span = 2.5) =>
  r <= 0 ? 0 : clamp(0.5 + 0.5 * Math.tanh(Math.log(r) / Math.log(span)), 0, 1);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const hourLabel = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ─── The engine ────────────────────────────────────────────────────────────────

export function computeNightStats(input: NightInput): NightStats {
  const { tickets, orders, tables, capacity, benchmark, numEvents, eventStart, eventEnd } = input;
  const n = Math.max(numEvents, 1);

  // ── Attendance ──
  const ticketsSold = tickets.reduce((s, t) => s + (t.refunded ? 0 : t.quantity), 0);
  const allAttendees = tickets.flatMap((t) => t.attendees);
  const scannedAttendees = allAttendees.filter((a) => a.scanned);
  const scannedTableGuests = tables
    .filter((t) => t.scanned && !t.refunded)
    .reduce((s, t) => s + Math.max(1, t.guests || 1), 0);
  const hasScanData =
    allAttendees.some((a) => a.scanned) || tables.some((t) => t.scanned);
  const attendance = scannedAttendees.length + scannedTableGuests;

  const sellThroughPct = capacity && capacity > 0 ? clamp(pct(ticketsSold, capacity), 0, 100) : null;
  const showUpRatePct = hasScanData && ticketsSold > 0 ? clamp(pct(attendance, ticketsSold), 0, 100) : null;
  const noShowRatePct = showUpRatePct != null ? clamp(100 - showUpRatePct, 0, 100) : null;
  const fillPct = capacity && capacity > 0 && hasScanData ? clamp(pct(attendance, capacity), 0, 100) : null;
  const guestTickets = tickets.filter((t) => t.isGuest).reduce((s, t) => s + t.quantity, 0);
  const guestListSharePct = ticketsSold > 0 ? clamp(pct(guestTickets, ticketsSold), 0, 100) : 0;

  // Effective head count for per-head metrics: real attendance if scanned, else sold.
  const heads = attendance > 0 ? attendance : ticketsSold;

  // ── Revenue ──
  const ticketRevenue = tickets.reduce((s, t) => s + t.revenue, 0);
  const drinkRevenue = orders.reduce((s, o) => s + o.total, 0);
  const tableRevenue = tables.reduce((s, t) => s + (t.revenue || 0), 0);
  const grossRevenue = ticketRevenue + drinkRevenue + tableRevenue;
  const refunds =
    tickets.reduce((s, t) => s + (t.refunded ? t.refundAmount : 0), 0) +
    orders.reduce((s, o) => s + (o.refunded ? o.refundAmount : 0), 0) +
    tables.reduce((s, t) => s + (t.refunded ? t.refundAmount : 0), 0);
  const netRevenue = Math.max(0, grossRevenue - refunds);
  const revenuePerHead = heads > 0 ? netRevenue / heads : 0;
  const avgOrderValue = orders.length > 0 ? drinkRevenue / orders.length : 0;

  // ── Bar ──
  const drinkCounts = new Map<string, number>();
  let drinkCount = 0;
  for (const o of orders) {
    for (const it of o.items) {
      const q = it.qty || 0;
      drinkCount += q;
      if (it.name) drinkCounts.set(it.name, (drinkCounts.get(it.name) || 0) + q);
    }
  }
  const topDrinkEntry = [...drinkCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topDrink = topDrinkEntry ? topDrinkEntry[0] : null;
  const topDrinkCount = topDrinkEntry ? topDrinkEntry[1] : 0;
  const drinksPerHead = heads > 0 ? drinkCount / heads : 0;

  // Drink redemption: of attendees entitled to a drink (those who scanned), how
  // many redeemed it. Only meaningful when there is scan + redemption data.
  const entitled = scannedAttendees.length;
  const redeemed = scannedAttendees.filter((a) => a.drinkRedeemed).length;
  const anyRedemption = allAttendees.some((a) => a.drinkRedeemed);
  const drinkRedemptionRatePct =
    anyRedemption && entitled > 0 ? clamp(pct(redeemed, entitled), 0, 100) : null;

  // ── Timing ──
  // Orders + entries bucketed across the event window (15-min for one night).
  const windowMs = Math.max(eventEnd - eventStart, 3_600_000);
  const bucketMs = windowMs > 8 * 3_600_000 ? 3_600_000 : 15 * 60_000;
  const buckets: TimelineBucket[] = [];
  for (let t = eventStart; t <= eventEnd; t += bucketMs) {
    const end = t + bucketMs;
    const o = orders.filter((x) => x.createdAt >= t && x.createdAt < end).length;
    const e = scannedAttendees.filter((a) => a.scannedAt != null && a.scannedAt >= t && a.scannedAt < end).length;
    buckets.push({ time: hourLabel(t), orders: Math.round(o / n), entries: Math.round(e / n) });
  }

  // Real peak hour by drink revenue.
  const revByHour = new Map<number, number>();
  for (const o of orders) {
    const h = new Date(o.createdAt).getHours();
    revByHour.set(h, (revByHour.get(h) || 0) + o.total);
  }
  const peakEntry = [...revByHour.entries()].sort((a, b) => b[1] - a[1])[0];
  const peakHourLabel = peakEntry ? `${String(peakEntry[0]).padStart(2, '0')}:00` : '—';
  const peakHourRevenue = peakEntry ? Math.round(peakEntry[1] / n) : 0;

  // Real arrival distribution from scan timestamps.
  const arrivalTimes = scannedAttendees.map((a) => a.scannedAt).filter((x): x is number => x != null);
  const medArrival = median(arrivalTimes);
  const medianArrivalLabel = medArrival != null ? hourLabel(medArrival) : null;
  const pctBeforeMidnight =
    arrivalTimes.length > 0
      ? clamp(
          pct(
            arrivalTimes.filter((ms) => {
              const h = new Date(ms).getHours();
              return h >= 18 && h < 24; // 18:00–23:59 = "before midnight"
            }).length,
            arrivalTimes.length,
          ),
          0,
          100,
        )
      : null;

  // ── Audience ──
  const newCustomers = input.newCustomers;
  const returningCustomers = input.returningCustomers;
  const audienceTotal = newCustomers + returningCustomers;
  const returningRatePct = audienceTotal > 0 ? clamp(pct(returningCustomers, audienceTotal), 0, 100) : 0;

  // ── Funnel ──
  const uniqueBuyers = new Set(
    [...tickets.map((t) => t.email), ...orders.map((o) => o.email)].filter(Boolean),
  ).size;
  const conversionRatePct = input.pageViews > 0 ? clamp(pct(uniqueBuyers, input.pageViews), 0, 100) : null;

  // ── Deltas vs venue average (per-event) ──
  const perEventAttendance = heads / n;
  const attendanceChangePct =
    benchmark.avgAttendance && benchmark.avgAttendance > 0
      ? Math.round(((perEventAttendance - benchmark.avgAttendance) / benchmark.avgAttendance) * 100)
      : null;
  const revenuePerHeadChangePct =
    benchmark.avgRevenuePerHead && benchmark.avgRevenuePerHead > 0
      ? Math.round(((revenuePerHead - benchmark.avgRevenuePerHead) / benchmark.avgRevenuePerHead) * 100)
      : null;
  const drinksPerHeadChangePct =
    benchmark.avgDrinksPerHead && benchmark.avgDrinksPerHead > 0
      ? Math.round(((drinksPerHead - benchmark.avgDrinksPerHead) / benchmark.avgDrinksPerHead) * 100)
      : null;

  // ── Score (grounded, relative to capacity / venue norm / nightlife refs) ──
  const fill =
    capacity && capacity > 0
      ? clamp((hasScanData ? attendance : ticketsSold) / capacity, 0, 1.1) / 1.1
      : benchmark.avgAttendance
        ? logRatioScore(perEventAttendance / benchmark.avgAttendance)
        : sat(perEventAttendance, 150);
  const showUp = showUpRatePct != null ? clamp(showUpRatePct / 100, 0, 1) : 0.6;
  const bar =
    0.6 * sat(drinksPerHead, 1.5) +
    0.4 * (benchmark.avgDrinksPerHead ? logRatioScore(drinksPerHead / benchmark.avgDrinksPerHead) : sat(drinksPerHead, 1.5));
  const spend = benchmark.avgRevenuePerHead
    ? logRatioScore(revenuePerHead / benchmark.avgRevenuePerHead)
    : sat(revenuePerHead, 25);
  const audience = clamp(returningRatePct / 100, 0, 1);
  const conversion = conversionRatePct != null ? sat(conversionRatePct / 100, 0.08) : 0.5;

  const subScores: NightSubScores = { fill, showUp, bar, spend, audience, conversion };

  // Weights — drop show-up when no scan data and renormalize.
  const w = { fill: 0.28, showUp: 0.18, bar: 0.2, spend: 0.16, audience: 0.1, conversion: 0.08 };
  let totalW = w.fill + w.showUp + w.bar + w.spend + w.audience + w.conversion;
  let weighted =
    fill * w.fill + showUp * w.showUp + bar * w.bar + spend * w.spend + audience * w.audience + conversion * w.conversion;
  if (!hasScanData) {
    weighted -= showUp * w.showUp;
    totalW -= w.showUp;
  }
  const overall01 = clamp(weighted / totalW, 0, 1);
  const overallScore = Math.round(overall01 * 100) / 10;
  const tier: NightStats['tier'] =
    overallScore >= 8 ? 'excellent' : overallScore >= 6 ? 'good' : overallScore >= 4 ? 'average' : 'low';

  return {
    ticketsSold: Math.round(ticketsSold / n),
    attendance: Math.round(attendance / n),
    capacity,
    sellThroughPct,
    fillPct,
    showUpRatePct,
    noShowRatePct,
    hasScanData,
    guestListSharePct,
    ticketRevenue: Math.round(ticketRevenue / n),
    drinkRevenue: Math.round(drinkRevenue / n),
    tableRevenue: Math.round(tableRevenue / n),
    tablesBooked: Math.round(tables.filter((t) => !t.refunded).length / n),
    grossRevenue: Math.round(grossRevenue / n),
    refunds: Math.round(refunds / n),
    netRevenue: Math.round(netRevenue / n),
    revenuePerHead,
    avgOrderValue,
    drinkCount: Math.round(drinkCount / n),
    drinksPerHead,
    drinkRedemptionRatePct,
    topDrink,
    topDrinkCount: Math.round(topDrinkCount / n),
    peakHourLabel,
    peakHourRevenue,
    medianArrivalLabel,
    pctBeforeMidnight,
    newCustomers: Math.round(newCustomers / n),
    returningCustomers: Math.round(returningCustomers / n),
    returningRatePct,
    topSegment: input.topSegment,
    conversionRatePct,
    attendanceChangePct,
    revenuePerHeadChangePct,
    drinksPerHeadChangePct,
    timeline: buckets,
    overallScore,
    tier,
    subScores,
  };
}
