import { describe, expect, it } from 'vitest';
import {
  MAX_TICKET_PLACES, buildTicketPlaces, ticketPlaceCount,
} from '../../../supabase/functions/_shared/ticket-places.ts';

const NOW = Date.UTC(2026, 9, 28, 20, 0, 0);
const buyer = { fullName: 'Paul Dupont', email: 'Paul@Example.com', phone: '+33 6 12 34 56 78' };

describe('ticketPlaceCount', () => {
  it('un billet de plusieurs personnes a une place par personne', () => {
    expect(ticketPlaceCount(2, false)).toBe(2);
    expect(ticketPlaceCount(4, false)).toBe(4);
  });

  it("un billet d'une personne n'a pas de place : son QR suffit", () => {
    expect(ticketPlaceCount(1, false)).toBe(0);
  });

  it('un pack de groupe garde son QR unique', () => {
    expect(ticketPlaceCount(3, true)).toBe(0);
  });

  it('une quantité illisible ne crée rien', () => {
    expect(ticketPlaceCount('3', false)).toBe(0);
    expect(ticketPlaceCount(2.5, false)).toBe(0);
    expect(ticketPlaceCount(Number.NaN, false)).toBe(0);
    expect(ticketPlaceCount(0, false)).toBe(0);
    expect(ticketPlaceCount(-2, false)).toBe(0);
    expect(ticketPlaceCount(MAX_TICKET_PLACES + 1, false)).toBe(0);
  });
});

