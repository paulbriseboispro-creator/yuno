import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/TicketSelection.tsx :
   bandeau flouté 11rem (+ safe-area) → label d'étape → cartes de tarif
   (#141414, r16, nom + sous-titre + prix). La page garde sa structure,
   rien ne saute quand les tarifs arrivent. */
export function TicketSelectionSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }} aria-hidden>
      <Shimmer className="rounded-none" style={{ height: 'calc(11rem + env(safe-area-inset-top, 0px))' }} />
      <div className="px-4 pt-5 space-y-5">
        <SkeletonLine width="45%" height={12} />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl p-4 flex items-center gap-4"
            style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex-1 min-w-0 space-y-2.5">
              <SkeletonLine width="55%" height={16} />
              <SkeletonLine width="35%" height={12} />
            </div>
            <SkeletonLine width={64} height={22} />
          </div>
        ))}
      </div>
    </div>
  );
}
