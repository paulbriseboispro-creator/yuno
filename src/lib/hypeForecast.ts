/**
 * ════════════════════════════════════════════════════════════════════════════
 *  HYPE FORECAST ENGINE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  A real, time-to-event-aware forecasting engine for nightlife events.
 *
 *  The old "hype score" only described the *last 24h* of activity with a pile
 *  of arbitrary magic numbers. It never predicted anything. This engine answers
 *  the question an owner actually has:
 *
 *      "Given where I am right now, how full will this night be?"
 *
 *  ── How it works (3 layers) ────────────────────────────────────────────────
 *
 *  1. PACE FORECAST (the skeleton).
 *     Nightlife ticket sales follow a heavily back-loaded S-curve: slow build,
 *     then a sharp spike in the final days. We model g(f) = the fraction of the
 *     final sales that is typically reached by the time-fraction f of the sales
 *     window (f = 0 at sale open, f = 1 at doors). We learn g(f) from the
 *     venue's OWN past events when available, and fall back to a generic
 *     nightlife prior when history is thin (empirical-Bayes shrinkage). The raw
 *     projection is simply:  projectedFinal = currentSold / g(f).
 *
 *  2. DEMAND PRESSURE (the correction).
 *     Raw pace is blind to the *quality* of the current audience. We read the
 *     leading indicators that precede a purchase — traffic vs the venue's
 *     baseline, the view→cart→checkout→buy funnel, dwell time, returning
 *     visitors, favorites velocity, traffic-source diversity and sales
 *     acceleration — into a single Demand Pressure Index (DPI, 0..1). DPI nudges
 *     the pace projection up or down by up to ±30%.
 *
 *  3. CONFIDENCE (the honesty).
 *     A projection 30 days out from one data point is a guess. One 12h before
 *     doors with 5 past events behind it is nearly certain. Confidence grows
 *     with time elapsed, history depth and data volume, and it is surfaced
 *     instead of hidden.
 *
 *  Everything here is pure and deterministic so it can be unit-tested and reused
 *  on the server later. No network, no React, no Date.now() side effects.
 */

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** A cumulative-sales sample: `cum` tickets sold as of timestamp `t` (ms). */
export interface SalesPoint {
  t: number;
  cum: number;
}

/** A completed past event, normalized into a unit sales curve. */
export interface HistoricalEvent {
  finalSold: number;
  capacity: number | null;
  /** Sorted ascending by `f`. `f` = time-fraction 0..1, `frac` = cum/final 0..1. */
  curve: { f: number; frac: number }[];
}

/** Leading-indicator signals read from visitor_sessions / orders / loyalty. */
export interface DemandSignals {
  /** Avg unique daily visitors to this event over the last 7d. */
  visitors7dDaily: number;
  /** Venue baseline: avg unique daily visitors over the last 30d. */
  baselineDaily: number;
  /** Funnel counts over the analysis window (event-scoped when possible). */
  views: number;
  carts: number;
  checkouts: number;
  purchases: number;
  /** Engagement depth. */
  avgDurationSec: number;
  scrollDepthMax: number; // 0..100
  returningVisitorRate: number; // 0..1
  /** Intent to attend. */
  favorites: number;
  favorites7d: number;
  /** Word-of-mouth proxy: distinct referrer/utm sources. */
  sourceDiversity: number;
  /** Sales dynamics. */
  salesSlope7d: number; // change in tickets/day across the last 7d (qty/day)
  recentDailySales: number; // avg tickets/day over the last 7d
  /** Loyalty / repeat base. */
  returningCustomerRate: number; // 0..1
  loyaltyActive: number;
  loyaltyTotal: number;
}

/**
 * Self-reported "before Yuno" profile. Provides a calibrated prior so the very
 * first events already forecast well, before the engine has any Yuno history.
 */
export interface BaselineProfile {
  /** Attendance on a good night — the realistic target before history exists. */
  typicalAttendance: number | null;
  /** Room capacity. */
  capacity: number | null;
  /** When customers usually buy — shapes how back-loaded the curve is. */
  salesTiming: 'door' | 'mixed' | 'advance' | null;
  /** How often the venue sells out — calibrates early sellout probability. */
  selloutFrequency: 'never' | 'rarely' | 'sometimes' | 'often' | 'always' | null;
}

