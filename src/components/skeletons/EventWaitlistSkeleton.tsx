import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/EventWaitlistPage.tsx (formulaire invité) :
   bloc retour p-4 (flèche seule) → bloc titre (icône + titre, soirée,
   sous-titre) → 2 champs h-12 arrondis → bouton h-12 → lien de connexion
   centré. Pas de header sticky ni de barre flottante. Mêmes conteneurs
   (px-5, space-y-6) et mêmes jetons de thème (bg-background) que la page. */
export function EventWaitlistSkeleton() {
  return (
    <div className="min-h-screen bg-background" aria-hidden>
      {/* Retour */}
      <div className="p-4">
        <Shimmer width={20} height={20} className="rounded" />
      </div>

      <div className="px-5 space-y-6">
        {/* Titre */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Shimmer width={20} height={20} className="rounded" />
            <SkeletonLine width={170} height={20} />
          </div>
          <SkeletonLine width="55%" height={14} />
          <SkeletonLine width="70%" height={12} />
        </div>

        {/* Formulaire invité */}
        <div className="space-y-3">
          <Shimmer width="100%" height={48} className="rounded-xl" />
          <Shimmer width="100%" height={48} className="rounded-xl" />
          <Shimmer width="100%" height={48} className="rounded-md" />
          <div className="flex justify-center pt-1">
            <SkeletonLine width={120} height={12} />
          </div>
        </div>
      </div>
    </div>
  );
}
