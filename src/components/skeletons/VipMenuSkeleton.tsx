import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/VipMenu.tsx :
   header sticky glassmorphe (retour 36px + titre + pastille convive) →
   carte crédit (filet haut, kicker + tags, gros chiffre, barre de progression)
   → label de section à filet → recherche h-42 → rangée de puces catégories →
   cartes articles (visuel 96×128 + marque / nom / contenance / description /
   prix + bouton). Même colonne de lecture (maxWidth 768, px-4) que la page.
   Pas de barre panier : elle n'apparaît qu'une fois un article ajouté. */
export function VipMenuSkeleton() {
  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Header sticky */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ maxWidth: 768, margin: '0 auto' }}>
          <Shimmer width={36} height={36} style={{ borderRadius: 2, flexShrink: 0 }} />
          <SkeletonLine width={150} height={19} className="flex-1" style={{ maxWidth: 150 }} />
          <Shimmer width={96} height={28} className="rounded-full" style={{ marginLeft: 'auto', flexShrink: 0 }} />
        </div>
      </div>

      <div className="px-4 py-5 space-y-6" style={{ maxWidth: 768, margin: '0 auto' }}>
        {/* Carte crédit (CreditBudgetBar) */}
        <div
          className="overflow-hidden"
          style={{ background: '#141414', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Shimmer width="100%" height={2} className="rounded-none bg-white/10" />
          <div className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <SkeletonLine width={92} height={10} />
              <div className="flex items-center gap-1.5">
                <Shimmer width={62} height={20} className="rounded-full" />
                <Shimmer width={74} height={20} className="rounded-full" />
              </div>
            </div>
            <SkeletonLine width={110} height={10} />
            <SkeletonLine width={130} height={44} className="mt-2" />
            <div className="mt-4">
              <Shimmer width="100%" height={2} style={{ borderRadius: 1 }} />
              <div className="flex items-center justify-between mt-2">
                <SkeletonLine width={120} height={10} />
                <SkeletonLine width={84} height={10} />
              </div>
            </div>
          </div>
        </div>

        {/* Section bouteilles : label à filet + recherche + puces */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <SkeletonLine width={28} height={1} />
            <SkeletonLine width={90} height={10} />
          </div>
          <Shimmer width="100%" height={42} className="mb-3" style={{ borderRadius: 10 }} />
          <div className="flex gap-2 overflow-hidden pb-1">
            {[88, 104, 76, 96].map((w, i) => (
              <Shimmer key={i} width={w} height={28} style={{ borderRadius: 10, flexShrink: 0 }} />
            ))}
          </div>
        </div>

        {/* Articles */}
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex gap-4 p-3"
              style={{ background: '#141414', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Shimmer width={96} height={128} className="bg-white/10" style={{ borderRadius: 4, flexShrink: 0 }} />
              <div className="flex-1 min-w-0 flex flex-col">
                <SkeletonLine width={60} height={10} />
                <SkeletonLine width="72%" height={17} className="mt-1" />
                <SkeletonLine width={40} height={10} className="mt-1.5" />
                <SkeletonLine width="90%" height={12} className="mt-2" />
                <SkeletonLine width="65%" height={12} className="mt-1" />
                <div className="mt-auto pt-3 flex items-end justify-between gap-2">
                  <SkeletonLine width={56} height={22} />
                  <Shimmer width={76} height={36} style={{ borderRadius: 3 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
