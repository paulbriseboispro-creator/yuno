import { describe, expect, it } from 'vitest';
import {
  boundDeposit, packInScope, parseGuestCount, safePlacementStatus,
} from '../../../supabase/functions/_shared/table-bounds.ts';

describe('parseGuestCount — convives bornés par la formule', () => {
  it('accepte la base, le maximum et tout entier entre les deux', () => {
    expect(parseGuestCount(4, 4, 4)).toBe(4);
    expect(parseGuestCount(6, 4, 4)).toBe(6);
    expect(parseGuestCount(8, 4, 4)).toBe(8);
    expect(parseGuestCount('5', 4, 4)).toBe(5);
  });
  it('absent = la base de la formule', () => {
    expect(parseGuestCount(undefined, 6, 2)).toBe(6);
    expect(parseGuestCount(null, 6, 2)).toBe(6);
    expect(parseGuestCount('', 6, 2)).toBe(6);
  });
  it('accepte moins que la base (table de 4 prise à 2), jamais zéro', () => {
    expect(parseGuestCount(1, 4, 4)).toBe(1);
    expect(parseGuestCount(3, 4, 4)).toBe(3);
    expect(parseGuestCount(0, 4, 4)).toBeNull();
  });
  it('refuse au-dessus du maximum, négatif, décimal, texte', () => {
    expect(parseGuestCount(9, 4, 4)).toBeNull();
    expect(parseGuestCount(500, 8, 0)).toBeNull();
    expect(parseGuestCount(-2, 4, 4)).toBeNull();
    expect(parseGuestCount(4.5, 4, 4)).toBeNull();
    expect(parseGuestCount('quatre', 4, 4)).toBeNull();
    expect(parseGuestCount(Number.NaN, 4, 4)).toBeNull();
    expect(parseGuestCount({}, 4, 4)).toBeNull();
  });
  it('formule sans extras : jusqu\'à la base, pas au-delà', () => {
    expect(parseGuestCount(8, 8, 0)).toBe(8);
    expect(parseGuestCount(5, 8, 0)).toBe(5);
    expect(parseGuestCount(9, 8, 0)).toBeNull();
    expect(parseGuestCount(8, 8, null)).toBe(8);
  });
});

describe('safePlacementStatus — liste blanche', () => {
  it('garde les trois valeurs permises, écarte le reste', () => {
    expect(safePlacementStatus('none')).toBe('none');
    expect(safePlacementStatus('requested')).toBe('requested');
    expect(safePlacementStatus('assign_on_arrival')).toBe('assign_on_arrival');
    expect(safePlacementStatus('approved')).toBe('none');
    expect(safePlacementStatus('rejected')).toBe('none');
    expect(safePlacementStatus(undefined)).toBe('none');
    expect(safePlacementStatus(42)).toBe('none');
  });
});

describe('boundDeposit — l\'acompte ne dépasse pas le prix', () => {
  it('acompte fixe plus haut que le prix : plafonné', () => {
    expect(boundDeposit(200, 150)).toBe(150);
    expect(boundDeposit(100, 150)).toBe(100);
    expect(boundDeposit(150, 150)).toBe(150);
  });
});

describe('packInScope — la formule est de la bonne soirée / du bon club', () => {
  const ev = 'event-1';
  it('event-scopé : seule la formule de la soirée', () => {
    const scope = { eventId: ev, eventScoped: true, clubId: null };
    expect(packInScope({ event_id: ev }, scope)).toBe(true);
    expect(packInScope({ event_id: 'event-2' }, scope)).toBe(false);
    expect(packInScope({ event_id: null, venue_id: 'club-a' }, scope)).toBe(false);
  });
  it('club en mode élite : formule du club, ou créée pour cette soirée', () => {
    const scope = { eventId: ev, eventScoped: false, clubId: 'club-a' };
    expect(packInScope({ event_id: null, venue_id: 'club-a' }, scope)).toBe(true);
    expect(packInScope({ event_id: ev, venue_id: null }, scope)).toBe(true);
  });
  it('club en mode élite : jamais la formule d\'un autre club ni d\'une autre soirée', () => {
    const scope = { eventId: ev, eventScoped: false, clubId: 'club-a' };
    expect(packInScope({ event_id: null, venue_id: 'club-b' }, scope)).toBe(false);
    expect(packInScope({ event_id: 'event-2', venue_id: 'club-a' }, scope)).toBe(false);
    expect(packInScope({ event_id: null, venue_id: null }, scope)).toBe(false);
  });
});
