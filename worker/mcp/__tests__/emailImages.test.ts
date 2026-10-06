// Images des e-mails dessinés par l'IA : lecture du format, téléchargement
// (redirections, https seul, taille), dépôt dans un emplacement.
import { describe, expect, it, vi } from 'vitest';
import { fetchRemoteImage, imageInfo, storeSlotImage, MAX_IMAGE_BYTES } from '../emailImages';

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// PNG 1×1, GIF 1×1 réels.
const PNG = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
const GIF = b64('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==');

/** JPEG minimal : SOI, un APP0 de 16 octets, puis SOF0 640×480. */
function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9, ...new Array(8).fill(0)]);
}

/** WebP étendu (VP8X) : largeur et hauteur sur 24 bits, moins un. */
function webpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  b.set([...'VP8X'].map((c) => c.charCodeAt(0)), 12);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 255, (w >> 8) & 255, (w >> 16) & 255], 24);
  b.set([h & 255, (h >> 8) & 255, (h >> 16) & 255], 27);
  return b;
}

describe('imageInfo', () => {
  it('reads format and size from the bytes', () => {
    expect(imageInfo(PNG)).toEqual({ mime: 'image/png', ext: 'png', width: 1, height: 1 });
    expect(imageInfo(GIF)).toEqual({ mime: 'image/gif', ext: 'gif', width: 1, height: 1 });
    expect(imageInfo(jpeg(640, 480))).toEqual({ mime: 'image/jpeg', ext: 'jpg', width: 640, height: 480 });
    expect(imageInfo(webpVp8x(1080, 1350))).toEqual({ mime: 'image/webp', ext: 'webp', width: 1080, height: 1350 });
  });

  it('refuses what is not an image, whatever its name says', () => {
    expect(imageInfo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>                '))).toBeNull();
    expect(imageInfo(new TextEncoder().encode('<html><script>alert(1)</script></html>        '))).toBeNull();
    expect(imageInfo(new Uint8Array(4))).toBeNull();
  });
});

describe('fetchRemoteImage', () => {
  it('follows https redirects by hand and returns the bytes', async () => {
    const fetcher = vi.fn(async (url: string) => (url === 'https://a.example/img'
      ? new Response(null, { status: 302, headers: { Location: 'https://cdn.example/img.png' } })
      : new Response(PNG, { status: 200 })));
    const r = await fetchRemoteImage('https://a.example/img', fetcher as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
  });

  it('never leaves https and never reads beyond 8 MB', async () => {
    expect(await fetchRemoteImage('http://a.example/img.png')).toEqual({ ok: false, reason: 'bad_url' });
    const toHttp = vi.fn(async () => new Response(null, { status: 301, headers: { Location: 'http://a.example/x.png' } }));
    expect(await fetchRemoteImage('https://a.example/x', toHttp as unknown as typeof fetch)).toEqual({ ok: false, reason: 'bad_url' });
    const big = vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } }));
    expect(await fetchRemoteImage('https://a.example/big.png', big as unknown as typeof fetch)).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('storeSlotImage', () => {
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_MCP_KEY: 'sb_secret_test', SUPABASE_ANON_KEY: 'sb_publishable_test' };
  const code = 'a'.repeat(32);

  it('uploads to the slot name with the PUBLIC key, then has the base validate it', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, image_id: 'img1', name: 'Photo DJ' }), { status: 200 });
    }));
    const upload = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    });
    const r = await storeSlotImage(env, code, PNG, upload as unknown as typeof fetch);
    vi.unstubAllGlobals();
    expect(r).toMatchObject({ ok: true, image: { url: `https://db.example/storage/v1/object/public/email-assets/mcp/${code}/image.png`, width: 1, height: 1 } });
    expect(seen[0].url).toBe(`https://db.example/storage/v1/object/email-assets/mcp/${code}/image.png`);
    expect((seen[0].init.headers as Record<string, string>).apikey).toBe('sb_publishable_test');
    expect(seen[1].url).toBe('https://db.example/rest/v1/rpc/mcp_image_finish');
    expect(JSON.parse(String(seen[1].init.body))).toMatchObject({ p_code: code, p_mime: 'image/png', p_width: 1 });
  });

  it('a closed slot or a non-image is refused before anything is validated', async () => {
    const closed = vi.fn(async () => new Response('{"message":"new row violates row-level security policy"}', { status: 403 }));
    expect(await storeSlotImage(env, code, PNG, closed as unknown as typeof fetch)).toEqual({ ok: false, reason: 'slot_closed' });
    const never = vi.fn();
    expect(await storeSlotImage(env, code, new TextEncoder().encode('<html>not an image at all</html>'), never as unknown as typeof fetch))
      .toEqual({ ok: false, reason: 'not_an_image' });
    expect(never).not.toHaveBeenCalled();
    expect(await storeSlotImage(env, 'bad', PNG, never as unknown as typeof fetch)).toEqual({ ok: false, reason: 'not_found' });
  });
});
