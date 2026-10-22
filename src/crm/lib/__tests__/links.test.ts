import { describe, expect, it } from 'vitest';
import {
  LINK_KINDS, bestLink, buildGoDestination, findKind, goDisplay, goUrl, groupSources, linkConversion,
  linkState, nextIndex, reusableLink, saleSourceText, sourceFamily, sourceHost, sourceKind, sourceName, type NightLink,
} from '../links';

const link = (o: Partial<NightLink>): NightLink => ({
  id: 'l', code: 'abcd1234', label: 'Story 1', platform: 'instagram', placement: 'story', source: 'yuno-abcd1234',
  created_at: '2026-10-05T10:00:00Z', archived: false, clicks: 0, visitors: 0, clicks_24h: 0, last_click_at: null,
  mobile_pct: null, spark: [], tickets: 0, orders: 0, revenue: 0, buyers: 0, new_buyers: 0, first_sale_at: null, people: [],
  ...o,
});

describe('liens de soirée', () => {
  it('le catalogue est le miroir de _crm_link_creatable (11 paires, sans doublon)', () => {
    expect(LINK_KINDS).toHaveLength(11);
    expect(new Set(LINK_KINDS.map((k) => `${k.platform}.${k.placement}`)).size).toBe(11);
    expect(findKind('instagram', 'story')?.perPost).toBe(true);
    expect(findKind('instagram', 'bio')?.perPost).toBe(false);
    expect(findKind('instagram', 'flyer')).toBeNull();
  });

  it('Instagram = story + lien en bio, TikTok = lien en bio seulement', () => {
    const at = (p: string) => LINK_KINDS.filter((k) => k.platform === p).map((k) => k.placement);
    expect(at('instagram')).toEqual(['story', 'bio']);
    expect(at('tiktok')).toEqual(['bio']);
    // un ancien lien (reel, post, vidéo TikTok) garde son libellé
    expect(findKind('instagram', 'reel')).not.toBeNull();
    expect(findKind('tiktok', 'video')).not.toBeNull();
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
    expect(sourceKind('dj-masza')).toBe('partner');
    expect(sourceKind(null)).toBe('offline');
    expect(sourceKind('')).toBe('offline');
  });

  // MÊME jeu que la vérification SQL de `_crm_ticket_source` (migration
  // 20261018100000) : valeurs réelles de utm_source vues le 17/10/2026, puis
  // les cas qui testent l'ordre des règles. Les deux côtés doivent rendre
  // exactement ces familles.
  it('classe chaque utm_source Shotgun comme le SQL', () => {
    const cases: [string, string][] = [
    ["direct", 'di'],
    ["shotgun", 'sg'],
    ["instagram.com", 'so'],
    ["instagram", 'so'],
    ["ig", 'so'],
    ["yuno", 'em'],
    ["tiktok", 'so'],
    ["facebook.com", 'so'],
    ["ezapv.r.ag.d.sendibm3.com", 'ex'],
    ["t4bs.app.link", 'au'],
    ["l.instagram.com", 'so'],
    ["google", 'se'],
    ["shotgun-email", 'ex'],
    ["snapchat", 'so'],
    ["ezapv.r.a.d.sendibm1.com", 'ex'],
    ["lumea-community", 'pa'],
    ["chatgpt.com", 'se'],
    ["gifhi.r.ag.d.sendibm3.com", 'ex'],
    ["m.facebook.com", 'so'],
    ["facebook", 'so'],
    ["www.google.fr", 'se'],
    ["l.facebook.com", 'so'],
    ["outlook.live.com", 'ex'],
    ["snapchat.com", 'so'],
    ["www.google.com", 'se'],
    ["cysoh.r.ah.d.sendibm5.com", 'ex'],
    ["bio.site", 'au'],
    ["zimbra.free.fr", 'ex'],
    ["spiritobrussels.com", 'au'],
    ["da11v.r.sp1-brevo.net", 'ex'],
    ["linktr.ee", 'au'],
    ["boccamar.com", 'au'],
    ["bandsintown", 'au'],
    ["newsletter", 'ex'],
    ["post-feed-ig", 'so'],
    ["www.google.co.uk", 'se'],
    ["appleid.apple.com", 'au'],
    ["maitrey", 'pa'],
    ["localhost", 'au'],
    ["arc.net", 'au'],
    ["mail02.orange.fr", 'ex'],
    ["petitbain.org", 'au'],
    ["lm.facebook.com", 'so'],
    ["com.snapchat.android", 'so'],
    ["mailing-list", 'ex'],
    ["songkick", 'au'],
    ["google.fr", 'se'],
    ["preview.mailerlite.io", 'ex'],
    ["https://www.google.com/", 'se'],
    ["itainparis", 'pa'],
    ["tickets-ens-paris", 'pa'],
    ["fb", 'so'],
    ["sponso", 'pa'],
    ["smartboard.shotgun.live", 'sg'],
    ["l.messenger.com", 'so'],
    ["internal", 'au'],
    ["partiful.com", 'au'],
    ["www.snapchat.com", 'so'],
    ["alohafind.com", 'au'],
    ["app.link", 'au'],
    ["lanuit.club", 'au'],
    ["spotify", 'au'],
    ["", 'of'],
    ["  ", 'of'],
    ["yuno-m-1a2b3c4d", 'em'],
    ["yuno-s-1a2b3c4d", 'sm'],
    ["yuno-d-1a2b3c4d", 'dm'],
    ["yuno-k5s54beg", 'yl'],
    ["X", 'so'],
    ["x.com", 'so'],
    ["t.co", 'so'],
    ["https://t.co/abc", 'so'],
    ["mail.google.com", 'ex'],
    ["android-app://com.google.android.gm", 'ex'],
    ["android-app://com.google.android.googlequicksearchbox", 'se'],
    ["us12.list-manage.com", 'ex'],
    ["e-mail", 'ex'],
    ["bing.com", 'se'],
    ["claude.ai", 'se'],
    ["perplexity.ai", 'se'],
    ["claude-promo", 'pa'],
    ["big-event", 'pa'],
    ["googleusercontent.com", 'au'],
    ["https://", 'au'],
    ["Instagram.com/stories", 'so'],
    ["whatsapp", 'so'],
    ["wa.me", 'so'],
    // Liens de suivi Shotgun de 3AM (22/10/2026) : un nom sans point = un partenaire.
    ["dj-masza", 'pa'],
    ["assas", 'pa'],
    ["3-am", 'pa'],
    ["affinity-pro", 'pa'],
    ["mosko-julyus", 'pa'],
    ["luka", 'pa'],
    ["Ladagnous", 'pa'],
    ["gatsby", 'pa'],
    ["augustin", 'pa'],
    ["qr", 'au'],
    ["flyer", 'au'],
    ["linktree", 'au'],
    ["test", 'au'],
    ["a", 'au'],
    ["dj masza", 'au'],
    ];
    for (const [src, fam] of cases) expect([src, sourceFamily(src)]).toEqual([src, fam]);
  });

  it('lit le domaine nu et donne un nom lisible', () => {
    expect(sourceHost('https://www.google.com/search?q=club')).toBe('google.com');
    expect(sourceHost('lm.facebook.com')).toBe('facebook.com');
    expect(sourceName('ezapv.r.ag.d.sendibm3.com')).toBe('Brevo');
    expect(sourceName('l.instagram.com')).toBe('Instagram');
    expect(sourceName('com.snapchat.android')).toBe('Snapchat');
    expect(sourceName('chatgpt.com')).toBe('ChatGPT');
    expect(sourceName('linktr.ee')).toBe('linktr.ee');
  });

  it('range les e-mails d’autres outils et la recherche à part', () => {
    expect(sourceKind('ezapv.r.ag.d.sendibm3.com')).toBe('extmail');
    expect(sourceKind('www.google.fr')).toBe('search');
    expect(sourceKind('instagram.com')).toBe('social');
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

  it('détaille les liens Yuno par type : story et lien en bio séparés', () => {
    const links = [
      link({ source: 'yuno-st1', platform: 'instagram', placement: 'story' }),
      link({ source: 'yuno-st2', platform: 'instagram', placement: 'story' }),
      link({ source: 'yuno-bio', platform: 'instagram', placement: 'bio' }),
      link({ source: 'yuno-tt', platform: 'tiktok', placement: 'bio' }),
    ];
    const g = groupSources([
      { source: 'yuno-st1', tickets: 3, orders: 3, revenue: null },
      { source: 'yuno-st2', tickets: 2, orders: 2, revenue: null },
      { source: 'yuno-bio', tickets: 4, orders: 4, revenue: null },
      { source: 'yuno-tt', tickets: 1, orders: 1, revenue: null },
      { source: 'yuno-inconnu', tickets: 1, orders: 1, revenue: null },
    ], links);
    expect(g).toHaveLength(1);
    expect(g[0].tickets).toBe(11);
    expect(g[0].kinds).toEqual([
      { key: 'instagram.bio', tickets: 4 },
      { key: 'instagram.story', tickets: 5 },
      { key: 'tiktok.bio', tickets: 1 },
      { key: 'other.link', tickets: 1 },
    ].sort((a, b) => b.tickets - a.tickets));
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
