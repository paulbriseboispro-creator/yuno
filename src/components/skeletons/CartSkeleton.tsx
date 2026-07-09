import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/Cart.tsx :
   hero cinématique 13.5rem (back + compteur en haut, kicker + titre en bas) →
   label de section → cartes articles (image 84px + nom + stepper) →
   barre de total flottante. Mêmes conteneurs (max-w-2xl / max-w-xl). */
export function CartSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Hero */}
      <div
        className="relative overflow-hidden bg-white/5 animate-pulse"
        style={{
          height: 'calc(13.5rem + env(safe-area-inset-top, 0px))',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          className="absolute left-0 right-0 mx-auto flex max-w-2xl items-center justify-between px-4"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
        >
          <Shimmer width={36} height={36} className="bg-white/10" style={{ borderRadius: 2 }} />
          <Shimmer width={58} height={28} className="bg-white/10 rounded-full" />
        </div>
        <div className="absolute bottom-5 left-0 right-0 mx-auto max-w-2xl px-4">
          <SkeletonLine width={72} height={11} className="mb-2.5 bg-white/10" />
          <SkeletonLine width="65%" height={38} className="bg-white/10" />
        </div>
      </div>

      {/* Articles */}
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-36 space-y-8">
        <div>
          <SkeletonLine width={180} height={12} className="mb-4" />
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex gap-3.5 p-3"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                }}
              >
                <Shimmer width={84} height={84} style={{ borderRadius: 8, flexShrink: 0 }} />
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <SkeletonLine width="60%" height={14} />
                    <SkeletonLine width={52} height={16} />
                  </div>
                  <SkeletonLine width={90} height={10} className="mt-2" />
                  <div className="flex items-center gap-2 mt-3">
                    <Shimmer width={32} height={32} style={{ borderRadius: 8 }} />
                    <Shimmer width={20} height={18} className="rounded" />
                    <Shimmer width={32} height={32} style={{ borderRadius: 8 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Barre de total flottante */}
      <div
        className="fixed bottom-0 left-0 right-0 px-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        <Shimmer width="100%" height={72} className="mx-auto max-w-xl" style={{ borderRadius: 8 }} />
      </div>
    </div>
  );
}
