/**
 * Comment une affiche entre dans un cadre.
 *
 * Shotgun ne rend qu'UN visuel par soirée (`coverUrl` = `coverThumbnailUrl`, le
 * 16:9 des organisateurs ; le 3:4 n'est pas dans l'API). Un cadre vertical rempli
 * en `object-fit: cover` en montre une tranche au hasard, texte de l'affiche coupé.
 * Quand l'image et le cadre n'ont pas des proportions voisines, l'affiche est donc
 * montrée ENTIÈRE (contain) sur son propre flou, jamais rognée.
 */

/** Écart de proportions toléré avant de renoncer au rognage (1,3 = 30 %). */
export const POSTER_COVER_TOLERANCE = 1.3;

export type PosterFitMode = 'cover' | 'contain';

/** Proportions (largeur ÷ hauteur) inconnues ou nulles : on garde le rognage habituel. */
export function posterFitMode(imageRatio: number | null | undefined, frameRatio: number | null | undefined): PosterFitMode {
  if (!imageRatio || !frameRatio || !Number.isFinite(imageRatio) || !Number.isFinite(frameRatio) || imageRatio <= 0 || frameRatio <= 0) return 'cover';
  const gap = imageRatio > frameRatio ? imageRatio / frameRatio : frameRatio / imageRatio;
  return gap <= POSTER_COVER_TOLERANCE ? 'cover' : 'contain';
}
