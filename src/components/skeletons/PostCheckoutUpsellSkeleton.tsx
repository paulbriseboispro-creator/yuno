import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/PostCheckoutUpsell.tsx :
   en-tête (kicker + « passer ») → hero (titre 2 lignes + sous-titre) →
   carte contexte soirée (affiche 48px) → 3 cartes « comment ça marche » →
   section presale (label + badge, lignes boisson 44px + bouton 30px) →
   reste de la carte → barre fixe en bas (CTA 44, max-w 460). */
export function PostCheckoutUpsellSkeleton() {
  const surface: React.CSSProperties = {
    background: '#141414',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
  };
  const drinkRow = (i: number) => (
    <div key={i} className="flex items-center gap-3" style={{ ...surface, padding: '10px 12px' }}>
      <Shimmer width={44} height={44} style={{ borderRadius: 6, flexShrink: 0 }} />
      <div className="min-w-0 flex-1">
        <SkeletonLine width="60%" height={14} />
        <SkeletonLine width={52} height={12} className="mt-1" />
      </div>
      <Shimmer width={30} height={30} style={{ borderRadius: 8, flexShrink: 0 }} />
    </div>
  );

  return (
    <div
      className="min-h-[100dvh] overflow-x-hidden"
      style={{ background: '#0A0A0A', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}
      aria-hidden
    >
      <div className="mx-auto px-5" style={{ maxWidth: 460 }}>
        {/* En-tête */}
        <div className="flex items-center justify-between" style={{ paddingTop: 18 }}>
          <SkeletonLine width={150} height={11} />
          <SkeletonLine width={64} height={11} />
        </div>

        {/* Hero */}
        <div style={{ marginTop: 22 }}>
          <SkeletonLine width="92%" height={36} />
          <SkeletonLine width="58%" height={36} className="mt-1.5" />
          <SkeletonLine width="96%" height={13} style={{ marginTop: 12 }} />
          <SkeletonLine width="74%" height={13} className="mt-2" />
        </div>

        {/* Contexte soirée */}
        <div className="flex items-center gap-3.5" style={{ ...surface, marginTop: 20, padding: 12 }}>
          <Shimmer width={48} height={48} style={{ borderRadius: 4, flexShrink: 0 }} />
          <div className="min-w-0 flex-1">
            <SkeletonLine width="70%" height={14} />
            <SkeletonLine width="45%" height={10} className="mt-1.5" />
          </div>
        </div>

        {/* Comment ça marche */}
        <div className="grid grid-cols-3 gap-2" style={{ marginTop: 20 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2" style={{ ...surface, padding: '12px 8px' }}>
              <Shimmer width={17} height={17} className="rounded" />
              <SkeletonLine width="85%" height={11} />
              <SkeletonLine width="60%" height={11} />
            </div>
          ))}
        </div>

        {/* Presale */}
        <section style={{ marginTop: 28 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <SkeletonLine width={28} height={2} />
              <SkeletonLine width={120} height={10} />
            </div>
            <Shimmer width={72} height={20} style={{ borderRadius: 3 }} />
          </div>
          <SkeletonLine width="65%" height={12} style={{ marginBottom: 12 }} />
          <div className="space-y-2">{[0, 1, 2].map(drinkRow)}</div>
        </section>

        {/* Reste de la carte */}
        <section style={{ marginTop: 28 }}>
          <div className="flex items-center gap-3 mb-3">
            <SkeletonLine width={28} height={2} />
            <SkeletonLine width={90} height={10} />
          </div>
          <div className="space-y-2">{[3, 4].map(drinkRow)}</div>
        </section>
      </div>

      {/* Barre fixe : payer ou passer */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 px-4"
        style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))', paddingTop: 12, background: 'linear-gradient(to top, rgba(10,10,10,0.97) 65%, transparent)' }}
      >
        <div className="mx-auto w-full" style={{ maxWidth: 460 }}>
          <Shimmer width="100%" height={44} style={{ borderRadius: 3 }} />
        </div>
      </div>
    </div>
  );
}
