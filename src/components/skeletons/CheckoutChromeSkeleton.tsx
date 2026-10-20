import { Shimmer, SkeletonLine } from './Shimmer';

/* Le cadre commun du tunnel d'achat public (billets, tables, guest list) :
   l'en-tête d'étape (CheckoutStepHeader : retour carré, étape centrée sur deux
   lignes, trait de progression) et la barre plate du bas (CheckoutSummaryBar :
   total, frais, bouton pleine largeur, phrase dessous). */
export function CheckoutStepHeaderSkeleton({ progress }: { progress: number }) {
  return (
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
      <div className="absolute bottom-[-1px] left-0 h-[2px] bg-white/[0.12]" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

export function CheckoutBarSkeleton({ withTotal = true }: { withTotal?: boolean }) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{ background: 'rgba(14,14,16,0.94)', borderTop: '1px solid rgba(255,255,255,0.10)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto w-full max-w-md px-4 pb-3 pt-3">
        {withTotal && (
          <div className="mb-3 flex items-baseline justify-between">
            <SkeletonLine width={40} height={10} />
            <SkeletonLine width={84} height={22} />
          </div>
        )}
        <Shimmer width="100%" height={48} style={{ borderRadius: 4 }} />
        <div className="mt-2.5 flex justify-center">
          <SkeletonLine width={220} height={11} />
        </div>
      </div>
    </div>
  );
}
