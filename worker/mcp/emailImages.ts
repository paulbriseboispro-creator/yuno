// Images des e-mails dessinés par l'IA : une image collée dans le chat
// (ChatGPT la passe à l'outil par un lien temporaire), une image d'un site, ou
// une image que le pro dépose sur la page Yuno /ai/image/<code>.
//
// L'IA ouvre d'abord un EMPLACEMENT (add_email_image → mcp_write) : un code à
// usage unique, 30 minutes, rattaché à l'espace. Le fichier part dans le seau
// public email-assets à `mcp/<code>/image.<ext>` avec la clé PUBLIQUE : la
// policy de stockage `mcp_image_slot_open` n'accepte que ce nom, tant que
// l'emplacement est ouvert. Le Worker n'y gagne aucun droit propre. Puis
// mcp_image_finish vérifie que le fichier existe et rend l'image prête.
// Migration 20261009153000.

import type { McpEnv } from './config';
import { json } from './oauth';
import { rpc } from './db';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const CODE_RE = /^[0-9a-f]{32}$/;

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
export interface ImageInfo { mime: ImageMime; ext: 'jpg' | 'png' | 'gif' | 'webp'; width: number; height: number }

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/**
 * Format et dimensions lus dans les octets (jamais dans l'en-tête annoncé) :
 * JPEG, PNG, GIF, WebP. Autre chose (SVG, HEIC, PDF, HTML…) = null.
 */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 24) return null;
  // PNG : signature puis IHDR (largeur, hauteur en big-endian).
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    const width = (b[16] << 24 >>> 0) + (b[17] << 16) + (b[18] << 8) + b[19];
    const height = (b[20] << 24 >>> 0) + (b[21] << 16) + (b[22] << 8) + b[23];
    return width && height ? { mime: 'image/png', ext: 'png', width, height } : null;
  }
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') {
    const width = u16le(b, 6);
    const height = u16le(b, 8);
    return width && height ? { mime: 'image/gif', ext: 'gif', width, height } : null;
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    let width = 0;
    let height = 0;
    if (chunk === 'VP8 ') {
      width = u16le(b, 26) & 0x3fff;
      height = u16le(b, 28) & 0x3fff;
    } else if (chunk === 'VP8L') {
      width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
      height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
    } else if (chunk === 'VP8X') {
      width = 1 + u24le(b, 24);
      height = 1 + u24le(b, 27);
    }
    return width && height ? { mime: 'image/webp', ext: 'webp', width, height } : null;
  }
  // JPEG : on suit les segments jusqu'au premier SOF (dimensions de l'image).
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const len = u16be(b, i + 2);
      if (len < 2) break;
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) {
        const height = u16be(b, i + 5);
        const width = u16be(b, i + 7);
        return width && height ? { mime: 'image/jpeg', ext: 'jpg', width, height } : null;
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Lit un corps de réponse sans jamais dépasser `max` octets. */
export async function readLimited(res: Response, max: number): Promise<Uint8Array | 'too_large'> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > max) return 'too_large';
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

export type FetchedImage = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'bad_url' | 'unreachable' | 'too_large' };

/**
 * Télécharge une image publique (https) ou le lien temporaire d'un fichier
 * collé dans ChatGPT. Les redirections sont suivies à la main (3 au plus,
 * toujours en https) : workerd refuse `redirect: 'error'`, et un lien ne doit
 * jamais finir sur une adresse non chiffrée.
 */