export interface ForecastInput {
  now: number;
  eventStart: number;
  saleStart: number;
  capacity: number | null;
  currentSold: number;
  salesSeries: SalesPoint[];
  history: HistoricalEvent[];
  demand: DemandSignals;
  /** Venue's average final attendance across past events (target fallback). */
  venueAvgFinal: number | null;
  /** Optional self-reported calibration (used most when history is thin). */
  baseline?: BaselineProfile | null;
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

/** Normalized 0..1 building blocks the pillars + overall score are built from. */
export interface SubScores {
  reach: number;
  funnel: number;
  engagement: number;
  conversion: number;
  recurrence: number;
  momentum: number;
  trajectory: number;
}

export interface ForecastResult {
  timeFraction: number;
  daysUntil: number;
  expectedFractionNow: number; // g(f)
  paceProjection: number; // currentSold / g(f)
  demandIndex: number; // DPI 0..1
  demandMultiplier: number; // 0.7..1.3
  projectedFinalDemand: number; // uncapped demand estimate
  projectedAttendance: number; // capped at capacity
  capacity: number | null;
  pctCapacity: number | null;
  selloutProbability: number; // 0..1
  paceStatus: 'ahead' | 'on_track' | 'behind';
  paceRatio: number; // actual sold / expected-by-now toward target
  confidence: 'low' | 'medium' | 'high';
  confidenceScore: number; // 0..1
  expectedCurve: { f: number; cum: number; kind: 'actual' | 'projected' }[];
  historyCount: number;
  subScores: SubScores;
  overallScore10: number; // 0..10
  level: 'low' | 'medium' | 'high' | 'fire';
}

// ─── Math helpers ──────────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Saturating map: 0 → 0, x = mid → 0.5, x → ∞ → 1. For "more is better" counts. */
const sat = (x: number, mid: number) => (x <= 0 ? 0 : x / (x + mid));

/**
 * Score a ratio around 1.0 onto 0..1. r = 1 → 0.5, r = span → ~0.88,
 * r = 1/span → ~0.12. Symmetric in log space, so doubling and halving are
 * treated as equal-magnitude moves.
 */
const logRatioScore = (r: number, span = 3) => {
  if (r <= 0) return 0;
  return clamp(0.5 + 0.5 * Math.tanh(Math.log(r) / Math.log(span)), 0, 1);
};

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

// ─── Layer 1 — the pace curve g(f) ─────────────────────────────────────────────

/**
 * Nightlife sales prior, back-loaded by nature (most tickets sell near doors).
 * The exact shape depends on WHEN the venue's crowd usually buys:
 *
 *   - 'door'    : almost everything at the last moment → very back-loaded (f^4).
 *   - 'mixed'   : the generic nightlife default (f^3).
 *   - 'advance' : strong presale culture → earlier, flatter (f^2).
 *
 * Checkpoints at f = 0.5 / 0.8: door ≈ 9% / 41%, mixed ≈ 18% / 56%,
 * advance ≈ 32% / 70%. Used as the fallback before Yuno history accumulates.
 */
export function priorCurve(f: number, timing?: BaselineProfile['salesTiming']): number {
  const x = clamp(f, 0, 1);
  switch (timing) {
    case 'door':
      return clamp(0.08 * x + 0.92 * x * x * x * x, 0, 1);
    case 'advance':
      return clamp(0.3 * x + 0.7 * x * x, 0, 1);
    case 'mixed':
    default:
      return clamp(0.15 * x + 0.85 * x * x * x, 0, 1);
  }
}

/** Linearly interpolate a single normalized history curve at time-fraction f. */
function interpCurve(curve: { f: number; frac: number }[], f: number): number {
  if (curve.length === 0) return priorCurve(f, 'mixed');
  if (f <= curve[0].f) return curve[0].frac * (f / Math.max(curve[0].f, 1e-6));
  for (let i = 1; i < curve.length; i++) {
    if (f <= curve[i].f) {
      const a = curve[i - 1];
      const b = curve[i];
      const w = (f - a.f) / Math.max(b.f - a.f, 1e-6);
      return a.frac + w * (b.frac - a.frac);
    }
  }
  return curve[curve.length - 1].frac;
}

/**
 * Blended expected-fraction-sold-by-now. Empirical-Bayes shrinkage toward the
 * generic prior: with 0 past events we fully trust the prior; the more history,
 * the more we trust the venue's own learned curve (2 pseudo-events of prior).
 */
export function expectedFraction(
  history: HistoricalEvent[],
  f: number,
  timing?: BaselineProfile['salesTiming'],
): number {
  const prior = priorCurve(f, timing);
  if (history.length === 0) return prior;
  const venue =
    history.reduce((s, h) => s + interpCurve(h.curve, f), 0) / history.length;
  const w = history.length / (history.length + 2);
  return clamp(w * venue + (1 - w) * prior, 0.001, 1);
}

// ─── Layer 2 — Demand Pressure Index ───────────────────────────────────────────

interface DemandBreakdown {
  dpi: number;
  reach: number;
  funnel: number;
  engagement: number;
  favVelocity: number;
  diversity: number;
  acceleration: number;
}

function computeDemand(d: DemandSignals): DemandBreakdown {
  // Reach: today's traffic vs the venue's normal day.
  const baseline = Math.max(d.baselineDaily, 0.5);
  const reach = logRatioScore(d.visitors7dDaily / baseline, 3);

  // Funnel: how cleanly views turn into intent. Typical nightlife rates used as
  // the "0.5 point" of each saturating term.
  const cartRate = d.views > 0 ? d.carts / d.views : 0;
  const checkoutRate = d.views > 0 ? d.checkouts / d.views : 0;
  const purchaseRate = d.views > 0 ? d.purchases / d.views : 0;
  const funnel =
    0.3 * sat(cartRate, 0.1) +
    0.3 * sat(checkoutRate, 0.05) +
    0.4 * sat(purchaseRate, 0.025);

  // Engagement depth.
  const engagement =
    0.45 * sat(d.avgDurationSec, 45) +
    0.2 * clamp(d.scrollDepthMax / 100, 0, 1) +
    0.35 * clamp(d.returningVisitorRate, 0, 1);

  // Favorites velocity — saves are a strong intent-to-attend signal.
  const favVelocity = sat(d.favorites7d, Math.max(4, baseline * 0.4));

  // Word of mouth: more distinct sources = broader organic spread.
  const diversity = sat(d.sourceDiversity, 4);

  // Acceleration: is the daily sales rate rising? Centered at 0.5 (flat).
  const accelRaw = d.salesSlope7d / Math.max(1, d.recentDailySales + 1);
  const acceleration = clamp(0.5 + 0.5 * Math.tanh(accelRaw), 0, 1);

  const dpi = clamp(
    0.22 * reach +
      0.26 * funnel +
      0.18 * engagement +
      0.12 * favVelocity +
      0.07 * diversity +
      0.15 * acceleration,
    0,
    1,
  );

  return { dpi, reach, funnel, engagement, favVelocity, diversity, acceleration };
}

// ─── The engine ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export function computeForecast(input: ForecastInput): ForecastResult {
  const {
    now,
    eventStart,
    saleStart,
    currentSold,
    history,
    demand,
    baseline,
  } = input;

