/**
 * Vidéo verticale de la page soirée — règles partagées par les formulaires
 * (club + organisateur) et par le héros public.
 *
 * Contrat produit : une seule vidéo portrait (9:16) par soirée, lue en boucle,
 * muette, en autoplay, UNIQUEMENT sur la page de la soirée. Partout ailleurs
 * (Explore, cartes, emails, passes Wallet, partages) l'affiche reste le seul
 * visuel — la vidéo n'a donc jamais à être « déclinée » ni optimisée en
 * miniature.
 *
 * Limites (miroir du bucket `event-videos`, migrations 20260907200000 + 210000) :
 *   · 30 Mo, MP4 ou MOV, codec vidéo H.264 OBLIGATOIRE. Un .mov HEVC (réglage
 *     iPhone « Haute efficacité ») se lit sur Safari mais pas sur Chrome/Android,
 *     et le WebM ne se lit pas partout sur iOS : on refuse avant l'envoi plutôt
 *     que de laisser un client tomber sur un rectangle noir.
 *   · portrait obligatoire (la page l'affiche en 9:16, un paysage serait
 *     recadré à 20 % de sa largeur)
 *   · 60 s max — au-delà c'est une bande-annonce, pas un visuel de page
 */
import { supabase } from '@/integrations/supabase/client';

export const EVENT_VIDEO_BUCKET = 'event-videos';
export const EVENT_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
export const EVENT_VIDEO_MAX_SECONDS = 60;
/** Ce que l'input file accepte — le bucket refuse le reste côté serveur. */
export const EVENT_VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.m4v,.mov';

const ACCEPTED_TYPES = new Set(['video/mp4', 'video/quicktime']);
/** Entrées `stsd` acceptées : H.264 sous ses deux emballages. */
const H264_ENTRIES = new Set(['avc1', 'avc3']);

export type EventVideoRejection = 'bad_type' | 'too_large' | 'too_long' | 'not_portrait' | 'unsupported_codec' | 'unreadable';

export type EventVideoInspection =
  | { ok: true; duration: number; width: number; height: number }
  | { ok: false; reason: EventVideoRejection };

/** Type MIME fiable : Safari laisse parfois `file.type` vide sur un .mov. */
function resolveMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  return '';
}

/**
 * Lit les types d'entrées `stsd` (codecs) d'un MP4 / MOV en parcourant les
 * atomes ISO BMFF : moov → trak → mdia → minf → stbl → stsd. Le navigateur ne
 * dit jamais QUEL codec un fichier porte (Safari lit le HEVC sans broncher),
 * il faut donc regarder dans la boîte. `null` = conteneur illisible, on laisse
 * alors le <video> trancher.
 */
async function sniffCodecs(file: File): Promise<Set<string> | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(bytes.buffer);
  const found = new Set<string>();
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const fourcc = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  const walk = (start: number, end: number) => {
    let off = start;
    while (off + 8 <= end) {
      let size = dv.getUint32(off);
      const type = fourcc(off + 4);
      let header = 8;
      if (size === 1) { size = Number(dv.getBigUint64(off + 8)); header = 16; }
      else if (size === 0) size = end - off;
      if (size < header) return;
      const boxEnd = Math.min(off + size, end);
      if (CONTAINERS.has(type)) walk(off + header, boxEnd);
      else if (type === 'stsd' && off + header + 8 <= boxEnd) {
        const count = dv.getUint32(off + header + 4);
        let p = off + header + 8;
        for (let i = 0; i < count && p + 8 <= boxEnd; i++) {
          const entrySize = dv.getUint32(p);
          found.add(fourcc(p + 4));
          if (entrySize < 8) break;
          p += entrySize;
        }
      }
      off += size;
    }
  };
  try { walk(0, bytes.length); } catch { return null; }
  return found.size ? found : null;
}

/** Codecs vidéo connus qui ne se lisent pas partout (HEVC, AV1, VP9, Dolby Vision). */
const NON_UNIVERSAL = ['hvc1', 'hev1', 'hvt1', 'dvh1', 'dvhe', 'av01', 'vp09', 'vp08'];

/**
 * Lit les métadonnées du fichier dans un <video> hors écran pour valider
 * durée et orientation AVANT l'upload — refuser après 30 Mo transférés
 * serait une punition.
 */
export function inspectEventVideo(file: File): Promise<EventVideoInspection> {
  const mime = resolveMime(file);
  if (!ACCEPTED_TYPES.has(mime)) return Promise.resolve({ ok: false, reason: 'bad_type' });
  if (file.size > EVENT_VIDEO_MAX_BYTES) return Promise.resolve({ ok: false, reason: 'too_large' });

  return (async (): Promise<EventVideoInspection> => {
    const codecs = await sniffCodecs(file);
    if (codecs) {
      const hasH264 = [...codecs].some(c => H264_ENTRIES.has(c));
      const hasNonUniversal = NON_UNIVERSAL.some(c => codecs.has(c));
      if (hasNonUniversal || !hasH264) return { ok: false, reason: 'unsupported_codec' };
    }
    return probeMetadata(file);
  })();
}

/** Durée + orientation lues dans un <video> hors écran. */
function probeMetadata(file: File): Promise<EventVideoInspection> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const finish = (result: EventVideoInspection) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onloadedmetadata = () => {
      const { duration, videoWidth: width, videoHeight: height } = video;
      if (!width || !height) return finish({ ok: false, reason: 'unreadable' });
      if (height <= width) return finish({ ok: false, reason: 'not_portrait' });
      if (Number.isFinite(duration) && duration > EVENT_VIDEO_MAX_SECONDS) return finish({ ok: false, reason: 'too_long' });
      finish({ ok: true, duration, width, height });
    };
    video.onerror = () => finish({ ok: false, reason: 'unreadable' });
    // Un conteneur que le navigateur ne sait pas ouvrir ne lève parfois rien.
    window.setTimeout(() => finish({ ok: false, reason: 'unreadable' }), 15_000);
    video.src = url;
  });
}

/**
 * Upload dans le dossier du compte connecté (la policy du bucket exige
 * `<uid>/…`) et renvoie l'URL publique. Lève en cas d'échec : l'appelant
 * décide s'il annule l'enregistrement (oui — persister une soirée « avec
 * vidéo » sans vidéo serait un mensonge silencieux).
 */
export async function uploadEventVideo(file: File): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('not_authenticated');
  const mime = resolveMime(file) || 'video/mp4';
  const ext = mime === 'video/quicktime' ? 'mov' : 'mp4';
  const path = `${uid}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(EVENT_VIDEO_BUCKET)
    .upload(path, file, { upsert: false, contentType: mime, cacheControl: '31536000' });
  if (error) throw error;
  return supabase.storage.from(EVENT_VIDEO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Faut-il lancer la vidéo sur la page ? Non si la personne a demandé moins
 * d'animations, ou si son navigateur signale un mode économie de données :
 * dans les deux cas l'affiche suffit, et elle est déjà là.
 */
export function shouldAutoplayHeroVideo(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return false;
  return true;
}
