import { describe, expect, it } from 'vitest';
import { clockFromNoon, glKindOf, hourLabel, isGlFilter, nightVerdict, periodVerdict, ptsDelta, rate } from '../guestlist';

describe('glKindOf (miroir de _crm_ticket_gl_kind)', () => {
  it('une invitation Shotgun, quel que soit son prix', () => {
    expect(glKindOf('valid', 0, { deal_channel: 'invitation' })).toBe('inv');
    expect(glKindOf('valid', 12, { deal_channel: 'invitation' })).toBe('inv');
  });
  it('un billet valide à 0 € hors invitation', () => {
    expect(glKindOf('valid', 0, { deal_channel: 'online' })).toBe('free');
    expect(glKindOf('valid', 0, null)).toBe('free');
  });
  it('jamais un billet payant, au prix inconnu, ou qui n’est plus valide', () => {
    expect(glKindOf('valid', 18, { deal_channel: 'online' })).toBeNull();
    expect(glKindOf('valid', null, null)).toBeNull();
    expect(glKindOf('cancelled', 0, { deal_channel: 'invitation' })).toBeNull();
    expect(glKindOf('refunded', 0, null)).toBeNull();
    expect(glKindOf('other', 0, null)).toBeNull();
    expect(glKindOf('transferred', 0, { deal_channel: 'invitation' })).toBeNull();
  });
  it('un brut qui n’est pas un objet ne fait pas une invitation', () => {
    expect(glKindOf('valid', 5, ['invitation'])).toBeNull();
    expect(glKindOf('valid', 5, 'invitation')).toBeNull();
  });
});

describe('clockFromNoon', () => {
  it('compte depuis midi, passe minuit', () => {
    expect(clockFromNoon(0)).toBe('12:00');
    expect(clockFromNoon(690)).toBe('23:30');
    expect(clockFromNoon(712)).toBe('23:52');
    expect(clockFromNoon(720)).toBe('00:00');
    expect(clockFromNoon(795)).toBe('01:15');
  });
  it('rien quand la médiane manque', () => {
    expect(clockFromNoon(null)).toBeNull();
    expect(clockFromNoon(undefined)).toBeNull();
  });
});

describe('hourLabel', () => {
  it('français et espagnol en « h », anglais en am / pm', () => {
    expect(hourLabel(23, 'fr')).toBe('23 h');
    expect(hourLabel(0, 'es')).toBe('0 h');
    expect(hourLabel(23, 'en')).toBe('11 pm');
    expect(hourLabel(0, 'en')).toBe('12 am');
    expect(hourLabel(12, 'en')).toBe('12 pm');
  });
});

describe('rate et ptsDelta', () => {
  it('pas de pourcentage sous 10', () => {
    expect(rate(3, 9)).toBeNull();
    expect(rate(3, 10)).toBe(30);
    expect(rate(1, 3, 1)).toBe(33.3);
    expect(rate(0, 0, 0)).toBeNull();
  });
  it('écart en points', () => {
    expect(ptsDelta(57.9, 72.1)).toBe(-14.2);
    expect(ptsDelta(null, 10)).toBeNull();
  });
});

describe('nightVerdict', () => {
  const base = { scanKnown: true, entries: 76, came: 44, showup: 57.9, freeShare: 13.5, prev: null };
  it('aucune entrée', () => {
    expect(nightVerdict({ ...base, phase: 'upcoming', entries: 0 }).key).toBe('yc.gl.v.noneUp');
    expect(nightVerdict({ ...base, phase: 'past', entries: 0 }).key).toBe('yc.gl.v.nonePast');
  });
  it('avant la soirée : comparé à la fois d’avant au même moment', () => {
    const prev = { title: 'Minimal Room #9', sameDay: 25, entries: 50, showup: 60 };
    expect(nightVerdict({ ...base, phase: 'upcoming', entries: 50, prev })).toEqual({ key: 'yc.gl.v.upMore', vars: { n: 50, diff: 25, title: 'Minimal Room #9' } });
    expect(nightVerdict({ ...base, phase: 'upcoming', entries: 20, prev }).key).toBe('yc.gl.v.upLess');
    expect(nightVerdict({ ...base, phase: 'upcoming', entries: 25, prev }).key).toBe('yc.gl.v.upSame');
    expect(nightVerdict({ ...base, phase: 'upcoming', entries: 25 }).key).toBe('yc.gl.v.up');
  });
  it('pendant : déjà entrés', () => {
    expect(nightVerdict({ ...base, phase: 'live', came: 12 })).toEqual({ key: 'yc.gl.v.live', vars: { came: 12, n: 76 } });
  });
  it('après : le taux de venue seulement si la porte a scanné', () => {
    expect(nightVerdict({ ...base, phase: 'past', scanKnown: false, showup: null }).key).toBe('yc.gl.v.pastNoScan');
    const v = nightVerdict({ ...base, phase: 'past', prev: { title: 'Bass Culture #8', sameDay: 61, entries: 61, showup: 72.1 } });
    expect(v.key).toBe('yc.gl.v.past');
    expect(v.cmp).toEqual({ key: 'yc.gl.v.cmpDown', vars: { n: 14, title: 'Bass Culture #8' } });
    expect(nightVerdict({ ...base, phase: 'past', prev: { title: 'X', sameDay: 0, entries: 0, showup: 57 } }).cmp?.key).toBe('yc.gl.v.cmpSame');
    expect(nightVerdict({ ...base, phase: 'past', prev: { title: 'X', sameDay: 0, entries: 0, showup: null } }).cmp).toBeUndefined();
  });
});

describe('periodVerdict', () => {
  it('va aussi loin que les données le permettent', () => {
    expect(periodVerdict({ entries: 0, nights: 0, showup: null, prevShowup: null, freeShare: null, converted: 0, eligible: 0 }).key).toBe('yc.gl.a.v.none');
    expect(periodVerdict({ entries: 300, nights: 4, showup: 61.2, prevShowup: null, freeShare: 14, converted: 18, eligible: 120 }))
      .toEqual({ key: 'yc.gl.a.v.full', vars: { n: 300, nights: 4, pct: 61.2, conv: 15, converted: 18 } });
    expect(periodVerdict({ entries: 300, nights: 4, showup: 61.2, prevShowup: null, freeShare: 14, converted: 1, eligible: 8 }).key).toBe('yc.gl.a.v.showup');
    expect(periodVerdict({ entries: 30, nights: 1, showup: null, prevShowup: null, freeShare: null, converted: 0, eligible: 0 }).key).toBe('yc.gl.a.v.entries');
  });
});

describe('isGlFilter', () => {
  it('ne laisse passer que les valeurs connues du serveur', () => {
    expect(isGlFilter('loyal')).toBe(true);
    expect(isGlFilter('vip')).toBe(false);
    expect(isGlFilter(null)).toBe(false);
  });
});
