import { describe, expect, it } from 'vitest';
import {
  DOOR_MIN_SCANS, DOOR_MIN_SHARE, clockFromNoon, doorMeasured, glKindOf, hourLabel, isGlFilter, isPaidTicket, isSaleTicket,
  nightVerdict, periodVerdict, ptsDelta, rate, saleCountsAsNight, ticketKindOf,
} from '../guestlist';
import nightCases from './fixtures/sale-counts-as-night.json';

describe('saleCountsAsNight (miroir de _crm_sale_counts_as_night, DATA-02)', () => {
  it.each(nightCases.cases as [number | null, boolean | null, boolean | null, boolean][])(
    'prix %s, scanné %s, porte mesurée %s → %s',
    (price, scanned, measured, expected) => {
      expect(saleCountsAsNight(price, scanned, measured)).toBe(expected);
    },
  );
  it('seule une entrée gratuite non scannée sur une porte mesurée ne compte pas', () => {
    expect(saleCountsAsNight(0, false, true)).toBe(false);
    expect(saleCountsAsNight(0, false, false)).toBe(true);
  });
});

describe('doorMeasured (miroir de _crm_door_measured)', () => {
  it('au moins 10 scans ET au moins 10 % des billets valides', () => {
    expect(DOOR_MIN_SCANS).toBe(10);
    expect(DOOR_MIN_SHARE).toBe(0.1);
    expect(doorMeasured(756, 142)).toBe(true); // Osmoz : 18,8 %
    expect(doorMeasured(100, 10)).toBe(true);
    expect(doorMeasured(1000, 100)).toBe(true);
    expect(doorMeasured(110, 11)).toBe(true); // exactement 10 %, sans arrondi flottant
  });
  it('jamais sous 10 scans, même à 100 %', () => {
    expect(doorMeasured(9, 9)).toBe(false);
    expect(doorMeasured(40, 9)).toBe(false);
  });
  it('jamais sous 10 % des billets', () => {
    expect(doorMeasured(1000, 99)).toBe(false);
    expect(doorMeasured(101, 10)).toBe(false);
  });
  it('rien de scanné ou de connu : pas mesurée', () => {
    expect(doorMeasured(0, 0)).toBe(false);
    expect(doorMeasured(null, null)).toBe(false);
    expect(doorMeasured(undefined, 12)).toBe(true);
  });
});

describe('ticketKindOf (payant / entrée gratuite / guest list)', () => {
  it('une vente à plus de 0 € est payante', () => {
    expect(ticketKindOf('valid', 12, 'online')).toBe('paid');
    expect(isPaidTicket('valid', 0.5, null)).toBe(true);
  });
  it('un tarif à 0 € est une entrée gratuite, une invitation est la guest list', () => {
    expect(ticketKindOf('valid', 0, 'online')).toBe('free');
    expect(ticketKindOf('valid', 0, 'invitation')).toBe('inv');
    expect(ticketKindOf('valid', 15, 'invitation')).toBe('inv');
  });
  it('ni duplicata, ni billet qui n’est plus valide, ni prix inconnu', () => {
    expect(ticketKindOf('valid', 20, 'duplicata')).toBeNull();
    expect(ticketKindOf('refunded', 20, null)).toBeNull();
    expect(ticketKindOf('transferred', 20, null)).toBeNull();
    expect(ticketKindOf('valid', null, null)).toBeNull();
  });
  it('une vente (miroir de _crm_ticket_is_sale) = payante ou entrée gratuite', () => {
    expect(isSaleTicket('valid', null)).toBe(true);
    expect(isSaleTicket('valid', 'invitation')).toBe(false);
    expect(isSaleTicket('valid', 'duplicata')).toBe(false);
    expect(isSaleTicket('cancelled', null)).toBe(false);
  });
});

describe('glKindOf (miroir de _crm_ticket_gl_kind)', () => {
  it('une invitation Shotgun, quel que soit son prix', () => {
    expect(glKindOf('valid', 0, 'invitation')).toBe('inv');
    expect(glKindOf('valid', 12, 'invitation')).toBe('inv');
  });
  it('un billet valide à 0 € hors invitation', () => {
    expect(glKindOf('valid', 0, 'online')).toBe('free');
    expect(glKindOf('valid', 0, null)).toBe('free');
  });
  it('jamais un billet payant, au prix inconnu, ou qui n’est plus valide', () => {
    expect(glKindOf('valid', 18, 'online')).toBeNull();
    expect(glKindOf('valid', null, null)).toBeNull();
    expect(glKindOf('cancelled', 0, 'invitation')).toBeNull();
    expect(glKindOf('refunded', 0, null)).toBeNull();
    expect(glKindOf('other', 0, null)).toBeNull();
    expect(glKindOf('transferred', 0, 'invitation')).toBeNull();
  });
  it('un duplicata n’est jamais une entrée, même à 0 €', () => {
    expect(glKindOf('valid', 0, 'duplicata')).toBeNull();
    expect(glKindOf('valid', 15, 'duplicata')).toBeNull();
  });
  it('le canal se lit tel quel (colonne deal_channel, sans normalisation)', () => {
    expect(glKindOf('valid', 5, ' invitation ')).toBeNull();
    expect(glKindOf('valid', 0, undefined)).toBe('free');
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
    expect(nightVerdict({ ...base, phase: 'past', entries: 6, came: 4, showup: null })).toEqual({ key: 'yc.gl.v.pastSmall', vars: { came: 4, n: 6 } });
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
