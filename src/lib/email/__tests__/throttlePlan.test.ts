import { describe, expect, it } from 'vitest';
import {
  ACTIVE_DAY_END_HOUR, ACTIVE_DAY_START_HOUR, MIN_RATE,
  computeThrottlePlan, recommendPlan, suggestRate,
} from '../throttlePlan';

/** Mercredi 9 septembre 2026, heure locale. */
const at = (h: number, m = 0, day = 9) => new Date(2026, 8, day, h, m, 0, 0);

describe('suggestRate', () => {
  it('sur une heure : 4 vagues', () => {
    expect(suggestRate({ total: 1000, start: at(17, 30), mode: 'hour', days: 2, quietHours: false })).toBe(250);
    expect(suggestRate({ total: 120, start: at(17, 30), mode: 'hour', days: 2, quietHours: false })).toBe(30);
  });

  it('sur la journée : 24 h glissantes depuis le départ, pas la journée calendaire', () => {
    // sans nuit : 24 vagues
    expect(suggestRate({ total: 2400, start: at(17, 30), mode: 'day', days: 2, quietHours: false })).toBe(100);
    // nuit coupée : 17:30→22:30 (6 vagues) + 9:00→17:00 le lendemain (9 vagues, 17:00 < 17:30) = 15
    expect(suggestRate({ total: 1500, start: at(17, 30), mode: 'day', days: 2, quietHours: true })).toBe(100);
  });

  it('sur plusieurs jours : N × 24 h depuis le départ', () => {
    // sans nuit : 48 vagues
    expect(suggestRate({ total: 4800, start: at(17, 30), mode: 'days', days: 2, quietHours: false })).toBe(100);
    // nuit coupée : 6 (soir 1) + 14 (jour 2, 9→22 h) + 9 (jour 3, 9→17 h) = 29 vagues
    expect(suggestRate({ total: 2900, start: at(17, 30), mode: 'days', days: 2, quietHours: true })).toBe(100);
  });

  it('ne descend jamais sous le plancher de la contrainte', () => {
    expect(suggestRate({ total: 12, start: at(10), mode: 'days', days: 7, quietHours: true })).toBe(MIN_RATE);
  });
});

describe('computeThrottlePlan', () => {
  it('sur une heure : 4 vagues espacées de 15 min, rien de plus', () => {
    const r = computeThrottlePlan({ total: 1000, start: at(17, 30), mode: 'hour', days: 2, quietHours: false });
    expect(r.windowMinutes).toBe(15);
    expect(r.waves.map((w) => w.count)).toEqual([250, 250, 250, 250]);
    expect(r.waves.map((w) => w.at.getMinutes())).toEqual([30, 45, 0, 15]);
    expect(r.endAt?.getHours()).toBe(18);
    expect(r.warnings).not.toContain('longer');
  });

  it('sur la journée : la dernière vague part avant départ + 24 h, nuit sautée', () => {
    const r = computeThrottlePlan({ total: 1500, start: at(17, 30), mode: 'day', days: 2, quietHours: true });
    expect(r.waves).toHaveLength(15);
    expect(r.endAt!.getTime()).toBeLessThan(at(17, 30).getTime() + 24 * 3_600_000);
    expect(r.spanDays).toBe(2);
    expect(r.days[0].count).toBe(600);
    expect(r.days[1].waves[0].at.getHours()).toBe(ACTIVE_DAY_START_HOUR);
    expect(r.warnings).not.toContain('longer');
  });

  it('sur la journée sans nuit : 24 vagues, une par heure, de nuit comprise', () => {
    const r = computeThrottlePlan({ total: 2400, start: at(17, 30), mode: 'day', days: 2, quietHours: false });
    expect(r.waves).toHaveLength(24);
    expect(r.warnings).toContain('night');
    expect(r.warnings).not.toContain('longer');
  });

  it('nuit cochée : aucune vague entre 23 h et 9 h, reprise à 9 h', () => {
    const r = computeThrottlePlan({ total: 2000, start: at(21, 0), mode: 'days', days: 2, quietHours: true, rate: 100 });
    for (const w of r.waves) {
      const h = w.at.getHours();
      expect(h >= ACTIVE_DAY_START_HOUR && h < ACTIVE_DAY_END_HOUR).toBe(true);
    }
    expect(r.days[1].waves[0].at.getHours()).toBe(ACTIVE_DAY_START_HOUR);
    expect(r.warnings).not.toContain('night');
  });

  it('nuit décochée sur plusieurs jours : alerte night, et des vagues la nuit', () => {
    const r = computeThrottlePlan({ total: 2000, start: at(21, 0), mode: 'days', days: 2, quietHours: false, rate: 100 });
    expect(r.warnings).toContain('night');
    expect(r.waves.some((w) => w.at.getHours() >= ACTIVE_DAY_END_HOUR || w.at.getHours() < ACTIVE_DAY_START_HOUR)).toBe(true);
  });

  it('plafond du jour : la journée est coupée, le reste part le lendemain', () => {
    const r = computeThrottlePlan({
      total: 1000, start: at(10, 0), mode: 'day', days: 2, quietHours: true, dayCap: 300, dayUsed: 50,
    });
    expect(r.days[0].count).toBe(250);
    expect(r.days[1].count).toBe(300);
    expect(r.warnings).toContain('dayCap');
    expect(r.warnings).toContain('longer');
    expect(r.waves.reduce((s, w) => s + w.count, 0)).toBe(1000);
  });

  it('plafond personnalisé trop bas : le plan déborde des 24 h et le dit', () => {
    const r = computeThrottlePlan({ total: 1500, start: at(17, 30), mode: 'day', days: 2, quietHours: true, rate: 50 });
    expect(r.rate).toBe(50);
    expect(r.suggestedRate).toBe(100);
    expect(r.waves).toHaveLength(30);
    expect(r.warnings).toContain('longer');
  });

  it('petite audience : simple information, jamais bloquant', () => {
    const r = computeThrottlePlan({ total: 120, start: at(17, 30), mode: 'hour', days: 2, quietHours: false });
    expect(r.warnings).toContain('small');
    expect(r.waves.reduce((s, w) => s + w.count, 0)).toBe(120);
  });

  it('audience vide : aucune vague', () => {
    const r = computeThrottlePlan({ total: 0, start: at(17, 30), mode: 'day', days: 2, quietHours: false });
    expect(r.waves).toHaveLength(0);
    expect(r.endAt).toBeNull();
  });
});

describe('recommendPlan', () => {
  it('bandes : une heure, la journée, plusieurs jours', () => {
    expect(recommendPlan(120)).toEqual({ mode: 'hour', days: 2 });
    expect(recommendPlan(1500)).toEqual({ mode: 'day', days: 2 });
    expect(recommendPlan(6000)).toEqual({ mode: 'days', days: 3 });
    expect(recommendPlan(50000).days).toBe(7);
  });

  it('le plafond de chauffe force plusieurs jours', () => {
    expect(recommendPlan(1500, 600)).toEqual({ mode: 'days', days: 3 });
  });
});
