import { describe, expect, it } from 'vitest';
import { currentAdminHref, legacyAdminTarget, safeAdminNext } from '../redirects';
import { ADMIN_NAV, activeEntry, entryMatches } from '../nav';
import { searchResultHref } from '../shell/searchHref';

/**
 * Chaque ancienne adresse des deux admins (routes d'App.tsx avant la refonte,
 * redirections déjà en place, liens des alertes) et sa nouvelle place.
 */
const TABLE: Array<[string, string]> = [
  // Suite : routes montées
  ['/admin/growth', '/admin/pilot/audience'],
  ['/admin/signups', '/admin/pilot/signups'],
  ['/admin/revenue', '/admin/money'],
  ['/admin/product', '/admin/pilot/product'],
  ['/admin/ai', '/admin/pilot/product?tab=ai'],
  ['/admin/customers', '/admin/clients'],
  ['/admin/links', '/admin/comms/links'],
  ['/admin/venues', '/admin/pros/venues'],
  ['/admin/venues/club-123', '/admin/pros/venues/club-123'],
  ['/admin/organizers', '/admin/pros/organizers'],
  ['/admin/agencies', '/admin/pros/agencies'],
  ['/admin/events', '/admin/clients/events'],
  ['/admin/people', '/admin/clients/people'],
  ['/admin/people/6f1c0e2a-0000-4000-8000-000000000001', '/admin/clients/people/6f1c0e2a-0000-4000-8000-000000000001'],
  ['/admin/orders', '/admin/money/orders'],
  ['/admin/demo-access', '/admin/pros/demo'],
  ['/admin/support', '/admin/pros/support'],
  ['/admin/marketing', '/admin/comms'],
  ['/admin/marketing/email/new', '/admin/comms/email/new'],
  ['/admin/marketing/email/abc/edit', '/admin/comms/email/abc/edit'],
  ['/admin/marketing/email/abc/report', '/admin/comms/email/abc/report'],
  ['/admin/marketing/email/templates/t1', '/admin/comms/email/templates/t1'],
  ['/admin/marketing/automations', '/admin/comms/automations'],
  ['/admin/marketing/sms', '/admin/comms/sms'],
  ['/admin/marketing/sms/s1', '/admin/comms/sms/s1'],
  ['/admin/push', '/admin/comms/push'],
  ['/admin/notifications', '/admin/comms/engine'],
  ['/admin/feedback', '/admin/today/feedback'],
  ['/admin/alerts', '/admin/today/alerts'],
  ['/admin/audit', '/admin/legal/audit'],
  ['/admin/drinks', '/admin/system/drinks'],
  ['/admin/subscriptions', '/admin/money/subscriptions'],
  // Suite : redirections déjà en place avant la refonte
  ['/admin/analytics', '/admin/money'],
  ['/admin/accounting', '/admin/money'],
  ['/admin/traffic', '/admin/pilot/audience'],
  ['/admin/segmentation', '/admin/clients'],
  ['/admin/directory', '/admin/clients/people'],
  ['/admin/directory/user/u1', '/admin/clients/people/u1'],
  ['/admin/directory/venue/v1', '/admin/pros/venues/v1'],
  ['/admin/affiliates', '/admin/pros/agencies'],
  ['/admin/emails', '/admin/comms'],
  // Admin CRM
  ['/admin/crm', '/admin/pilot'],
  ['/admin/crm/login', '/admin/login'],
  ['/admin/crm/clients', '/admin/pros/crm'],
  ['/admin/crm/clients/org:abc', '/admin/pros/crm/org:abc'],
  ['/admin/crm/sales', '/admin/pros/sales'],
  ['/admin/crm/invite', '/admin/pros/invite'],
  ['/admin/crm/demo', '/admin/pros/crm-demo'],
  ['/admin/crm/support', '/admin/pros/crm-support'],
  ['/admin/crm/acquisition', '/admin/pilot/acquisition'],
  ['/admin/crm/product', '/admin/pilot/product?tab=crm'],
  ['/admin/crm/money', '/admin/money/crm'],
  ['/admin/crm/platform', '/admin/system/crm'],
  ['/admin/crm/platform/plan/venue:v1/e1', '/admin/system/crm/plan/venue:v1/e1'],
  ['/admin/crm/legal', '/admin/legal'],
  ['/admin/crm/settings', '/admin/system/settings'],
  ['/admin/crm/whatever', '/admin'],
];

