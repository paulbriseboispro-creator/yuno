import { describe, expect, it } from 'vitest';
import { LIFE_ORDER, accountStory, firstSaleMonth, last12Months, lifecycleCounts, monthlySeries, nightsByDay } from '../story';
import type { AccountRow } from '../accounts';
import type { EventRow, MonthRow } from '../data';

const row = (status: AccountRow['status'], extra: Partial<AccountRow> = {}): AccountRow => ({
  key: `venue:${status}`, type: 'club', ref: status, name: status, city: null, products: ['tickets'], status, hidden: false, is_demo: false,
  owner_id: null, owner_name: null, owner_email: null, owner_phone: null, created_at: '2026-01-01T00:00:00Z', last_login: null, last_seen: null,
  stripe_ready: false, sales_period: 0, sales_prev: 0, sales_30d: 0, sales_total: 0, revenue_period: 0, revenue_prev: 0, revenue_total: 0,
  last_sale_at: null, upcoming: 0, events_total: 0, crm: null, support: null, note: null, tags: [], ...extra,
});
const month = (m: string, tickets: number, rev = 0): MonthRow => ({ month: m, tickets, tickets_rev: rev, tables: 0, tables_rev: 0, guestlist: 0 });
const ev = (start: string, extra: Partial<EventRow> = {}): EventRow => ({
  id: start, title: 'Nuit', start_at: start, end_at: null, is_active: true, cancelled: false, slug: null, role: 'lead',
  tickets: 0, tables: 0, guestlist: 0, revenue: 0, ...extra,
});

describe('lifecycleCounts', () => {
  it('counts every stage, zero included, on an empty list', () => {
    const c = lifecycleCounts([]);
    expect(Object.keys(c).sort()).toEqual([...LIFE_ORDER].sort());
    expect(Object.values(c).every((v) => v === 0)).toBe(true);
  });
  it('counts by status', () => {
    const c = lifecycleCounts([row('selling'), row('selling'), row('at_risk')]);
    expect(c.selling).toBe(2);
    expect(c.at_risk).toBe(1);
    expect(c.invited).toBe(0);
  });
});

describe('firstSaleMonth', () => {
  it('is null without a sale (null, empty, all zero)', () => {
    expect(firstSaleMonth(null)).toBeNull();
    expect(firstSaleMonth([])).toBeNull();
    expect(firstSaleMonth([month('2026-03', 0)])).toBeNull();
  });
  it('picks the earliest month with a sale, whatever the order', () => {
    expect(firstSaleMonth([month('2026-06', 3), month('2026-04', 1), month('2026-02', 0)])).toBe('2026-04');
  });
});

describe('monthlySeries', () => {
  const now = new Date('2026-11-17T10:00:00Z');
  it('always gives 12 months ending this month', () => {
    const m = last12Months(now);
    expect(m).toHaveLength(12);
    expect(m[11]).toBe('2026-11');
    expect(m[0]).toBe('2025-12');
  });
  it('fills holes with zeros and sums tickets + tables', () => {
    const s = monthlySeries([{ month: '2026-10', tickets: 2, tickets_rev: 30, tables: 1, tables_rev: 100, guestlist: 4 }], now);
    expect(s).toHaveLength(12);
    expect(s.find((x) => x.month === '2026-10')).toMatchObject({ revenue: 130, sales: 3, guestlist: 4 });
    expect(s.filter((x) => x.revenue === 0)).toHaveLength(11);
    expect(monthlySeries(null, now).every((x) => x.revenue === 0)).toBe(true);
  });
});

describe('nightsByDay', () => {
  it('gives consecutive days, cancelled nights ignored', () => {
    const d = nightsByDay([ev('2026-11-14T22:00:00Z', { tickets: 3, guestlist: 2 }), ev('2026-11-15T22:00:00Z', { tickets: 9, cancelled: true })],
      new Date('2026-11-13T00:00:00Z'), new Date('2026-11-16T00:00:00Z'));
    expect(d.map((x) => x.d)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']);
    expect(d.map((x) => x.v)).toEqual([0, 5, 0, 0]);
  });
  it('stays bounded and empty-safe', () => {
    expect(nightsByDay([], new Date('2026-01-01'), new Date('2026-01-01'))).toHaveLength(1);
    expect(nightsByDay([], new Date('2020-01-01'), new Date('2030-01-01')).length).toBeLessThanOrEqual(800);
  });
});

describe('accountStory', () => {
  it('says nothing invented for an empty account', () => {
    const s = accountStory({ row: null, monthly: null, events: [], crm: null });
    expect(s).toMatchObject({ since: null, sales30: 0, upcoming: 0, crmState: null, trialEndsAt: null });
  });
  it('counts upcoming nights and keeps the CRM trial end', () => {
    const now = Date.parse('2026-11-17T00:00:00Z');
    const s = accountStory({
      row: row('selling', { sales_30d: 96, upcoming: 1, crm: { state: 'trial', mrr: 0, health: 70, balance: 0, trial_left: 2, sync: 'ok', paid: false, granted: false, frozen: false } }),
      monthly: [month('2026-05', 4)], events: [ev('2026-11-20T22:00:00Z'), ev('2026-11-27T22:00:00Z'), ev('2026-11-01T22:00:00Z')], crm: null,
    }, now);
    expect(s.since).toBe('2026-05');
    expect(s.sales30).toBe(96);
    expect(s.upcoming).toBe(2);
    expect(s.crmState).toBe('trial');
  });
});
