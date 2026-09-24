import { describe, expect, it } from 'vitest';
import {
  buildInsights, fmtLeadHours, heatmapMatrix, lastMinuteShare, peakSlot, ratio,
  type PurchaseBehavior,
} from '../purchaseBehavior';

const t = (k: string) => ({
  'pb.unit.lessHour': '< 1 h',
  'pb.unit.hours': '{n} h',
  'pb.unit.days': '{n} j',
  'pb.unit.weeks': '{n} sem.',
  'pb.ins.lead': 'lead {d}',
  'pb.ins.late': 'late {p}',
  'pb.ins.peak': 'peak {day} {h}',
  'pb.ins.repeat': 'repeat {p}',
  'pb.ins.top10': 'top10 {p}',
  'pb.ins.bar': 'bar {p}',
  'pb.day.4': 'vendredi',
} as Record<string, string>)[k] ?? k;

function base(): PurchaseBehavior {
  return {
    ok: true, tz: 'Europe/Paris', hasDrinks: true, from: '', to: '',
    summary: {
      transactions: 0, buyers: 0, amount: 0, avgBasket: 0, avgPerBuyer: 0, avgTxPerBuyer: 0,
      repeatBuyers: 0, newBuyers: 0, medianLeadHours: null, guestCheckouts: 0, guestlist: 0, guestlistScanned: 0,
    },
    pillars: [],
    leadTime: [],
    leadMedian: { tickets: null, tables: null },
    heatmap: [],
    nightDrinks: [],
    drinkRhythm: { drinkersPerNight: 0, avgOrdersPerNight: null, avgSpendPerNight: null, multiOrderShare: null, medianMinutesEntryToFirstDrink: null },
    groupSize: { tickets: [], avgTicketsPerOrder: null, tables: [], avgGuestsPerTable: null, avgPerHead: null, drinks: [], avgItemsPerOrder: null },
    basketBands: [],
    rounds: [],
    attach: {
      ticketOrders: 0, insurance: 0, bundledDrink: 0, bundledDrinkRedeemed: 0, upgrades: 0, loyaltyRewards: 0,
      optinBase: 0, newsletter: 0, sms: 0, tableOrders: 0, tableDeposit: 0, tableOnSite: 0,
    },
    loyalty: { frequency: [], medianDaysBetween: null, top10Share: null, newAmount: 0, returningAmount: 0 },
    crossSell: [],
    channels: [],
    trackedShare: null,
    funnel: {
      sessions: 0, carts: 0, checkouts: 0, orders: 0, abandonedCarts: 0, abandonedValue: 0,
      medianVisitAtPurchase: null, medianDurationBuyers: null, medianDurationOthers: null,
      newSessions: 0, newOrders: 0, returningSessions: 0, returningOrders: 0, devices: [], sources: [],
    },
    attendance: { nights: 0, ticketOrders: 0, ticketScanned: 0, tableOrders: 0, tableScanned: 0, guestlist: 0, guestlistScanned: 0, byLead: [] },
  };
}

describe('purchaseBehavior helpers', () => {
  it('ratio refuses an empty base', () => {
    expect(ratio(3, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });

  it('builds a Monday-first 7×24 matrix, per pillar or for all', () => {
    const rows: PurchaseBehavior['heatmap'] = [['tickets', 4, 18, 5], ['drinks', 4, 18, 2], ['tables', 0, 9, 1], ['tickets', 9, 30, 99]];
    const all = heatmapMatrix(rows, 'all');
    expect(all).toHaveLength(7);
    expect(all[0]).toHaveLength(24);
    expect(all[4][18]).toBe(7);
    expect(heatmapMatrix(rows, 'tickets')[4][18]).toBe(5);
    // Hors bornes : ignoré, jamais une exception.
    expect(all.flat().reduce((a, b) => a + b, 0)).toBe(8);
  });

  it('finds the busiest slot, or nothing on an empty matrix', () => {
    expect(peakSlot(heatmapMatrix([], 'all'))).toBeNull();
    expect(peakSlot(heatmapMatrix([['tickets', 5, 22, 3], ['tickets', 4, 18, 7]], 'all'))).toEqual({ day: 4, hour: 18, n: 7 });
  });

  it('counts the last 72 hours (after doors included) as last minute', () => {
    const lead: PurchaseBehavior['leadTime'] = [
      { bucket: 'd8_14', tickets: 5, tables: 2, ticketUnits: 5, amount: 0 },
      { bucket: 'd1_3', tickets: 3, tables: 0, ticketUnits: 3, amount: 0 },
      { bucket: 'h24', tickets: 1, tables: 0, ticketUnits: 1, amount: 0 },
      { bucket: 'after_start', tickets: 1, tables: 0, ticketUnits: 1, amount: 0 },
    ];
    expect(lastMinuteShare(lead, 'tickets')).toBe(0.5);
    expect(lastMinuteShare(lead, 'tables')).toBe(0);
    expect(lastMinuteShare([], 'tickets')).toBeNull();
  });

  it('formats a lead time in hours, days or weeks', () => {
    expect(fmtLeadHours(null, t)).toBe('—');
    expect(fmtLeadHours(0.4, t)).toBe('< 1 h');
    expect(fmtLeadHours(41, t)).toBe('41 h');
    expect(fmtLeadHours(24 * 6, t)).toBe('6 j');
    expect(fmtLeadHours(24 * 35, t)).toBe('5 sem.');
  });

  it('stays silent on a thin base', () => {
    const d = base();
    d.leadMedian.tickets = 30;
    d.leadTime = [{ bucket: 'h24', tickets: 3, tables: 0, ticketUnits: 3, amount: 0 }];
    d.summary.buyers = 4;
    d.summary.repeatBuyers = 2;
    expect(buildInsights(d, t, 'fr')).toEqual([]);
  });

  it('writes at most four takeaways from a real base', () => {
    const d = base();
    d.leadMedian.tickets = 41;
    d.leadTime = [
      { bucket: 'd8_14', tickets: 4, tables: 0, ticketUnits: 4, amount: 0 },
      { bucket: 'h24', tickets: 16, tables: 0, ticketUnits: 16, amount: 0 },
    ];
    d.heatmap = [['tickets', 4, 18, 9], ['drinks', 5, 1, 50]];
    d.summary.buyers = 40;
    d.summary.repeatBuyers = 10;
    d.loyalty.top10Share = 0.5;
    const ins = buildInsights(d, t, 'fr');
    expect(ins).toHaveLength(4);
    expect(ins[0].text).toBe('lead 41 h');
    expect(ins[1].key).toBe('late');
    // Le pic ignore les boissons : on commande au bar la nuit, on n'y « achète » pas sa soirée.
    expect(ins[2].text).toBe('peak vendredi 18');
    expect(ins[3].key).toBe('repeat');
  });
});
