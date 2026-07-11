// Burst de confettis — succès rares uniquement (achat confirmé, entrée en
// boîte, palier fidélité). Aucune dépendance : ~40 <span> framer-motion tirés
// depuis un point d'origine, gravité simulée par keyframes (montée ease-out,
// chute ease-in). Transform + opacity uniquement (règle motion.ts).
// Reduced-motion : rien — le haptic et l'overlay portent le feedback.
import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Palette éditoriale publique : rouge marque, blancs/gris, pointe dorée. */
const DEFAULT_COLORS = ['#E8192C', '#FFFFFF', '#E5E5E5', '#F2B84B'];

interface Particle {
  id: number;
  color: string;
  /** Déport horizontal total (px). */
  dx: number;
  /** Sommet de la montée (px, négatif = vers le haut). */
  rise: number;
  /** Point de chute (px). */
  fall: number;
  rotate: number;
  width: number;
  height: number;
  round: boolean;
  duration: number;
  delay: number;
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, id) => {
    const dx = (Math.random() - 0.5) * 360;
    return {
      id,
      color: DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)],
      dx,
      rise: -(60 + Math.random() * 220),
      fall: 220 + Math.random() * 260,
      rotate: (Math.random() - 0.5) * 1080,
      width: 5 + Math.random() * 5,
      height: 8 + Math.random() * 7,
      round: Math.random() < 0.25,
      duration: 1.05 + Math.random() * 0.55,
      delay: Math.random() * 0.12,
    };
  });
}

interface ConfettiBurstProps {
  /** Nombre de particules (défaut 40). */
  count?: number;
  /** Origine verticale du burst, fraction de l'écran (défaut 0.42). */
  originY?: number;
  /** Empilement — au-dessus des overlays de célébration par défaut. */
  zIndex?: number;
}

export function ConfettiBurst({ count = 40, originY = 0.42, zIndex = 140 }: ConfettiBurstProps) {
  const reduced = useReducedMotion();
  const particles = useMemo(() => makeParticles(count), [count]);

  if (reduced) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex }}
    >
      {particles.map((p) => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{
            x: [0, p.dx * 0.7, p.dx],
            y: [0, p.rise, p.fall],
            rotate: [0, p.rotate * 0.6, p.rotate],
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            times: [0, 0.38, 1],
            ease: ['easeOut', 'easeIn'],
          }}
          style={{
            position: 'absolute',
            left: '50%',
            top: `${originY * 100}%`,
            width: p.width,
            height: p.round ? p.width : p.height,
            borderRadius: p.round ? '50%' : 1.5,
            background: p.color,
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </div>
  );
}
