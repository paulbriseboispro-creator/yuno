import { describe, expect, it } from 'vitest';
import { sortTableGuests, tableGuestDoorName, tableGuestName, tableGuestTicketCount } from '@/lib/tableGuests';
import { validateTableReservation, wholeTableDoorState } from '@/lib/scan/rules';

const guest = (k: number) => `Invité ${k}`;

describe('tableGuestTicketCount (miroir de _table_guest_ticket_count)', () => {
  it('donne un ticket par personne de 2 à 50 personnes', () => {
    expect(tableGuestTicketCount(2)).toBe(2);
    expect(tableGuestTicketCount(6)).toBe(6);
    expect(tableGuestTicketCount(50)).toBe(50);
  });
  it('aucun ticket à part pour une personne, une valeur absente ou hors bornes', () => {
    expect(tableGuestTicketCount(1)).toBe(0);
    expect(tableGuestTicketCount(0)).toBe(0);
    expect(tableGuestTicketCount(51)).toBe(0);
    expect(tableGuestTicketCount(null)).toBe(0);
    expect(tableGuestTicketCount(undefined)).toBe(0);
    expect(tableGuestTicketCount(2.5)).toBe(0);
  });
});

describe('tableGuestName', () => {
  it('le titulaire garde son nom, repli sur la réservation', () => {
    expect(tableGuestName({ guest_number: 0, full_name: 'Marie D.' }, 'Autre', guest)).toBe('Marie D.');
    expect(tableGuestName({ guest_number: 0, full_name: null }, 'Marie D.', guest)).toBe('Marie D.');
    expect(tableGuestName({ guest_number: 0, full_name: '  ' }, null, guest)).toBe('Invité 0');
  });
  it('un invité s’appelle « Invité k », même si la base porte un nom vide', () => {
    expect(tableGuestName({ guest_number: 1, full_name: null }, 'Marie D.', guest)).toBe('Invité 1');
    expect(tableGuestName({ guest_number: 3, full_name: null }, null, guest)).toBe('Invité 3');
  });
});

describe('tableGuestDoorName', () => {
  it('à la porte, un invité dit à quelle table il appartient', () => {
    expect(tableGuestDoorName({ guest_number: 2, full_name: null }, 'Marie D.', guest)).toBe('Invité 2 · Marie D.');
    expect(tableGuestDoorName({ guest_number: 0, full_name: 'Marie D.' }, 'Marie D.', guest)).toBe('Marie D.');
    expect(tableGuestDoorName({ guest_number: 2, full_name: null }, null, guest)).toBe('Invité 2');
  });
});

describe('sortTableGuests', () => {
  it('titulaire d’abord, puis Invité 1, 2…', () => {
    const sorted = sortTableGuests([
      { guest_number: 2, full_name: null },
      { guest_number: 0, full_name: 'M' },
      { guest_number: 1, full_name: null },
    ]);
    expect(sorted.map((g) => g.guest_number)).toEqual([0, 1, 2]);
  });
});

describe('wholeTableDoorState (QR de la réservation)', () => {
  it('sans tickets d’invités, la table entière entre d’un coup, comme avant', () => {
    expect(wholeTableDoorState(false, 4, null)).toEqual({ scanned: false, headcount: 4 });
    expect(wholeTableDoorState(true, 4, null)).toEqual({ scanned: true, headcount: 4 });
  });
  it('avec tickets : il fait entrer les personnes encore dehors', () => {
    // Un invité est déjà entré avec son QR : la réservation est marquée, mais
    // il reste 3 personnes, le QR principal n'est pas « déjà scanné ».
    expect(wholeTableDoorState(true, 4, { remaining: 3 })).toEqual({ scanned: false, headcount: 3 });
  });
  it('« déjà scanné » seulement quand tout le monde est entré', () => {
    expect(wholeTableDoorState(true, 4, { remaining: 0 })).toEqual({ scanned: true, headcount: 1 });
  });
});

describe('validateTableReservation sur un ticket d’invité', () => {
  const base = {
    type: 'table_guest' as const, id: 'g', name: 'Invité 1 · M', status: 'paid',
    scanned: false, scannedAt: null, venueId: 'club', organizerUserId: null,
  };
  const ctx = { scope: { venueId: 'club', organizerUserId: null }, now: new Date(), mode: 'entry' as const };
  it('entre si la réservation est payée', () => {
    expect(validateTableReservation(base, ctx).status).toBe('success');
  });
  it('refusé si la réservation n’est pas payée, déjà entré, ou autre porte', () => {
    expect(validateTableReservation({ ...base, status: 'pending' }, ctx).status).toBe('not_paid');
    expect(validateTableReservation({ ...base, status: 'refunded' }, ctx).status).toBe('not_paid');
    expect(validateTableReservation({ ...base, scanned: true }, ctx).status).toBe('already');
    expect(validateTableReservation({ ...base, venueId: 'autre' }, ctx).status).toBe('wrong_venue');
  });
});
