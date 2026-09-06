import { Shimmer, SkeletonCircle, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/Welcome.tsx (vue carte, mobile d'abord) :
   header (wordmark 22 + pastille Beta, bascule carte/grille + langue) →
   bandeau marquee 36px → carte plein écran (flex-1) avec la liste flottante
   de clubs en bas (cartes w-64, avatar 48) → colonne latérale desktop (w-96,
   avatars 56) → BottomNav ancrée (pilule 52px). Même conteneur h-[100dvh]. */
export function WelcomeSkeleton() {
  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Header */}
      <div
        className="shrink-0 z-50"
        style={{ background: 'rgba(10,10,10,0.92)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Shimmer width={78} height={22} className="rounded" />
            <Shimmer width={40} height={18} className="rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Shimmer width={66} height={32} className="rounded-full" />
            <Shimmer width={44} height={32} className="rounded-full" />
          </div>
        </div>
      </div>

      {/* Marquee */}
      <div
        className="shrink-0 flex items-center overflow-hidden"
        style={{ height: 36, background: '#0C0C0E', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex shrink-0 items-center"
            style={{ padding: '0 24px', borderRight: '1px solid rgba(255,255,255,0.07)' }}
          >
            <SkeletonLine width={i % 2 === 0 ? 96 : 76} height={11} />
          </div>
        ))}
      </div>

      {/* Carte + liste flottante */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 relative flex min-h-0">
          <div className="flex-1 relative min-h-0">
            <Shimmer className="absolute inset-0 rounded-none" />

            <div className="absolute left-0 right-0 bottom-2 px-4 md:hidden">
              <div className="flex gap-3 overflow-hidden pb-2">
                {[0, 1].map((i) => (
                  <div key={i} className="shrink-0 w-64">
                    <div
                      className="rounded-xl p-3"
                      style={{ background: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      <div className="flex items-center gap-3">
                        <SkeletonCircle size={48} className="shrink-0 bg-white/10" />
                        <div className="flex-1 min-w-0">
                          <SkeletonLine width="60%" height={16} />
                          <SkeletonLine width="40%" height={12} className="mt-1" />
                          <Shimmer width={96} height={20} className="mt-1.5 rounded-full" />
                        </div>
                        <SkeletonCircle size={32} className="shrink-0" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Colonne latérale desktop */}
          <div
            className="hidden md:flex w-96 flex-col"
            style={{ borderLeft: '1px solid rgba(255,255,255,0.08)', background: 'rgba(10,10,10,0.95)' }}
          >
            <div className="p-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <SkeletonLine width={150} height={16} />
              <SkeletonLine width={60} height={12} className="mt-1.5" />
            </div>
            <div className="flex-1 overflow-hidden p-3 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-xl p-3"
                  style={{ background: 'rgba(20,20,20,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="flex items-center gap-3">
                    <SkeletonCircle size={56} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <SkeletonLine width="55%" height={16} />
                      <SkeletonLine width="35%" height={14} className="mt-1" />
                    </div>
                    <SkeletonCircle size={36} className="shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* BottomNav ancrée (mode docked) */}
      <div
        className="w-full shrink-0 flex justify-center px-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.625rem)' }}
      >
        <Shimmer
          width={248}
          height={52}
          className="rounded-full"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}
        />
      </div>
    </div>
  );
}
