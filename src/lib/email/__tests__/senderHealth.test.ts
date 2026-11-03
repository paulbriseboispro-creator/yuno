import { describe, expect, it } from 'vitest';
import { buildHealthView, campaignModeLabel, type HealthReport } from '../senderHealth';
import { HEALTH_WORD_KEYS, healthWord } from '../senderHealthWords';
import { spreadMinutes, type SenderSendMode } from '../sendRules';

const base: HealthReport = {
  status: 'good',
  reasons: [],
  metrics: { sent: 1000, bounced: 5, complained: 0, opened: 250, gmail_sent: 600, gmail_opened: 140, other_sent: 400, other_opened: 110 },
  held: {},
  base: { total: 1000, engaged: 300, contacted: 500, never: 200, gmail: 600, gmail_engaged: 180 },
  campaigns: [],
  rules: {
    force_spread: true, burst_allowed: false, spread_min_audience: 300, spread_per_hour: 600, spread_max_per_hour: 1000,
    waves_on: true, wave_first: 100, wave_max: 1600, wave_wait_minutes: 180, cold_small_max: 50,
    cold_daily_cap: 1000, cold_gmail_daily_cap: 200, gmail_recovery: false, gmail_recovery_since: null, gmail_engaged_days: 120,
    cold_frozen_until: null, frozen_reason: null, probation_days: 21,
  },
  thresholds: { bounce_pct: 3, complaint_permille: 1, open_pct: 4, gmail_relative: 0.5, watch_bounce_pct: 2, watch_open_pct: 10, watch_gmail_relative: 0.75 },
  generated_at: '2026-11-03T20:00:00Z',
};
const n = (v: number) => String(v);
const d = () => '24 nov.';

describe('buildHealthView', () => {
  it('dit « arrive bien » et ne montre pas de reprise quand tout va', () => {
    const v = buildHealthView(base, 'fr', n, d);
    expect(v.tone).toBe('ok');
    expect(v.title).toBe('Vos e-mails arrivent bien');
    expect(v.platform).toBeNull();
    expect(v.rules.map((r) => r.key)).toEqual(['recovery', 'spread', 'waves']);
    expect(v.rules.find((r) => r.key === 'spread')?.active).toBe(true);
  });

  it('explique un Gmail en spam avec les vrais taux et la reprise de la plateforme', () => {
    const v = buildHealthView({
      ...base, status: 'limited', reasons: ['gmail_spam'],
      metrics: { ...base.metrics, gmail_opened: 4, gmail_sent: 221, other_opened: 22, other_sent: 80 },
      rules: { ...base.rules, gmail_recovery: true, gmail_recovery_since: '2026-11-03T00:00:00Z' },
    }, 'fr', n, d);
    expect(v.tone).toBe('bad');
    expect(v.reasons[0]).toContain('1,8 %');
    expect(v.reasons[0]).toContain('27,5 %');
    expect(v.platform?.text).toContain('pas une sanction');
    expect(v.base.segments[2].what).toContain('Gmail');
  });

  it('nomme la pause des nouvelles adresses et sa date de fin', () => {
    const v = buildHealthView({
      ...base, status: 'paused', reasons: ['frozen'],
      rules: { ...base.rules, cold_frozen_until: '2026-11-24T00:00:00Z', frozen_reason: 'wave:bounces' },
    }, 'fr', n, d);
    expect(v.title).toContain('24 nov.');
    expect(v.reasons[0]).toContain('trop d’adresses invalides');
    expect(v.rules.find((r) => r.key === 'frozen')?.lift).toContain('24 nov.');
  });

  it('ne juge pas sous 50 envois', () => {
    const v = buildHealthView({ ...base, status: 'new', metrics: { ...base.metrics, sent: 10, gmail_sent: 5, other_sent: 5 } }, 'en', n, d);
    expect(v.tone).toBe('neutral');
    expect(v.tiles.find((t) => t.key === 'bounce')?.value).toBe('—');
  });

  it('range les motifs inconnus sous « autres règles »', () => {
    const v = buildHealthView({ ...base, held: { gmail_cold: 40, holdout: 3, plan_holder_after_queue: 2 } }, 'fr', n, d);
    expect(v.held).toEqual([
      { key: 'gmail_cold', n: 40, label: 'Gmail sans ouverture récente (reprise)' },
      { key: 'other', n: 5, label: 'Autres règles Yuno' },
    ]);
  });
});

