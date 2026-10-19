import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/TicketSelection.tsx :
   bandeau flouté 11rem (+ safe-area) → label d'étape → cartes d'offre
   (OfferCard : nom sur une ligne, description, puis prix + quantité). La page
   garde sa structure, rien ne saute quand les tarifs arrivent. */
export function TicketSelectionSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--sf-0a0a0a)' }} aria-hidden>
      <Shimmer className="rounded-none" style={{ height: 'calc(11rem + env(safe-area-inset-top, 0px))' }} />
      <div className="px-4 pt-5 space-y-5">
        <SkeletonLine width="45%" height={12} />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-md p-4 space-y-2.5"
            style={{ background: 'var(--sf-141414)', border: '1px solid rgb(var(--ink)/0.08)' }}
          >
            <SkeletonLine width="62%" height={15} />
            <SkeletonLine width="90%" height={11} />
            <div className="flex items-center justify-between pt-2">
              <SkeletonLine width={64} height={18} />
              <SkeletonLine width={104} height={32} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
