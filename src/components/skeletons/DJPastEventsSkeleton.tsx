import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/DJPastEventsPage.tsx (max-w-xl) :
   en-tête px-5 (back 36px radius 2 + kicker + titre) → « plus grosses
   soirées » (label à filet, 3 rangées : rang 28px, affiche 48×56 radius 6,
   2 lignes, compteur) → « toutes les soirées passées » (en-tête à filet,
   4 rangées : affiche 48×56 radius 3, 2 lignes). Mêmes filets rgba(.06)
   et env(safe-area-inset-top) que la page réelle. */
export function DJPastEventsSkeleton() {
  return (
    <div className="relative min-h-[100dvh] flex flex-col" style={{ background: '#0A0A0A' }} aria-hidden>
      <main className="flex-1 pb-28 mx-auto w-full max-w-xl">
        {/* En-tête */}
        <div className="flex items-center gap-3 px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)', paddingBottom: 12 }}>
          <Shimmer width={36} height={36} style={{ borderRadius: 2 }} />
          <div className="min-w-0 space-y-1.5">
            <SkeletonLine width={90} height={10} />
            <SkeletonLine width={170} height={20} />
          </div>
        </div>

        {/* Top 5 */}
        <div className="pt-4">
          <div className="flex items-center gap-3 mb-4 px-5">
            <SkeletonLine width={28} height={1} />
            <SkeletonLine width={130} height={10} />
          </div>
          <div className="flex flex-col">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="shrink-0 flex justify-center" style={{ width: 28 }}>
                  <SkeletonLine width={14} height={24} />
                </div>
                <Shimmer width={48} height={56} style={{ borderRadius: 6, flexShrink: 0 }} />
                <div className="flex-1 min-w-0 space-y-2">
                  <SkeletonLine width="70%" height={14} />
                  <SkeletonLine width="50%" height={11} />
                </div>
                <SkeletonLine width={36} height={12} className="shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Toutes les soirées passées */}
        <div className="pt-9">
          <div className="px-5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
            <SkeletonLine width={110} height={10} />
            <SkeletonLine width={14} height={10} />
          </div>
          <div className="px-5 pt-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <Shimmer width={48} height={56} style={{ borderRadius: 3, flexShrink: 0 }} />
                <div className="flex-1 min-w-0 space-y-2">
                  <SkeletonLine width="66%" height={14} />
                  <SkeletonLine width="48%" height={11} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
