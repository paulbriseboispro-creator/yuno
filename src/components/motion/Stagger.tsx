import { motion, type HTMLMotionProps } from 'framer-motion';
import { staggerContainer, staggerItem, reduceVariants, useReducedMotion } from '@/lib/motion';

/**
 * Conteneur de révélation en cascade (contextes framer dynamiques :
 * confirmation, résultats de recherche...). 60ms entre enfants.
 * Reduced-motion → pas de cascade, enfants en fondu simple.
 */
export function Stagger({ children, ...rest }: HTMLMotionProps<'div'>) {
  const reduced = useReducedMotion();
  const containerVariants = reduced
    ? { hidden: {}, visible: { transition: { staggerChildren: 0 } } }
    : staggerContainer;

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" {...rest}>
      {children}
    </motion.div>
  );
}

/** Enfant d'un <Stagger>. Reduced-motion → opacité seule. */
export function StaggerItem({ children, ...rest }: HTMLMotionProps<'div'>) {
  const reduced = useReducedMotion();
  return (
    <motion.div variants={reduceVariants(staggerItem, reduced)} {...rest}>
      {children}
    </motion.div>
  );
}
