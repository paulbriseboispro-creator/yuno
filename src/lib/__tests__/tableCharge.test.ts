import { describe, expect, it } from 'vitest';
import { chargedCents, tableCharge } from '../../../supabase/functions/_shared/table-charge.ts';

describe('tableCharge — ce que la session Stripe prélève', () => {
  it('acompte + frais de gestion, en centimes exacts', () => {
    const c = tableCharge(140, 5.6);
    expect(c.lines).toEqual([{ kind: 'deposit', cents: 14000 }, { kind: 'fee', cents: 560 }]);
    expect(c.totalCents).toBe(14560);
    expect(c.totalEuros).toBe(145.6);
  });
  it('un acompte à plusieurs décimales est arrondi comme Stripe le reçoit', () => {
    const c = tableCharge(133.335, 5.33);
    expect(c.lines[0]).toEqual({ kind: 'deposit', cents: Math.round(133.335 * 100) });
    expect(c.totalCents).toBe(c.lines[0].cents + 533);
  });
  it('frais absorbés : la ligne est l\'estimation des frais Stripe', () => {
    const c = tableCharge(200, 3.31);
    expect(c.totalEuros).toBe(203.31);
  });
  it('sans acompte : les frais seuls, la ligne de frais reste', () => {
    expect(tableCharge(0, 1.2).lines).toEqual([{ kind: 'fee', cents: 120 }]);
  });
  it('chargedCents lit une catégorie, jamais NaN', () => {
    const c = tableCharge(140, 5.6);
    expect(chargedCents(c.lines, 'deposit')).toBe(14000);
    expect(chargedCents(c.lines, 'fee')).toBe(560);
    expect(chargedCents(null, 'fee')).toBe(0);
    expect(chargedCents([{ kind: 'fee', cents: 'x' }], 'fee')).toBe(0);
  });
});
