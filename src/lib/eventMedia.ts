/**
 * Les trois médias d'une soirée (vidéo 16:9, affiche 1:1, logo du lieu) partent
 * vers le Storage dès qu'ils sont choisis — voir `deferredUpload.ts` pour le
 * pourquoi et pour la règle de nettoyage des orphelins.
 *
 * Contrat de chemin, à ne pas casser :
 *   · `event-videos` exige `<auth.uid()>/…` (policy du bucket)
 *   · `event-posters` exige `<organizer_user_id>/…`
 *   · `event-images` (affiche recadrée d'un club) vit sous `events/…`
 */
import { supabase } from '@/integrations/supabase/client';
import { compressImage } from '@/lib/compressImage';
import { startDeferredUpload, type DeferredUpload } from '@/lib/deferredUpload';
import { EVENT_VIDEO_BUCKET } from '@/lib/eventVideo';

/** Type MIME fiable : Safari laisse parfois `file.type` vide sur un .mov. */
function videoMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext === 'mov' ? 'video/quicktime' : 'video/mp4';
}

/**
 * Vidéo de la page soirée. Le fichier n'est jamais retouché après le choix
 * (pas de recadrage, pas de réencodage), donc l'envoi peut partir tout de
 * suite et n'aura jamais à être refait.
 */
export function startEventVideoUpload(file: File): DeferredUpload {
  const mime = videoMime(file);
  const ext = mime === 'video/quicktime' ? 'mov' : 'mp4';
  return startDeferredUpload({
    bucket: EVENT_VIDEO_BUCKET,
    pathFor: async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) throw new Error('not_authenticated');
      return `${uid}/${Date.now()}.${ext}`;
    },
    file,
    contentType: mime,
    cacheControl: '31536000',
  });
}

/**
 * Affiche ou logo de lieu d'un organisateur. Compressés AVANT l'envoi : une
 * photo d'iPhone pèse 5 à 10 Mo pour une vignette carrée affichée à 1080 px,
 * et jusqu'ici elle partait telle quelle, au clic sur « Publier ».
 */
export function startOrganizerImageUpload(
  file: File,
  organizerUserId: string,
  kind: 'poster' | 'venue-logo' = 'poster',
): DeferredUpload {
  const prepared = compressImage(file, kind === 'poster' ? 1400 : 512);
  return startDeferredUpload({
    bucket: 'event-posters',
    pathFor: async () => {
      const ext = ((await prepared).name.split('.').pop() || 'jpg').toLowerCase();
      return `${organizerUserId}/${Date.now()}-${kind}.${ext}`;
    },
    file: prepared,
  });
}

/**
 * Affiche recadrée d'un club. Le recadrage dépend du cadre que le pro fait
 * glisser, donc l'envoi ne part qu'une fois le blob produit — mais il sort à
 * ~300 Ko, pas à 8 Mo.
 */
export function startVenuePosterUpload(cropped: Promise<Blob>): DeferredUpload {
  return startDeferredUpload({
    bucket: 'event-images',
    pathFor: () => `events/${Date.now()}-poster.jpg`,
    file: cropped,
    contentType: 'image/jpeg',
  });
}
