import { useState } from 'react';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { EventHeroVideo } from '@/components/event/EventHeroVideo';

/**
 * Scène du haut de la page soirée : un cadre 16:9 aux coins arrondis, détaché
 * des bords de l'écran, posé sur un halo aux couleurs de l'affiche.
 *
 * - Avec vidéo : le film joue seul, en boucle, sans bouton (EventHeroVideo).
 *   L'affiche reste dessous : premier rendu, puis repli si le fichier ne se lit pas.
 * - Sans vidéo : l'affiche. Une affiche paysage remplit le cadre ; une affiche
 *   carrée ou portrait (le cas courant : le reste de Yuno la veut en 1:1) tient
 *   ENTIÈRE au centre, sur sa propre copie floutée — jamais rognée de moitié.
 *
 * Le cadre ne porte JAMAIS de texte : le titre vit en dessous, sur le noir de
 * la page. Le halo est la même affiche, minuscule, très floutée et saturée,
 * débordant du cadre : la couleur de la soirée sort de l'image sans la toucher.
 */
export function EventHeroStage({
  posterUrl,
  videoUrl,
  title,
}: {
  posterUrl?: string | null;
  videoUrl?: string;
  title: string;
}) {
  const [fit, setFit] = useState<'cover' | 'contain'>('contain');
  const haloSrc = posterUrl ? getOptimizedImageUrl(posterUrl, { width: 160, quality: 50 }) : null;

  return (
    <div className="relative" style={{ isolation: 'isolate' }}>
      {/* Halo : deux couches. Une large et diffuse qui teinte la page autour du
          cadre, une serrée qui porte la couleur jusqu'au bord. Masque radial pour
          que le halo s'éteigne en douceur, sans arête. */}
      {haloSrc ? (
        <div aria-hidden="true" className="pointer-events-none absolute" style={{ inset: '-26% -16% -34%', zIndex: -1 }}>
          <img
            src={haloSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              filter: 'blur(64px) saturate(1.8)',
              opacity: 0.8,
              WebkitMaskImage: 'radial-gradient(closest-side, #000 55%, transparent 100%)',
              maskImage: 'radial-gradient(closest-side, #000 55%, transparent 100%)',
            }}
          />
          <img
            src={haloSrc}
            alt=""
            className="absolute object-cover"
            style={{
              inset: '16% 11%',
              width: '78%',
              height: '68%',
              filter: 'blur(30px) saturate(1.6)',
              opacity: 0.85,
            }}
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{ inset: '-18% -10%', zIndex: -1, background: 'radial-gradient(closest-side, rgba(232,25,44,0.28), transparent)', filter: 'blur(30px)' }}
        />
      )}

      {/* Le cadre */}
      <div
        className="relative overflow-hidden"
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          borderRadius: 14,
          background: '#050505',
          boxShadow: '0 28px 70px -24px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.07)',
        }}
      >
        {posterUrl ? (
          <>
            {fit === 'contain' && (
              <img
                src={haloSrc ?? undefined}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ filter: 'blur(26px) saturate(1.3) brightness(0.55)', transform: 'scale(1.18)' }}
              />
            )}
            <img
              src={getOptimizedImageUrl(posterUrl, { width: 1200, quality: 85 })}
              alt={title}
              {...({ fetchpriority: 'high' } as Record<string, string>)}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight && img.naturalWidth / img.naturalHeight >= 1.5) setFit('cover');
              }}
              className="absolute inset-0 w-full h-full object-center"
              style={{ objectFit: fit }}
            />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #1a0a0d 0%, #4a0f1a 50%, #7a1428 100%)' }} />
        )}
        {videoUrl && <EventHeroVideo src={videoUrl} className="absolute inset-0 w-full h-full object-cover object-center" />}
        {/* Liseré intérieur au-dessus de l'image : le bord reste net sur une
            affiche noire comme sur une affiche claire. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ borderRadius: 14, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }} />
      </div>
    </div>
  );
}
