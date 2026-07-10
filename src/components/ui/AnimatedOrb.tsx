import { motion, useReducedMotion } from 'framer-motion';

export type OrbIntensity = 'idle' | 'searching';

interface AnimatedOrbProps {
  /** 'idle' = respiration lente ; 'searching' = accélérée + amplifiée. */
  intensity?: OrbIntensity;
  /** Taille rendue en px. Tous les calques dérivent d'un design de référence à 220px. */
  size?: number;
  className?: string;
}

/**
 * Orbe animée « Siri-style » aux couleurs Yuno (rouge `--primary`).
 *
 * Empilement de calques framer-motion en fondu additif (`mix-blend-mode: screen`,
 * isolé) : glow ambiant, trois anneaux coniques contra-rotatifs, un blob liquide
 * qui dérive, un halo médian, une sphère cœur avec reflet 3D « verre » et un éclat
 * spéculaire orbital. Le rendu est piloté par `size`, donc réutilisable en héros
 * (220) comme en pastille d'en-tête (~36). Respecte `prefers-reduced-motion`.
 */
export function AnimatedOrb({ intensity = 'idle', size = 220, className }: AnimatedOrbProps) {
  const reduce = useReducedMotion();
  const active = intensity === 'searching';
  // Échelle par rapport au design de référence (220px) + arrondi pour des px propres.
  const s = size / 220;
  const px = (n: number) => Math.round(n * s * 100) / 100;

  // Respiration organique : jamais parfaitement linéaire ni symétrique.
  const breathe: [number, number, number, number] = [0.37, 0, 0.63, 1];
  // En reduced-motion : orbe statique (aucune boucle infinie).
  const loop = <T,>(v: T): T | undefined => (reduce ? undefined : v);

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        isolation: 'isolate',
      }}
    >
      {/* Glow ambiant profond */}
      <motion.div
        style={{
          position: 'absolute',
          borderRadius: '9999px',
          width: px(300),
          height: px(300),
          background:
            'radial-gradient(circle, hsl(var(--primary) / 0.20) 0%, hsl(var(--primary) / 0.06) 42%, transparent 68%)',
          filter: `blur(${px(46)}px)`,
          mixBlendMode: 'screen',
        }}
        animate={{
          scale: loop(active ? [1, 1.35, 1] : [1, 1.14, 1]),
          opacity: loop(active ? [0.55, 0.95, 0.55] : [0.4, 0.62, 0.4]),
        }}
        transition={{ duration: active ? 2 : 4.5, repeat: Infinity, ease: breathe }}
      />

      {/* Anneau conique externe */}
      <motion.div
        style={{
          position: 'absolute',
          borderRadius: '9999px',
          width: px(178),
          height: px(178),
          background: `conic-gradient(from 0deg,
            transparent 0%, hsl(var(--primary) / 0.55) 12%, transparent 26%,
            hsl(var(--primary) / 0.28) 42%, transparent 56%,
            hsl(var(--primary) / 0.5) 74%, transparent 88%, transparent 100%)`,
          filter: `blur(${px(12)}px)`,
          mixBlendMode: 'screen',
        }}
        animate={{ rotate: loop(360) }}
        transition={{ duration: active ? 6 : 14, repeat: Infinity, ease: 'linear' }}
      />

      {/* Anneau conique médian (contra-rotatif) */}
      <motion.div
        style={{
          position: 'absolute',
          borderRadius: '9999px',
          width: px(134),
          height: px(134),
          background: `conic-gradient(from 120deg,
            transparent 0%, hsl(var(--primary) / 0.62) 15%, transparent 34%,
            hsl(var(--primary) / 0.34) 54%, transparent 70%,
            hsl(var(--primary) / 0.5) 90%, transparent 100%)`,
          filter: `blur(${px(7)}px)`,
          mixBlendMode: 'screen',
        }}
        animate={{ rotate: loop(-360) }}
        transition={{ duration: active ? 5 : 11, repeat: Infinity, ease: 'linear' }}
      />

      {/* Anneau conique interne */}
      <motion.div
        style={{
          position: 'absolute',
          borderRadius: '9999px',
          width: px(102),
          height: px(102),
          background: `conic-gradient(from 240deg,
            transparent 0%, hsl(var(--primary) / 0.7) 12%, transparent 30%,
            hsl(var(--primary) / 0.4) 50%, transparent 68%,
            hsl(var(--primary) / 0.55) 86%, transparent 100%)`,
          filter: `blur(${px(4)}px)`,
          mixBlendMode: 'screen',
        }}
        animate={{ rotate: loop(360) }}
        transition={{ duration: active ? 4 : 9, repeat: Infinity, ease: 'linear' }}
      />

      {/* Blob liquide dérivant — donne la sensation « vivant » */}
      <motion.div
        style={{
          position: 'absolute',
          borderRadius: '9999px',
          width: px(88),
          height: px(88),
          background:
            'radial-gradient(circle, hsl(var(--primary) / 0.7) 0%, hsl(var(--primary) / 0.15) 60%, transparent 100%)',
          filter: `blur(${px(11)}px)`,
          mixBlendMode: 'screen',
        }}
        animate={{
          x: loop(active ? [0, px(9), px(-6), 0] : [0, px(5), px(-4), 0]),
          y: loop(active ? [0, px(-7), px(8), 0] : [0, px(-4), px(4), 0]),
          scale: loop(active ? [1, 1.15, 0.92, 1] : [1, 1.06, 0.97, 1]),
        }}
        transition={{ duration: active ? 3.4 : 7, repeat: Infinity, ease: breathe }}
      />

      {/* Halo médian */}
      <motion.div
        style={{
          position: 'absolute',
          borderRadius: '9999px',
          width: px(66),
          height: px(66),
          background:
            'radial-gradient(circle, hsl(var(--primary) / 0.85) 0%, hsl(var(--primary) / 0.22) 55%, transparent 100%)',
          filter: `blur(${px(5)}px)`,
          mixBlendMode: 'screen',
        }}
        animate={{ scale: loop(active ? [1, 1.28, 0.96, 1.18, 1] : [1, 1.07, 1]) }}
        transition={{ duration: active ? 1.9 : 3.4, repeat: Infinity, ease: breathe }}
      />

      {/* Sphère cœur avec reflet 3D (verre) */}
      <motion.div
        style={{
          position: 'absolute',
          borderRadius: '9999px',
          width: px(40),
          height: px(40),
          background:
            'radial-gradient(circle at 35% 28%, hsl(0 0% 100% / 0.98) 0%, hsl(354 100% 72%) 26%, hsl(var(--primary)) 58%, hsl(var(--primary) / 0.6) 100%)',
          boxShadow: `0 0 ${px(28)}px ${px(10)}px hsl(var(--primary) / 0.55), 0 0 ${px(58)}px ${px(22)}px hsl(var(--primary) / 0.22)`,
        }}
        animate={{ scale: loop(active ? [1, 1.22, 0.92, 1.16, 1] : [1, 1.05, 1]) }}
        transition={{ duration: active ? 1.9 : 3.8, repeat: Infinity, ease: breathe }}
      />

      {/* Reflet spéculaire orbital — éclat de verre liquide */}
      {!reduce && (
        <motion.div
          style={{
            position: 'absolute',
            width: px(13),
            height: px(13),
            borderRadius: '9999px',
            background: 'radial-gradient(circle, hsl(0 0% 100% / 0.95) 0%, transparent 70%)',
            filter: `blur(${px(1.5)}px)`,
            mixBlendMode: 'screen',
          }}
          animate={{
            x: [px(-7), px(7), px(6), px(-7)],
            y: [px(-8), px(-5), px(7), px(-8)],
            opacity: active ? [0.9, 0.6, 0.9] : [0.75, 0.45, 0.75],
          }}
          transition={{ duration: active ? 3 : 6, repeat: Infinity, ease: breathe }}
        />
      )}
    </div>
  );
}

export default AnimatedOrb;
