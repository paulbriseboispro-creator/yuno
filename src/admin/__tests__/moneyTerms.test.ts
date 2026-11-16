import { describe, expect, it } from 'vitest';
import {
  BANNED_MONEY_WORDS, COST_ITEMS, MONEY_SOURCES, MONEY_TERMS, margin, moneyHintKey, moneyLabelKey, monthCosts, takeRate, topShare, yunoRevenue,
} from '../money/terms';
import { orderHref, parseOpen } from '../money/orderLink';
import { issueLink } from '../money/issueLinks';
import { toCsv } from '../money/csv';
import money from '@/i18n/locales/admin/modules/money';
import pilotage from '@/i18n/locales/admin/modules/pilotage';

describe('money vocabulary', () => {
  it('gives every term a source, a label and a hint in three languages', () => {
    for (const term of MONEY_TERMS) {
      expect(MONEY_SOURCES[term], term).toBeTruthy();
      for (const key of [moneyLabelKey(term), moneyHintKey(term)]) {
        const v = money[key];
        expect(v, key).toBeDefined();
        expect(v.every((s) => s.trim().length > 0), key).toBe(true);
      }
    }
    for (const item of COST_ITEMS) expect(money[`adm.mon.cost.item.${item}`], item).toBeDefined();
  });

  it('never uses the old money words nor an em dash', () => {
    for (const dict of [money, pilotage]) {
      for (const [key, triple] of Object.entries(dict)) {
        for (const text of triple) {
          expect(text.includes('—'), key).toBe(false);
          for (const w of BANNED_MONEY_WORDS) expect(text.includes(w), `${key}: ${w}`).toBe(false);
        }
      }
    }
  });

  it('adds the three parts of Yuno revenue', () => {
    expect(yunoRevenue({ fees: 497.28, subs: 24, recharges: 10.005 })).toBe(531.29);
    expect(yunoRevenue(null)).toBe(0);
    expect(yunoRevenue({ fees: 3 })).toBe(3);
  });

  it('computes the commission rate only with sales', () => {
    expect(takeRate(497.28, 7330.28)).toBeCloseTo(0.0678, 4);
    expect(takeRate(10, 0)).toBeNull();
  });

  it('counts AI automatically only when no line was entered', () => {
    expect(monthCosts([{ item: 'resend', amount: 20 }], 1.5)).toEqual({ total: 21.5, aiFromAuto: true });
    expect(monthCosts([{ item: 'resend', amount: 20 }, { item: 'ai', amount: 3 }], 1.5)).toEqual({ total: 23, aiFromAuto: false });
    expect(margin(100, 23.5)).toBe(76.5);
  });

  it('shows no concentration percentage under 10 pros', () => {
    expect(topShare(80, 100, 4)).toBeNull();
    expect(topShare(80, 100, 12)).toBe(0.8);
    expect(topShare(0, 0, 20)).toBeNull();
  });
});

describe('order links', () => {
  it('round-trips an order address', () => {
    expect(orderHref('ticket', 'abc')).toBe('/admin/money/orders?tab=tickets&open=ticket:abc');
    expect(orderHref('table', 'r 1')).toBe('/admin/money/orders?tab=tables&open=table:r%201');
    expect(parseOpen('table:r%201')).toEqual({ type: 'table', id: 'r 1' });
    expect(parseOpen('order:x')).toBeNull();
    expect(parseOpen('ticket:')).toBeNull();
    expect(parseOpen(null)).toBeNull();
  });

  it('sends a money alert to its sale, else its night', () => {
    expect(issueLink({ reference_type: 'ticket', reference_id: 't1', event_id: 'e1' })).toBe(orderHref('ticket', 't1'));
    expect(issueLink({ reference_type: 'table_reservation', reference_id: 'r1', event_id: null })).toBe(orderHref('table', 'r1'));
    expect(issueLink({ reference_type: null, reference_id: null, event_id: 'e1' })).toBe('/admin/clients/events?q=e1');
    expect(issueLink({ reference_type: null, reference_id: null, event_id: null })).toBeNull();
  });
});

describe('csv', () => {
  it('escapes separators and quotes, with a BOM', () => {
    expect(toCsv([['a;b', 'x"y', 3, null]])).toBe('﻿"a;b";"x""y";3;');
  });
});
