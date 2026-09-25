import { forwardRef } from 'react';
import { homeBannerImageStyle, type HomeBanner } from '@/lib/homeBanner';

/**
 * Fond du héros d'accueil de la Console : la bannière choisie, ou le dégradé
 * Yuno quand il n'y en a pas. Le même composant dessine le héros ET l'aperçu de
 * l'éditeur — ce qu'on règle est exactement ce qui s'affiche.
 * À poser dans un conteneur `relative overflow-hidden` marqué
 * `data-theme-island="dark"` (photo sous voile : sombre dans les deux thèmes).
 */
export const HomeBannerBackdrop = forwardRef<HTMLImageElement, {
  banner: HomeBanner | null;
  alt?: string;
  /** Glows réduits pour les petits aperçus. */
  compact?: boolean;
  onImageLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}>(function HomeBannerBackdrop({ banner, alt = '', compact = false, onImageLoad }, ref) {
  return (
    <>
      {banner ? (
        <img
          ref={ref}
          src={banner.url}
          alt={alt}
          draggable={false}
          onLoad={onImageLoad}
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
          style={homeBannerImageStyle(banner)}
        />
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 90% 70% at 80% -10%, rgba(232,25,44,0.24) 0%, transparent 58%),
                           radial-gradient(ellipse 70% 55% at 5% 110%, rgba(232,25,44,0.14) 0%, transparent 52%),
                           linear-gradient(155deg, #130508 0%, var(--sf-0a0a0c) 50%, #0c0a12 100%)`,
            }}
          />
          {!compact && (
            <>
              <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full" style={{ background: 'rgba(232,25,44,0.16)', filter: 'blur(80px)' }} />
              <div className="pointer-events-none absolute -bottom-28 left-2 h-64 w-64 rounded-full" style={{ background: 'rgba(232,25,44,0.09)', filter: 'blur(72px)' }} />
            </>
          )}
        </>
      )}

      {/* Voile cinéma : le bas reste sombre pour le nom et la puce « Ce soir ». */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: banner
            ? 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.45) 34%, rgba(0,0,0,0) 70%), linear-gradient(to right, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 55%)'
            : 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.18) 65%, transparent 100%)',
        }}
      />
    </>
  );
});
