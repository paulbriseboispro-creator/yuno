import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  UNLIMITED_TICKETS, displayChoiceOf, freePresetToRoundRows, fromRelative, isRowListed,
  normalizeFreePreset, roundsToFreePreset, saleChoiceOf, scheduleColumns, ticketPhase, toRelative,
} from '../freeTicketing';

const NOW = Date.parse('2026-10-10T18:00:00Z');
const before = '2026-10-10T17:00:00Z';
const after = '2026-10-10T19:00:00Z';

describe('miroir Deno', () => {
  it('le fichier _shared est identique octet pour octet', () => {
    const root = path.resolve(__dirname, '../../..');
    const front = fs.readFileSync(path.join(root, 'src/lib/freeTicketing.ts'), 'utf8');
    const edge = fs.readFileSync(path.join(root, 'supabase/functions/_shared/free-ticketing.ts'), 'utf8');
    expect(edge).toBe(front);
  });
});

describe('ticketPhase', () => {
  it('par défaut : en vente', () => {
    expect(ticketPhase({ isActive: true }, NOW)).toBe('on_sale');
  });
  it('caché gagne sur tout', () => {
    expect(ticketPhase({ isActive: true, hidden: true }, NOW)).toBe('hidden');
  });
  it('visible à une date : caché avant, en vente après', () => {
    expect(ticketPhase({ isActive: true, visibleFrom: after }, NOW)).toBe('hidden');
    expect(ticketPhase({ isActive: true, visibleFrom: before }, NOW)).toBe('on_sale');
  });
  it('vente plus tard (à la main) : visible, pas achetable', () => {
    expect(ticketPhase({ isActive: false }, NOW)).toBe('upcoming');
  });
  it('vente à une date : bientôt avant, en vente après', () => {
    expect(ticketPhase({ isActive: true, saleStartsAt: after }, NOW)).toBe('upcoming');
    expect(ticketPhase({ isActive: true, saleStartsAt: before }, NOW)).toBe('on_sale');
  });
  it('fin de vente passée : terminé, même si la vente était ouverte', () => {
    expect(ticketPhase({ isActive: true, saleEndsAt: before }, NOW)).toBe('ended');
    expect(ticketPhase({ isActive: true, saleEndsAt: after }, NOW)).toBe('on_sale');
  });
  it('une date illisible ne ferme rien', () => {
    expect(ticketPhase({ isActive: true, visibleFrom: 'n/a', saleStartsAt: 'n/a' }, NOW)).toBe('on_sale');
  });
});

describe('prix public « à partir de »', () => {
  it('écarte les billets cachés ou pas encore affichés', () => {
    expect(isRowListed({}, NOW)).toBe(true);
    expect(isRowListed({ hidden: true }, NOW)).toBe(false);
    expect(isRowListed({ visible_from: after }, NOW)).toBe(false);
    expect(isRowListed({ visible_from: before }, NOW)).toBe(true);
  });
});

describe('formulaire ⇄ colonnes', () => {
  it('aller-retour des deux choix', () => {
    const cols = scheduleColumns({ display: 'at', visibleFrom: before, sale: 'at', saleStartsAt: after, saleEndsAt: null });
    expect(cols).toEqual({ hidden: false, visible_from: before, is_active: true, sale_starts_at: after, sale_ends_at: null });
    const back = { isActive: cols.is_active, hidden: cols.hidden, visibleFrom: cols.visible_from, saleStartsAt: cols.sale_starts_at };
    expect(displayChoiceOf(back)).toBe('at');
    expect(saleChoiceOf(back)).toBe('at');
  });
  it('« plus tard » = vente fermée, sans date', () => {
    const cols = scheduleColumns({ display: 'hidden', visibleFrom: before, sale: 'manual', saleStartsAt: after });
    expect(cols.hidden).toBe(true);
    expect(cols.visible_from).toBeNull();
    expect(cols.is_active).toBe(false);
    expect(cols.sale_starts_at).toBeNull();
  });
});

describe('dates relatives (modèles)', () => {
  const start = '2026-10-17T21:00:00Z'; // samedi 17/10, 23:00 à Paris (UTC+2)
  it('J-N calendaires dans le fuseau de la soirée', () => {
    expect(toRelative('2026-10-10T18:00:00Z', start)).toEqual({ daysBefore: 7, time: '20:00' });
    expect(toRelative('2026-10-17T19:30:00Z', start)).toEqual({ daysBefore: 0, time: '21:30' });
  });
  it('aller-retour exact', () => {
    const rel = toRelative('2026-10-12T08:15:00Z', start)!;
    expect(fromRelative(rel, start)).toBe('2026-10-12T08:15:00.000Z');
  });
  it('rejouée sur une autre date, traverse le changement d’heure', () => {
    // Soirée du samedi 31/10 (UTC+1 après le 25/10) : « J-7 à 20:00 » = 24/10 à 20:00 (UTC+2).
    expect(fromRelative({ daysBefore: 7, time: '20:00' }, '2026-10-31T22:00:00Z')).toBe('2026-10-24T18:00:00.000Z');
    expect(fromRelative({ daysBefore: 0, time: '20:00' }, '2026-10-31T22:00:00Z')).toBe('2026-10-31T19:00:00.000Z');
  });
  it('autre fuseau', () => {
    expect(fromRelative({ daysBefore: 1, time: '12:00' }, '2026-07-04T02:00:00Z', 'America/New_York')).toBe('2026-07-02T16:00:00.000Z');
  });
});

