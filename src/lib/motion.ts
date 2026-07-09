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

// ── Transitions de page (archétypes app publique) ────────────────────
// Un wrapper par nature de page, pas un fondu unique. Consommées par
// <PublicPage variant>. `flow` est direction-aware (résolu au runtime
// selon useNavigationType()). Toutes < 350ms, courbe EASE_OUT, et
// dégradées en opacité seule sous reduced-motion (côté composant).
export type PageVariant = 'discovery' | 'immersive' | 'flow' | 'account';

/** Durées d'entrée par archétype (secondes). */
const PAGE_DUR = {
  discovery: 0.26, // grille éditoriale / listes
  immersive: 0.3,  // fiches à hero cinématique
  flow: 0.3,       // tunnel de résa
  account: 0.24,   // pages utilitaires
} as const;

type PageMotion = { initial: Record<string, number>; animate: Record<string, number>; transition: Transition };

/** Variantes statiques (tout sauf `flow`, qui dépend du sens de navigation). */
export const pageVariants: Record<Exclude<PageVariant, 'flow'>, PageMotion> = {
  // Découverte : entrée « affiche » — léger lever + fondu.
  discovery: { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: PAGE_DUR.discovery, ease: EASE_OUT } },
  // Immersif : opacité seule — le hero (.animate-hero-*) porte le mouvement.
  immersive: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: PAGE_DUR.immersive, ease: EASE_OUT } },
  // Compte : fondu calme, déplacement minimal.
  account: { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: PAGE_DUR.account, ease: EASE_OUT } },
};

/**
 * Tunnel de résa : glissement directionnel façon app native.
 * `back` (navigation POP) → entre depuis la gauche ; sinon depuis la droite.
 */
export const flowVariant = (back: boolean): PageMotion => ({
  initial: { opacity: 0, x: back ? -20 : 20 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: PAGE_DUR.flow, ease: EASE_OUT },
});

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
