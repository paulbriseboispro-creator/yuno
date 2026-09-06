import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/TicketCheckout.tsx :
   header sticky h-12 (retour + titre centré + badge +18) → CheckoutSteps
   (3 pastilles reliées) → carte du tarif (filet gauche, nom + prix) →
   stepper de quantité (− / chiffre / +) → filet → label de section réglé →
   carte participant (en-tête numéroté + 4 champs h-11) →
   barre flottante (total + bouton). Mêmes conteneurs (max-w-lg / max-w-md). */
export function TicketCheckoutSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Header sticky */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center justify-between px-4 h-12">
          <Shimmer width={32} height={32} style={{ borderRadius: 2 }} />
          <SkeletonLine width={150} height={11} className="mx-3" />
          <Shimmer width={34} height={22} style={{ borderRadius: 2 }} />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 pb-36">
        {/* CheckoutSteps */}
        <div className="flex items-center w-full max-w-md mx-auto py-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <Shimmer width={24} height={24} className="rounded-full" />
                <SkeletonLine width={54} height={9} />
              </div>
              {i < 2 && (
                <div className="flex-1 mx-2.5 mb-[1.1rem]">
                  <div className="h-px w-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Carte du tarif */}
        <div
          className="relative border border-white/[0.08] bg-[#141414] overflow-hidden mt-4"
          style={{ borderRadius: 4 }}
        >
          <div className="absolute left-0 inset-y-0 w-[3px] bg-white/10" />
          <div className="pl-5 pr-4 py-4 flex items-start justify-between gap-3">
            <SkeletonLine width="55%" height={17} />
            <SkeletonLine width={78} height={22} />
          </div>
        </div>

        {/* Quantité */}
        <div className="mt-6">
          <SkeletonLine width={130} height={10} className="mx-auto mb-4" />
          <div className="flex items-center justify-center gap-8">
            <Shimmer width={44} height={44} className="rounded-full" />
            <div className="w-16 flex justify-center">
              <Shimmer width={30} height={52} className="rounded" />
            </div>
            <Shimmer width={44} height={44} className="rounded-full" />
          </div>
        </div>

        <div className="my-6 h-px bg-white/[0.06]" />

        {/* Coordonnées */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <span className="shrink-0" style={{ width: 28, height: 1, background: 'rgba(255,255,255,0.10)' }} />
            <SkeletonLine width={150} height={10} />
          </div>
          <SkeletonLine width={220} height={12} />

          <div className="space-y-3 p-4 rounded-[10px] border border-white/[0.08] bg-[#141414]">
            <div className="flex items-center gap-2.5 mb-1">
              <Shimmer width={24} height={24} className="rounded-full" />
              <SkeletonLine width={48} height={11} />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonLine width={i % 2 === 0 ? 90 : 70} height={10} />
                <Shimmer width="100%" height={44} style={{ borderRadius: 8 }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Barre flottante */}
      <div className="fixed bottom-0 left-0 right-0 z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex justify-center px-4 pb-4 bg-[#0A0A0A]">
          <div
            className="inline-flex items-center w-full max-w-md gap-4 rounded-xl px-5 py-3 justify-between"
            style={{
              background: 'rgba(14, 14, 16, 0.92)',
              border: '1px solid rgba(255, 255, 255, 0.10)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          >
            <div className="flex flex-col min-w-0 gap-1">
              <SkeletonLine width={40} height={9} />
              <SkeletonLine width={84} height={22} />
              <SkeletonLine width={64} height={10} />
            </div>
            <Shimmer width={124} height={44} className="shrink-0" style={{ borderRadius: 8 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
