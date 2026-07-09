import { cn } from '@/lib/utils';

/* ============================================================
   Shimmer — primitive de skeleton unifiée (app cliente publique).
   `bg-white/5 animate-pulse` sur fond #0A0A0A, arrondis via
   className ou style.borderRadius (style gagne toujours).
   ============================================================ */

export interface ShimmerProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export function Shimmer({ width, height, className, style }: ShimmerProps) {
  return (
    <div
      aria-hidden
      className={cn('bg-white/5 animate-pulse rounded-lg', className)}
      style={{ width, height, ...style }}
    />
  );
}

/** Ligne de texte (labels, titres) — hauteur 14px par défaut. */
export function SkeletonLine({ width = '100%', height = 14, className, style }: ShimmerProps) {
  return <Shimmer width={width} height={height} className={cn('rounded', className)} style={style} />;
}

/** Cercle (avatars, pastilles). */
export function SkeletonCircle({
  size = 40,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return <Shimmer width={size} height={size} className={cn('rounded-full', className)} style={style} />;
}

/** Carte pleine largeur (blocs de contenu). */
export function SkeletonCard({ width = '100%', height = 120, className, style }: ShimmerProps) {
  return <Shimmer width={width} height={height} className={cn('rounded-2xl', className)} style={style} />;
}
