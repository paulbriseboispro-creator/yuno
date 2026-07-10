/**
 * Paris-time night window helpers for the live ops dashboard.
 *
 * Club nights are anchored to Europe/Paris wall-clock time (18:00 → 06:00),
 * but every timestamp we query is UTC. The previous implementation abused
 * `toLocaleString` → `new Date()` round-trips (locale-dependent, DST-fragile)
 * and bucketed hours in the *browser's* timezone, so an owner traveling
 * abroad saw a shifted entry histogram. Everything here goes through
 * Intl.DateTimeFormat with an explicit timeZone instead.
 */

const PARIS_TZ = 'Europe/Paris';

// Formatter construction is expensive — build once, reuse for every call
// (bucketHourParis runs over hundreds of scans per refetch).
const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS_TZ,
  hour: '2-digit',
  hour12: false,
});

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parisWallClock(at: Date): WallClock {
  const parts = partsFormatter.formatToParts(at);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24, // some engines render midnight as "24"
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset (minutes) between Paris wall-clock and UTC at a given instant. */
function parisOffsetMinutes(at: Date): number {
  const wc = parisWallClock(at);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * Convert a Paris wall-clock time to the UTC instant it names.
 * Two-pass offset lookup so DST transitions resolve to the correct side.
 * `day` may overflow the month (Date.UTC normalizes it), which is how
 * callers do "+1 day" arithmetic.
 */
function parisWallTimeToUtc(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = parisOffsetMinutes(new Date(naive));
  const candidate = new Date(naive - offset1 * 60_000);
  const offset2 = parisOffsetMinutes(candidate);
  return offset2 === offset1 ? candidate : new Date(naive - offset2 * 60_000);
}

/**
 * "Tonight" as a UTC interval, anchored to Paris wall-clock:
 * - 18:00 or later → 18:00 today → 06:00 tomorrow
 * - before 06:00   → 18:00 yesterday → 06:00 today
 * - daytime (06-18)→ 00:00 today → 24:00 today (calendar day)
 */
export function getNightWindow(now: Date = new Date()): { start: string; end: string } {
  const wc = parisWallClock(now);
  let start: Date;
  let end: Date;
  if (wc.hour >= 18) {
    start = parisWallTimeToUtc(wc.year, wc.month, wc.day, 18);
    end = parisWallTimeToUtc(wc.year, wc.month, wc.day + 1, 6);
  } else if (wc.hour < 6) {
    start = parisWallTimeToUtc(wc.year, wc.month, wc.day - 1, 18);
    end = parisWallTimeToUtc(wc.year, wc.month, wc.day, 6);
  } else {
    start = parisWallTimeToUtc(wc.year, wc.month, wc.day, 0);
    end = parisWallTimeToUtc(wc.year, wc.month, wc.day + 1, 0);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Hour-of-day (0-23) of a timestamp in Paris time — for entry histograms. */
export function bucketHourParis(iso: string): number {
  return Number(hourFormatter.format(new Date(iso))) % 24;
}

/**
 * Stable key identifying the current Paris night (date of the evening's
 * start). Used to scope per-night client state like dismissed alerts.
 */
export function nightKeyParis(now: Date = new Date()): string {
  const wc = parisWallClock(now);
  // Before 06:00 the night "belongs" to yesterday's date.
  const d = new Date(Date.UTC(wc.year, wc.month - 1, wc.hour < 6 ? wc.day - 1 : wc.day));
  return d.toISOString().slice(0, 10);
}
