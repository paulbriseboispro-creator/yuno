import { Shimmer, SkeletonLine } from './Shimmer';
import { CheckoutBarSkeleton, CheckoutStepHeaderSkeleton } from './CheckoutChromeSkeleton';

/* Silhouette fidèle de src/pages/TableCheckout.tsx (étape 1, celle qui
   s'affiche au chargement) : en-tête d'étape (« Votre table · Étape 1 sur 3 »)
   → en-tête de formule (titre + sous-titre, bouton « changer de zone ») →
   compteur de convives (carte p-6 : − / chiffre / +, jauge) → méta de la soirée
   → carte de prix (lignes, total, rangée code promo) → barre plate collée en
   bas (montant, frais, bouton « Continuer »). Mêmes conteneurs (max-w-lg / max-w-md). */
export function TableCheckoutSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }} aria-hidden>
      <CheckoutStepHeaderSkeleton progress={1 / 3} />

      <div className="mx-auto max-w-lg px-4 pb-48 pt-5">
        {/* En-tête de formule */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <SkeletonLine width="60%" height={30} />
            <SkeletonLine width={110} height={10} className="mt-1.5" />
          </div>
          <Shimmer width={130} height={36} className="shrink-0" style={{ borderRadius: 4 }} />
        </div>

        {/* Compteur de convives */}
        <div className="rounded-[10px] border border-white/[0.08] bg-[#141414] p-6">
          <SkeletonLine width={120} height={10} className="mx-auto mb-6" />
          <div className="flex items-center justify-center gap-8">
            <Shimmer width={56} height={56} className="rounded-full" />
            <div className="flex w-24 flex-col items-center">
              <Shimmer width={40} height={56} className="rounded" />
              <SkeletonLine width={64} height={9} className="mt-1.5" />
            </div>
            <Shimmer width={56} height={56} className="rounded-full" />
          </div>
          <div className="mt-6 px-2">
            <Shimmer width="100%" height={8} className="rounded-full" />
            <div className="mt-2 flex justify-between">
              <SkeletonLine width={48} height={9} />
              <SkeletonLine width={48} height={9} />
            </div>
          </div>
        </div>

        {/* Méta de la soirée */}
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5">
          <SkeletonLine width={100} height={12} />
          <SkeletonLine width={56} height={12} />
          <SkeletonLine width={120} height={12} />
        </div>

        {/* Carte de prix + rangée code promo */}
        <div className="mt-5 overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
          <div className="space-y-2.5 p-3.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex h-5 items-center justify-between gap-3">
                <SkeletonLine width={i === 0 ? 96 : 120} height={12} />
                <SkeletonLine width={64} height={12} />
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
              <SkeletonLine width={80} height={15} />
              <SkeletonLine width={90} height={20} />
            </div>
          </div>
          <div className="flex h-11 items-center border-t border-white/[0.07] px-3.5">
            <SkeletonLine width={130} height={12} />
          </div>
        </div>
      </div>

      <CheckoutBarSkeleton />
    </div>
  );
}
