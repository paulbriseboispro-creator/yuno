import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  UNLIMITED_TICKETS, displayChoiceOf, freePresetToRoundRows, fromRelative, isRowListed,
  normalizeFreePreset, presetSaleChoice, roundsToFreePreset, rowPhase, saleChoiceOf, scheduleColumns, ticketPhase, toRelative,
  wouldCreateChainCycle,
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
    expect(cols).toEqual({ hidden: false, visible_from: before, is_active: true, sale_starts_at: after, sale_ends_at: null, opens_after_round_id: null });
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

describe('rounds billet par billet (s’ouvre quand un autre est complet)', () => {
  // La grille d'un pro : 4 rounds × 2 entrées (avant 1 h / toute la nuit),
  // chaque entrée a sa propre file de rounds.
  const grid = [
    ['Early Round — Before 1 AM', 6, 10, '01:00'], ['Early Round — All Night Long', 10, 10, null],
    ['First Round — Before 1 AM', 8, 25, '01:00'], ['First Round — All Night Long', 12, 25, null],
    ['Second Round — Before 1 AM', 10, 45, '01:00'], ['Second Round — All Night Long', 14, 45, null],
    ['Last Round — Before 1 AM', 12, 70, '01:00'], ['Last Round — All Night Long', 16, 70, null],
  ] as const;
  const rows = grid.map(([name, price, max, entry], i) => ({
    id: `r${i}`, name, price, max_tickets: max, position: i, is_active: i < 2,
    entry_deadline: entry ? `${entry}:00` : null,
    opens_after_round_id: i >= 2 ? `r${i - 2}` : null,
  }));

  it('formulaire : « après un billet » ferme la vente et pose le lien', () => {
    const cols = scheduleColumns({ display: 'now', sale: 'after', opensAfterRoundId: 'r0', saleStartsAt: after });
    expect(cols).toMatchObject({ is_active: false, opens_after_round_id: 'r0', sale_starts_at: null });
    expect(saleChoiceOf({ isActive: true, opensAfterRoundId: 'r0' })).toBe('after');
    // Sans billet choisi, rien n'est lié (et rien n'est mis en vente).
    expect(scheduleColumns({ display: 'now', sale: 'after', opensAfterRoundId: null })).toMatchObject({ is_active: false, opens_after_round_id: null });
    expect(scheduleColumns({ display: 'now', sale: 'now', opensAfterRoundId: 'r0' }).opens_after_round_id).toBeNull();
  });

  it('un billet en attente est « Bientôt » côté public', () => {
    expect(ticketPhase({ isActive: false, opensAfterRoundId: 'r0' }, NOW)).toBe('upcoming');
  });

  it('refuse les boucles', () => {
    const links = Object.fromEntries(rows.map((r) => [r.id, r.opens_after_round_id]));
    expect(wouldCreateChainCycle(links, 'r0', 'r6')).toBe(true); // r6 → r4 → r2 → r0
    expect(wouldCreateChainCycle(links, 'r0', 'r0')).toBe(true);
    expect(wouldCreateChainCycle(links, 'r1', 'r6')).toBe(false);
  });

  it('modèle : la grille complète fait l’aller-retour, liens et heures compris', () => {
    const preset = roundsToFreePreset(rows, '2026-10-17T21:00:00Z');
    expect(preset[2]).toMatchObject({ key: 'r2', opensAfter: 'r0', sale: 'manual', entryDeadline: '01:00' });
    expect(presetSaleChoice(preset[2])).toBe('after');
    expect(presetSaleChoice(preset[0])).toBe('now');
    const out = freePresetToRoundRows(normalizeFreePreset(JSON.parse(JSON.stringify(preset))), 'ev', '2026-10-24T21:00:00Z');
    expect(out.map((r) => r.is_active)).toEqual([true, true, false, false, false, false, false, false]);
    // Les liens visent les NOUVEAUX ids, dans la même requête.
    expect(out[2].opens_after_round_id).toBe(out[0].id);
    expect(out[7].opens_after_round_id).toBe(out[5].id);
    expect(new Set(out.map((r) => r.id)).size).toBe(8);
    expect(out.reduce((a, r) => a + r.max_tickets, 0)).toBe(300);
    expect(out.map((r) => r.entry_deadline)).toEqual(['01:00:00', null, '01:00:00', null, '01:00:00', null, '01:00:00', null]);
  });

  it('un lien vers une clé inconnue ne lie rien et ne met pas en vente', () => {
    const out = freePresetToRoundRows([{ name: 'X', price: 1, maxTickets: 10, includesDrink: false, display: 'now', sale: 'manual', key: 'a', opensAfter: 'zz' }], 'e', '2026-10-24T21:00:00Z');
    expect(out[0]).toMatchObject({ opens_after_round_id: null, is_active: false });
  });

  it('un vieux lecteur verrait « plus tard », jamais « en vente »', () => {
    expect(normalizeFreePreset([{ name: 'A', sale: 'after', opensAfter: 'k' }])[0]).toMatchObject({ sale: 'manual', opensAfter: 'k' });
  });
});

describe('visibilité des billets « après un billet » (réglage de la soirée)', () => {
  const waiting = { isActive: false, opensAfterRoundId: 'r0', ticketsSold: 0, maxTickets: 25 };
  it('aperçu par défaut : Bientôt', () => {
    expect(ticketPhase(waiting, NOW)).toBe('upcoming');
    expect(ticketPhase(waiting, NOW, 'preview')).toBe('upcoming');
  });
  it('masqué jusqu’à son tour', () => {
    expect(ticketPhase(waiting, NOW, 'hidden')).toBe('hidden');
  });
  it('tous achetables maintenant, sauf une date de vente encore à venir', () => {
    expect(ticketPhase(waiting, NOW, 'open')).toBe('on_sale');
    expect(ticketPhase({ ...waiting, saleStartsAt: after }, NOW, 'open')).toBe('upcoming');
  });
  it('un billet épuisé n’attend plus : jamais masqué ni rouvert par le réglage', () => {
    const sold = { ...waiting, ticketsSold: 25 };
    expect(ticketPhase(sold, NOW, 'hidden')).toBe('upcoming');
    expect(ticketPhase({ ...waiting, manuallySoldOut: true }, NOW, 'open')).toBe('upcoming');
  });
  it('un billet fermé à la main (sans lien) reste fermé', () => {
    expect(ticketPhase({ isActive: false }, NOW, 'open')).toBe('upcoming');
    expect(ticketPhase({ isActive: false }, NOW, 'hidden')).toBe('upcoming');
  });
  it('ligne brute (checkout) : même règle', () => {
    const row = { is_active: false, opens_after_round_id: 'r0', tickets_sold: 0, max_tickets: 25 };
    expect(rowPhase(row, NOW, 'open')).toBe('on_sale');
    expect(rowPhase(row, NOW, 'hidden')).toBe('hidden');
    expect(rowPhase(row, NOW)).toBe('upcoming');
  });
});