describe('buildTicketPlaces', () => {
  it('crée exactement N places, QR <billet>-k, acheteur en premier', () => {
    const rows = buildTicketPlaces({
      ticketQr: 'TK-abc',
      quantity: 3,
      isGroup: false,
      buyer,
      attendees: [
        { fullName: 'Paul Dupont', email: 'paul@example.com', phone: '+33 6 12 34 56 78' },
        { fullName: '  Margot   Leroy ', email: 'margot@example.com', phone: '+33 7 00 00 00 01' },
        { fullName: 'Inès', email: '', phone: '' },
      ],
      now: NOW,
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.qr_code)).toEqual(['TK-abc-1', 'TK-abc-2', 'TK-abc-3']);
    expect(rows[0]).toMatchObject({ full_name: 'Paul Dupont', email: 'paul@example.com', phone: '+33 6 12 34 56 78' });
    expect(rows[1]).toMatchObject({ full_name: 'Margot Leroy', email: 'margot@example.com', phone: '+33 7 00 00 00 01' });
    expect(rows[2]).toMatchObject({ full_name: 'Inès', email: null, phone: null });
  });

  it("l'identité de la place 1 vient du serveur, pas du formulaire", () => {
    const rows = buildTicketPlaces({
      ticketQr: 'TK-abc',
      quantity: 2,
      isGroup: false,
      buyer,
      attendees: [{ fullName: 'Quelqu’un d’autre', email: 'autre@example.com' }, {}],
      now: NOW,
    });
    expect(rows[0]).toMatchObject({ full_name: 'Paul Dupont', email: 'paul@example.com' });
  });

  it("un ami sans nom devient « <acheteur> +k »", () => {
    const rows = buildTicketPlaces({
      ticketQr: 'TK-abc',
      quantity: 4,
      isGroup: false,
      buyer,
      attendees: [{ fullName: 'Paul Dupont' }, { fullName: '' }, { fullName: '   ' }, { fullName: '123' }],
      now: NOW,
    });
    expect(rows.map((r) => r.full_name)).toEqual(['Paul Dupont', 'Paul Dupont +1', 'Paul Dupont +2', 'Paul Dupont +3']);
  });

  it('le nombre de places suit la quantité du billet, jamais la liste envoyée', () => {
    const short = buildTicketPlaces({
      ticketQr: 'TK-abc', quantity: 3, isGroup: false, buyer,
      attendees: [{ fullName: 'Paul Dupont' }],
      now: NOW,
    });
    expect(short).toHaveLength(3);
    expect(short[2].full_name).toBe('Paul Dupont +2');

    const long = buildTicketPlaces({
      ticketQr: 'TK-abc', quantity: 2, isGroup: false, buyer,
      attendees: [{ fullName: 'Paul Dupont' }, { fullName: 'Ami Un' }, { fullName: 'Ami Deux' }, { fullName: 'Ami Trois' }],
      now: NOW,
    });
    expect(long).toHaveLength(2);
    expect(long.map((r) => r.qr_code)).toEqual(['TK-abc-1', 'TK-abc-2']);
  });

  it('une liste illisible ou absente ne bloque rien', () => {
    for (const attendees of [undefined, null, 'x', 42, [null, 'x', 7]]) {
      const rows = buildTicketPlaces({ ticketQr: 'TK-abc', quantity: 3, isGroup: false, buyer, attendees, now: NOW });
      expect(rows.map((r) => r.full_name)).toEqual(['Paul Dupont', 'Paul Dupont +1', 'Paul Dupont +2']);
    }
  });

  it('écarte un email ou un téléphone illisible, et les champs non textuels', () => {
    const rows = buildTicketPlaces({
      ticketQr: 'TK-abc', quantity: 3, isGroup: false, buyer,
      attendees: [
        {},
        { fullName: 'Ami Un', email: 'pas un email', phone: 'aucun' },
        { fullName: { toString: () => 'Piège' }, email: ['a@b.co'], phone: 33612345678 },
      ],
      now: NOW,
    });
    expect(rows[1]).toMatchObject({ full_name: 'Ami Un', email: null, phone: null });
    expect(rows[2]).toMatchObject({ full_name: 'Paul Dupont +2', email: null, phone: null });
  });

  it('borne la longueur des champs', () => {
    const rows = buildTicketPlaces({
      ticketQr: 'TK-abc', quantity: 2, isGroup: false, buyer,
      attendees: [{}, { fullName: 'A'.repeat(500), phone: '1'.repeat(80) }],
      now: NOW,
    });
    expect(rows[1].full_name).toHaveLength(120);
    expect(rows[1].phone).toHaveLength(40);
  });

  it("acheteur sans nom : repli sur le formulaire, puis sur l'email", () => {
    const fromForm = buildTicketPlaces({
      ticketQr: 'TK-abc', quantity: 2, isGroup: false,
      buyer: { fullName: '', email: 'paul@example.com' },
      attendees: [{ fullName: 'Paul Formulaire' }, {}],
      now: NOW,
    });
    expect(fromForm.map((r) => r.full_name)).toEqual(['Paul Formulaire', 'Paul Formulaire +1']);

    const fromEmail = buildTicketPlaces({
      ticketQr: 'TK-abc', quantity: 2, isGroup: false,
      buyer: { fullName: null, email: 'paul@example.com' },
      attendees: [],
      now: NOW,
    });
    expect(fromEmail.map((r) => r.full_name)).toEqual(['paul', 'paul +1']);
  });

  it("garde l'ordre des places : une milliseconde de plus par place", () => {
    const rows = buildTicketPlaces({ ticketQr: 'TK-abc', quantity: 3, isGroup: false, buyer, attendees: [], now: NOW });
    expect(rows.map((r) => Date.parse(r.created_at) - NOW)).toEqual([0, 1, 2]);
  });

  it("ne crée rien sans QR de billet, pour un billet d'une personne ou un groupe", () => {
    expect(buildTicketPlaces({ ticketQr: '', quantity: 3, isGroup: false, buyer, attendees: [], now: NOW })).toEqual([]);
    expect(buildTicketPlaces({ ticketQr: 'TK-abc', quantity: 1, isGroup: false, buyer, attendees: [{ fullName: 'Paul Dupont' }], now: NOW })).toEqual([]);
    expect(buildTicketPlaces({ ticketQr: 'TK-abc', quantity: 3, isGroup: true, buyer, attendees: [], now: NOW })).toEqual([]);
  });
});
