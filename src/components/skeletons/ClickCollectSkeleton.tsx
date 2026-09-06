import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/ClickCollect.tsx (barman, app Pro) :
   header sticky h-14/h-16 sous la safe-area (retour 40px + icône + titre,
   filtre de soirée en sm+ et sélecteur de langue) → filtre de soirée mobile
   h-11 → onglets 3 colonnes → cartes commandes (n° + date vs badge, lignes
   d'articles, total + action). Mêmes conteneurs (max-w-7xl, p-3 sm:p-4). */
export function ClickCollectSkeleton() {
  return (
    <div className="min-h-screen pb-20" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Header sticky */}
      <div
        className="sticky top-0 z-40"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: 'rgba(15,15,15,0.80)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:px-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <Shimmer width={40} height={40} style={{ borderRadius: 6, flexShrink: 0 }} />
            <Shimmer width={20} height={20} className="rounded" style={{ flexShrink: 0 }} />
            <SkeletonLine width={150} height={18} />
          </div>
          <div className="flex flex-none items-center gap-1 sm:gap-2">
            <Shimmer width={200} height={40} className="hidden sm:block" style={{ borderRadius: 6 }} />
            <Shimmer width={64} height={36} style={{ borderRadius: 6 }} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl p-3 sm:p-4">
        {/* Filtre de soirée mobile */}
        <div className="sm:hidden mb-3 flex items-center gap-2">
          <Shimmer width={16} height={16} className="rounded" style={{ flexShrink: 0 }} />
          <Shimmer height={44} className="flex-1" style={{ borderRadius: 6 }} />
        </div>

        {/* Onglets */}
        <div
          className="grid w-full grid-cols-3 gap-0 p-1 mb-4 sm:mb-6"
          style={{ background: '#121212', borderRadius: 8 }}
        >
          {[0, 1, 2].map((i) => (
            <Shimmer key={i} height={40} style={{ borderRadius: 6 }} />
          ))}
        </div>

        {/* Cartes commandes */}
        <div className="space-y-3 sm:space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="p-3 sm:p-4" style={{ background: '#0F0F0F', borderRadius: 8 }}>
              <div className="flex items-start justify-between mb-2 sm:mb-3">
                <div className="min-w-0 space-y-1.5">
                  <SkeletonLine width={130} height={15} />
                  <SkeletonLine width={150} height={12} />
                </div>
                <Shimmer width={64} height={22} className="rounded-full" style={{ marginLeft: 8, flexShrink: 0 }} />
              </div>
              <div className="space-y-1 mb-2 sm:mb-3">
                {[0, 1].map((j) => (
                  <div key={j} className="flex justify-between gap-2">
                    <SkeletonLine width={j === 0 ? '55%' : '40%'} height={13} />
                    <SkeletonLine width={44} height={13} />
                  </div>
                ))}
              </div>
              <div
                className="flex items-center justify-between pt-2 sm:pt-3 gap-2"
                style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}
              >
                <SkeletonLine width={60} height={20} />
                <Shimmer width={44} height={44} className="sm:hidden" style={{ borderRadius: 6 }} />
                <Shimmer width={100} height={36} className="hidden sm:block" style={{ borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