/** Pages de détail montées par les rubriques (hors menu, sous une entrée). */
const DETAIL = [/^\/admin\/pros\/venues\/[^/]+$/, /^\/admin\/clients\/people\/[^/]+$/, /^\/admin\/pros\/crm\/[^/]+$/, /^\/admin\/comms\/email\//, /^\/admin\/comms\/sms\/[^/]+$/, /^\/admin\/system\/crm\/plan\//, /^\/admin\/system\/drinks$/, /^\/admin\/login$/];

describe('legacyAdminTarget', () => {
  it.each(TABLE)('%s → %s', (from, to) => {
    expect(legacyAdminTarget(from)).toBe(to);
    expect(legacyAdminTarget(`${from}/`)).toBe(to);
  });

  it('lands every old address on a page of the new menu', () => {
    for (const [, to] of TABLE) {
      const { entry } = activeEntry(to.split('?')[0]);
      const known = !!entry || DETAIL.some((re) => re.test(to)) || to.split('?')[0] === '/admin';
      expect(known, to).toBe(true);
    }
  });

  it('keeps the query and the anchor, the original query winning', () => {
    expect(legacyAdminTarget('/admin/alerts', '', '#coorg')).toBe('/admin/today/alerts#coorg');
    expect(legacyAdminTarget('/admin/events', '?q=e1')).toBe('/admin/clients/events?q=e1');
    expect(legacyAdminTarget('/admin/notifications', '?tab=credits&name=x')).toBe('/admin/comms/engine?tab=credits&name=x');
    expect(legacyAdminTarget('/admin/waitlist')).toBe('/admin/comms/links?tab=waitlist');
    expect(legacyAdminTarget('/admin/waitlist', '?tab=leads')).toBe('/admin/comms/links?tab=leads');
    expect(legacyAdminTarget('/admin/crm', '?tab=activity')).toBe('/admin/pilot?tab=activity');
    expect(legacyAdminTarget('/admin/crm/login', '?next=%2Fadmin%2Fcrm%2Fsupport&step=code'))
      .toBe('/admin/login?next=%2Fadmin%2Fcrm%2Fsupport&step=code');
  });

  it('leaves new addresses alone', () => {
    for (const r of ADMIN_NAV) for (const e of r.entries) expect(legacyAdminTarget(e.path), e.path).toBeNull();
    expect(legacyAdminTarget('/admin/pros/crm/org:abc')).toBeNull();
    expect(legacyAdminTarget('/admin/system')).toBeNull();
  });
});

describe('currentAdminHref (liens des alertes déjà émises)', () => {
  it('rewrites a full old link and keeps anything else', () => {
    expect(currentAdminHref('/admin/venues/v1')).toBe('/admin/pros/venues/v1');
    expect(currentAdminHref('/admin/alerts#coorg')).toBe('/admin/today/alerts#coorg');
    expect(currentAdminHref('/admin/crm/clients?open=org%3Aabc')).toBe('/admin/pros/crm?open=org%3Aabc');
    expect(currentAdminHref('/admin/crm/platform?tab=day')).toBe('/admin/system/crm?tab=day');
    expect(currentAdminHref('/admin/system')).toBe('/admin/system');
    expect(currentAdminHref('/owner/dashboard')).toBe('/owner/dashboard');
  });
});

describe('safeAdminNext', () => {
  it('only accepts an admin address that is not the sign-in', () => {
    expect(safeAdminNext('/admin/pros/crm')).toBe('/admin/pros/crm');
    expect(safeAdminNext('/admin/crm/support')).toBe('/admin/crm/support');
    expect(safeAdminNext(null)).toBe('/admin');
    expect(safeAdminNext('https://evil.example/admin')).toBe('/admin');
    expect(safeAdminNext('//evil.example')).toBe('/admin');
    expect(safeAdminNext('/admin//evil.example')).toBe('/admin');
    expect(safeAdminNext('/admin/login?next=x')).toBe('/admin');
    expect(safeAdminNext('/admin/crm/login')).toBe('/admin');
  });
});

describe('nav entries', () => {
  it('match their own address only once per rubric', () => {
    for (const r of ADMIN_NAV) {
      for (const e of r.entries) {
        expect(activeEntry(e.path).rubric.id, e.path).toBe(r.id);
        expect(activeEntry(e.path).entry?.path, e.path).toBe(e.path);
        expect(entryMatches(e, e.path)).toBe(true);
      }
    }
  });

  it('lights the most specific entry', () => {
    expect(activeEntry('/admin/pros/crm-demo').entry?.key).toBe('crmDemo');
    expect(activeEntry('/admin/pros/crm/org:1').entry?.key).toBe('crmAccounts');
    expect(activeEntry('/admin/comms/email/abc/edit').entry?.key).toBe('marketing');
    expect(activeEntry('/admin').rubric.id).toBe('today');
    expect(activeEntry('/admin/today/alerts').entry?.key).toBe('alerts');
  });
});

describe('search result links', () => {
  const row = (kind: Parameters<typeof searchResultHref>[0]['kind'], id: string) => ({ kind, id, label: 'x', sub: null, ref: null, at: null });
  it('opens the matching page of the new admin', () => {
    expect(searchResultHref(row('venue', 'club-1'))).toBe('/admin/pros/venues/club-1');
    expect(searchResultHref(row('crm', 'org:abc'))).toBe('/admin/pros/crm/org%3Aabc');
    expect(searchResultHref(row('person', 'u1'))).toBe('/admin/clients/people/u1');
    expect(searchResultHref(row('event', 'e1'))).toBe('/admin/clients/events?q=e1');
    expect(searchResultHref(row('ticket', 't1'))).toBe('/admin/money/orders?tab=tickets&open=ticket:t1');
    expect(searchResultHref(row('table', 'r1'))).toBe('/admin/money/orders?tab=tables&open=table:r1');
  });
});
