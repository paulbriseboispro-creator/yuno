import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/VenuePage.tsx :
   hero plein bleed 4:3 (back à gauche, share + fav à droite) →
   bloc identité (logo 92px qui chevauche le hero de −62px, kicker,
   titre display géant, bio 2 lignes, pastille genre, rangée d'actions) →
   stats MUSIC / AREA / AGE à filets → section soirées (label à filet +
   affiches carrées). Mêmes paddings (px-5) et conteneur (max-w-xl). */
export function VenuePageSkeleton() {
  return (
    <div className="min-h-screen pb-20" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Hero 4:3 */}
      <div className="relative overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="absolute left-5 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
          <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
        </div>
        <div className="absolute right-5 z-20 flex items-center gap-2" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
          <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
          <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
        </div>
        <Shimmer width="100%" className="rounded-none" style={{ aspectRatio: '4 / 3' }} />
      </div>

      {/* Bloc identité */}
      <div className="px-5 pt-5">
        <Shimmer
          width={92}
          height={92}
          className="bg-white/10"
          style={{ borderRadius: 14, border: '3px solid #0A0A0A', marginTop: -62, marginBottom: 14, position: 'relative', zIndex: 10 }}
        />
        <SkeletonLine width={110} height={10} className="mb-3" />
        <SkeletonLine width="78%" height={44} className="mb-2" />
        <SkeletonLine width="52%" height={44} className="mb-4" />
        <SkeletonLine width="92%" height={12} className="mb-2" />
        <SkeletonLine width="64%" height={12} className="mb-4" />
        <SkeletonLine width={96} height={24} className="mb-4" style={{ borderRadius: 10 }} />
        <div className="flex items-center gap-3">
          <Shimmer width={104} height={32} style={{ borderRadius: 10 }} />
          <Shimmer width={92} height={32} style={{ borderRadius: 10 }} />
        </div>
      </div>

      {/* Stats à filets */}
      <div className="flex items-start px-5 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col flex-1 min-w-0"
            style={{ paddingRight: 12, paddingLeft: i === 0 ? 0 : 12, borderLeft: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.07)' }}
          >
            <SkeletonLine width={40} height={9} className="mb-2" />
            <SkeletonLine width="70%" height={16} />
          </div>
        ))}
      </div>

      {/* Soirées à venir */}
      <div className="mx-auto max-w-xl pt-8">
        <div className="flex items-center justify-between px-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
          <SkeletonLine width={120} height={10} />
          <SkeletonLine width={48} height={10} />
        </div>
        <div className="px-5 pt-5 flex flex-col gap-6">
          {[0, 1].map((i) => (
            <div key={i}>
              <Shimmer width="100%" className="rounded-xl" style={{ aspectRatio: '1 / 1' }} />
              <SkeletonLine width="60%" height={16} className="mt-3" />
              <SkeletonLine width="38%" height={11} className="mt-2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
