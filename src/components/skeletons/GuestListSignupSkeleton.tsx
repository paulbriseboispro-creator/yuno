import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/GuestListSignup.tsx (formulaire invité) :
   header sticky h-14 (bouton fantôme 40px + titre) → bannière de la soirée
   1:1 arrondie → bloc titre centré (titre / lieu / date) → pastilles
   d'avantages centrées → carte des places restantes (grand chiffre) →
   carte formulaire (titre, lien connexion, 3 champs h-10, récap, bouton
   h-12). Pas de barre flottante. Mêmes conteneurs (max-w-lg, p-4) et mêmes
   jetons de thème (bg-background / border-border) que la page réelle. */
export function GuestListSignupSkeleton() {
  return (
    <div className="min-h-screen bg-background" aria-hidden>
      {/* Header sticky */}
      <div className="sticky top-0 z-40 border-b border-border/40 bg-surface/80">
        <div className="flex items-center gap-3 px-4 h-14">
          <Shimmer width={40} height={40} className="rounded-md" />
          <SkeletonLine width={110} height={16} />
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-6">
        {/* Bannière */}
        <div className="rounded-xl overflow-hidden border border-border/30">
          <Shimmer width="100%" className="aspect-square rounded-xl bg-white/10" />
        </div>

        {/* Infos soirée */}
        <div className="flex flex-col items-center space-y-2 pt-2">
          <SkeletonLine width="65%" height={24} />
          <SkeletonLine width="40%" height={14} />
          <SkeletonLine width="55%" height={12} />
        </div>

        {/* Avantages */}
        <div className="flex flex-wrap justify-center gap-2">
          <Shimmer width={100} height={28} className="rounded-full" />
          <Shimmer width={150} height={28} className="rounded-full" />
        </div>

        {/* Places restantes */}
        <div
          className="rounded-xl border border-white/[0.08] p-5 flex flex-col items-center"
          style={{ background: 'rgba(255,255,255,0.03)' }}
        >
          <SkeletonLine width={48} height={36} />
          <SkeletonLine width={100} height={14} className="mt-1" />
        </div>

        {/* Formulaire */}
        <div className="rounded-lg border border-border/50 bg-card">
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <SkeletonLine width={110} height={14} />
              <SkeletonLine width={200} height={12} />
            </div>
            <SkeletonLine width={220} height={12} />
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonLine width={i === 0 ? 90 : 60} height={12} />
                <Shimmer width="100%" height={40} className="rounded-md" />
              </div>
            ))}
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <SkeletonLine width="60%" height={14} />
              <SkeletonLine width={30} height={14} />
            </div>
            <Shimmer width="100%" height={48} className="rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
