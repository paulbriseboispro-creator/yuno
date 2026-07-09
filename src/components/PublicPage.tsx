import { motion, useReducedMotion } from 'framer-motion';
import { useNavigationType } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';
import {
  pageVariants,
  flowVariant,
  transitions,
  type PageVariant,
} from '@/lib/motion';

/* ============================================================
   PublicPage — wrapper d'entrée par ARCHÉTYPE de page (app cliente).
   Remplace le fondu unique `PageFade` : chaque nature de page a sa
   transition propre, toutes sur la courbe signature EASE_OUT, < 350ms.

     • discovery — grille / listes : léger lever + fondu « affiche ».
     • immersive — fiches à hero cinématique : opacité seule (le hero
                   joue sa propre chorégraphie .animate-hero-*).
     • flow      — tunnel de résa : glissement directionnel (avant→droite,
                   retour→gauche) façon app native, via useNavigationType().
     • account   — pages utilitaires : fondu calme.

   reduced-motion → fondu d'opacité seul (aucun déplacement).

   ⚠️ Ne pas envelopper d'éléments position:fixed/sticky (headers collants,
   BottomNav, barres d'action de checkout…) : un ancêtre transformé casse
   leur positionnement. Envelopper uniquement le CONTENU DÉFILANT ; laisser
   le chrome fixe en sibling hors du wrapper.
   ============================================================ */
export function PublicPage({
  variant = 'account',
  children,
  className,
  style,
}: {
  variant?: PageVariant;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const navType = useNavigationType(); // 'POP' | 'PUSH' | 'REPLACE'

  // Accessibilité : opacité seule, zéro translation, entrée rapide.
  if (reduced) {
    return (
      <motion.div
        className={className}
        style={style}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitions.pop}
      >
        {children}
      </motion.div>
    );
  }

  const m = variant === 'flow' ? flowVariant(navType === 'POP') : pageVariants[variant];
  return (
    <motion.div
      className={className}
      style={style}
      initial={m.initial}
      animate={m.animate}
      transition={m.transition}
    >
      {children}
    </motion.div>
  );
}
