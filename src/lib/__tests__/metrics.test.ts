import { describe, expect, it } from 'vitest';
import {
  attendancePct, basket, fillPct, METRIC_IDS, metricHintKey, metricLabelKey, pctDelta,
  readableDelta, sharePct, spendPerHead,
} from '../metrics';
import fr from '../../i18n/locales/fr';
import en from '../../i18n/locales/en';
import es from '../../i18n/locales/es';

describe('metrics — ratios', () => {
  it('fill : sans capacité, rien', () => {
    expect(fillPct(92, 650)).toBeCloseTo(14.15, 1);
    expect(fillPct(10, 0)).toBeNull();
    expect(fillPct(10, null)).toBeNull();
  });
  it('dépense par tête : jamais sur zéro entrée', () => {
    expect(spendPerHead(2000, 100)).toBe(20);
    expect(spendPerHead(2000, 0)).toBeNull();
  });
  it('présence bornée à 100', () => {
    expect(attendancePct(80, 100)).toBe(80);
    expect(attendancePct(120, 100)).toBe(100);
    expect(attendancePct(3, 0)).toBeNull();
  });
  it('panier par pilier', () => {
    expect(basket(300, 10)).toBe(30);
    expect(basket(300, 0)).toBeNull();
  });
  it('part muette sous le seuil', () => {
    expect(sharePct(1, 1)).toBeNull();
    expect(sharePct(5, 20)).toBe(25);
  });
});

describe('metrics — comparaisons lisibles', () => {
  it('variation en %', () => {
    expect(pctDelta(120, 100)).toBe(20);
    expect(pctDelta(5, 0)).toBeNull();
  });
  it('base nulle → écart absolu', () => {
    expect(readableDelta(84, 0)).toEqual({ kind: 'abs', value: 84 });
  });
  it('variation énorme → écart absolu', () => {
    expect(readableDelta(1077, 37)).toEqual({ kind: 'abs', value: 1040 });
  });
  it('pas de référence → rien', () => {
    expect(readableDelta(10, null)).toEqual({ kind: 'none' });
    expect(readableDelta(0, 0)).toEqual({ kind: 'none' });
  });
  it('variation normale → %', () => {
    expect(readableDelta(90, 100)).toEqual({ kind: 'pct', value: -10 });
  });
});

describe('metrics — dictionnaire traduit', () => {
  for (const [lang, dict] of [['fr', fr], ['en', en], ['es', es]] as const) {
    it(`${lang} : un libellé et une définition par chiffre`, () => {
      for (const id of METRIC_IDS) {
        expect((dict as Record<string, string>)[metricLabelKey(id)], `${lang} ${metricLabelKey(id)}`).toBeTruthy();
        expect((dict as Record<string, string>)[metricHintKey(id)], `${lang} ${metricHintKey(id)}`).toBeTruthy();
      }
    });
  }
});
