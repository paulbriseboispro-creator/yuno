import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle du programme de src/pages/MomentPage.tsx :
   5 lignes (affiche 64px r4 + titre + méta), conteneur 20px, gap 18 —
   mêmes cotes que l'ancien placeholder inerte. */
export function MomentRowsSkeleton() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Shimmer width={64} height={64} style={{ borderRadius: 4, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkeletonLine width="55%" height={12} style={{ borderRadius: 4 }} />
            <SkeletonLine width="35%" height={10} style={{ borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
