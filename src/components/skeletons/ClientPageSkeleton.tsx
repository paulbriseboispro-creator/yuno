import { Shimmer, SkeletonLine } from './Shimmer';

/* Silhouette neutre des pages client secondaires (fallback de route quand
   aucune page n'a sa propre silhouette) : header sticky de la DA publique
   (bouton retour 36px + kicker mono + titre uppercase) → liste de lignes
   (vignette 64px r4 + deux lignes). Toujours sur #0A0A0A : le chargement
   ne ressemble jamais à un écran noir ni à un dashboard pro. */
/** `bare` : header seul (carte, landing, auth…) — pas de lignes fantômes. */
export function ClientPageSkeleton({ bare = false }: { bare?: boolean } = {}) {
  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ background: '#0A0A0A' }} aria-hidden>
      <div
        className="sticky top-0 z-40 flex items-center gap-3.5"
        style={{ background: 'rgba(10,10,10,0.92)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 14px' }}
      >
        <Shimmer width={36} height={36} className="rounded-full bg-white/[0.06]" />
        <div className="flex-1 min-w-0">
          <SkeletonLine width={96} height={10} className="mb-2" />
          <SkeletonLine width={180} height={20} />
        </div>
      </div>
      {!bare && (
      <div className="flex-1 w-full mx-auto" style={{ maxWidth: 512, padding: '20px 20px 96px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3.5">
            <Shimmer width={64} height={64} style={{ borderRadius: 4, flexShrink: 0 }} />
            <div className="flex-1 flex flex-col gap-2">
              <SkeletonLine width="55%" height={12} />
              <SkeletonLine width="35%" height={10} />
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
