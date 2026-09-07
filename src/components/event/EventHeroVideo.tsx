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
export function EventHeroVideo({ src, className }: { src: string; className?: string }) {
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
    // React pose la propriété `muted` mais pas toujours l'attribut ; Safari
    // n'autorise l'autoplay que si les deux sont là.
    v.muted = true;
    v.defaultMuted = true;
    const tryPlay = () => { v.play().catch(() => { /* autoplay refusé → l'affiche reste */ }); };

    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) tryPlay(); else v.pause(); },
      { threshold: 0.15 },
    );
    io.observe(v);
    const onVisibility = () => { if (document.hidden) v.pause(); else tryPlay(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      v.pause();
    };
  }, [mounted, src]);

  if (!mounted || failed) return null;

  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      autoPlay
      playsInline
      preload="metadata"
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setPlaying(true)}
      onError={() => setFailed(true)}
      className={className}
      style={{ opacity: playing ? 1 : 0, transition: 'opacity 480ms ease-out', pointerEvents: 'none' }}
    />
  );
}
