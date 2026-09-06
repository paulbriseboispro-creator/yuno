import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/DJEpkPage.tsx (fond #0a0a0c, maxWidth 760) :
   barre d'actions alignée à droite (2 boutons, radius 10) → hero 16:9
   à coins 18 (label à filet + titre + lieu en bas à gauche) → genres
   (pilules) → bio → « a joué à » (pilules 999) → écoute (lecteur 152px).
   Mêmes marges (16px 20px 0 / 28px 20px 0) que la page réelle. */
export function DJEpkSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0c' }} aria-hidden>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 0 64px' }}>
        {/* Barre d'actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 20px 0' }}>
          <Shimmer width={92} height={34} style={{ borderRadius: 10 }} />
          <Shimmer width={96} height={34} style={{ borderRadius: 10 }} />
        </div>

        {/* Hero 16:9 */}
        <div style={{ position: 'relative', margin: '16px 20px 0', borderRadius: 18, overflow: 'hidden', aspectRatio: '16/9', background: '#141414' }}>
          <Shimmer className="absolute inset-0 rounded-none" />
          <div style={{ position: 'absolute', left: 20, right: 20, bottom: 18 }}>
            <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
              <SkeletonLine width={28} height={1} className="bg-white/10" />
              <SkeletonLine width={80} height={10} className="bg-white/10" />
            </div>
            <SkeletonLine width="62%" height={32} className="bg-white/10" />
            <SkeletonLine width={130} height={11} className="bg-white/10" style={{ marginTop: 8 }} />
          </div>
        </div>

        {/* Genres */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '20px 20px 0' }}>
          {[64, 88, 56].map((w, i) => (
            <Shimmer key={i} width={w} height={22} className="rounded-full" />
          ))}
        </div>

        {/* Bio */}
        <section style={{ padding: '28px 20px 0' }}>
          <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
            <SkeletonLine width={28} height={1} />
            <SkeletonLine width={60} height={10} />
          </div>
          <div className="space-y-2">
            <SkeletonLine width="100%" height={13} />
            <SkeletonLine width="97%" height={13} />
            <SkeletonLine width="93%" height={13} />
            <SkeletonLine width="58%" height={13} />
          </div>
        </section>

        {/* A joué à */}
        <section style={{ padding: '28px 20px 0' }}>
          <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
            <SkeletonLine width={28} height={1} />
            <SkeletonLine width={90} height={10} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[120, 96, 140, 108].map((w, i) => (
              <Shimmer key={i} width={w} height={34} className="rounded-full" />
            ))}
          </div>
        </section>

        {/* Écoute */}
        <section style={{ padding: '28px 20px 0' }}>
          <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
            <SkeletonLine width={28} height={1} />
            <SkeletonLine width={70} height={10} />
          </div>
          <Shimmer width="100%" height={152} style={{ borderRadius: 12 }} />
        </section>
      </div>
    </div>
  );
}
