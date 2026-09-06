import { Shimmer, SkeletonCircle, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/LiveMode.tsx :
   LiveHeader sticky (pastille 36 + venue/soirée + ✕ 36) →
   LiveEventContext (poster h-56 avec titre ancré en bas, line-up DJ, chips
   ambiance) → colonne max-w-lg : LiveMinSpendBar (carte #141414, jauge) →
   LiveMenu (titre, recherche 44px, chips catégories, grille 2 colonnes de
   cartes boisson : visuel carré + nom/prix + double CTA 44px). */
export function LiveModeSkeleton() {
  return (
    <div
      className="min-h-screen"
      style={{ background: '#0A0A0A', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 128px)' }}
      aria-hidden
    >
      {/* LiveHeader */}
      <div
        className="sticky top-0 z-40"
        style={{
          background: 'rgba(10,10,10,0.86)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <SkeletonCircle size={36} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <SkeletonLine width={36} height={10} />
            <SkeletonLine width="62%" height={18} className="mt-1" />
            <SkeletonLine width="78%" height={10} className="mt-1" />
          </div>
          <SkeletonCircle size={36} className="shrink-0" />
        </div>
      </div>

      {/* LiveEventContext : poster + bloc titre ancré en bas */}
      <section className="relative overflow-hidden">
        <div className="relative h-56 w-full yuno-shimmer bg-white/5">
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0) 0%, rgba(10,10,10,0.35) 45%, #0A0A0A 100%)' }}
          />
          <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
            <div className="mx-auto max-w-lg">
              <SkeletonLine width={110} height={10} className="bg-white/10" />
              <SkeletonLine width="72%" height={27} className="mt-1 bg-white/10" />
              <SkeletonLine width={150} height={10} className="mt-1.5 bg-white/10" />
            </div>
          </div>
        </div>

        {/* Line-up + ambiance */}
        <div className="mx-auto max-w-lg px-4 pb-1 pt-3">
          <SkeletonLine width={64} height={10} className="mb-2" />
          <div className="mb-3 flex gap-2.5 overflow-hidden pb-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex shrink-0 items-center gap-2">
                <SkeletonCircle size={36} />
                <div className="pr-1">
                  <SkeletonLine width={64} height={11} />
                  <SkeletonLine width={40} height={8} className="mt-1" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[56, 72, 48].map((w, i) => (
              <Shimmer key={i} width={w} height={19} className="rounded-full" />
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-lg">
        {/* LiveMinSpendBar */}
        <section
          className="mx-4 mt-4 p-4"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <SkeletonLine width={110} height={10} />
            <SkeletonLine width={70} height={12} />
          </div>
          <Shimmer width="100%" height={6} className="mt-2 rounded-full" />
          <SkeletonLine width={120} height={10} className="mt-2" />
        </section>

        {/* LiveMenu */}
        <section className="mt-5">
          <div className="px-4">
            <SkeletonLine width={120} height={15} />
          </div>
          <div className="mt-3 px-4">
            <Shimmer width="100%" height={44} className="rounded" style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.1)' }} />
          </div>
          <div className="mt-3 flex gap-2 overflow-hidden px-4 pb-1">
            {[78, 64, 66, 90].map((w, i) => (
              <Shimmer key={i} width={w} height={28} className="shrink-0 rounded-full" />
            ))}
          </div>

          <div className="px-4 pt-3">
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex flex-col overflow-hidden"
                  style={{ background: '#000', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
                >
                  <Shimmer width="100%" className="rounded-none bg-white/10" style={{ aspectRatio: '1 / 1' }} />
                  <div className="flex flex-1 flex-col px-3 pt-2.5">
                    <SkeletonLine width="85%" height={12} />
                    <SkeletonLine width="55%" height={12} className="mt-1" />
                    <SkeletonLine width={48} height={14} className="mt-1.5" />
                  </div>
                  <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-1.5 p-2.5 pt-0">
                    <Shimmer height={44} className="rounded" />
                    <Shimmer width={52} height={44} className="rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
