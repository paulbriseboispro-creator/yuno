import { Shimmer, SkeletonLine } from './Shimmer';
import { ExploreCardsSkeleton } from './ExploreCardsSkeleton';

/* Silhouette fidèle de src/pages/Explore.tsx AVANT que son chunk soit là
   (fallback de route) : header sticky (wordmark 20px + pastilles ville/date,
   barre de recherche 40px + bouton filtres 40px) → rangée de chips →
   ExploreCardsSkeleton (celui que la page affiche elle-même pendant la
   requête). Chunk et données montrent donc la même image, sans à-coup. */
export function ExploreSkeleton() {
  return (
    <div className="flex min-h-[100dvh] flex-col" style={{ background: '#0A0A0A' }} aria-hidden>
      <div
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <SkeletonLine width={64} height={20} />
            <SkeletonLine width={36} height={16} style={{ borderRadius: 999 }} />
          </div>
          <div className="flex items-center gap-2">
            <Shimmer width={92} height={28} style={{ borderRadius: 10 }} />
            <Shimmer width={100} height={28} style={{ borderRadius: 10 }} />
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 pb-3">
          <Shimmer height={40} className="flex-1" style={{ borderRadius: 10, background: '#1F1F22' }} />
          <Shimmer width={40} height={40} style={{ borderRadius: 10, background: '#1F1F22' }} />
        </div>
      </div>

      <main className="flex-1">
        <div style={{ padding: '12px 0 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex gap-2 overflow-hidden" style={{ paddingLeft: 20, paddingRight: 20 }}>
            {[88, 72, 96, 80, 110].map((w, i) => (
              <Shimmer key={i} width={w} height={36} style={{ borderRadius: 10, flexShrink: 0 }} />
            ))}
          </div>
        </div>
        <ExploreCardsSkeleton />
      </main>
    </div>
  );
}
