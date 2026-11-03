/**
 * Une affiche qui remplit son cadre (le parent est en `position: relative` et
 * `overflow: hidden`). Proportions voisines : rognage habituel. Sinon l'affiche
 * est montrée entière sur son propre flou (`posterFitMode`, src/crm/lib/posterFit.ts).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { posterFitMode } from '@/crm/lib/posterFit';

const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' };

export function PosterFit({ src, opacity, objectPosition = 'center' }: { src: string; opacity?: number; objectPosition?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [imageRatio, setImageRatio] = useState<number | null>(null);
  const [frameRatio, setFrameRatio] = useState<number | null>(null);

  useEffect(() => {
    setImageRatio(null);
  }, [src]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => {
      const { width, height } = el.getBoundingClientRect();
      setFrameRatio(width > 0 && height > 0 ? width / height : null);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const contain = posterFitMode(imageRatio, frameRatio) === 'contain';
  return (
    <div ref={box} style={{ ...FILL, overflow: 'hidden', opacity }}>
      {contain && (
        <img src={src} alt="" aria-hidden style={{ ...FILL, objectFit: 'cover', filter: 'blur(22px) saturate(1.15)', transform: 'scale(1.2)', opacity: 0.8 }} />
      )}
      <img
        src={src}
        alt=""
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w > 0 && h > 0) setImageRatio(w / h);
        }}
        style={{ ...FILL, objectFit: contain ? 'contain' : 'cover', objectPosition }}
      />
    </div>
  );
}
