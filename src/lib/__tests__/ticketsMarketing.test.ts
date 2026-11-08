import { describe, expect, it } from 'vitest';
import { isTicketsMarketingPath, pruneTicketsMarketingNav } from '../ticketsMarketing';

describe('isTicketsMarketingPath', () => {
  it('reconnaît les pages marketing des trois Consoles', () => {
    for (const p of ['/owner/campaigns', '/owner/campaigns/automations', '/organizer-app/sms', '/owner/sms-campaigns',
      '/owner/push?tab=auto', '/organizer-app/promoters/finance', '/owner/djs?tab=djs', '/manager/promoters',
      '/owner/ads', '/organizer-app/scarcity', '/owner/clients/imports']) {
      expect(isTicketsMarketingPath(p)).toBe(true);
    }
  });
  it('garde la vente, la porte, les analyses et les clients', () => {
    for (const p of ['/owner/dashboard', '/owner/ticketing', '/organizer-app/guest-list?tab=events', '/owner/orders',
      '/organizer-app/checkin', '/owner/analyses/sales', '/owner/clients', '/owner/clients/segments', '/owner/promo-codes',
      '/organizer-app/smsx', '/organizer-app', '/crm/emails', undefined]) {
      expect(isTicketsMarketingPath(p)).toBe(false);
    }
  });
});

describe('pruneTicketsMarketingNav', () => {
  it('retire les entrées et sous-entrées, et le groupe vidé', () => {
    type Item = { path?: string; subItems?: Item[] };
    const out = pruneTicketsMarketingNav<Item, { label: string; items: Item[] }>([
      { label: 'a', items: [{ path: '/owner/ticketing', subItems: [{ path: '/owner/promo-codes' }, { path: '/owner/scarcity' }] }] },
      { label: 'b', items: [{ path: '/owner/campaigns' }, { path: '/owner/push' }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].items[0].subItems).toEqual([{ path: '/owner/promo-codes' }]);
  });
});
