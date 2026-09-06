import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/DJPublicPage.tsx :
   hero cinématique plein-bleed 4:3 (back + partage flottants) →
   bloc identité px-5 (photo 92px chevauchant le hero, kicker, titre,
   lieu, bouton suivre + compteur) → genres (pilules) → réseaux (carrés
   44px) → à propos → rangée de stats à filets (3 colonnes) → prochaines
   dates (max-w-xl, en-tête à filet, affiche carrée). Mêmes paddings
   et env(safe-area-inset-top) que la page réelle → zéro layout shift. */
export function DJPublicSkeleton() {
  return (
    <div className="relative min-h-[100dvh] flex flex-col" style={{ background: '#0A0A0A' }} aria-hidden>
      <main className="flex-1 pb-28">
        {/* Hero */}
        <div className="relative overflow-hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px))' }}>
          <div className="absolute left-5 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
          </div>
          <div className="absolute right-5 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
          </div>
          <div className="relative w-full overflow-hidden" style={{ aspectRatio: '4/3' }}>
            <Shimmer className="absolute inset-0 rounded-none" />
          </div>
        </div>

        {/* Bloc identité */}
        <div className="px-5 pt-5">
          <Shimmer
            width={92}
            height={92}
            className="bg-white/10"
            style={{
              borderRadius: 14,
              border: '3px solid #0A0A0A',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.12)',
              marginTop: -62,
              marginBottom: 14,
              position: 'relative',
              zIndex: 10,
            }}
          />
          <SkeletonLine width={22} height={10} className="mb-2" />
          <SkeletonLine width="72%" height={36} style={{ marginBottom: 16 }} />
          <SkeletonLine width={150} height={11} style={{ marginBottom: 16 }} />
          <div className="flex items-center gap-3">
            <Shimmer width={100} height={32} style={{ borderRadius: 10 }} />
            <SkeletonLine width={80} height={13} />
          </div>
        </div>

        {/* Genres */}
        <div className="px-5 pt-5">
          <div className="flex flex-wrap gap-2">
            {[64, 88, 56].map((w, i) => (
              <Shimmer key={i} width={w} height={22} className="rounded-full" />
            ))}
          </div>
        </div>

        {/* Réseaux */}
        <div className="px-5 pt-6">
          <div className="flex items-center gap-3 mb-4">
            <SkeletonLine width={28} height={1} />
            <SkeletonLine width={90} height={10} />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <Shimmer key={i} width={44} height={44} style={{ borderRadius: 4 }} />
            ))}
          </div>
        </div>

        {/* À propos */}
        <div className="px-5 pt-7">
          <div className="flex items-center gap-3 mb-4">
            <SkeletonLine width={28} height={1} />
            <SkeletonLine width={70} height={10} />
          </div>
          <div className="space-y-2">
            <SkeletonLine width="100%" height={12} />
            <SkeletonLine width="96%" height={12} />
            <SkeletonLine width="92%" height={12} />
            <SkeletonLine width="60%" height={12} />
          </div>
        </div>

        {/* Stats à filets */}
        <div
          className="flex items-start px-5 pt-6 pb-5 mt-7"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 0 }}
        >
          <div className="flex flex-col flex-1 min-w-0" style={{ paddingRight: 12 }}>
            <SkeletonLine width={64} height={9} style={{ marginBottom: 6 }} />
            <SkeletonLine width={28} height={22} />
          </div>
          <div className="flex flex-col flex-1 min-w-0" style={{ paddingRight: 12, borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 12 }}>
            <SkeletonLine width={64} height={9} style={{ marginBottom: 6 }} />
            <SkeletonLine width={28} height={22} />
          </div>
          <div className="flex flex-col flex-1 min-w-0" style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 12 }}>
            <SkeletonLine width={64} height={9} style={{ marginBottom: 6 }} />
            <SkeletonLine width={28} height={22} />
          </div>
        </div>

        {/* Prochaines dates */}
        <div className="mx-auto max-w-xl pt-8">
          <div className="flex items-center justify-between px-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
            <SkeletonLine width={110} height={10} />
            <SkeletonLine width={14} height={10} />
          </div>
          <div className="flex flex-col gap-6 px-5 pt-4 pb-4">
            <div>
              <div className="relative aspect-square overflow-hidden" style={{ borderRadius: 10 }}>
                <Shimmer className="absolute inset-0 rounded-none" />
              </div>
              <div className="pt-2.5 space-y-2">
                <SkeletonLine width={90} height={10} />
                <SkeletonLine width="70%" height={14} />
                <SkeletonLine width={120} height={11} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
