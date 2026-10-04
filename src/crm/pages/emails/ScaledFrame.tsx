/**
 * Un e-mail rendu en grand, à la largeur d'un ordinateur (640) ou d'un
 * téléphone (375), réduit pour tenir dans son cadre. Aperçu des modèles et
 * agrandissement des résultats.
 */
import { useEffect, useState } from 'react';

export function ScaledFrame({ html, title, mobile }: { html: string; title: string; mobile: boolean }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 640, h: 560 });
  useEffect(() => {
    if (!box) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);
  const inner = mobile ? 375 : 640;
  const scale = Math.min(1, size.w / inner);
  return (
    <div ref={setBox} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 420, overflow: 'hidden' }}>
      <iframe
        title={title}
        srcDoc={html}
        sandbox=""
        style={{ position: 'absolute', top: 0, left: '50%', width: inner, height: size.h / scale, border: 0, background: '#fff', transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center', borderRadius: 14 }}
      />
    </div>
  );
}
