import { Shimmer, SkeletonCircle, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/LoyaltyHub.tsx :
   hero (lien retour → trophée + titre centrés → sous-titre → 2 cartes de
   stats côte à côte) → kicker « mes clubs » à filet → cartes club
   (anneau de progression 64px + nom / badge de palier / points / prochaine
   récompense + chevron) → carte « découvrir » en pointillés.
   Mêmes conteneurs (px-4, rounded-2xl) que la page réelle. */
export function LoyaltyHubSkeleton() {
  return (
    <div className="min-h-screen pb-24" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="relative px-4 pt-4 pb-6">
          <div className="flex items-center gap-1.5 mb-6">
            <Shimmer width={16} height={16} className="rounded" />
            <SkeletonLine width={52} height={14} />
          </div>

          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-2">
              <Shimmer width={24} height={24} className="rounded" />
              <SkeletonLine width={140} height={28} />
            </div>
            <SkeletonLine width={220} height={14} className="mx-auto" />
          </div>

          {/* Cartes de stats */}
          <div className="grid grid-cols-2 gap-2 mt-6">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-2xl p-3 flex flex-col items-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <Shimmer width={16} height={16} className="rounded mb-1" />
                <SkeletonLine width={48} height={24} className="mb-1" />
                <SkeletonLine width={70} height={10} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cartes club */}
      <div className="px-4 space-y-3 mt-2">
        <div className="flex items-center gap-2 px-1">
          <SkeletonLine width={90} height={12} />
          <span className="flex-1" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
        </div>

        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-full rounded-2xl overflow-hidden p-4"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center gap-3">
              <SkeletonCircle size={64} className="bg-white/10" style={{ flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <SkeletonLine width="55%" height={14} />
                  <Shimmer width={28} height={18} className="rounded-full" />
                </div>
                <div className="flex items-baseline gap-1 mb-1">
                  <SkeletonLine width={60} height={24} />
                  <SkeletonLine width={20} height={12} />
                </div>
                <div className="flex items-center gap-1">
                  <Shimmer width={12} height={12} className="rounded" style={{ flexShrink: 0 }} />
                  <SkeletonLine width="50%" height={12} />
                  <Shimmer width={30} height={18} className="rounded-full" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                </div>
              </div>
              <Shimmer width={16} height={16} className="rounded" style={{ flexShrink: 0 }} />
            </div>
          </div>
        ))}

        {/* Carte « découvrir » */}
        <div
          className="w-full p-4 rounded-2xl flex items-center justify-center gap-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.10)' }}
        >
          <Shimmer width={16} height={16} className="rounded" />
          <SkeletonLine width={150} height={14} />
          <Shimmer width={16} height={16} className="rounded" />
        </div>
      </div>
    </div>
  );
}
