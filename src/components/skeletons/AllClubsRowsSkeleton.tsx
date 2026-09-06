import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle des rangées de src/pages/AllClubsPage.tsx (bloc INLINE,
   sans page : l'en-tête sticky reste visible pendant le chargement) :
   6 rangées « club » — vignette 60px radius 14 sur #191919, nom 16px,
   ligne ville/genre 11px, flèche — mêmes padding 12/14, bordure rgba(.08)
   et radius 18 que le bouton réel. `display: contents` pour hériter du
   gap 12 du conteneur parent. */
export function AllClubsRowsSkeleton() {
  return (
    <div className="contents" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 18,
          }}
        >
          <Shimmer
            width={60}
            height={60}
            style={{ borderRadius: 14, flexShrink: 0, background: '#191919', border: '1px solid rgba(255,255,255,0.08)' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <SkeletonLine width="56%" height={16} />
            <SkeletonLine width="40%" height={11} style={{ marginTop: 6 }} />
          </div>
          <SkeletonLine width={14} height={18} style={{ flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}
