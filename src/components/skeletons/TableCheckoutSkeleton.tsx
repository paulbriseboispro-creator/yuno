import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/TableCheckout.tsx (étape 1, celle qui
   s'affiche au chargement) : header fixe h-12 (lien retour) →
   VipCheckoutSteps (3 pastilles h-7 reliées) → en-tête de formule (titre +
   sous-titre, pilule « changer de zone ») → compteur de convives (carte p-6 :
   − / chiffre / +, jauge) → méta de la soirée → carte de prix (3 lignes +
   total) → bouton « Suivant » plein rond. Pas de barre flottante à l'étape 1.
   Mêmes conteneurs (max-w-lg / max-w-md). */
export function TableCheckoutSkeleton() {
  return (
    <div className="min-h-screen pb-24" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Header fixe */}
      <div
        className="fixed top-0 z-40 w-full"
        style={{ background: 'rgba(10,10,10,0.90)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="mx-auto flex h-12 max-w-lg items-center px-4">
          <Shimmer width={84} height={32} className="-ml-2 rounded" />
        </div>
      </div>

      <div className="pt-12">
        <div className="mx-auto max-w-lg px-4 py-5">
          {/* VipCheckoutSteps */}
          <div className="flex items-center justify-between w-full max-w-md mx-auto px-2 py-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <Shimmer width={28} height={28} className="rounded-full" />
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

          {/* En-tête de formule */}
          <div className="flex items-start justify-between gap-3 mt-4 mb-5">
            <div className="min-w-0 flex-1">
              <SkeletonLine width="60%" height={30} />
              <SkeletonLine width={110} height={10} className="mt-1.5" />
            </div>
            <Shimmer width={118} height={32} className="shrink-0 rounded-full" />
          </div>

          {/* Compteur de convives */}
          <div className="rounded-[10px] border border-white/[0.08] bg-[#141414] p-6">
            <SkeletonLine width={120} height={10} className="mx-auto mb-6" />
            <div className="flex items-center justify-center gap-8">
              <Shimmer width={56} height={56} className="rounded-full" />
              <div className="w-24 flex flex-col items-center">
                <Shimmer width={40} height={56} className="rounded" />
                <SkeletonLine width={64} height={9} className="mt-1.5" />
              </div>
              <Shimmer width={56} height={56} className="rounded-full" />
            </div>
            <div className="mt-6 px-2">
              <Shimmer width="100%" height={8} className="rounded-full" />
              <div className="flex justify-between mt-2">
                <SkeletonLine width={48} height={9} />
                <SkeletonLine width={48} height={9} />
              </div>
            </div>
          </div>

          {/* Méta de la soirée */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-5">
            <SkeletonLine width={100} height={12} />
            <SkeletonLine width={56} height={12} />
            <SkeletonLine width={120} height={12} />
          </div>

          {/* Carte de prix */}
          <div className="mt-5 border border-white/[0.08] bg-[#141414] p-4 space-y-2.5" style={{ borderRadius: 10 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex justify-between items-center gap-3 h-5">
                <SkeletonLine width={i === 0 ? 96 : 120} height={12} />
                <SkeletonLine width={64} height={12} />
              </div>
            ))}
            <div className="border-t border-white/[0.08] pt-3 mt-1 flex justify-between items-center gap-3">
              <SkeletonLine width={80} height={15} />
              <SkeletonLine width={90} height={20} />
            </div>
            <div className="flex justify-center pt-1">
              <SkeletonLine width={200} height={11} />
            </div>
          </div>

          {/* Bouton Suivant */}
          <Shimmer width="100%" height={48} className="mt-7 rounded-full" />
        </div>
      </div>
    </div>
  );
}
