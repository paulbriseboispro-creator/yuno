import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle des lignes de src/pages/AllEventsPage.tsx :
   5 lignes (affiche 72px r4 + titre + méta) séparées par un filet 5 %,
   conteneur 32px 20px, gap 20 — mêmes cotes que l'ancien placeholder inerte. */
export function AllEventsRowsSkeleton() {
  return (
    <div style={{ padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: 20 }} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        >
          <Shimmer width={72} height={72} style={{ borderRadius: 4, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkeletonLine width="55%" height={12} style={{ borderRadius: 4 }} />
            <SkeletonLine width="35%" height={10} style={{ borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