export async function fetchRemoteImage(raw: string, fetcher: typeof fetch = fetch): Promise<FetchedImage> {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'bad_url' }; }
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password) return { ok: false, reason: 'bad_url' };
    let res: Response;
    try {
      res = await fetcher(url.toString(), {
        redirect: 'manual',
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5', 'User-Agent': 'YunoEmailImage/1.0 (+https://yunoapp.eu/ai)' },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, reason: 'unreachable' };
      try { url = new URL(loc, url); } catch { return { ok: false, reason: 'bad_url' }; }
      continue;
    }
    if (!res.ok) return { ok: false, reason: 'unreachable' };
    const bytes = await readLimited(res, MAX_IMAGE_BYTES);
    return bytes === 'too_large' ? { ok: false, reason: 'too_large' } : { ok: true, bytes };
  }
  return { ok: false, reason: 'unreachable' };
}

export interface StoredImage { image_id?: string; url: string; width: number; height: number; name?: string | null }
export type StoreResult = { ok: true; image: StoredImage } | { ok: false; reason: string };

interface StorageEnv extends McpEnv { SUPABASE_ANON_KEY?: string }

/** Dépose les octets dans l'emplacement `code`, puis le fait valider par la base. */
export async function storeSlotImage(env: StorageEnv, code: string, bytes: Uint8Array, fetcher: typeof fetch = fetch): Promise<StoreResult> {
  if (!CODE_RE.test(code)) return { ok: false, reason: 'not_found' };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };
  const info = imageInfo(bytes);
  if (!info) return { ok: false, reason: 'not_an_image' };
  if (!env.SUPABASE_ANON_KEY || !env.SUPABASE_URL) return { ok: false, reason: 'not_configured' };
  const name = `mcp/${code}/image.${info.ext}`;
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_ANON_KEY,
    'Content-Type': info.mime,
    'x-upsert': 'false',
    'cache-control': 'max-age=31536000',
  };
  if (env.SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${env.SUPABASE_ANON_KEY}`;
  let up: Response;
  try {
    up = await fetcher(`${env.SUPABASE_URL}/storage/v1/object/email-assets/${name}`, {
      method: 'POST', headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, reason: 'upload_failed' };
  }
  // 403 = la policy refuse : emplacement expiré ou déjà utilisé.
  if (up.status === 403 || (up.status === 400 && (await up.clone().text()).includes('row-level security'))) return { ok: false, reason: 'slot_closed' };
  if (!up.ok && up.status !== 409) return { ok: false, reason: 'upload_failed' };
  const url = `${env.SUPABASE_URL}/storage/v1/object/public/email-assets/${name}`;
  const done = await rpc<Record<string, unknown>>(env, 'mcp_image_finish', {
    p_code: code, p_name: name, p_url: url, p_mime: info.mime, p_bytes: bytes.byteLength, p_width: info.width, p_height: info.height,
  });
  if (!done?.ok) return { ok: false, reason: String(done?.error ?? 'upload_failed') };
  return { ok: true, image: { image_id: done.image_id as string, url, width: info.width, height: info.height, name: (done.name as string | null) ?? null } };
}

/** Explication d'un échec, pour l'IA (anglais) comme pour la page d'envoi. */
export function imageFailureText(reason: string): string {
  switch (reason) {
    case 'too_large': return 'The image is larger than 8 MB.';
    case 'not_an_image': return 'The file is not a JPEG, PNG, GIF or WebP image.';
    case 'bad_url': return 'The link is not a valid https link to an image.';
    case 'unreachable': return 'The image could not be downloaded from this link.';
    case 'slot_closed': case 'expired': case 'already_used': return 'This upload link has expired or was already used.';
    case 'not_found': return 'This upload link does not exist.';
    case 'not_configured': return 'Image upload is not configured on this server.';
    default: return 'The image could not be saved.';
  }
}

const UPLOAD_PATH = /^\/mcp\/image\/([0-9a-f]{32})\/?$/;

export function isImageUploadRoute(pathname: string): boolean {
  return UPLOAD_PATH.test(pathname);
}

/**
 * /mcp/image/<code> — GET : état de l'emplacement (page d'envoi) ; POST / PUT :
 * le fichier, brut ou en multipart (champ « file »). Sert la page Yuno ET une
 * IA qui sait exécuter du code avec le fichier sous la main.
 */
export async function handleImageUpload(request: Request, env: StorageEnv): Promise<Response> {
  const code = (new URL(request.url).pathname.match(UPLOAD_PATH) ?? [])[1] ?? '';
  const headers = { 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Cache-Control': 'no-store' };
  if (request.method === 'GET') {
    const slot = await rpc<Record<string, unknown>>(env, 'mcp_image_slot', { p_code: code });
    return json(slot?.ok ? slot : { ok: false, error: 'not_found' }, slot?.ok ? 200 : 404, headers);
  }
  if (request.method !== 'POST' && request.method !== 'PUT') return json({ ok: false, error: 'method_not_allowed' }, 405, headers);
  if (Number(request.headers.get('content-length') || 0) > MAX_IMAGE_BYTES + 64 * 1024) {
    return json({ ok: false, error: 'too_large', message: imageFailureText('too_large') }, 413, headers);
  }
  const slot = await rpc<Record<string, unknown>>(env, 'mcp_image_slot', { p_code: code });
  if (!slot?.ok) return json({ ok: false, error: 'not_found', message: imageFailureText('not_found') }, 404, headers);
  if (slot.status !== 'waiting') {
    return json({ ok: false, error: String(slot.status), message: imageFailureText(slot.status === 'ready' ? 'already_used' : 'expired'), url: slot.url ?? null }, 410, headers);
  }
  let bytes: Uint8Array;
  const type = request.headers.get('content-type') || '';
  if (type.startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') return json({ ok: false, error: 'no_file', message: 'Send the image in a "file" field.' }, 400, headers);
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const body = await readLimited(new Response(request.body), MAX_IMAGE_BYTES);
    if (body === 'too_large') return json({ ok: false, error: 'too_large', message: imageFailureText('too_large') }, 413, headers);
    bytes = body;
  }
  const stored = await storeSlotImage(env, code, bytes);
  if (!stored.ok) {
    const status = stored.reason === 'too_large' ? 413 : stored.reason === 'not_an_image' ? 415 : stored.reason === 'slot_closed' ? 410 : 400;
    return json({ ok: false, error: stored.reason, message: imageFailureText(stored.reason) }, status, headers);
  }
  return json({ ok: true, ...stored.image }, 200, headers);
}
