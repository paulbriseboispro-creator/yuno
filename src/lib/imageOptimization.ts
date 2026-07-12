/**
 * Optimizes Supabase Storage image URLs using the built-in image transformation feature.
 * This converts images to WebP format and resizes them to the specified dimensions.
 * 
 * @param url - The original Supabase Storage URL
 * @param options - Transformation options
 * @returns Optimized image URL with transformation parameters
 */
export function getOptimizedImageUrl(
  url: string | undefined | null,
  options: {
    width?: number;
    height?: number;
    quality?: number;
    /**
     * Mode de redimensionnement Supabase. Par défaut le transform applique
     * `cover` quand width ET height sont fournis → l'image est recadrée
     * (effet zoom). Passer 'contain' pour livrer l'image entière.
     */
    resize?: 'cover' | 'contain' | 'fill';
  } = {}
): string {
  if (!url) return '';

  // Only transform Supabase Storage URLs
  if (!url.includes('supabase.co/storage/v1/object/public/')) {
    return url;
  }

  const { width, height, quality = 80, resize } = options;

  // ⚠️ PIÈGE SUPABASE : le transform ne préserve PAS le ratio quand on ne donne
  // que `width`. Le mode par défaut est `cover` sur une boîte width × hauteur
  // d'origine → il renvoie une BANDE VERTICALE CENTRALE de l'image à sa hauteur
  // native (ex. 1080×1080 + width=128 → 128×1080). D'où des vignettes rognées
  // et « zoomées » partout où l'on demandait juste une largeur.
  //
  // Fix : largeur seule = redimensionnement PROPORTIONNEL. On borne la hauteur
  // très large (×4) et on force `contain` — Supabase ajuste alors la hauteur au
  // ratio réel, sans letterbox (vérifié : 640×800 + width 480 → 480×600).
  // Pour un vrai recadrage carré, passer width ET height explicitement (cover).
  const proportional = width && !height;
  const effectiveHeight = proportional ? width * 4 : height;
  const effectiveResize = proportional ? 'contain' : resize;

  // Convert from object URL to render URL for transformations
  // From: https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
  // To: https://<ref>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=X&height=Y&quality=Q
  const transformUrl = url.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/'
  );

  // Preserve any query string already on the source URL (e.g. a legacy ?t=
  // cache-buster) and merge the transform params into it, so we never emit a
  // malformed `?t=123?width=...` with two question marks.
  const [base, existingQuery] = transformUrl.split('?');
  const params = new URLSearchParams(existingQuery || '');

  if (width) params.set('width', width.toString());
  if (effectiveHeight) params.set('height', effectiveHeight.toString());
  if (effectiveResize) params.set('resize', effectiveResize);
  params.set('quality', quality.toString());

  return `${base}?${params.toString()}`;
}

/**
 * Generates srcSet for responsive images
 */
export function getResponsiveSrcSet(
  url: string | undefined | null,
  sizes: number[],
  quality = 80
): string {
  if (!url) return '';
  
  return sizes
    .map(size => `${getOptimizedImageUrl(url, { width: size, quality })} ${size}w`)
    .join(', ');
}
