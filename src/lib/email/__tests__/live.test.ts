// « Complet » posé à la main : l'email doit dire ce que la page dit.
import { describe, expect, it } from 'vitest';
import {
  applyTicketsSoldOut, buildGuestListLive, guestListSummary, isGuestListClosed, LIVE_OPEN, liveSoldOut,
  openTablePacks, tablesLeftFor, type LiveSoldOut,
} from '../live';

const closedTables: LiveSoldOut = { ...LIVE_OPEN, tablesSoldOut: true };

describe('liveSoldOut', () => {
  it('lit les drapeaux snake_case sans jamais lever', () => {
    expect(liveSoldOut(null)).toEqual(LIVE_OPEN);
    expect(liveSoldOut({})).toEqual(LIVE_OPEN);
    expect(liveSoldOut({ tickets_sold_out: true, sold_out_pack_ids: ['a', 'b'] })).toEqual({
      ticketsSoldOut: true, tablesSoldOut: false, guestListSoldOut: false, soldOutPackIds: ['a', 'b'],
    });
  });
});

describe('applyTicketsSoldOut', () => {
  const rows = [{ n: 'Early', s: '', p: '10 €', out: false }, { n: 'Regular', s: '', p: '15 €', out: false }];
  it('laisse les tranches telles quelles quand la billetterie est ouverte', () => {
    expect(applyTicketsSoldOut(rows, LIVE_OPEN)).toEqual(rows);
  });
  it('marque chaque tranche épuisée quand la billetterie est fermée à la main', () => {
    expect(applyTicketsSoldOut(rows, { ...LIVE_OPEN, ticketsSoldOut: true }).every((r) => r.out)).toBe(true);
  });
});

describe('openTablePacks + tablesLeftFor', () => {
  const packs = [{ id: 'p1', tables_count: 4 }, { id: 'p2', tables_count: 2 }, { id: null, tables_count: 1 }];
  it('retire les formules nommées complètes pour la soirée (miroir de _event_tables_left)', () => {
    const open = openTablePacks(packs, { ...LIVE_OPEN, soldOutPackIds: ['p2'] });
    expect(open.map((p) => p.id)).toEqual(['p1', null]);
  });
  it('stock = formules ouvertes moins réservations, jamais négatif', () => {
    expect(tablesLeftFor(6, 2, LIVE_OPEN)).toBe(4);
    expect(tablesLeftFor(6, 9, LIVE_OPEN)).toBe(0);
  });
  it('aucune formule ouverte ⇒ null (le bloc s’efface plutôt que de vendre du vide)', () => {
    expect(tablesLeftFor(0, 0, LIVE_OPEN)).toBeNull();
  });
  it('soirée fermée à la main ⇒ 0, quel que soit le stock', () => {
    expect(tablesLeftFor(21, 0, closedTables)).toBe(0);
    expect(tablesLeftFor(0, 0, closedTables)).toBe(0);
  });
});

describe('buildGuestListLive', () => {
  const part = { id: 'gl', free_before_time: '00:30:00', includes_drink: true, quota: 100, show_remaining: true };
  it('places restantes seulement si le pro les affiche', () => {
    expect(buildGuestListLive(part, 40)!.remaining).toBe(60);
    expect(buildGuestListLive({ ...part, show_remaining: false }, 40)!.remaining).toBeNull();
  });
  it('quota atteint ⇒ complet', () => {
    const gl = buildGuestListLive(part, 100)!;
    expect(isGuestListClosed(gl)).toBe(true);
    expect(guestListSummary(gl)).toBe('Gratuit avant 00:30 · boisson offerte · complet');
  });
  it('fermée à la main (soirée entière ou cette part) ⇒ complet, même sans quota affiché', () => {
    const byEvent = buildGuestListLive({ ...part, show_remaining: false }, 0, { ...LIVE_OPEN, guestListSoldOut: true })!;
    expect(isGuestListClosed(byEvent)).toBe(true);
    expect(byEvent.remaining).toBe(0);
    const byPart = buildGuestListLive({ ...part, show_remaining: false, manually_sold_out: true }, 0)!;
    expect(isGuestListClosed(byPart)).toBe(true);
    expect(guestListSummary(byPart)).toContain('complet');
  });
  it('ouverte ⇒ pas de mention complet', () => {
    const gl = buildGuestListLive(part, 10)!;
    expect(isGuestListClosed(gl)).toBe(false);
    expect(guestListSummary(gl)).toBe('Gratuit avant 00:30 · boisson offerte · 90 places restantes');
  });
});
