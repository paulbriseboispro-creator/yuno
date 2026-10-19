import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/TicketCheckout.tsx (page « Vos infos ») :
   en-tête sticky h-14 (retour carré + étape centrée sur deux lignes) → carte
   « Votre commande » (affiche + soirée, billet + quantité, code promo) → titre
   → trois champs de 48 px → date en trois cases → barre plate collée en bas
   (total, frais, bouton pleine largeur). Mêmes conteneurs (max-w-lg / max-w-md). */
export function TicketCheckoutSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }} aria-hidden>
      <div
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.92)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="mx-auto flex h-14 max-w-lg items-center gap-3 px-4">
          <Shimmer width={40} height={40} style={{ borderRadius: 4 }} />
          <div className="flex flex-1 flex-col items-center gap-1.5">
            <SkeletonLine width={84} height={11} />
            <SkeletonLine width={70} height={9} />
          </div>
          <span className="w-10" />
        </div>
      </div>

      <div className="mx-auto max-w-lg px-4 pt-5">
        <div className="overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
          <div className="flex items-center gap-3 p-3.5">
            <Shimmer width={52} height={52} style={{ borderRadius: 6 }} />
            <div className="flex flex-col gap-2">
              <SkeletonLine width={150} height={10} />
              <SkeletonLine width={190} height={16} />
            </div>
          </div>
          <div className="h-px bg-white/[0.07]" />
          <div className="flex items-center gap-3 p-3.5">
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonLine width="70%" height={14} />
              <SkeletonLine width="45%" height={12} />
            </div>
            <Shimmer width={40} height={40} style={{ borderRadius: 4 }} />
            <SkeletonLine width={14} height={16} />
            <Shimmer width={40} height={40} style={{ borderRadius: 4 }} />
          </div>
          <div className="flex h-11 items-center border-t border-white/[0.07] px-3.5">
            <SkeletonLine width={130} height={12} />
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
          <div className="flex flex-col gap-[7px]">
            <SkeletonLine width={130} height={11} />
            <div className="flex gap-2">
              <Shimmer width={72} height={48} style={{ borderRadius: 8 }} />
              <Shimmer width={72} height={48} style={{ borderRadius: 8 }} />
              <Shimmer width={100} height={48} style={{ borderRadius: 8 }} />
            </div>
          </div>
        </div>
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{ background: 'rgba(14,14,16,0.94)', borderTop: '1px solid rgba(255,255,255,0.10)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="mx-auto w-full max-w-md px-4 pb-3 pt-3">
          <div className="mb-3 flex items-baseline justify-between">
            <SkeletonLine width={40} height={10} />
            <SkeletonLine width={84} height={22} />
          </div>
          <Shimmer width="100%" height={48} style={{ borderRadius: 4 }} />
          <div className="mt-2.5 flex justify-center">
            <SkeletonLine width={220} height={11} />
          </div>
        </div>
      </div>
    </div>
  );
}
