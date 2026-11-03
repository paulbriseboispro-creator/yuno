/**
 * Images des e-mails servies par yunoapp.eu, jamais par supabase.co.
 *
 * Un e-mail dont les images viennent d'un domaine tiers partagé (le stockage
 * Supabase, que des pages d'hameçonnage utilisent aussi) est un signal de spam
 * pour Gmail : le test 3AM Act III du 03/11 est arrivé en Spam, où Gmail
 * désactive en plus tous les liens. Resend le signale (« Host images on the
 * sending domain »).
 *
 * À l'envoi, toute adresse `<projet>.supabase.co/storage/v1/object/public/<bucket>/…`
 * d'un bucket d'images publiques devient `https://yunoapp.eu/email-img/<bucket>/…`,
 * que le Worker (worker/emailImage.ts) relit chez Supabase et met en cache.
 * Pur, sans dépendance : importé par send-campaign ET par le Worker (liste des
 * buckets commune).
 */

/** Buckets publics qui portent des images d'e-mail. Jamais les autres (autorisations de mineur, vidéos, bundles…). */
export const EMAIL_IMAGE_BUCKETS = [
  'email-assets',
  'campaign-assets',
  'event-images',
  'event-posters',
  'organization-assets',
  'venue-assets',
  'profile-photos',
  'affiliate-media',
  'drink-images',
] as const;

export const EMAIL_IMAGE_PATH = '/email-img/';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Réécrit les adresses d'images du stockage public vers `publicUrl/email-img/`.
 * `supabaseUrl` = l'adresse du projet (`https://<ref>.supabase.co`). Tout ce qui
 * n'est pas un bucket listé reste tel quel.
 */
export function rehostEmailImages(html: string, supabaseUrl: string, publicUrl: string): string {
  if (!html || !supabaseUrl || !publicUrl) return html;
  const base = supabaseUrl.replace(/\/+$/, '');
  const target = `${publicUrl.replace(/\/+$/, '')}${EMAIL_IMAGE_PATH}`;
  const re = new RegExp(
    `${escapeRe(base)}/storage/v1/object/public/(${EMAIL_IMAGE_BUCKETS.map(escapeRe).join('|')})/`,
    'g',
  );
  return html.replace(re, (_m, bucket: string) => `${target}${bucket}/`);
}

/**
 * Chemin `/email-img/<bucket>/<fichier>` → chemin de stockage `<bucket>/<fichier>`,
 * ou null s'il n'est pas servable (bucket hors liste, `..`, chemin vide).
 */
export function emailImageStoragePath(pathname: string): string | null {
  if (!pathname.startsWith(EMAIL_IMAGE_PATH)) return null;
  const rest = pathname.slice(EMAIL_IMAGE_PATH.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  const file = rest.slice(slash + 1);
  if (!(EMAIL_IMAGE_BUCKETS as readonly string[]).includes(bucket)) return null;
  if (!file || file.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  return `${bucket}/${file}`;
}
