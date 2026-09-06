import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de la grille « Soirées à venir » de src/pages/CityPage.tsx :
   grille 2 colonnes (3 sur md), gap 3, cartes event-card (#141414, r10,
   filet 8 %) : visuel carré 1:1 → corps px-3 py-2.5 (club, titre 2 lignes,
   date + prix). */
export function CityEventsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
        >
          <Shimmer width="100%" className="rounded-none bg-white/10" style={{ aspectRatio: '1 / 1' }} />
          <div className="flex flex-col flex-1 px-3 py-2.5 gap-1">
            <SkeletonLine width="50%" height={9} />
            <SkeletonLine width="92%" height={13} />
            <SkeletonLine width="64%" height={13} />
            <div className="flex items-center justify-between mt-auto pt-0.5">
              <SkeletonLine width={54} height={10} />
              <SkeletonLine width={40} height={10} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