  // Self-reported baseline backfills capacity / target / curve shape until the
  // engine has learned the venue's own rhythm from Yuno history.
  const capacity = input.capacity ?? baseline?.capacity ?? null;
  const venueAvgFinal = input.venueAvgFinal ?? baseline?.typicalAttendance ?? null;
  const timing = baseline?.salesTiming ?? 'mixed';

  // ── Time fraction f ──
  const leadMs = Math.max(eventStart - saleStart, DAY_MS); // guard div-by-0
  const elapsedMs = now - saleStart;
  const f = clamp(elapsedMs / leadMs, 0.001, 1);
  const daysUntil = Math.max(0, Math.round((eventStart - now) / DAY_MS));

  // ── Layer 1: pace projection ──
  const gNow = expectedFraction(history, f, timing);
  // Floor g so an ultra-early projection from 1 ticket can't explode to ∞.
  const gSafe = Math.max(gNow, 0.04);
  const paceProjection = currentSold / gSafe;

  // ── Layer 2: demand correction ──
  const dem = computeDemand(demand);
  const demandMultiplier = clamp(1 + (dem.dpi - 0.5) * 0.6, 0.7, 1.3);

  const projectedFinalDemand = Math.max(
    Math.round(paceProjection * demandMultiplier),
    currentSold,
  );
  const projectedAttendance =
    capacity != null
      ? Math.min(projectedFinalDemand, capacity)
      : projectedFinalDemand;
  const pctCapacity =
    capacity && capacity > 0
      ? clamp((projectedAttendance / capacity) * 100, 0, 100)
      : null;

  // ── Layer 3: confidence ──
  const historyFactor = history.length / (history.length + 2);
  const dataFactor = sat(demand.views + currentSold * 5, 200);
  // A self-reported baseline means we are no longer blind on a cold start, so
  // it lifts the confidence floor (a calibrated cold start reads "Medium").
  const baselineFactor = baseline ? 0.1 : 0;
  const confidenceScore = clamp(
    0.15 + 0.4 * f + 0.18 * historyFactor + 0.17 * dataFactor + baselineFactor,
    0,
    1,
  );
  const confidence: ForecastResult['confidence'] =
    confidenceScore >= 0.7 ? 'high' : confidenceScore >= 0.45 ? 'medium' : 'low';

