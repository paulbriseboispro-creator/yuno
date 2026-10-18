import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/EventWaitlistPage.tsx (formulaire) :
   bouton retour rond → affiche + kicker/titre/date → titre d'accroche et
   phrase → prénom / nom côte à côte → e-mail → bouton.
   Mêmes conteneurs (max-w-md, px-5) et jetons de thème (bg-background). */
export function EventWaitlistSkeleton() {
  return (
    <div className="relative min-h-screen bg-background" aria-hidden>
      <Shimmer width={40} height={40} className="absolute left-4 top-4 rounded-full" />

      <div className="mx-auto max-w-md px-5 pt-[88px]">
        <div className="flex items-center gap-4">
          <Shimmer width={84} height={104} className="shrink-0 rounded" />
          <div className="flex-1 space-y-2">
            <SkeletonLine width={90} height={10} />
            <SkeletonLine width="80%" height={18} />
            <SkeletonLine width="60%" height={11} />
          </div>
        </div>

        <div className="mt-9 space-y-3">
          <SkeletonLine width="85%" height={32} />
          <SkeletonLine width="100%" height={14} />
          <SkeletonLine width="70%" height={14} />
        </div>

        <div className="mt-7 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Shimmer width="100%" height={54} className="rounded" />
            <Shimmer width="100%" height={54} className="rounded" />
          </div>
          <Shimmer width="100%" height={54} className="rounded" />
          <Shimmer width="100%" height={56} className="rounded" />
        </div>
      </div>
    </div>
  );
}
