import { describe, expect, it } from 'vitest';
import { daysUntil, familyCounts, groupByUrgency, mergeFeed, visibleItems, type CrmFeedItem, type SuiteFeedItem, type TodayItem } from '../today/queue';
import { lightsOf } from '../today/health';
import type { CockpitHealth } from '../today/data';

function item(p: Partial<TodayItem>): TodayItem {
  return {
    family: 'signup', kind: 'signup_blocked', key: Math.random().toString(36), name: 'X', subject_kind: null, subject_id: null,
    detail: null, at: null, due_at: null, urgency: 2, href: '/admin', params: null, mark: null, ...p,
  };
}

describe('today queue', () => {
  const items = [
    item({ key: 'a', urgency: 1, family: 'sync' }),
    item({ key: 'b', urgency: 3, family: 'alert' }),
    item({ key: 'c', urgency: 1, family: 'signup', mark: { status: 'snoozed', until: '2099-01-01', at: '2026-01-01', reason: null } }),
    item({ key: 'd', urgency: 2, family: 'signup' }),
  ];

  it('hides handled and postponed lines unless asked', () => {
    expect(visibleItems(items, 'all', false).map((i) => i.key)).toEqual(['a', 'b', 'd']);
    expect(visibleItems(items, 'all', true)).toHaveLength(4);
    expect(visibleItems(items, 'signup', false).map((i) => i.key)).toEqual(['d']);
  });

  it('groups by urgency, most urgent first, without empty groups', () => {
    const g = groupByUrgency(visibleItems(items, 'all', false));
    expect(g.map((x) => x.urgency)).toEqual([1, 2, 3]);
    expect(groupByUrgency([items[1]]).map((x) => x.urgency)).toEqual([3]);
  });

  it('counts open lines per family, in the canonical order', () => {
    expect(familyCounts(items)).toEqual([{ family: 'signup', n: 1 }, { family: 'sync', n: 1 }, { family: 'alert', n: 1 }]);
  });

  it('days until a date', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    expect(daysUntil('2026-11-18T12:00:00Z', now)).toBe(2);
    expect(daysUntil('2026-11-15T12:00:00Z', now)).toBe(-1);
    expect(daysUntil(null, now)).toBeNull();
  });
});

describe('unified activity feed', () => {
  const suite: SuiteFeedItem[] = [
    { at: '2026-11-16T20:00:00+00:00', kind: 'ticket', title: 'A', subtitle: 'Night', actor: null, amount: 10, ref_type: 'event', ref_id: 'e1' },
    { at: '2026-11-16T19:00:00+00:00', kind: 'order', title: 'Drink', subtitle: null, actor: null, amount: 8, ref_type: null, ref_id: null },
    { at: '2026-11-16T18:00:00+00:00', kind: 'venue', title: 'Club', subtitle: null, actor: null, amount: null, ref_type: 'venue', ref_id: 'v1' },
  ];
  const crm: CrmFeedItem[] = [
    { at: '2026-11-16T19:30:00+00:00', k: 'fail', tag: 'error', who: '3 AM', id: 'org:1', meta: { error: 'boom' } },
    { at: '2026-11-10T08:00:00+00:00', k: 'send', tag: 'first_send', who: '3 AM', id: 'org:1', meta: { name: 'Guest list' } },
  ];

  it('merges both sources newest first and never shows the paused drinks pillar', () => {
    const rows = mergeFeed(suite, crm, true);
    expect(rows.map((r) => r.kind)).toEqual(['ticket', 'crm_fail', 'venue', 'crm_send']);
    expect(rows.find((r) => r.kind === 'crm_fail')?.sub).toBe('boom');
    expect(rows[0].href).toContain('/admin/clients/events');
  });

  it('holds back CRM lines older than the loaded Tickets page until the next page', () => {
    expect(mergeFeed(suite, crm, false).map((r) => r.kind)).not.toContain('crm_send');
  });

  it('filters by family', () => {
    expect(mergeFeed(suite, crm, true, 'crm').map((r) => r.kind)).toEqual(['crm_fail', 'crm_send']);
    expect(mergeFeed(suite, crm, true, 'sales').map((r) => r.kind)).toEqual(['ticket']);
  });
});

describe('health lights', () => {
  const t = (k: string) => k;
  const base: CockpitHealth = {
    urgent_alerts: 0, crons_total: 40, app_crashes_7d: 0, ota_download_fail_7d: 0, ai_errors_24h: 0,
    maintenance_mode: false, payments_disabled: false,
    email_quota: { used: 100, free: 40000, credits: 0, remaining: 39900, day_used: 0, day_cap: 25000 },
  };

  it('all green on a quiet day', () => {
    expect(lightsOf(base, t, 'fr').map((l) => l.tone)).toEqual(['positive', 'positive', 'neutral', 'positive']);
  });

  it('turns red on switched-off payments, a full pool and many crashes', () => {
    const l = lightsOf({ ...base, payments_disabled: true, app_crashes_7d: 30, email_quota: { ...base.email_quota!, used: 39000 } }, t, 'fr');
    expect(l.map((x) => x.tone)).toEqual(['negative', 'negative', 'neutral', 'negative']);
  });

  it('warns on maintenance and an unknown quota stays neutral', () => {
    const l = lightsOf({ ...base, maintenance_mode: true, email_quota: null, app_crashes_7d: 2 }, t, 'fr');
    expect(l.map((x) => x.tone)).toEqual(['warning', 'neutral', 'neutral', 'warning']);
  });
});
