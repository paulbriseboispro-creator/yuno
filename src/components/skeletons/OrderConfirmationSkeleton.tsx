import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/OrderConfirmation.tsx :
   bouton retour flottant → hero affiche 4:5 (badge confirmé + compte à rebours,
   kicker, titre, date) → colonne de lecture max-w 600 : « Ton pass » (QR blanc
   224px, légende, lignes de détail sur surface #141414) → « Et maintenant ? »
   (3 étapes 38px reliées) → « Prépare ta soirée » (2 cartes) → partage (CTA 44). */
export function OrderConfirmationSkeleton() {
  const surface: React.CSSProperties = {
    background: '#141414',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
  };
  const ruledLabel = (width: number) => (
    <div className="flex items-center gap-3">
      <SkeletonLine width={28} height={2} />
      <SkeletonLine width={width} height={10} />
    </div>
  );

  return (
    <div
      className="min-h-[100dvh] overflow-x-hidden"
      style={{ background: '#0A0A0A', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
      aria-hidden
    >
      {/* Retour flottant */}
      <div className="absolute left-0 right-0 z-30 flex px-4" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
        <Shimmer width={118} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
      </div>

      {/* Hero affiche */}
      <section
        className="relative w-full overflow-hidden yuno-shimmer bg-white/5"
        style={{ aspectRatio: '4 / 5', maxHeight: '64vh', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="absolute inset-x-0 bottom-0 px-5 pb-7" style={{ maxWidth: 600, margin: '0 auto' }}>
          <div className="flex items-center gap-2.5 mb-3">
            <Shimmer width={112} height={26} className="bg-white/10 rounded-full" />
            <Shimmer width={78} height={26} className="bg-white/10 rounded-full" />
          </div>
          <SkeletonLine width={110} height={10} className="mb-2 bg-white/10" />
          <SkeletonLine width="82%" height={44} className="bg-white/10" />
          <SkeletonLine width={200} height={11} className="mt-3 bg-white/10" />
        </div>
      </section>

      <div className="mx-auto px-5 w-full box-border" style={{ maxWidth: 600 }}>
        {/* Ton pass */}
        <section className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="mb-5">{ruledLabel(90)}</div>
          <div className="flex flex-col items-center">
            <Shimmer width={224} height={224} className="mb-4 bg-white/10" style={{ borderRadius: 8 }} />
            <SkeletonLine width={190} height={10} className="mb-5" />
            <div className="w-full" style={{ ...surface, padding: '4px 16px' }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex justify-between items-center"
                  style={{ padding: '11px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                >
                  <SkeletonLine width={80} height={10} />
                  <SkeletonLine width={i === 2 ? 64 : 56} height={i === 2 ? 17 : 14} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Et maintenant ? */}
        <section className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="mb-6">{ruledLabel(110)}</div>
          {[0, 1, 2].map((i) => {
            const isLast = i === 2;
            return (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center flex-none">
                  <Shimmer width={38} height={38} style={{ borderRadius: 8 }} />
                  {!isLast && <div style={{ width: 1, flex: 1, minHeight: 18, background: 'rgba(255,255,255,0.10)', margin: '4px 0' }} />}
                </div>
                <div className="flex-1" style={{ paddingBottom: isLast ? 0 : 18 }}>
                  <SkeletonLine width="55%" height={15} />
                  <SkeletonLine width="92%" height={12} className="mt-2" />
                  <SkeletonLine width="70%" height={12} className="mt-1.5" />
                </div>
              </div>
            );
          })}
        </section>

        {/* Prépare ta soirée */}
        <section className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="mb-5">{ruledLabel(130)}</div>
          <div className="grid grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col items-start gap-3" style={{ ...surface, padding: 16 }}>
                <Shimmer width={20} height={20} className="rounded" />
                <SkeletonLine width="70%" height={11} />
              </div>
            ))}
          </div>
          <SkeletonLine width="60%" height={11} className="mt-4" />
        </section>

        {/* Partage */}
        <section className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="mb-3">{ruledLabel(120)}</div>
          <SkeletonLine width="88%" height={14} className="mb-5" />
          <Shimmer width="100%" height={44} style={{ borderRadius: 3 }} />
        </section>
      </div>
    </div>
  );
}
