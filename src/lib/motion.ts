// ════════════════════════════════════════════════════════════════════
// Yuno — Motion language (source de vérité framer-motion)
// ────────────────────────────────────────────────────────────────────
// Pendant JS des tokens CSS de src/index.css (:root). Toute animation
// framer dans l'app cliente importe ses courbes/durées d'ici.
//
// Principes (Emil Kowalski) : courbes custom, durées UI < 300ms,
// ease-out pour entrées/sorties, jamais ease-in, transform + opacity
// uniquement, reduced-motion = opacité seule (pas zéro).
//
// Supersède src/lib/animations.ts dont tous les noms sont re-exportés
// ci-dessous pour compat (ne pas casser SearchOverlay/FilterPage/Welcome).
// ════════════════════════════════════════════════════════════════════
import { type Variants, type Transition, useReducedMotion } from 'framer-motion';

// Re-export des presets existants (compat) ----------------------------
export {
  spring,
  pageTransition,
  pageTransitionConfig,
  staggerContainer,
  staggerItem,
  fadeIn,
  slideUp,
  scaleIn,
  heroZoom,
  tapScale,
  tapScaleSmall,
  hoverLift,
  cardHover,
} from './animations';

export { useReducedMotion };

// ── Courbes (miroir des tokens CSS) ──────────────────────────────────
/** Signature Yuno — entrées/sorties. = --ease-out */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** Mouvement à l'écran / morph. = --ease-in-out */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;
/** Drawers / bottom sheets (iOS). = --ease-drawer */
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

// ── Transitions nommées (miroir des durées CSS) ──────────────────────
export const transitions = {
  /** feedback press bouton/carte — --dur-press 130ms */
  pressFeedback: { duration: 0.13, ease: EASE_OUT } as Transition,
  /** petits popovers / swaps — --dur-pop 180ms */
  pop: { duration: 0.18, ease: EASE_OUT } as Transition,
  /** dropdowns / selects — --dur-dropdown 220ms */
  dropdown: { duration: 0.22, ease: EASE_OUT } as Transition,
  /** modales / drawers — --dur-modal 260ms */
  modal: { duration: 0.26, ease: EASE_OUT } as Transition,
  /** révélation au scroll / entrée de section — 500ms */
  reveal: { duration: 0.5, ease: EASE_OUT } as Transition,
  // Springs (gestes, éléments "vivants")
  snappy: { type: 'spring', stiffness: 400, damping: 25 } as Transition,
  smooth: { type: 'spring', stiffness: 200, damping: 30 } as Transition,
  /** spring célébratoire (overshoot ~0.2) — succès rare uniquement */
  celebrate: { type: 'spring', stiffness: 260, damping: 16 } as Transition,
} as const;

// ── Helper reduced-motion ────────────────────────────────────────────
/**
 * Dégrade un Variants en version "réduite" : retire tout déplacement /
 * scale (x, y, scale, rotate) et ne garde que l'opacité. Annule aussi
 * les delays de stagger. À appeler avec le booléen de useReducedMotion().
 *
 *   const reduced = useReducedMotion();
 *   <motion.div variants={reduceVariants(staggerItem, reduced)} />
 */
export function reduceVariants(variants: Variants, reduced: boolean | null): Variants {
  if (!reduced) return variants;
  const stripped: Variants = {};
  for (const [key, value] of Object.entries(variants)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      const opacity = v.opacity;
      // ne garder que l'opacité + une transition rapide sans delay
      stripped[key] = {
        ...(opacity !== undefined ? { opacity } : {}),
        transition: { duration: 0.2, ease: EASE_OUT },
      };
    } else {
      stripped[key] = value;
    }
  }
  return stripped;
}

/** whileTap réduit : pas de scale, léger fondu (feedback minimal). */
export const reducedTap = { opacity: 0.85 };
