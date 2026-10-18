import { describe, expect, it } from 'vitest';
import { dropBlocksOutsideScope } from '../../../supabase/functions/_shared/email-block-scope';

// Audit du 18/10, MAIL-14 : un bloc lié à une soirée hors de l'espace ne part pas.
const LIVE = new Set(['event', 'tickets', 'guestlist', 'table', 'countdown', 'lineup']);
const isLive = <B extends { type: string }>(b: B) => LIVE.has(b.type);
const MINE = 'e-mine';
const OTHER = 'e-other';

describe('dropBlocksOutsideScope', () => {
  it('garde les blocs de ses soirées, retire ceux d’une autre', () => {
    const blocks = [
      { id: '1', type: 'text' },
      { id: '2', type: 'event', eventId: MINE },
      { id: '3', type: 'tickets', eventId: OTHER },
      { id: '4', type: 'lineup' }, // hérite de la soirée de la campagne
    ];
    const r = dropBlocksOutsideScope(blocks, MINE, new Set([MINE]), isLive);
    expect(r.blocks.map((b) => b.id)).toEqual(['1', '2', '4']);
    expect(r.dropped).toBe(1);
    expect(r.eventId).toBe(MINE);
  });

  it('campagne reliée à une soirée d’un autre compte : ses blocs hérités partent aussi, la soirée est oubliée', () => {
    const blocks = [{ id: '1', type: 'event' }, { id: '2', type: 'countdown', eventId: MINE }, { id: '3', type: 'cta' }];
    const r = dropBlocksOutsideScope(blocks, OTHER, new Set([MINE]), isLive);
    expect(r.blocks.map((b) => b.id)).toEqual(['2', '3']);
    expect(r.eventId).toBeNull();
  });

  it('sans soirée du tout : rien ne bouge', () => {
    const blocks = [{ id: '1', type: 'tickets' }];
    expect(dropBlocksOutsideScope(blocks, null, new Set(), isLive).blocks).toHaveLength(1);
  });
});
