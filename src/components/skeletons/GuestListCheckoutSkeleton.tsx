import { Shimmer, SkeletonLine } from './Shimmer';
import { CheckoutBarSkeleton, CheckoutStepHeaderSkeleton } from './CheckoutChromeSkeleton';

/* Silhouette fidèle de src/pages/GuestListCheckout.tsx (« Vos infos ») : en-tête
   d'étape (« Étape 2 sur 3 ») → carte « Votre commande » (affiche + soirée,
   la liste et ses lignes) → titre → trois champs de 48 px → barre plate collée
   en bas (bouton seul : rien à payer). Mêmes conteneurs (max-w-lg / max-w-md). */
export function GuestListCheckoutSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }} aria-hidden>
      <CheckoutStepHeaderSkeleton progress={2 / 3} />

      <div className="mx-auto max-w-lg px-4 pb-40 pt-5">
        <div className="overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
          <div className="flex items-center gap-3 p-3.5">
            <Shimmer width={52} height={52} style={{ borderRadius: 6 }} />
            <div className="flex flex-col gap-2">
              <SkeletonLine width={150} height={10} />
              <SkeletonLine width={190} height={16} />
            </div>
          </div>
          <div className="h-px bg-white/[0.07]" />
          <div className="flex items-start gap-3 p-3.5">
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonLine width="55%" height={14} />
              <SkeletonLine width="70%" height={12} />
              <SkeletonLine width="35%" height={10} />
            </div>
            <SkeletonLine width={56} height={11} />
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-[18px]">
          <div className="flex flex-col gap-2">
            <SkeletonLine width="72%" height={24} />
            <SkeletonLine width={200} height={12} />
          </div>
          {[96, 64, 88].map((w) => (
            <div key={w} className="flex flex-col gap-[7px]">
              <SkeletonLine width={w} height={11} />
              <Shimmer width="100%" height={48} style={{ borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </div>

      <CheckoutBarSkeleton withTotal={false} />
    </div>
  );
}
