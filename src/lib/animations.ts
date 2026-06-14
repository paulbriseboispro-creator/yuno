import { type Variants, type Transition } from 'framer-motion';

// ── Spring presets (Apple / Revolut feel) ──────────────────────────
export const spring = {
  snappy: { type: 'spring', stiffness: 400, damping: 25 } as Transition,
  smooth: { type: 'spring', stiffness: 200, damping: 30 } as Transition,
  bouncy: { type: 'spring', stiffness: 300, damping: 15 } as Transition,
  gentle: { type: 'tween', duration: 0.3, ease: [0.25, 0.1, 0.25, 1] } as Transition,
};

// ── Page transition ────────────────────────────────────────────────
export const pageTransition: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const pageTransitionConfig: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 28,
};

// ── Stagger container + children ──────────────────────────────────
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06 },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
};

// ── Fade in ───────────────────────────────────────────────────────
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4 } },
};

// ── Slide up ──────────────────────────────────────────────────────
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 260, damping: 24 },
  },
};

// ── Scale in (modals, empty states) ───────────────────────────────
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 22 },
  },
};

// ── Hero zoom out (cinematic cover) ───────────────────────────────
export const heroZoom: Variants = {
  hidden: { scale: 1.06, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { duration: 0.7, ease: [0.25, 0.1, 0.25, 1] },
  },
};

// ── Tap / hover presets ───────────────────────────────────────────
export const tapScale = { scale: 0.96 };
export const tapScaleSmall = { scale: 0.92 };
export const hoverLift = { y: -3, transition: { type: 'spring' as const, stiffness: 400, damping: 25 } };
export const cardHover = { scale: 1.015, transition: { type: 'spring' as const, stiffness: 400, damping: 25 } };
