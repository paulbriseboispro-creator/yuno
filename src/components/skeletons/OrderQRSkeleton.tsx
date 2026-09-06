import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette fidèle de src/pages/OrderQR.tsx (OrderQROverlay plein écran) :
   barre haute sous la safe-area (fermer 36px + pastille de type + cale) →
   zone QR centrée (carte blanche 216px + marge 16 → 248px, consigne dessous)
   → bas : libellé des articles, carte info (vignette 44px + club / titre /
   date + badge), puis le pied propre à la commande de boissons (bloc
   préparation, PIN de secours, total, validité, retour au menu). Même
   colonne (max-w-md) et mêmes safe-areas que l'overlay réel. */
export function OrderQRSkeleton() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: '#0A0A0A' }} aria-hidden>
      {/* Barre supérieure */}
      <div
        className="flex items-center justify-between w-full max-w-md mx-auto"
        style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 8px' }}
      >
        <Shimmer width={36} height={36} style={{ borderRadius: 2 }} />
        <Shimmer width={92} height={26} className="rounded-full" />
        <div style={{ width: 36 }} />
      </div>

      {/* Zone QR */}
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto" style={{ padding: '0 32px' }}>
        <Shimmer width={248} height={248} className="bg-white/10" style={{ borderRadius: 6 }} />
        <SkeletonLine width={112} height={10} style={{ marginTop: 20 }} />
      </div>

      {/* Infos bas */}
      <div
        className="w-full max-w-md mx-auto"
        style={{ padding: '16px 24px calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
      >
        <SkeletonLine width={160} height={10} className="mx-auto" style={{ marginBottom: 12 }} />

        {/* Carte info */}
        <div
          className="flex items-center gap-3"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}
        >
          <Shimmer width={44} height={44} style={{ borderRadius: 8, flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <SkeletonLine width={80} height={10} />
            <SkeletonLine width="70%" height={15} className="mt-1" />
            <SkeletonLine width={110} height={10} className="mt-1.5" />
          </div>
          <Shimmer width={56} height={22} className="rounded-full self-start" style={{ flexShrink: 0 }} />
        </div>

        {/* Pied commande boisson */}
        <div className="space-y-2.5">
          <div style={{ padding: '12px 13px', borderRadius: 8, background: '#141414', border: '1px solid rgba(255,255,255,0.14)' }}>
            <Shimmer width="100%" height={40} style={{ borderRadius: 3 }} />
          </div>
          <div
            className="flex items-center justify-between"
            style={{ padding: '10px 13px', borderRadius: 8, background: '#141414', border: '1px solid rgba(255,255,255,0.14)' }}
          >
            <SkeletonLine width={90} height={10} />
            <div className="flex items-center gap-2">
              <SkeletonLine width={52} height={16} />
              <Shimmer width={26} height={26} style={{ borderRadius: 6 }} />
            </div>
          </div>
          <div
            className="flex items-center justify-between"
            style={{ padding: '10px 13px', borderRadius: 8, background: '#141414', border: '1px solid rgba(255,255,255,0.14)' }}
          >
            <SkeletonLine width={70} height={10} />
            <SkeletonLine width={56} height={16} />
          </div>
          <SkeletonLine width={150} height={9} className="mx-auto" style={{ marginTop: 12 }} />
          <Shimmer width="100%" height={40} className="rounded-full" />
        </div>
      </div>
    </div>
  );
}
