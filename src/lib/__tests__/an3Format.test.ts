import { describe, expect, it } from 'vitest';
import { compactMoney, compactNumber, deltaShape, deltaText, deltaTone, minutesSinceNoonLabel, pct } from '../analytics/an3Format';

describe('chiffres abrégés', () => {
  it('abrège au-dessus de mille, sans décimale inutile', () => {
    expect(compactNumber(950, 'fr-FR')).toBe('950');
    expect(compactNumber(12883, 'fr-FR')).toBe('12,9 k');
    expect(compactNumber(50633, 'fr-FR')).toBe('50,6 k');
    expect(compactNumber(391185, 'fr-FR')).toBe('391 k');
    expect(compactNumber(8.4, 'fr-FR')).toBe('8,4');
    expect(compactNumber(27, 'en-GB')).toBe('27');
  });
  it('écrit les euros selon la langue', () => {
    expect(compactMoney(50633, 'fr-FR')).toBe('50,6 k €');
    expect(compactMoney(50633, 'en-GB')).toBe('€50.6 k');
    expect(compactMoney(null, 'fr-FR')).toBe('—');
    expect(compactMoney(-0.001, 'fr-FR')).toBe('0 €');
  });
  it('pourcentage entier, une décimale seulement sous 1 %', () => {
    expect(pct(27.4, 'fr-FR')).toBe('27 %');
    expect(pct(0.4, 'fr-FR')).toBe('0,4 %');
    expect(pct(null, 'fr-FR')).toBe('—');
  });
});

describe('deltas', () => {
  it('en % sur une base normale, en absolu sur une petite base', () => {
    expect(deltaShape(250, 212)).toEqual({ kind: 'pct', value: (38 / 212) * 100, up: true });
    expect(deltaShape(12, 9)).toEqual({ kind: 'abs', value: 3, up: true });
    expect(deltaShape(5, 0)).toEqual({ kind: 'abs', value: 5, up: true });
    expect(deltaShape(4000, 10)).toEqual({ kind: 'abs', value: 3990, up: true }); // base < 20
    expect(deltaShape(400, 100)).toEqual({ kind: 'pct', value: 300, up: true });
    expect(deltaShape(500, 100)).toEqual({ kind: 'abs', value: 400, up: true }); // > 300 %
    expect(deltaShape(100, 100)).toEqual({ kind: 'same' });
    expect(deltaShape(null, 3)).toEqual({ kind: 'none' });
  });
  it('deux pourcentages se comparent en points', () => {
    expect(deltaText(deltaShape(48, 91, { pointDiff: true }), 'pct', 'fr-FR')).toBe('▼ −43 pt');
  });
  it('se lit avec flèche, signe et unité', () => {
    expect(deltaText(deltaShape(250, 212), 'n', 'fr-FR')).toBe('▲ +18 %');
    expect(deltaText(deltaShape(12, 9), 'n', 'fr-FR', 'billets')).toBe('▲ +3 billets');
    expect(deltaText(deltaShape(1200, 1700), 'money', 'fr-FR')).toBe('▼ −29 %');
    expect(deltaText(deltaShape(15, 10), 'money', 'fr-FR')).toBe('▲ +5 €');
  });
  it('la polarité vient de la métrique', () => {
    expect(deltaTone(deltaShape(30, 40), 'down')).toBe('good'); // no-show qui baisse
    expect(deltaTone(deltaShape(30, 40), 'up')).toBe('bad');
    expect(deltaTone(deltaShape(30, 40), 'neutral')).toBeNull();
    expect(deltaTone({ kind: 'same' }, 'up')).toBeNull();
  });
});

describe('heures de la nuit', () => {
  it('convertit des minutes depuis midi en heure locale', () => {
    expect(minutesSinceNoonLabel(0, 'fr-FR')).toBe('12 h 00');
    expect(minutesSinceNoonLabel(795, 'fr-FR')).toBe('01 h 15');
    expect(minutesSinceNoonLabel(795, 'en-GB')).toBe('1:15 am');
  });
});
