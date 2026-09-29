import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { peopleOf, shareOf, attributionCoverage } from '@/lib/collabPartyBreakdown';

const z = { tickets: 0, tables: 0, table_guests: 0, guests: 0, entered: 0, revenue: null };

describe('qui fait vendre — mise en forme', () => {
  it('le public = billets + convives de table + inscrits (une table compte ses convives, pas 1)', () => {
    expect(peopleOf({ tickets: 46, table_guests: 13, guests: 27 })).toBe(86);
  });
  it('part du public amenée, arrondie ; rien tant que la soirée n’a personne', () => {
    const totals = { ...z, tickets: 40, table_guests: 10, guests: 50 };
    expect(shareOf({ ...z, tickets: 30, guests: 20 }, totals)).toBe(50);
    expect(shareOf({ ...z, tickets: 1 }, { ...z, tickets: 3 })).toBe(33);
    expect(shareOf({ ...z, tickets: 1 }, z)).toBeNull();
  });
  it('couverture : combien de personnes sont rattachées à un partenaire', () => {
    expect(attributionCoverage({ totals: { ...z, tickets: 46, table_guests: 13, guests: 27 }, unattributed: { ...z, tickets: 46, table_guests: 13 } }))
      .toEqual({ known: 27, total: 86 });
    expect(attributionCoverage({ totals: z, unattributed: z })).toEqual({ known: 0, total: 0 });
  });
});
