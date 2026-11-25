import { describe, it, expect } from 'vitest';
import {
  validatePackForm, parseTableServerError, tablesWithoutPack, removedSoldTables, touchedNothing, applyRoomBlocker,
} from '../tablesConfig';

const ok = { basePrice: '300', baseCapacity: '6', maxExtraPersons: '2', extraPersonPrice: '10', deposit: '100', depositType: 'fixed' as const, minimumSpend: '0', paymentMode: 'online' as const };

describe('validatePackForm', () => {
  it('accepte une formule saine', () => expect(validatePackForm(ok)).toEqual({}));
  it('refuse un acompte fixe supérieur au prix', () => expect(validatePackForm({ ...ok, deposit: '500' }).deposit).toBe('deposit_exceeds_price'));
  it('refuse un pourcentage hors 1-100', () => {
    expect(validatePackForm({ ...ok, depositType: 'percentage', deposit: '0' }).deposit).toBe('deposit_percent_range');
    expect(validatePackForm({ ...ok, depositType: 'percentage', deposit: '101' }).deposit).toBe('deposit_percent_range');
    expect(validatePackForm({ ...ok, depositType: 'percentage', deposit: '20' })).toEqual({});
  });
  it('ignore l’acompte sur place', () => expect(validatePackForm({ ...ok, deposit: '999', paymentMode: 'on_site' })).toEqual({}));
  it('refuse prix négatif, capacité 0, extras négatifs', () => {
    const e = validatePackForm({ ...ok, basePrice: '-1', baseCapacity: '0', maxExtraPersons: '-2' });
    expect(e.basePrice).toBe('price_negative');
    expect(e.baseCapacity).toBe('capacity_min');
    expect(e.maxExtraPersons).toBe('extra_persons_negative');
  });
  it('exige un prix', () => expect(validatePackForm({ ...ok, basePrice: '' }).basePrice).toBe('price_required'));
});

describe('parseTableServerError', () => {
  it('YU002', () => expect(parseTableServerError({ code: 'YU002', message: 'table_pack_invalid:deposit_exceeds_price' })).toEqual({ kind: 'pack_invalid', reason: 'deposit_exceeds_price' }));
  it('YU003', () => expect(parseTableServerError({ code: 'YU003', message: 'table_has_reservation:t-1' })).toEqual({ kind: 'table_has_reservation', tableId: 't-1' }));
  it('YU001', () => expect(parseTableServerError({ code: 'YU001', message: 'x' })).toEqual({ kind: 'pack_cap' }));
  it('autre', () => expect(parseTableServerError({ code: '42501', message: 'x' })).toBeNull());
});

describe('plan', () => {
  it('tables sans formule', () => {
    const tabs = [{ id: 'a', packId: 'p1' }, { id: 'b', packId: null }, { id: 'c', packId: 'gone' }];
    expect(tablesWithoutPack(tabs, new Set(['p1'])).map((t) => t.id)).toEqual(['b', 'c']);
  });
  it('tables vendues retirées', () => expect(removedSoldTables(['a', 'b', 'c'], ['a'], new Set(['b']))).toEqual(['b']));
  it('écriture à 0 ligne', () => { expect(touchedNothing([])).toBe(true); expect(touchedNothing(null)).toBe(true); expect(touchedNothing([{ id: 1 }])).toBe(false); });
  it('raison du bouton salle', () => {
    expect(applyRoomBlocker({ hasEligibleEvent: false, eventHasClub: false, eventHasReservations: false })).toBe('no_event');
    expect(applyRoomBlocker({ hasEligibleEvent: true, eventHasClub: true, eventHasReservations: false })).toBe('club');
    expect(applyRoomBlocker({ hasEligibleEvent: true, eventHasClub: false, eventHasReservations: true })).toBe('reservations');
    expect(applyRoomBlocker({ hasEligibleEvent: true, eventHasClub: false, eventHasReservations: false })).toBeNull();
  });
});

import { paymentsBannerKind, tablesCollector } from '../tablesConfig';
describe('bandeau paiements', () => {
  const base = { ready: false, hasOnlinePacks: true, collector: 'organizer' as const, viewer: 'organizer' as const, canManageStripe: true };
  it('collecteur', () => { expect(tablesCollector({ venue_id: 'v' })).toBe('club'); expect(tablesCollector({ venue_id: null })).toBe('organizer'); });
  it('sur place seul', () => expect(paymentsBannerKind({ ...base, hasOnlinePacks: false })).toBe('on_site_only'));
  it('prêt', () => expect(paymentsBannerKind({ ...base, ready: true })).toBe('ready'));
  it('relier Stripe', () => expect(paymentsBannerKind(base)).toBe('viewer_connect'));
  it('éditeur : demander au fondateur', () => expect(paymentsBannerKind({ ...base, canManageStripe: false })).toBe('viewer_ask_owner'));
  it('le club doit relier', () => expect(paymentsBannerKind({ ...base, collector: 'club' })).toBe('other_connect'));
});
