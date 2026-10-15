import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/EventDetails.tsx :
   contrôles → scène 16:9 arrondie (colonne 768, 20 px des bords) → badges,
   titre, « présente » → double bloc date / ouverture → ligne lieu → rangée
   d'actions → callout billets. Mêmes ratios/paddings que la page réelle. */
export function EventDetailsSkeleton() {
  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--sf-0a0a0a)' }} aria-hidden>
      <div style={{ maxWidth: 768, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 20px 0' }}>
        {/* Boutons haut (back / share / fav) */}
        <div className="flex items-start justify-between" style={{ marginBottom: 18 }}>
          <Shimmer width={40} height={40} style={{ borderRadius: 4 }} />
          <div className="flex items-center gap-2">
            <Shimmer width={40} height={40} style={{ borderRadius: 4 }} />
            <Shimmer width={40} height={40} style={{ borderRadius: 4 }} />
          </div>
        </div>

        {/* Scène 16:9 */}
        <div className="w-full yuno-shimmer bg-white/5" style={{ aspectRatio: '16 / 9', borderRadius: 14 }} />

        {/* Badges + titre + présente */}
        <div style={{ paddingTop: 'clamp(24px, 6vw, 34px)' }}>
          <SkeletonLine width={90} height={22} className="mb-4" style={{ borderRadius: 10 }} />
          <SkeletonLine width="80%" height={40} className="mb-2" />
          <SkeletonLine width="55%" height={40} className="mb-5" />
          <SkeletonLine width={150} height={14} />
        </div>

        {/* Double bloc date / ouverture */}
        <div className="flex items-stretch" style={{ marginTop: 22, padding: '22px 0', borderTop: '1px solid rgb(var(--ink)/0.08)', borderBottom: '1px solid rgb(var(--ink)/0.08)' }}>
          <div className="flex-1 space-y-3">
            <SkeletonLine width={70} height={9} />
            <SkeletonLine width={64} height={50} />
            <SkeletonLine width={80} height={10} />
          </div>
          <div className="shrink-0" style={{ width: 1, background: 'rgb(var(--ink)/0.08)', margin: '0 24px' }} />
          <div className="flex-1 space-y-3">
            <SkeletonLine width={80} height={9} />
            <SkeletonLine width={120} height={50} />
            <SkeletonLine width={80} height={10} />
          </div>
        </div>
        {/* Ligne lieu */}
        <div style={{ padding: '16px 0', borderBottom: '1px solid rgb(var(--ink)/0.08)' }}>
          <SkeletonLine width="60%" height={12} />
        </div>
      </div>

      <div style={{ maxWidth: 768, margin: '0 auto' }}>
        {/* Rangée d'actions */}
        <div className="grid grid-cols-2 gap-2.5" style={{ padding: '18px 20px clamp(20px, 4vw, 28px)', borderBottom: '1px solid rgb(var(--ink)/0.07)' }}>
          <Shimmer width="100%" height={42} style={{ borderRadius: 4 }} />
          <Shimmer width="100%" height={42} style={{ borderRadius: 4 }} />
        </div>

        {/* Callout billets */}
        <div style={{ padding: '20px 20px 0' }}>
          <SkeletonLine width={160} height={12} className="mb-3" />
          <Shimmer width="100%" height={84} style={{ borderRadius: 4 }} />
        </div>
      </div>
    </div>
  );
}