describe('droits d’envoi', () => {
  it('montre le niveau, ses limites et ce qu’il manque pour monter', () => {
    const lv = (level: number, daily_cap: number, per_hour: number, cold_daily: number, cold_gmail_daily: number) => ({ level, daily_cap, per_hour, cold_daily, cold_gmail_daily, burst: false });
    const v = buildHealthView({
      ...base,
      rights: {
        current: lv(2, 800, 250, 500, 100), next: lv(3, 1500, 400, 1000, 200),
        ladder: [lv(1, 300, 150, 200, 0), lv(2, 800, 250, 500, 100), lv(3, 1500, 400, 1000, 200), lv(4, 5000, 800, 2000, 500), { ...lv(5, 25000, 2000, 5000, 1000), burst: true }],
        check: { level: 2, since: '2026-11-03T00:00:00Z', max_auto: 3, next_check_at: '2026-11-10T00:00:00Z', sent: 206, bounced: 2, complained: 0, gmail_relative: 0.05,
          checks: { days: false, volume: true, bounces: true, complaints: true, gmail: false, no_halt: true, not_frozen: true, cap: true } },
        history: [{ at: '2026-11-03T00:00:00Z', from: null, to: 2, reason: 'start' }],
      },
    }, 'fr', n, d);
    expect(v.rights?.name).toBe('Confiance');
    expect(v.rights?.limits[0]).toBe('800 e-mails par jour');
    expect(v.rights?.ladder.find((l) => l.on)?.level).toBe(2);
    expect(v.rights?.next?.checks.find((c) => c.key === 'gmail')).toMatchObject({ ok: false, label: 'Gmail ouvre au moins aux 3/4 des autres messageries (5 %)' });
    expect(v.rights?.history[0].label).toBe('Point de départ');
    expect(v.rights?.progress).toMatchObject({ passed: 6, total: 8, daysNeeded: 7 });
    expect(v.rights?.progress?.label).toMatch(/^6 conditions sur 8 remplies · \d jours sur 7 à ce niveau$/);
  });
});

describe('campaignModeLabel', () => {
  const c = { id: 'x', name: 'x', at: null, status: 'sent', kind: 'marketing' as const, wave_state: null, wave_released: null, wave_total: null,
    spread_forced: null, per_hour: null, sent: 0, bounced: 0, complained: 0, held: 0, gmail_sent: 0, opened: 0, gmail_opened: 0 };
  it('dit comment la campagne est partie', () => {
    expect(campaignModeLabel(c, 'fr')).toBe('d’un coup');
    expect(campaignModeLabel({ ...c, per_hour: 600 }, 'fr')).toBe('réparti · 600/h');
    expect(campaignModeLabel({ ...c, wave_state: 'testing', wave_released: 2, wave_total: 4 }, 'fr')).toBe('vagues 2/4');
    expect(campaignModeLabel({ ...c, wave_state: 'halted' }, 'fr')).toBe('vagues arrêtées');
  });
});

describe('spreadMinutes (miroir de _email_enforce_spread)', () => {
  const mode: SenderSendMode = { force_spread: true, burst_allowed: false, min_audience: 300, per_hour: 600, max_per_hour: 1000, cold_frozen_until: null };
  it('impose 600 / h quand rien n’est choisi', () => expect(spreadMinutes(mode, 3000, null)).toBe(300));
  it('ne va jamais plus vite que 1 000 / h', () => expect(spreadMinutes(mode, 3000, 60)).toBe(180));
  it('garde une durée plus lente choisie', () => expect(spreadMinutes(mode, 3000, 240)).toBe(240));
  it('ne touche rien sous le seuil ni pour un compte autorisé', () => {
    expect(spreadMinutes(mode, 200, null)).toBeNull();
    expect(spreadMinutes({ ...mode, force_spread: false, burst_allowed: true }, 3000, null)).toBeNull();
  });
});

describe('senderHealthWords', () => {
  it('a les trois langues pour chaque clé', () => {
    for (const k of HEALTH_WORD_KEYS) {
      for (const l of ['en', 'fr', 'es'] as const) expect(healthWord(l, k).length).toBeGreaterThan(0);
    }
  });
});
