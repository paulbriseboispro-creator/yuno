// Takeover de célébration plein écran — réservé aux moments SIGNATURE
// (entrée en boîte validée, palier fidélité atteint). Auto-dismiss ~2.6 s,
// tap n'importe où pour fermer. Esthétique éditoriale publique : scrim
// sombre + blur, kicker mono uppercase rouge, titre fort, sous-titre gris.
// Reduced-motion : opacité seule (spring célébratoire désactivé).
import { useEffect, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { transitions } from '@/lib/motion';
import { ConfettiBurst } from './ConfettiBurst';

const RED = '#E8192C';
const G1 = '#E5E5E5';
const G2 = '#9A9A9A';

const AUTO_DISMISS_MS = 2600;

interface CelebrationOverlayProps {
  /** Ligne kicker (mono uppercase, rouge). */
  kicker: string;
  /** Titre principal. */
  title: string;
  /** Sous-titre optionnel (nom du club…). */
  subtitle?: string;
  /** Élément visuel optionnel au-dessus du kicker (icône, TierBadge…). */
  icon?: ReactNode;
  /** Confettis derrière le contenu (défaut oui). */
  confetti?: boolean;
  onDone: () => void;
}

export function CelebrationOverlay({
  kicker,
  title,
  subtitle,
  icon,
  confetti = true,
  onDone,
}: CelebrationOverlayProps) {
  const reduced = useReducedMotion();

  useEffect(() => {
    const timer = setTimeout(onDone, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24 }}
      onClick={onDone}
      className="fixed inset-0 flex items-center justify-center px-8"
      style={{
        zIndex: 130,
        background: 'rgba(5,5,5,0.9)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      {confetti && <ConfettiBurst originY={0.38} />}
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 14 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        transition={reduced ? { duration: 0.3 } : transitions.celebrate}
        className="flex flex-col items-center text-center"
      >
        {icon && <div className="mb-5">{icon}</div>}
        <p
          className="font-mono font-bold uppercase"
          style={{ fontSize: 11, letterSpacing: '0.16em', color: RED }}
        >
          {kicker}
        </p>
        <h2 className="mt-2 text-3xl font-bold" style={{ color: '#FFFFFF' }}>
          {title}
        </h2>
        {subtitle && (
          <p className="mt-2 text-sm" style={{ color: G2 }}>
            {subtitle}
          </p>
        )}
      </motion.div>
      {/* Filet éditorial bas — signature des surfaces publiques. */}
      <div
        aria-hidden
        className="absolute bottom-12 left-1/2 h-px w-10 -translate-x-1/2"
        style={{ background: G1, opacity: 0.25 }}
      />
    </motion.div>
  );
}
