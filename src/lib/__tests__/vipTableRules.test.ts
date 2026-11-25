import { describe, it, expect } from 'vitest';
import {
  tableMoney, adjustmentNeed, adjustmentArgs, tableHeldBy, freeTablesOfPack, vipErrorInfo,
} from '../vipTableRules';

describe('tableMoney', () => {
  it('table sur place à 800 € : 0 / 800 / 800', () => {
    expect(tableMoney({ totalPrice: 800, deposit: 0, hasOnlinePayment: false }))
      .toEqual({ paidOnline: 0, remainingOnSite: 800, commitment: 800 });
  });
  it('acompte en ligne : encaissé = ce que Stripe a pris, reste = total − acompte', () => {
    expect(tableMoney({ totalPrice: 500, deposit: 140, chargedTotal: 145.6, hasOnlinePayment: true }))
      .toEqual({ paidOnline: 145.6, remainingOnSite: 360, commitment: 500 });
  });
  it('sans charged_total : acompte + frais de service', () => {
    expect(tableMoney({ totalPrice: 300, deposit: 300, serviceFee: 12, hasOnlinePayment: true }))
      .toEqual({ paidOnline: 312, remainingOnSite: 0, commitment: 300 });
  });
  it('un acompte manuel sans Stripe ne compte pas comme encaissé en ligne', () => {
    expect(tableMoney({ totalPrice: 400, deposit: 100, hasOnlinePayment: false }).paidOnline).toBe(0);
  });
});

describe('adjustmentNeed', () => {
  it('même formule : libre', () => {
    expect(adjustmentNeed({ reservationPackId: 'a', targetPackId: 'a', reservationPrice: 500, targetPrice: 500 }).required).toBe(false);
  });
  it('table sans formule liée : libre', () => {
    expect(adjustmentNeed({ reservationPackId: 'a', targetPackId: undefined, reservationPrice: 500 }).required).toBe(false);
  });
  it('autre formule plus chère : écart proposé', () => {
    expect(adjustmentNeed({ reservationPackId: 'a', targetPackId: 'b', reservationPrice: 500, targetPrice: 800 }))
      .toEqual({ required: true, difference: 300 });
  });
  it('autre formule moins chère : écart 0', () => {
    expect(adjustmentNeed({ reservationPackId: 'a', targetPackId: 'b', reservationPrice: 500, targetPrice: 400 }).difference).toBe(0);
  });
});

describe('adjustmentArgs', () => {
  it('surclassement offert : pas de montant', () => {
    expect(adjustmentArgs('upgrade_free', 50)).toEqual({ p_adjustment: 'upgrade_free', p_adjustment_amount: null });
  });
  it('différence : montant arrondi au centime', () => {
    expect(adjustmentArgs('pay_on_site', 12.345)).toEqual({ p_adjustment: 'pay_on_site', p_adjustment_amount: 12.35 });
  });
  it('rien choisi ou montant négatif : null', () => {
    expect(adjustmentArgs(null, 0)).toBeNull();
    expect(adjustmentArgs('pay_on_site', -1)).toBeNull();
  });
});

describe('tables libres', () => {
  const reservations = [
    { id: 'r1', assignedTableId: 't1' },
    { id: 'r2', assignedTableId: null, requestedTableId: 't2', placementStatus: 'requested' },
    { id: 'r3', assignedTableId: null, requestedTableId: 't3', placementStatus: 'rejected' },
  ];
  it('attribuée et demande vivante tiennent la table', () => {
    expect(tableHeldBy('t1', reservations)?.id).toBe('r1');
    expect(tableHeldBy('t2', reservations)?.id).toBe('r2');
    expect(tableHeldBy('t3', reservations)).toBeUndefined();
  });
  it('la demande de la résa elle-même ne la bloque pas', () => {
    expect(tableHeldBy('t2', reservations, 'r2')).toBeUndefined();
  });
  it('filtre par formule et exclut les tenues', () => {
    const tables = [{ id: 't1', packId: 'p' }, { id: 't2', packId: 'p' }, { id: 't3', packId: 'p' }, { id: 't4', packId: 'q' }, { id: 't5' }];
    expect(freeTablesOfPack(tables, reservations, 'p', 'r2')).toEqual(['t2', 't3', 't5']);
  });
});

describe('vipErrorInfo', () => {
  it('codes serveur', () => {
    expect(vipErrorInfo({ code: 'YU004' })).toEqual({ key: 'tblg.err.placementChanged', refresh: true });
    expect(vipErrorInfo({ code: 'YU007', message: 'table_taken' }).key).toBe('tblg.err.tableTaken');
    expect(vipErrorInfo({ code: 'YU006' }).key).toBe('tblg.err.useRefund');
    expect(vipErrorInfo({ code: 'YU005' }).key).toBe('tblg.err.adjustmentRequired');
    expect(vipErrorInfo({ message: 'already_seated' }).key).toBe('tblg.err.alreadySeated');
  });
  it('statuts HTTP de send-vip-confirmation', () => {
    expect(vipErrorInfo({ status: 403 }).key).toBe('tblg.err.notAllowed');
    expect(vipErrorInfo({ status: 409 }).key).toBe('tblg.err.stateMismatch');
  });
  it('inconnu : message générique, liste relue', () => {
    expect(vipErrorInfo(new Error('boom'))).toEqual({ key: 'tblg.err.generic', refresh: true });
  });
});
