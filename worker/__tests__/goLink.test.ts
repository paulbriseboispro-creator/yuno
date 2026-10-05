import { afterEach, describe, expect, it, vi } from 'vitest';
import { GO_PATH_RE, buildGoDestination, handleGoLink, isBotUserAgent } from '../goLink';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
const IPHONE_IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0';

afterEach(() => vi.unstubAllGlobals());

describe('liens /go/', () => {
  it('reconnaît un code et rien d’autre', () => {
    expect('/go/k5s54beg'.match(GO_PATH_RE)?.[1]).toBe('k5s54beg');
    expect('/go/k5s54beg/'.match(GO_PATH_RE)?.[1]).toBe('k5s54beg');
    expect('/go/../admin'.match(GO_PATH_RE)).toBeNull();
    expect('/go/a'.match(GO_PATH_RE)).toBeNull();
  });

  it('pose la source du lien dans utm_source, en https seulement', () => {
    const d = new URL(buildGoDestination({ url: 'https://shotgun.live/events/x?ref=1', source: 'yuno-k5s54beg', medium: 'story' })!);
    expect(d.host).toBe('shotgun.live');
    expect(d.searchParams.get('ref')).toBe('1');
    expect(d.searchParams.get('utm_source')).toBe('yuno-k5s54beg');
    expect(d.searchParams.get('utm_medium')).toBe('story');
    expect(d.searchParams.get('utm_campaign')).toBe('yuno');
    expect(buildGoDestination({ url: 'http://shotgun.live/events/x', source: 'yuno-a' })).toBeNull();
    expect(buildGoDestination({ url: 'javascript:alert(1)', source: 'yuno-a' })).toBeNull();
  });

  it('ne compte pas les robots d’aperçu', () => {
    expect(isBotUserAgent('WhatsApp/2.23.20.0')).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent(IPHONE_IG)).toBe(false);
  });

  it('redirige en 302 et transmet le visiteur à crm_link_hit', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://shotgun.live/events/x', source: 'yuno-k5s54beg', medium: 'bio' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = new Request('https://yunoapp.eu/go/k5s54beg', { headers: { 'User-Agent': IPHONE_IG, 'cf-connecting-ip': '9.9.9.9' } });
    const res = await handleGoLink(req, ENV, 'k5s54beg', new URL(req.url));
    expect(res?.status).toBe(302);
    expect(res?.headers.get('Location')).toContain('utm_source=yuno-k5s54beg');
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ p_code: 'k5s54beg', p_ip: '9.9.9.9', p_count: true });
  });

  it('un test depuis la Console (?t=1) ou un robot redirige sans compter', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://shotgun.live/events/x', source: 'yuno-a1b2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const t = new Request('https://yunoapp.eu/go/a1b2?t=1', { headers: { 'User-Agent': IPHONE_IG } });
    await handleGoLink(t, ENV, 'a1b2', new URL(t.url));
    const bot = new Request('https://yunoapp.eu/go/a1b2', { headers: { 'User-Agent': 'WhatsApp/2.23' } });
    await handleGoLink(bot, ENV, 'a1b2', new URL(bot.url));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(((c as unknown as [string, RequestInit])[1].body as string)));
    expect(bodies.map((b) => b.p_count)).toEqual([false, false]);
  });

  it('rend la main à l’app si le lien est inconnu ou si la base ne répond pas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })));
    const req = new Request('https://yunoapp.eu/go/zzzz', { headers: { 'User-Agent': IPHONE_IG } });
    expect(await handleGoLink(req, ENV, 'zzzz', new URL(req.url))).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await handleGoLink(req, ENV, 'zzzz', new URL(req.url))).toBeNull();
  });
});
