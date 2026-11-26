import { describe, expect, it } from 'vitest';
import {
  fillParams, freeTablesForManual, guestCountError, guestCountValid, isPreorderOrder, isQueuedEmail,
  manualReservationError, preorderOfReservation, preorderTotals,
} from '../vipManualRules';

describe('manualReservationError', () => {
  it('traduit chaque code du serveur', () => {
    expect(manualReservationError({ message: 'table_not_found', code: '23503' }).key).toBe('tblm.err.tableNotFound');
    expect(manualReservationError({ message: 'pack_not_in_zone', code: '22023' }).key).toBe('tblm.err.packOutOfScope');
    expect(manualReservationError({ message: 'pack_not_in_event' }).key).toBe('tblm.err.packOutOfScope');
    expect(manualReservationError({ message: 'email_required', code: '22023' }).key).toBe('tblm.err.emailRequired');
    expect(manualReservationError({ code: '23505', message: 'duplicate key value violates uq_table_reservations_live_table' }).key).toBe('tblm.err.tableTaken');
    expect(manualReservationError({ code: '42501', message: 'forbidden' }).key).toBe('tblm.err.notAllowed');
    expect(manualReservationError({ code: '23514', message: 'La zone "VIP" est complète (3/3 tables).' }).key).toBe('tblm.err.zoneFull');
    expect(manualReservationError({ message: 'boom' }).key).toBe('tblm.err.generic');
  });
  it('lit les bornes du groupe', () => {
    const e = manualReservationError({ code: 'YU011', message: 'guest_count_out_of_range:2:12' });
    expect(e.key).toBe('tblm.err.guestRange');
    expect(fillParams('Entre {min} et {max}', e.params)).toBe('Entre 2 et 12');
  });
});

describe('guestCountError', () => {
  it('traduit YU011 à YU014 et demande une relecture quand l\'état a changé', () => {
    expect(guestCountError({ code: 'YU011', message: 'guest_count_out_of_range:1:8' }).params).toEqual({ min: '1', max: '8' });
    const entered = guestCountError({ code: 'YU012', message: 'guest_count_below_entered:3' });
    expect(entered.key).toBe('tblm.guests.errEntered');
    expect(entered.params).toEqual({ n: '3' });
    expect(guestCountError({ code: 'YU013', message: 'reservation_not_active' })).toMatchObject({ key: 'tblm.guests.errNotActive', refresh: true });
    expect(guestCountError({ code: 'YU014', message: 'guest_count_changed:5' })).toMatchObject({ key: 'tblm.guests.errChanged', refresh: true });
    expect(guestCountError({ code: '42501', message: 'forbidden' }).key).toBe('tblm.err.notAllowed');
  });
});

describe('isQueuedEmail', () => {
  it('un 202 {queued:true} est reconnu, rien d\'autre', () => {
    expect(isQueuedEmail({ queued: true })).toBe(true);
    expect(isQueuedEmail({ success: true })).toBe(false);
    expect(isQueuedEmail(null)).toBe(false);
  });
});

describe('freeTablesForManual', () => {
  const tables = [
    { id: 'a', name: 'A1', zoneId: 'z1' },
    { id: 'b', name: 'B1', zoneId: 'z2' },
    { id: 'c', name: 'C1' },
  ];
  it('ne garde que les tables de la zone, hors tables tenues', () => {
    const resas = [{ id: 'r', assignedTableId: 'a' }];
    expect(freeTablesForManual(tables, resas, 'z1').map(t => t.id)).toEqual(['c']);
    expect(freeTablesForManual(tables, [], 'z2').map(t => t.id)).toEqual(['b', 'c']);
    expect(freeTablesForManual(tables, [], null)).toHaveLength(3);
  });
});

describe('guestCountValid', () => {
  it('respecte le plancher des entrés et le plafond', () => {
    expect(guestCountValid(4, 3, 10)).toBe(true);
    expect(guestCountValid(2, 3, 10)).toBe(false);
    expect(guestCountValid(11, 0, 10)).toBe(false);
    expect(guestCountValid(0, 0, 10)).toBe(false);
  });
});

describe('précommandes', () => {
  const orders = [
    { reservationId: 'r1', status: 'preorder', totalAmount: 240, items: [{ quantity: 2 }] },
    { reservationId: 'r1', status: 'confirmed', notes: 'Pré-commande (checkout) · à régler sur place', totalAmount: 60, items: [{ quantity: 1 }] },
    { reservationId: 'r1', status: 'served', notes: 'Pré-commande', totalAmount: 90, items: [{ quantity: 1 }] },
    { reservationId: 'r2', status: 'preorder', totalAmount: 100, items: [{ quantity: 1 }] },
    { reservationId: 'r2', status: 'pending', notes: 'au bar', totalAmount: 50, items: [{ quantity: 1 }] },
    { reservationId: 'r3', status: 'cancelled', notes: 'Pré-commande', totalAmount: 70, items: [{ quantity: 1 }] },
  ];
  it('reconnaît une précommande par son statut ou sa note', () => {
    expect(isPreorderOrder({ status: 'preorder' })).toBe(true);
    expect(isPreorderOrder({ status: 'confirmed', notes: 'Pre-order (checkout)' })).toBe(true);
    expect(isPreorderOrder({ status: 'pending', notes: 'au bar' })).toBe(false);
  });
  it('cumule le « à encaisser sur place » sans compter le servi ni l\'annulé', () => {
    const t = preorderTotals(orders);
    expect(t.byReservation.get('r1')).toBe(300);
    expect(t.byReservation.get('r2')).toBe(100);
    expect(t.byReservation.has('r3')).toBe(false);
    expect(t.total).toBe(400);
    expect(t.tables).toBe(2);
  });
  it('compte les bouteilles d\'une réservation (servies comprises, annulées non)', () => {
    expect(preorderOfReservation(orders, 'r1')).toEqual({ bottles: 4, due: 300 });
    expect(preorderOfReservation(orders, 'r3')).toEqual({ bottles: 0, due: 0 });
  });
});
