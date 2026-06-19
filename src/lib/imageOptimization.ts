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
  } = {}
): string {
  if (!url) return '';
  
  // Only transform Supabase Storage URLs
  if (!url.includes('supabase.co/storage/v1/object/public/')) {
    return url;
  }
  
  const { width, height, quality = 80 } = options;
  
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
  if (height) params.set('height', height.toString());
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
