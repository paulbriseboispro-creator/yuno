import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/CategoryDrinks.tsx :
   header sticky h-14/h-16 (retour + titre + nom du club) → compteur de
   produits → grille DrinkCard 2 colonnes (3 en md, 4 en lg) : image carrée,
   nom + prix, ligne de degré, bouton pilule h-7. Mêmes conteneurs
   (max-w-7xl, px-3 sm:px-4, py-4 sm:py-8) que la page réelle. */
export function CategoryDrinksSkeleton() {
  return (
    <div className="min-h-screen pb-24" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Header sticky */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'rgba(15,15,15,0.80)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center gap-3 sm:gap-4 px-3 sm:px-4">
          <Shimmer width={36} height={36} style={{ borderRadius: 6, flexShrink: 0 }} />
          <div className="flex-1 min-w-0 space-y-1.5">
            <SkeletonLine width={120} height={18} />
            <SkeletonLine width={90} height={10} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-8">
        {/* Compteur */}
        <SkeletonLine width={110} height={14} className="mb-4 sm:mb-6" />

        {/* Grille produits */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="overflow-hidden rounded-2xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              {/* Image carrée */}
              <Shimmer width="100%" className="aspect-square rounded-none bg-white/10" />
              {/* Contenu */}
              <div className="p-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <SkeletonLine width="60%" height={14} />
                  <SkeletonLine width={44} height={16} />
                </div>
                <SkeletonLine width={52} height={10} className="mb-2.5" />
                <Shimmer width="100%" height={28} className="rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
