import { describe, it, expect } from 'vitest';
import { heldTables, ServiceReservation } from '../serviceTypes';

const res = (over: Partial<ServiceReservation>): ServiceReservation =>
  ({
    id: 'r', fullName: 'Guest', vipStatus: 'waiting', assignedTableId: null, requestedTableId: null,
    placementStatus: 'none', ...over,
  }) as ServiceReservation;

describe('heldTables', () => {
  it('garde une table pré-placée pour un client en attente', () => {
    const map = heldTables([res({ id: 'a', assignedTableId: 't1' })]);
    expect(map.get('t1')?.id).toBe('a');
  });

  it('garde une table demandée au checkout tant que la demande est ouverte', () => {
    const map = heldTables([res({ id: 'a', requestedTableId: 't2', placementStatus: 'requested' })]);
    expect(map.get('t2')?.id).toBe('a');
    expect(heldTables([res({ id: 'a', requestedTableId: 't2', placementStatus: 'rejected' })]).size).toBe(0);
  });

  it("n'inclut jamais un client installé, terminé ou absent", () => {
    const map = heldTables([
      res({ id: 'a', assignedTableId: 't1', vipStatus: 'placed' }),
      res({ id: 'b', assignedTableId: 't2', vipStatus: 'finished' }),
      res({ id: 'c', assignedTableId: 't3', vipStatus: 'no_show' }),
    ]);
    expect(map.size).toBe(0);
  });

  it('un pré-placement prime sur une simple demande de la même table', () => {
    const map = heldTables([
      res({ id: 'req', requestedTableId: 't1', placementStatus: 'requested' }),
      res({ id: 'pre', assignedTableId: 't1' }),
    ]);
    expect(map.get('t1')?.id).toBe('pre');
  });
});
