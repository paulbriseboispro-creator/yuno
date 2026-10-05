import { describe, expect, it } from 'vitest';
import {
  LINK_KINDS, bestLink, buildGoDestination, findKind, goDisplay, goUrl, groupSources, linkConversion,
  linkState, nextIndex, reusableLink, saleSourceText, sourceKind, type NightLink,
} from '../links';

const link = (o: Partial<NightLink>): NightLink => ({
  id: 'l', code: 'abcd1234', label: 'Story 1', platform: 'instagram', placement: 'story', source: 'yuno-abcd1234',
  created_at: '2026-10-05T10:00:00Z', archived: false, clicks: 0, visitors: 0, clicks_24h: 0, last_click_at: null,
  mobile_pct: null, spark: [], tickets: 0, orders: 0, revenue: 0, buyers: 0, new_buyers: 0, first_sale_at: null, people: [],
  ...o,
});

describe('liens de soirée', () => {
  it('le catalogue est le miroir de _crm_link_kind_ok (15 paires, sans doublon)', () => {
    expect(LINK_KINDS).toHaveLength(15);
    expect(new Set(LINK_KINDS.map((k) => `${k.platform}.${k.placement}`)).size).toBe(15);
    expect(findKind('instagram', 'story')?.perPost).toBe(true);
    expect(findKind('instagram', 'bio')?.perPost).toBe(false);
    expect(findKind('instagram', 'flyer')).toBeNull();
  });

  it('numérote les stories et réutilise la bio', () => {
    const story = findKind('instagram', 'story')!;
    const bio = findKind('instagram', 'bio')!;
    const links = [link({ id: 'a' }), link({ id: 'b' }), link({ id: 'c', placement: 'bio' })];
    expect(nextIndex(links, story)).toBe(3);
    expect(reusableLink(links, bio)?.id).toBe('c');
    expect(reusableLink(links, story)).toBeNull();
    expect(reusableLink([link({ placement: 'bio', archived: true })], bio)).toBeNull();
  });

  it('construit l’URL courte et la destination Shotgun', () => {
    expect(goUrl('https://yunoapp.eu/', 'k5s54beg')).toBe('https://yunoapp.eu/go/k5s54beg');
    expect(goDisplay('https://yunoapp.eu', 'k5s54beg')).toBe('yunoapp.eu/go/k5s54beg');
    const d = new URL(buildGoDestination({ url: 'https://shotgun.live/events/x', source: 'yuno-k5s54beg', medium: 'story' })!);
    expect(d.searchParams.get('utm_source')).toBe('yuno-k5s54beg');
    expect(buildGoDestination({ url: 'http://x.fr', source: 'yuno-a' })).toBeNull();
  });

  it('range chaque source Shotgun dans sa famille', () => {
    expect(sourceKind('yuno-k5s54beg')).toBe('link');
    expect(sourceKind('yuno-m-1a2b3c4d')).toBe('email');
    expect(sourceKind('yuno')).toBe('email');
    expect(sourceKind('yuno-s-1a2b3c4d')).toBe('sms');
    expect(sourceKind('shotgun')).toBe('shotgun');
    expect(sourceKind('direct')).toBe('direct');
    expect(sourceKind('Instagram')).toBe('social');
    expect(sourceKind('linktr.ee')).toBe('site');
    expect(sourceKind(null)).toBe('offline');
    expect(sourceKind('')).toBe('offline');
  });

  it('regroupe les sources sans perdre un billet', () => {
    const g = groupSources([
      { source: 'yuno-a', tickets: 3, orders: 2, revenue: 36 },
      { source: 'yuno-b', tickets: 2, orders: 2, revenue: 24 },
      { source: 'shotgun', tickets: 10, orders: 8, revenue: 120 },
      { source: 'instagram', tickets: 4, orders: 4, revenue: 48 },
      { source: null, tickets: 1, orders: 1, revenue: 0 },
    ]);
    expect(g.map((x) => x.kind)).toEqual(['link', 'social', 'shotgun', 'offline']);
    expect(g[0]).toMatchObject({ tickets: 5, revenue: 60 });
    expect(g.reduce((a, x) => a + x.tickets, 0)).toBe(20);
    expect(groupSources([{ source: 'shotgun', tickets: 1, orders: 1, revenue: null }])[0].revenue).toBeNull();
  });

  it('ne donne un taux qu’à partir de 10 visiteurs', () => {
    expect(linkConversion(link({ visitors: 9, orders: 3 }))).toBeNull();
    expect(linkConversion(link({ visitors: 40, orders: 4 }))).toBeCloseTo(0.1);
    expect(bestLink([link({ id: 'a', visitors: 5, tickets: 9 }), link({ id: 'b', visitors: 50, tickets: 3 })])?.id).toBe('b');
    expect(bestLink([link({ visitors: 50, tickets: 0 })])).toBeNull();
  });

  it('ne dit jamais « 0 vente » avant la première preuve de Shotgun', () => {
    expect(linkState(link({ clicks: 0 }), false)).toBe('new');
    expect(linkState(link({ clicks: 12 }), false)).toBe('waiting');
    expect(linkState(link({ clicks: 12 }), true)).toBe('clicks');
    expect(linkState(link({ clicks: 12, tickets: 1 }), false)).toBe('selling');
  });

  it('dit par où est arrivé un achat', () => {
    const t = (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('|')}` : k);
    expect(saleSourceText({ kind: 'yl', label: 'Story 2' }, t)).toBe('yc.cli.card.src.link:Story 2');
    expect(saleSourceText({ kind: 'em', label: 'Line-up' }, t)).toBe('yc.cli.card.src.email:Line-up');
    expect(saleSourceText({ kind: 'em', label: null }, t)).toBe('yc.ana.src.em');
    expect(saleSourceText({ kind: 'so', src: 'instagram' }, t)).toBe('yc.cli.card.src.social:Instagram');
    expect(saleSourceText({ kind: 'sg', src: 'shotgun' }, t)).toBe('yc.ana.src.sg');
    expect(saleSourceText(null, t)).toBeNull();
  });
});
