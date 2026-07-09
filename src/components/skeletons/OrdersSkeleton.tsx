import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/MyOrders.tsx (layout temporel) :
   header sticky h-14 → bloc titre → SegControl 3 segments →
   kicker à filet → cartes "en attente" (bandeau + contenu + CTA).
   Mêmes conteneurs (max-w-md, px-4) que la page réelle. */
export function OrdersSkeleton() {
  return (
    <div className="min-h-screen pb-24" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Header sticky */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-4">
          <Shimmer width={36} height={36} style={{ borderRadius: 2 }} />
          <SkeletonLine width={120} height={11} />
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 py-4 space-y-4">
        {/* Bloc titre */}
        <div className="px-1 space-y-2">
          <SkeletonLine width={190} height={26} />
          <SkeletonLine width={140} height={10} />
        </div>

        {/* Segmented control (3 segments) */}
        <div
          className="flex gap-1 p-1"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }}
        >
          {[0, 1, 2].map((i) => (
            <Shimmer key={i} height={42} className="flex-1" style={{ borderRadius: 7 }} />
          ))}
        </div>

        {/* Kicker à filet */}
        <div className="flex items-center gap-3 px-1" style={{ marginTop: 4 }}>
          <SkeletonLine width={28} height={2} />
          <SkeletonLine width={130} height={10} />
          <span className="flex-1" style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
          <SkeletonLine width={16} height={10} />
        </div>

        {/* Cartes commandes */}
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                background: '#141414',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              {/* Bandeau */}
              <Shimmer width="100%" height={30} className="rounded-none" />
              {/* Contenu */}
              <div className="flex items-center gap-3" style={{ padding: '11px 12px 9px' }}>
                <Shimmer width={42} height={42} style={{ borderRadius: 8, flexShrink: 0 }} />
                <div className="flex-1 space-y-2">
                  <SkeletonLine width="70%" height={14} />
                  <SkeletonLine width="45%" height={10} />
                </div>
                <SkeletonLine width={36} height={13} />
              </div>
              {/* CTA */}
              <div style={{ padding: '0 12px 12px' }}>
                <Shimmer width="100%" height={40} style={{ borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
