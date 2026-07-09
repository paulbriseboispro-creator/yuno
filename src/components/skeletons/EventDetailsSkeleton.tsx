import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/EventDetails.tsx :
   hero cinématique CARRÉ (1:1, plein bleed) avec titre en bas →
   rangée d'actions → callout billets → double bloc date/heure →
   tableau d'infos. Mêmes ratios/paddings que la page réelle. */
export function EventDetailsSkeleton() {
  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Hero 1:1 plein bleed */}
      <div
        className="relative w-full overflow-hidden bg-white/5 animate-pulse"
        style={{ aspectRatio: '1 / 1', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Boutons haut (back / share / fav) */}
        <div
          className="absolute top-0 left-0 right-0 flex items-start justify-between"
          style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 16px 0' }}
        >
          <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
          <div className="flex items-center gap-2">
            <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
            <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
          </div>
        </div>
        {/* Badges + titre + meta en bas */}
        <div className="absolute bottom-0 left-0 right-0" style={{ padding: '0 20px clamp(24px, 5vh, 44px)' }}>
          <SkeletonLine width={90} height={22} className="mb-4 bg-white/10" style={{ borderRadius: 10 }} />
          <SkeletonLine width="80%" height={46} className="mb-3 bg-white/10" />
          <SkeletonLine width="55%" height={12} className="bg-white/10" />
        </div>
      </div>

      <div style={{ maxWidth: 768, margin: '0 auto' }}>
        {/* Rangée d'actions */}
        <div
          className="flex items-center gap-2.5"
          style={{ padding: 'clamp(20px, 4vw, 28px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <Shimmer width={116} height={32} style={{ borderRadius: 2 }} />
          <Shimmer width={116} height={32} style={{ borderRadius: 2 }} />
        </div>

        {/* Callout billets */}
        <div style={{ padding: '20px 20px 0' }}>
          <SkeletonLine width={160} height={12} className="mb-3" />
          <Shimmer width="100%" height={84} style={{ borderRadius: 4 }} />
        </div>

        {/* Double bloc date / heure */}
        <div style={{ padding: 'clamp(32px, 5vw, 44px) 20px' }}>
          <SkeletonLine width={80} height={12} className="mb-6" />
          <div className="flex items-stretch mb-6 pb-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex-1 space-y-3">
              <SkeletonLine width={40} height={9} />
              <SkeletonLine width={96} height={54} />
              <SkeletonLine width={120} height={16} />
            </div>
            <div className="shrink-0" style={{ width: 1, background: 'rgba(255,255,255,0.07)', margin: '0 24px' }} />
            <div className="flex-1 space-y-3">
              <SkeletonLine width={70} height={9} />
              <SkeletonLine width={110} height={54} />
              <SkeletonLine width={90} height={10} />
            </div>
          </div>
          {/* Tableau d'infos */}
          <Shimmer width="100%" height={96} style={{ borderRadius: 4 }} />
        </div>
      </div>
    </div>
  );
}
