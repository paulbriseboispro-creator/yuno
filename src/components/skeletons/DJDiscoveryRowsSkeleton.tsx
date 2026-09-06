import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de la liste de src/components/dj-marketplace/DJDiscovery.tsx
   (bloc INLINE sous la barre de filtres, qui reste visible) : 5 cartes
   DJMarketplaceCard — avatar 60px radius 14 sur #191919, nom 16px + petit
   badge, ligne ville/genres 11px, marqueur de droite neutre — mêmes
   padding 12/14, bordure rgba(.08), radius 18 et gap 12 que la liste réelle.
   Neutre aux deux modes (fan / booker) : ni CTA « Réserver », ni tarif. */
export function DJDiscoveryRowsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <SkeletonLine width="48%" height={16} />
              <Shimmer width={18} height={14} className="rounded-full" />
            </div>
            <SkeletonLine width="42%" height={11} style={{ marginTop: 6 }} />
          </div>
          <SkeletonLine width={14} height={18} style={{ flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}
