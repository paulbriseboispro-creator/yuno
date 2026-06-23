import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { transitions, reducedTap, useReducedMotion } from '@/lib/motion';

// Élément rendu — EventCard est un <article>, les boutons un <button>, etc.
const TAGS = {
  div: motion.div,
  button: motion.button,
  a: motion.a,
  article: motion.article,
  li: motion.li,
} as const;

type TappableTag = keyof typeof TAGS;

export interface TappableProps extends HTMLMotionProps<'div'> {
  /** Élément rendu. Défaut 'div'. */
  as?: TappableTag;
  /** Scale au press. 0.97 défaut · 0.92 petites icônes · 0.99 grandes cartes. */
  pressScale?: number;
  /** Léger lift au survol — uniquement sur appareils réellement hover-capable. */
  hoverLift?: boolean;
}

// (hover: hover) → exclut le faux hover-on-tap des écrans tactiles.
const canHover =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

/**
 * Feedback de press universel (Emil : un élément pressable doit "répondre").
 * Press = scale subtil 130ms ease-out. Reduced-motion → léger fondu, pas de scale.
 */
export const Tappable = forwardRef<HTMLElement, TappableProps>(function Tappable(
  { as = 'div', pressScale = 0.97, hoverLift = false, children, ...rest },
  ref,
) {
  const reduced = useReducedMotion();
  const Comp = TAGS[as] as typeof motion.div;

  return (
    <Comp
      ref={ref as never}
      whileTap={reduced ? reducedTap : { scale: pressScale }}
      whileHover={hoverLift && canHover && !reduced ? { y: -3 } : undefined}
      transition={transitions.pressFeedback}
      {...rest}
    >
      {children}
    </Comp>
  );
});