  // ── Sellout probability ──
  let selloutProbability = 0;
  if (capacity && capacity > 0) {
    const ratio = projectedFinalDemand / capacity;
    const base = logistic((ratio - 1) * 5); // 0.5 exactly at projected = capacity
    // Discount by confidence so a shaky early projection isn't reported as 95%.
    let dataProb = clamp(base * (0.55 + 0.45 * confidenceScore), 0.01, 0.99);
    // Blend with the venue's self-reported sellout habit. Early on (low
    // confidence) we lean on what they told us; later, the live data takes over.
    const freqPrior: Record<string, number> = {
      never: 0.05, rarely: 0.2, sometimes: 0.45, often: 0.7, always: 0.9,
    };
    if (baseline?.selloutFrequency && freqPrior[baseline.selloutFrequency] != null) {
      const prior = freqPrior[baseline.selloutFrequency];
      dataProb = clamp(confidenceScore * dataProb + (1 - confidenceScore) * prior, 0.01, 0.99);
    }
    selloutProbability = dataProb;
  }

  // ── Pace vs schedule (toward a target) ──
  const target =
    (capacity && capacity > 0 ? capacity : null) ??
    (venueAvgFinal && venueAvgFinal > 0 ? venueAvgFinal : null) ??
    Math.max(projectedFinalDemand, 1);
  const expectedByNow = Math.max(gNow * target, 0.5);
  const paceRatio = currentSold / expectedByNow;
  const paceStatus: ForecastResult['paceStatus'] =
    paceRatio >= 1.1 ? 'ahead' : paceRatio <= 0.9 ? 'behind' : 'on_track';

  // ── Projected cumulative curve (for charting) ──
  const expectedCurve: ForecastResult['expectedCurve'] = [];
  const STEPS = 10;
  for (let i = 0; i <= STEPS; i++) {
    const ff = (i / STEPS) * f;
    expectedCurve.push({
      f: ff,
      cum: Math.round((expectedFraction(history, ff, timing) / Math.max(gNow, 1e-3)) * currentSold),
      kind: 'actual',
    });
  }
  for (let i = 1; i <= STEPS; i++) {
    const ff = f + (i / STEPS) * (1 - f);
    expectedCurve.push({
      f: ff,
      cum: Math.round(expectedFraction(history, ff, timing) * projectedFinalDemand),
      kind: 'projected',
    });
  }

  // ── Sub-scores (0..1) → pillars + overall ──
  const conversionScore =
    0.55 * sat(demand.views > 0 ? demand.purchases / demand.views : 0, 0.03) +
    0.45 * sat(demand.checkouts > 0 ? demand.purchases / demand.checkouts : 0, 0.4);
  const recurrenceScore =
    0.55 * clamp(demand.returningCustomerRate, 0, 1) +
    0.45 *
      (demand.loyaltyTotal > 0
        ? clamp(demand.loyaltyActive / demand.loyaltyTotal, 0, 1)
        : sat(demand.loyaltyActive, 10));
  const momentumScore = clamp(
    0.55 * dem.acceleration + 0.45 * logRatioScore(paceRatio, 2),
    0,
    1,
  );

  // Trajectory: are we on course to fill the room / beat our average?
  const trajRatio = projectedFinalDemand / Math.max(target, 1);
  const trajectory = clamp(logistic((trajRatio - 0.6) * 3), 0, 1);

  const subScores: SubScores = {
    reach: clamp(0.7 * dem.reach + 0.3 * dem.favVelocity, 0, 1),
    funnel: clamp(0.7 * dem.funnel + 0.3 * dem.engagement, 0, 1),
    engagement: dem.engagement,
    conversion: conversionScore,
    recurrence: recurrenceScore,
    momentum: momentumScore,
    trajectory,
  };

  // Overall: trajectory dominates because it is the predictive part. Demand,
  // momentum and reach refine it.
  const overall01 =
    0.5 * trajectory +
    0.25 * dem.dpi +
    0.15 * momentumScore +
    0.1 * subScores.reach;
  const overallScore10 = Math.round(overall01 * 100) / 10;
  const level: ForecastResult['level'] =
    overallScore10 >= 8
      ? 'fire'
      : overallScore10 >= 6
        ? 'high'
        : overallScore10 >= 4
          ? 'medium'
          : 'low';

  return {
    timeFraction: f,
    daysUntil,
    expectedFractionNow: gNow,
    paceProjection,
    demandIndex: dem.dpi,
    demandMultiplier,
    projectedFinalDemand,
    projectedAttendance,
    capacity,
    pctCapacity,
    selloutProbability,
    paceStatus,
    paceRatio,
    confidence,
    confidenceScore,
    expectedCurve,
    historyCount: history.length,
    subScores,
    overallScore10,
    level,
  };
}
