import type { CSSProperties, ReactNode } from 'react';
import { PublicPage } from '@/components/PublicPage';

/* ============================================================
   PageFade — alias de compat historique.
   Déprécié : préférer <PublicPage variant="..."> qui adapte la
   transition à la nature de la page (discovery / immersive / flow /
   account). PageFade = fondu calme « account ».
   ============================================================ */
export function PageFade({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <PublicPage variant="account" className={className} style={style}>
      {children}
    </PublicPage>
  );
}
