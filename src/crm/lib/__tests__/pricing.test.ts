import { describe, expect, it } from 'vitest';
import { estimateMonth, fromSlider, rechargeExamples, snapEmails, snapSms, toSlider } from '@/crm/lib/pricing';

const cfg = { rates: { email: 1, sms: 35 }, monthly_yunits: 10_000, price_month: 24 };

describe('page Tarifs : simulateur', () => {
  it('reste dans les Yunits offerts : pas de recharge', () => {
    const e = estimateMonth(4_000, 0, cfg);
    expect(e).toMatchObject({ used: 4_000, included: 4_000, need: 0, recharge: null, rechargeEur: 0, total: 24 });
  });

  it('prend la plus petite recharge vendue qui couvre le mois', () => {
    // 45 000 e-mails + 300 SMS = 55 500 Yunits ; 45 500 à acheter ; 45 000 + 10 % = 49 500.
    const e = estimateMonth(45_000, 300, cfg);
    expect(e.used).toBe(55_500);
    expect(e.need).toBe(45_500);
    expect(e.recharge).toMatchObject({ base: 45_000, bonusPct: 10, received: 49_500 });
    expect(e.rechargeEur).toBe(90);
    expect(e.left).toBe(4_000);
    expect(e.total).toBe(114);
  });

  it('suit le prix et les tarifs de la base', () => {
    const e = estimateMonth(10_000, 100, { rates: { email: 1, sms: 50 }, monthly_yunits: 5_000, price_month: 24 });
    expect(e.used).toBe(15_000);
    expect(e.recharge?.base).toBe(10_000);
    expect(e.total).toBe(44);
  });

  it('montre de vraies recharges de la page Yunits, bonus compris', () => {
    expect(rechargeExamples().map((q) => [q.base, q.received, q.amountCents / 100])).toEqual([
      [5_000, 5_000, 10], [10_000, 10_000, 20], [25_000, 27_500, 50], [50_000, 57_500, 100],
    ]);
  });

  it('arrondit les curseurs à un pas lisible', () => {
    expect(snapEmails(4_130)).toBe(4_250);
    expect(snapEmails(47_400)).toBe(47_000);
    expect(snapEmails(999_999)).toBe(200_000);
    expect(snapSms(187)).toBe(190);
    expect(snapSms(1_234)).toBe(1_200);
    expect(fromSlider(toSlider(45_000, 200_000), 200_000)).toBeCloseTo(45_000, -3);
    expect(toSlider(0, 3_000)).toBe(0);
    expect(toSlider(3_000, 3_000)).toBe(1000);
  });
});
