import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { transitions, useReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/* ============================================================
   EmptyState — état vide unifié (app cliente publique, DS éditorial).
   Centré, sombre, icône dans un conteneur doux (bg-white/5 +
   border-white/10), body atténué, CTA pilule rouge optionnel.
   Entrée `pop` ; reduced-motion → opacité seule.
   ============================================================ */

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
  className?: string;
}

export function EmptyState({ icon: Icon, title, body, ctaLabel, onCta, className }: EmptyStateProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={transitions.pop}
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      {/* Icône — conteneur arrondi doux */}
      <div className="mb-6 flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <Icon className="h-8 w-8" style={{ color: '#9A9A9A' }} strokeWidth={1.6} />
      </div>

      <h3
        className="font-display uppercase text-white"
        style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05, marginBottom: 10 }}
      >
        {title}
      </h3>
      <p
        className="font-sans"
        style={{ fontSize: 13, lineHeight: 1.6, color: '#9A9A9A', maxWidth: 270, marginBottom: ctaLabel && onCta ? 26 : 0 }}
      >
        {body}
      </p>

      {ctaLabel && onCta && (
        <button
          onClick={onCta}
          className="flex cursor-pointer items-center justify-center gap-2 border-0 font-mono font-bold uppercase transition-transform active:scale-[0.97]"
          style={{
            height: 44,
            padding: '0 24px',
            borderRadius: 999,
            background: '#E8192C',
            color: '#fff',
            fontSize: 11,
            letterSpacing: '0.1em',
            boxShadow: '0 10px 28px -10px rgba(232,25,44,0.7)',
          }}
        >
          {ctaLabel}
        </button>
      )}
    </motion.div>
  );
}
