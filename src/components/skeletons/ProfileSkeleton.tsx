import { Shimmer, SkeletonLine, SkeletonCircle, SkeletonCard } from './Shimmer';

/* Silhouette fidèle de src/pages/Profile.tsx :
   hero immersif 380px (avatar centré pt-20) → assistant CTA →
   quick stats (grid 2 col) → streak → hub fidélité → nightlife → fun stats.
   Mêmes conteneurs/espacements que la page réelle → zéro layout shift. */
export function ProfileSkeleton() {
  return (
    <div className="min-h-screen bg-background pb-24" aria-hidden>
      <div className="mx-auto max-w-3xl p-3 sm:p-4 space-y-4 sm:space-y-6">
        {/* Hero header — miroir de ProfileHeader (minHeight 380, avatar centré) */}
        <div
          className="relative -mx-3 sm:-mx-4 -mt-3 sm:-mt-4 overflow-hidden"
          style={{ minHeight: 380, paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="absolute inset-0 bg-white/5 animate-pulse" />
          <div className="relative z-10 flex flex-col items-center pt-20">
            <SkeletonCircle size={112} className="bg-white/10" />
            <SkeletonLine width={170} height={24} className="mt-6 bg-white/10" />
            <SkeletonLine width={110} height={12} className="mt-3 bg-white/10" />
          </div>
        </div>

        {/* Yuno assistant — CTA ligne */}
        <SkeletonCard height={64} />

        {/* Quick stats — 2 grandes cartes + rangée centrée */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard height={150} />
            <SkeletonCard height={150} />
          </div>
          <div className="flex items-center justify-center gap-6 py-2">
            <SkeletonLine width={64} height={12} />
            <SkeletonLine width={64} height={12} />
            <SkeletonLine width={64} height={12} />
          </div>
        </div>

        {/* Party streak */}
        <SkeletonCard height={96} />

        {/* Loyalty hub */}
        <SkeletonCard height={180} />

        {/* Nightlife section */}
        <SkeletonCard height={150} />

        {/* Fun stats */}
        <SkeletonCard height={220} />

        {/* Edit info button */}
        <Shimmer width="100%" height={44} className="rounded-xl" />
      </div>
    </div>
  );
}
