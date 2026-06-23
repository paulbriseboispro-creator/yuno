import { motion, type HTMLMotionProps } from 'framer-motion';
import { transitions, useReducedMotion } from '@/lib/motion';

const TAGS = {
  div: motion.div,
  section: motion.section,
  li: motion.li,
} as const;

type FadeInTag = keyof typeof TAGS;

export interface FadeInViewProps extends HTMLMotionProps<'div'> {
  /** Élément rendu. Défaut 'div'. */
  as?: FadeInTag;
  /** Index dans une liste → délai de stagger (plafonné à 240ms). */
  index?: number;
  /** Décalage vertical initial en px. Défaut 16. */
  offsetY?: number;
}

/**
 * Révélation au scroll (continuité spatiale). Une seule fois ({once:true}),
 * déclenchée 80px avant l'entrée dans le viewport. Reduced-motion → opacité seule.
 * Si l'élément est déjà visible au montage, framer joue l'entrée immédiatement
 * (jamais de contenu bloqué invisible).
 */
export function FadeInView({ as = 'div', index = 0, offsetY = 16, children, ...rest }: FadeInViewProps) {
  const reduced = useReducedMotion();
  const delay = reduced ? 0 : Math.min(index * 0.05, 0.24);
  const Comp = TAGS[as] as typeof motion.div;

  return (
    <Comp
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: offsetY }}
      whileInView={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ ...transitions.reveal, delay }}
      {...rest}
    >
      {children}
    </Comp>
  );
}
