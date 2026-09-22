/**
 * Médias des pubs Meta — images, carrousels, vidéos choisis par le pro dans
 * l'assistant de campagne.
 *
 * Tout part dans le bucket public `ad-creatives`, sous `<auth.uid()>/…`
 * (policy du bucket) : Meta va chercher l'image (`adimages`) et la vidéo
 * (`advideos` `file_url`) par URL depuis ses serveurs, il faut donc une URL
 * publique et stable. Les envois sont différés (`deferredUpload`) : le fichier
 * monte pendant que le pro écrit son texte.
 *
 * Règles Meta qu'on applique AVANT l'envoi, pour que le refus soit immédiat et
 * lisible plutôt qu'une erreur Graph à la création :
 *   · image : JPEG/PNG/WebP, recompressée à 1600 px max (Meta recommande
 *     ≥ 1080 px, le feed affiche du 1:1 ou du 4:5) ;
 *   · vidéo : MP4/MOV en H.264 (même détection de codec que la vidéo de page
 *     soirée : un .mov HEVC d'iPhone passe chez Meta mais pas partout dans le
 *     navigateur qui doit en tirer la couverture), 50 Mo, 4 min max ;
 *   · vidéo : une COUVERTURE est obligatoire (`image_hash` de `video_data`).
 *     On la capture à 1 s dans le navigateur ; le pro peut la remplacer.
 */
import { supabase } from '@/integrations/supabase/client';
import { compressImage } from '@/lib/compressImage';
import { startDeferredUpload, type DeferredUpload } from '@/lib/deferredUpload';

export const AD_MEDIA_BUCKET = 'ad-creatives';
export const AD_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
export const AD_VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.m4v,.mov';
export const AD_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const AD_VIDEO_MAX_SECONDS = 240;

export type AdVideoRejection = 'bad_type' | 'too_large' | 'too_long' | 'unsupported_codec' | 'unreadable';

const H264_ENTRIES = new Set(['avc1', 'avc3']);

function videoMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  return '';
}

/** Codecs déclarés dans les atomes `stsd` d'un MP4/MOV (null = conteneur illisible). */
async function sniffCodecs(file: File): Promise<Set<string> | null> {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  const found = new Set<string>();
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const walk = (start: number, end: number, depth: number) => {
    let o = start;
    while (o + 8 <= end && depth < 8) {
      let size = view.getUint32(o);
      const type = tag(o + 4);
      let header = 8;
      if (size === 1) { if (o + 16 > end) return; size = Number(view.getBigUint64(o + 8)); header = 16; }
      if (size === 0) size = end - o;
      if (size < header) return;
      const boxEnd = Math.min(end, o + size);
      if (containers.has(type)) walk(o + header, boxEnd, depth + 1);
      else if (type === 'stsd') {
        const n = view.getUint32(o + header + 4);
        let p = o + header + 8;
        for (let i = 0; i < n && p + 8 <= boxEnd; i++) {
          const es = view.getUint32(p);
          found.add(tag(p + 4));
          if (es < 8) break;
          p += es;
        }
      }
      o = boxEnd;
    }
  };
  try { walk(0, bytes.length, 0); } catch { return null; }
  return found.size ? found : null;
}

export type AdVideoInspection =
  | { ok: true; duration: number; width: number; height: number }
  | { ok: false; reason: AdVideoRejection };

export async function inspectAdVideo(file: File): Promise<AdVideoInspection> {
  const mime = videoMime(file);
  if (mime !== 'video/mp4' && mime !== 'video/quicktime') return { ok: false, reason: 'bad_type' };
  if (file.size > AD_VIDEO_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const codecs = await sniffCodecs(file);
  if (codecs && ![...codecs].some((c) => H264_ENTRIES.has(c))) return { ok: false, reason: 'unsupported_codec' };
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (r: AdVideoInspection) => { URL.revokeObjectURL(url); resolve(r); };
    v.onloadedmetadata = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return done({ ok: false, reason: 'unreadable' });
      if (v.duration > AD_VIDEO_MAX_SECONDS) return done({ ok: false, reason: 'too_long' });
      done({ ok: true, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => done({ ok: false, reason: 'unreadable' });
    v.src = url;
  });
}

/** Image de couverture capturée dans la vidéo (à ~1 s), en JPEG. */
export function captureVideoFrame(file: File, atSeconds = 1): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    const finish = (b: Blob | null) => { URL.revokeObjectURL(url); resolve(b); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(atSeconds, Math.max(0, v.duration - 0.1)); };
    v.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return finish(null);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b), 'image/jpeg', 0.86);
      } catch { finish(null); }
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

async function ownFolder(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('not_authenticated');
  return uid;
}

const stamp = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function startAdImageUpload(file: File): DeferredUpload {
  const prepared = compressImage(file, 1600, 0.86);
  return startDeferredUpload({
    bucket: AD_MEDIA_BUCKET,
    pathFor: async () => `${await ownFolder()}/${stamp()}.jpg`,
    file: prepared,
    contentType: 'image/jpeg',
    cacheControl: '31536000',
  });
}

export function startAdVideoUpload(file: File): DeferredUpload {
  const mime = videoMime(file);
  return startDeferredUpload({
    bucket: AD_MEDIA_BUCKET,
    pathFor: async () => `${await ownFolder()}/${stamp()}.${mime === 'video/quicktime' ? 'mov' : 'mp4'}`,
    file,
    contentType: mime,
    cacheControl: '31536000',
  });
}

export function startAdThumbnailUpload(blob: Blob): DeferredUpload {
  return startDeferredUpload({
    bucket: AD_MEDIA_BUCKET,
    pathFor: async () => `${await ownFolder()}/${stamp()}-cover.jpg`,
    file: blob,
    contentType: 'image/jpeg',
    cacheControl: '31536000',
  });
}
