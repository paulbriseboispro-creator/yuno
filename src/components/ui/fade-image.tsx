import { useState, type ImgHTMLAttributes } from 'react';

/* ============================================================
   FadeImage — image qui se RÉVÈLE au lieu d'apparaître d'un coup.

   Sur un feed qui défile, chaque poster « pop » à l'écran quand il finit
   de charger : c'est ce qui rend une liste nerveuse. Ici l'image reste à
   opacité 0 sur le fond dégradé de sa carte, puis fond en 220 ms (courbe
   signature) dès que le navigateur l'a décodée. Une image déjà en cache
   arrive avec `complete` à true : aucune transition, aucun clignotement.

   Uniquement opacity (GPU), jamais de layout. Reduced-motion : la
   transition d'opacité est conservée (elle aide, elle ne bouge pas).
   ============================================================ */
export function FadeImage({ style, onLoad, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      {...rest}
      ref={(el) => {
        // Image servie depuis le cache : déjà décodée au montage.
        if (el && el.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
      }}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      style={{
        ...style,
        opacity: loaded ? 1 : 0,
        transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    />
  );
}
