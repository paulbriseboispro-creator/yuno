import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/GuestListCheckout.tsx :
   header sticky h-12 (retour + titre) → CheckoutSteps (3 pastilles reliées) →
   carte de la soirée (affiche 64px + titre / lieu / date) → 3 pastilles
   d'avantages → carte des places restantes (grand chiffre) → carte formulaire
   (titre, lien connexion, 3 champs h-10, récap) → barre flottante
   (libellé + bouton rond). Mêmes conteneurs (max-w-lg / max-w-md). */
export function GuestListCheckoutSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Header sticky */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-3 px-4 h-12">
          <Shimmer width={32} height={32} style={{ borderRadius: 2 }} />
          <SkeletonLine width={140} height={11} />
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

        {/* Carte de la soirée */}
        <div
          className="mt-4 border border-white/[0.08] bg-[#141414] p-3 flex items-center gap-3"
          style={{ borderRadius: 10 }}
        >
          <Shimmer width={64} height={64} className="shrink-0 bg-white/10" style={{ borderRadius: 6 }} />
          <div className="min-w-0 flex-1">
            <SkeletonLine width="65%" height={15} />
            <SkeletonLine width="40%" height={11} className="mt-1.5" />
            <SkeletonLine width={130} height={10} className="mt-2" />
          </div>
        </div>

        {/* Avantages */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Shimmer width={96} height={26} className="rounded-sm" />
          <Shimmer width={150} height={26} className="rounded-sm" />
          <Shimmer width={130} height={26} className="rounded-sm" />
        </div>

        {/* Places restantes */}
        <div
          className="mt-3 border border-white/[0.08] p-4 flex flex-col items-center"
          style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}
        >
          <SkeletonLine width={48} height={36} />
          <SkeletonLine width={100} height={14} className="mt-1" />
        </div>

        {/* Formulaire */}
        <div className="mt-5 border border-white/[0.08] bg-[#141414] p-4 space-y-4" style={{ borderRadius: 10 }}>
          <div className="space-y-1.5">
            <SkeletonLine width={110} height={14} />
            <SkeletonLine width={200} height={12} />
          </div>
          <SkeletonLine width={220} height={12} />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonLine width={i === 0 ? 90 : 60} height={12} />
                <Shimmer width="100%" height={40} className="rounded-md" />
              </div>
            ))}
          </div>
          <div className="border-t border-white/[0.08] pt-3 flex justify-between items-center">
            <SkeletonLine width="60%" height={14} />
            <SkeletonLine width={30} height={14} />
          </div>
        </div>
      </div>

      {/* Barre flottante */}
      <div className="fixed bottom-0 left-0 right-0 z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex justify-center pb-4 px-4">
          <div
            className="inline-flex items-center w-full max-w-md gap-3 px-4 py-2.5 rounded-2xl justify-between"
            style={{
              background: 'rgba(14, 14, 16, 0.92)',
              border: '1px solid rgba(255, 255, 255, 0.10)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          >
            <SkeletonLine width={150} height={13} />
            <Shimmer width={150} height={44} className="shrink-0 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
