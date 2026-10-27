import { useEffect, useRef, useState } from 'react';

/**
 * Vidéo de fond du héros de la page soirée.
 *
 * L'affiche reste l'image de premier rendu (LCP) : la vidéo n'est montée
 * qu'au premier temps mort du navigateur, arrive en fondu dès sa première
 * image, et se coupe hors écran ou onglet caché. Un fichier illisible ne
 * casse rien : le composant disparaît et l'affiche reprend sa place.
 *
 * Toujours muette, en boucle, sans contrôles ni PiP : c'est un décor animé,
 * pas un lecteur. L'appelant a déjà filtré reduced-motion / économie de
 * données via `shouldAutoplayHeroVideo()`.
 */
export function EventHeroVideo({ src, className, onPlay }: { src: string; className?: string; onPlay?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  // Laisse l'affiche peindre d'abord.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setMounted(true), { timeout: 800 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setMounted(true), 400);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v || !mounted) return;
    // Safari n'accepte l'autoplay que si l'élément est muet AVANT de charger
    // sa source, attributs compris (React ne pose que la propriété `muted`).
    // La source n'est donc donnée qu'ici, une fois tout ça en place.
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    if (v.getAttribute('src') !== src) {
      v.src = src;
      v.load();
    }

    let visible = true;
    const tryPlay = () => {
      if (!visible || document.hidden || !v.paused) return;
      v.play().catch(() => { /* refusé : on retentera au prochain signal */ });
    };

    // Un seul play() au montage ne suffit pas : sur iPhone il échoue quand la
    // vidéo n'a pas encore de données (4G), en mode économie d'énergie, ou au
    // retour d'arrière-plan — l'affiche restait alors figée jusqu'au bout.
    // On relance donc à chaque signal utile, jusqu'à ce qu'elle tourne :
    // données prêtes, retour à l'écran, page restaurée, premier geste.
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) tryPlay(); else v.pause();
      },
      { threshold: 0.15 },
    );
    io.observe(v);
    const onVisibility = () => { if (document.hidden) v.pause(); else tryPlay(); };
    const mediaEvents = ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'stalled', 'suspend'] as const;
    const gestureEvents = ['touchend', 'pointerdown', 'click', 'keydown', 'scroll'] as const;
    mediaEvents.forEach((e) => v.addEventListener(e, tryPlay));
    gestureEvents.forEach((e) => window.addEventListener(e, tryPlay, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', tryPlay);
    tryPlay();
    return () => {
      io.disconnect();
      mediaEvents.forEach((e) => v.removeEventListener(e, tryPlay));
      gestureEvents.forEach((e) => window.removeEventListener(e, tryPlay, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', tryPlay);
      v.pause();
    };
  }, [mounted, src]);

  if (!mounted || failed) return null;

  return (
    <video
      ref={ref}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => { if (!playing) onPlay?.(); setPlaying(true); }}
      onError={() => setFailed(true)}
      className={className}
      style={{ opacity: playing ? 1 : 0, transition: 'opacity 480ms ease-out', pointerEvents: 'none' }}
    />
  );
}
