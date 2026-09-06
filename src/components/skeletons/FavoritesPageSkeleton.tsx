import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/Favorites.tsx pendant le chargement du
   chunk (fallback de route) : header sticky (titre + compteur, rangée
   filtres + bascule vue) → mosaïque 2 colonnes d'ardoises carrées r18,
   exactement celle que FavoritesSkeleton dessine ensuite dans la page. */
export function FavoritesPageSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A' }} aria-hidden>
      <div
        style={{ position: 'sticky', top: 0, zIndex: 40, paddingTop: 'env(safe-area-inset-top, 0px)', background: 'rgba(10,10,10,0.90)', borderBottom: '1px solid rgba(255,255,255,.07)' }}
      >
        <div className="flex items-center justify-between" style={{ padding: '22px 20px 14px' }}>
          <SkeletonLine width={150} height={26} />
          <SkeletonLine width={44} height={22} style={{ borderRadius: 999 }} />
        </div>
        <div className="flex items-center gap-2" style={{ padding: '0 20px 14px' }}>
          {[64, 72, 60].map((w, i) => (
            <Shimmer key={i} width={w} height={32} style={{ borderRadius: 10 }} />
          ))}
          <span className="flex-1" />
          <Shimmer width={76} height={38} style={{ borderRadius: 10 }} />
        </div>
      </div>
      <div style={{ maxWidth: 512, margin: '0 auto', padding: '22px 0 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, padding: '0 20px' }}>
          {[0, 1, 2, 3].map((i) => (
            <Shimmer key={i} style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 18 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
