import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle du feed Explore (src/pages/Explore.tsx) :
   hero 300px r20 → rail (label 140×14 + cartes 222×230 r18) →
   rank (label 120×14 + cartes 195×160 r14). Mêmes dimensions que
   l'ancien bloc inline `.skeleton` → zéro layout shift. */
export function ExploreCardsSkeleton() {
  return (
    <div aria-hidden style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Hero */}
      <Shimmer width="100%" height={300} style={{ borderRadius: 20 }} />

      {/* Rail — "À ne pas manquer" */}
      <div>
        <SkeletonLine width={140} height={14} style={{ borderRadius: 6, marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 14, overflow: 'hidden' }}>
          {[1, 2, 3].map((i) => (
            <Shimmer key={i} width={222} height={230} style={{ borderRadius: 18, flexShrink: 0 }} />
          ))}
        </div>
      </div>

      {/* Rank — "Les plus réservés" */}
      <div>
        <SkeletonLine width={120} height={14} style={{ borderRadius: 6, marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 16, overflow: 'hidden' }}>
          {[1, 2, 3].map((i) => (
            <Shimmer key={i} width={195} height={160} style={{ borderRadius: 14, flexShrink: 0 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