describe('modèle d’une billetterie libre', () => {
  const start = '2026-10-17T21:00:00Z';
  const rows = [
    { name: 'Regular', price: 20, max_tickets: UNLIMITED_TICKETS, position: 1, is_active: false, includes_drink: false },
    {
      name: 'Early', price: 12, max_tickets: 100, position: 0, is_active: true,
      visible_from: '2026-10-10T18:00:00Z', sale_starts_at: '2026-10-12T18:00:00Z', sale_ends_at: '2026-10-16T21:59:00Z',
      includes_drink: true, drink_deadline_type: 'fixed_time', drink_cutoff_time: '01:00',
    },
    { name: 'Secret', price: 0, max_tickets: 30, position: 2, is_active: true, hidden: true },
  ];

  it('garde l’ordre, les choix et rend les dates relatives', () => {
    const preset = roundsToFreePreset(rows, start);
    expect(preset.map((p) => p.name)).toEqual(['Early', 'Regular', 'Secret']);
    expect(preset[0]).toMatchObject({
      maxTickets: 100, includesDrink: true, drinkDeadlineType: 'fixed_time', drinkCutoffTime: '01:00',
      display: 'at', visibleAt: { daysBefore: 7, time: '20:00' },
      sale: 'at', saleStartAt: { daysBefore: 5, time: '20:00' }, saleEndAt: { daysBefore: 1, time: '23:59' },
    });
    expect(preset[1]).toMatchObject({ maxTickets: null, sale: 'manual', display: 'now' });
    expect(preset[2]).toMatchObject({ display: 'hidden', sale: 'now' });
  });

  it('rejoué sur une nouvelle soirée : mêmes écarts, nouvelles dates', () => {
    const preset = normalizeFreePreset(JSON.parse(JSON.stringify(roundsToFreePreset(rows, start))));
    const next = '2026-10-24T21:00:00Z';
    const out = freePresetToRoundRows(preset, 'ev-2', next, undefined, 3);
    expect(out[0]).toMatchObject({
      event_id: 'ev-2', name: 'Early', position: 3, max_tickets: 100, auto_activate: false, ticket_type: 'standard',
      visible_from: '2026-10-17T18:00:00.000Z', sale_starts_at: '2026-10-19T18:00:00.000Z', sale_ends_at: '2026-10-23T21:59:00.000Z',
      is_active: true, hidden: false, includes_drink: true, drink_cutoff_time: '01:00',
    });
    expect(out[1]).toMatchObject({ max_tickets: UNLIMITED_TICKETS, is_active: false, sale_starts_at: null });
    expect(out[2]).toMatchObject({ hidden: true, is_active: true });
  });

  it('une date de vente perdue ne met jamais le billet en vente', () => {
    const out = freePresetToRoundRows([{ name: 'X', price: 1, maxTickets: null, includesDrink: false, display: 'now', sale: 'at', saleStartAt: null }], 'e', '2026-10-24T21:00:00Z');
    expect(out[0].is_active).toBe(false);
  });

  it('normalise un jsonb douteux', () => {
    expect(normalizeFreePreset(null)).toEqual([]);
    expect(normalizeFreePreset([{ price: 3 }, { name: 'A', display: 'bogus', sale: 'bogus', maxTickets: UNLIMITED_TICKETS }])).toEqual([
      expect.objectContaining({ name: 'A', display: 'now', sale: 'now', maxTickets: null }),
    ]);
  });
});

describe('vue publique', () => {
  it('ordre du pro, sans les billets cachés', async () => {
    const { publicFreeTickets } = await import('../freeTicketing');
    const list = publicFreeTickets([
      { position: 2, isActive: true, name: 'C' },
      { position: 0, isActive: false, name: 'A' },
      { position: 1, isActive: true, hidden: true, name: 'B' },
      { position: 3, isActive: true, saleEndsAt: before, name: 'D' },
    ], NOW);
    expect(list.map((x) => [x.ticket.name, x.phase])).toEqual([['A', 'upcoming'], ['C', 'on_sale'], ['D', 'ended']]);
  });
  it('date lisible dans le fuseau de la soirée', async () => {
    const { formatTicketDate } = await import('../freeTicketing');
    expect(formatTicketDate('2026-10-12T18:00:00Z', 'Europe/Paris', 'en-GB')).toBe('12 Oct, 20:00');
  });
});

describe('heure limite d’entrée', () => {
  it('HH:MM seulement, time SQL accepté', async () => {
    const { normalizeEntryDeadline } = await import('../freeTicketing');
    expect(normalizeEntryDeadline('00:30:00')).toBe('00:30');
    expect(normalizeEntryDeadline('23:59')).toBe('23:59');
    expect(normalizeEntryDeadline('24:00')).toBeNull();
    expect(normalizeEntryDeadline('')).toBeNull();
    expect(normalizeEntryDeadline(null)).toBeNull();
  });
  it('suit le billet dans le modèle, aller et retour', () => {
    const preset = roundsToFreePreset([
      { name: 'Avant 1h', price: 10, max_tickets: 50, position: 0, is_active: true, entry_deadline: '01:00:00' },
      { name: 'Toute la nuit', price: 15, max_tickets: 50, position: 1, is_active: true },
    ], '2026-10-17T21:00:00Z');
    expect(preset.map((p) => p.entryDeadline)).toEqual(['01:00', null]);
    const rows = freePresetToRoundRows(normalizeFreePreset(JSON.parse(JSON.stringify(preset))), 'e', '2026-10-24T21:00:00Z');
    expect(rows.map((r) => r.entry_deadline)).toEqual(['01:00:00', null]);
  });
});
