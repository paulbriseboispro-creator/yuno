import { describe, expect, it } from 'vitest';
import type { HealthReport } from '../senderHealth';
import { buildHealthView } from '../senderHealth';
import { canDo, chartPoints, signals, usage, type HealthVisual } from '../senderHealthVisual';
import { HEALTH_WORD_KEYS, healthWord } from '../senderHealthWords';

const report: HealthReport = {
  status: 'good',
  reasons: [],
  metrics: { sent: 1000, bounced: 5, complained: 0, opened: 250, gmail_sent: 600, gmail_opened: 140, other_sent: 400, other_opened: 110 },
  held: { unengaged: 120, gmail_cold: 300, mystery: 4 },
  base: { total: 1000, engaged: 300, contacted: 500, never: 200, gmail: 600, gmail_engaged: 180 },
  campaigns: [],
  rules: {
    force_spread: true, burst_allowed: false, spread_min_audience: 100, spread_per_hour: 150, spread_max_per_hour: 150,
    waves_on: true, wave_first: 100, wave_max: 1600, wave_wait_minutes: 180, cold_small_max: 50,
    cold_daily_cap: 200, cold_gmail_daily_cap: 0, gmail_recovery: true, gmail_recovery_since: '2026-11-03T00:00:00Z', gmail_engaged_days: 120,
    cold_frozen_until: null, frozen_reason: null, probation_days: 21,
  },
  thresholds: { bounce_pct: 2, complaint_permille: 0.5, open_pct: 4, gmail_relative: 0.5, watch_bounce_pct: 2, watch_open_pct: 10, watch_gmail_relative: 0.75 },
  generated_at: '2026-11-04T08:00:00Z',
};

const visual: HealthVisual = {
  today: { sent: 120, daily_cap: 300, cold: 200, cold_cap: 200, cold_gmail: 0, cold_gmail_cap: 0, cold_month: 900, cold_month_cap: 3000, per_hour: 150, level: 1, shared_max_level: 3 },
  series: [
    { d: '2026-11-02', sent: 0, bounced: 0, complained: 0, gmail_sent: 0, gmail_opened: 0, other_sent: 0, other_opened: 0, held: 0 },
    { d: '2026-11-03', sent: 300, bounced: 2, complained: 0, gmail_sent: 200, gmail_opened: 4, other_sent: 100, other_opened: 30, held: 50 },
    { d: '2026-11-04', sent: 30, bounced: 0, complained: 0, gmail_sent: 10, gmail_opened: 5, other_sent: 20, other_opened: 6, held: 0 },
  ],
  smart: { on: true, unengaged: 120, junk: 3, refocus: 0, min_audience: 300, min_received: 3, days: 180 },
  incidents: [], recidive_count: 2, recidive_window_days: 60,
  thresholds: { bounce_pct: 2, complaint_permille: 0.5, gmail_relative: 0.5, guard_open_pct: 5 },
  generated_at: '2026-11-04T08:00:00Z',
};
const n = (v: number) => String(v);

describe('usage', () => {
  it('colore selon la part utilisée du plafond', () => {
    expect(usage(120, 300)).toEqual({ ratio: 0.4, left: 180, tone: 'ok' });
    expect(usage(250, 300).tone).toBe('warn');
    expect(usage(300, 300)).toMatchObject({ ratio: 1, left: 0, tone: 'bad' });
    expect(usage(0, 0).tone).toBe('none');
  });
});

describe('chartPoints', () => {
  it('ne trace un taux que dès 20 envois dans la journée', () => {
    const p = chartPoints(visual.series);
    expect(p[1]).toMatchObject({ sent: 300, gmail: 2, other: 30 });
    expect(p[2].gmail).toBeNull();
    expect(p[2].other).toBe(30);
    expect(p[0]).toMatchObject({ gmail: null, other: null });
  });
});

describe('signals', () => {
  it('rend les trois signaux avec les seuils du serveur', () => {
    const [b, c, g] = signals(report);
    expect(b).toMatchObject({ key: 'bounce', value: 0.5, tone: 'ok', limit: 2 });
    expect(b.zones[1]).toBe(2);
    expect(c).toMatchObject({ key: 'complaints', value: 0, tone: 'ok', limit: 0.5 });
    expect(g.key).toBe('gmail');
    expect(g.higherIsBetter).toBe(true);
    // 140/600 contre 110/400 : Gmail ouvre à 85 % des autres
    expect(Math.round(g.value!)).toBe(85);
    expect(g.tone).toBe('ok');
  });
  it('passe au rouge quand Gmail ouvre moins de la moitié des autres', () => {
    const g = signals({ ...report, metrics: { ...report.metrics, gmail_opened: 10 } })[2];
    expect(g.tone).toBe('bad');
  });
  it('se tait sous l’échantillon minimal', () => {
    const s = signals({ ...report, metrics: { ...report.metrics, sent: 10, gmail_sent: 5, other_sent: 5 } });
    expect(s.map((x) => x.tone)).toEqual(['none', 'none', 'none']);
  });
});

describe('canDo', () => {
  it('dit ce que le compte peut faire, Gmail fermé pendant la reprise', () => {
    const c = canDo(report, visual, n);
    expect(c.map((x) => x.key)).toEqual(['engaged', 'daily', 'hour', 'cold', 'month', 'gmail', 'burst', 'smart', 'domain']);
    expect(c.find((x) => x.key === 'gmail')?.state).toBe('no');
    expect(c.find((x) => x.key === 'cold')).toMatchObject({ state: 'limited', vars: { n: '200' } });
    expect(c.find((x) => x.key === 'burst')?.state).toBe('no');
  });
  it('ferme les nouvelles adresses quand le compte est à l’écart', () => {
    const c = canDo({ ...report, rules: { ...report.rules, cold_frozen_until: '2036-01-01T00:00:00Z', frozen_reason: 'recidive' } }, visual, n);
    expect(c.find((x) => x.key === 'cold')?.state).toBe('no');
    expect(c.some((x) => x.key === 'month')).toBe(false);
  });
});

describe('récidive et motifs', () => {
  it('nomme la récidive sans date', () => {
    const v = buildHealthView({ ...report, status: 'paused', reasons: ['frozen'],
      rules: { ...report.rules, cold_frozen_until: '2036-01-01T00:00:00Z', frozen_reason: 'recidive' } }, 'fr', n, () => '1 janv.');
    expect(v.title).toBe('Nouvelles adresses fermées');
    expect(v.sub).not.toContain('janv');
  });
  it('range les motifs de l’envoi intelligent sous leur nom', () => {
    const v = buildHealthView(report, 'fr', n, () => '');
    expect(v.held.map((h) => h.key)).toEqual(['gmail_cold', 'unengaged', 'other']);
    expect(v.held.find((h) => h.key === 'unengaged')?.label).toBe('N’ouvrent plus vos e-mails');
  });
  it('chaque clé de la page a ses trois langues', () => {
    for (const k of HEALTH_WORD_KEYS.filter((x) => x.startsWith('v.'))) {
      for (const l of ['en', 'fr', 'es'] as const) expect(healthWord(l, k)).not.toBe(k);
    }
    expect(healthWord('es', 'v.inc.count', { n: 1, max: 2, d: 60 })).toBe('1 de 2 en 60 días');
  });
});
