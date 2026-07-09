import { motion } from 'framer-motion';
import { transitions, useReducedMotion } from '@/lib/motion';

/* ============================================================
   PageFade — entrée de page subtile (app cliente publique).
   opacity 0 + y:8 → visible, courbe `pop` (180ms ease-out).
   Pas d'exit, pas de key sur le pathname : entrée pure au mount.
   Reduced-motion → fondu d'opacité seul (aucun déplacement).

   ⚠️ Ne pas envelopper d'éléments position:fixed/sticky (footers
   collants, BottomNav…) : un ancêtre transformé casse leur
   positionnement. Envelopper uniquement le contenu défilant.
   ============================================================ */
export function PageFade({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={transitions.pop}
    >
      {children}
    </motion.div>
  );
}
