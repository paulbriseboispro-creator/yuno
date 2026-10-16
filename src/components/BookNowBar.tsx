import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { tint } from '@/lib/proTheme';
import { useLanguage } from '@/contexts/LanguageContext';

interface BookNowBarProps {
  /** « Réserver », « Réserver une table »… */
  label: string;
  /** Prix d'appel ; absent = le bouton ne porte que son libellé. */
  fromAmount?: number;
  /** Petite ligne au-dessus du bouton (ex. « entrée gratuite aussi »). */
  caption?: string;
  icon?: ReactNode;
  accentColor?: string;
  onClick: () => void;
}

/**
 * Barre collante de la page soirée : UN grand bouton, libellé + prix d'appel
 * (« Réserver · dès 6 € »). Le détail du prix vit dans la liste des formules,
 * pas ici.
 */
export function BookNowBar({ label, fromAmount, caption, icon, accentColor, onClick }: BookNowBarProps) {
  const { t, language } = useLanguage();
  const bg = accentColor ?? '#E8192C';
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR';
  const price = fromAmount && fromAmount > 0
    ? `${t('event.fromShort')} ${fromAmount.toLocaleString(locale, {
        minimumFractionDigits: Number.isInteger(fromAmount) ? 0 : 2,
        maximumFractionDigits: 2,
      })} €`
    : null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32, delay: 0.15 }}
      >
        <div className="flex flex-col items-center pb-4 px-4">
          {caption && (
            <span
              className="mb-2 max-w-md truncate"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '10px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--tx-9a9a9a)',
                textShadow: '0 1px 8px rgba(0,0,0,0.8)',
              }}
            >
              {caption}
            </span>
          )}
          <button
            onClick={onClick}
            className={cn(
              'w-full max-w-md h-14 inline-flex items-center justify-center gap-2.5 whitespace-nowrap',
              'transition-all duration-150 hover:brightness-110 active:scale-[0.98]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
            )}
            style={{
              background: bg,
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.85)',
              borderRadius: 18,
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: '18px',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              boxShadow: `0 10px 32px ${tint(bg, '55')}, 0 2px 10px rgba(0,0,0,0.4)`,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {icon && <span className="opacity-90">{icon}</span>}
            <span>{label}</span>
            {price && (
              <>
                <span aria-hidden style={{ opacity: 0.9 }}>·</span>
                <span>{price}</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
