import { motion } from 'framer-motion';
import { tint } from '@/lib/proTheme';

/**
 * Barre collante d'une soirée complète : le même gabarit que `BookNowBar`, mais
 * un constat, pas un bouton. Elle suit le scroll pour que le « SOLD OUT » se
 * voie de partout sur la page, à la place du bandeau posé sur l'affiche.
 */
export function SoldOutBar({ label = 'SOLD OUT' }: { label?: string }) {
  const bg = '#E8192C';

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32, delay: 0.15 }}
      >
        <div className="flex flex-col items-center pb-4 px-4">
          <div
            role="status"
            className="w-full max-w-md h-14 inline-flex items-center justify-center whitespace-nowrap"
            style={{
              background: bg,
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.85)',
              borderRadius: 18,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '16px',
              fontWeight: 700,
              letterSpacing: '0.18em',
              boxShadow: `0 10px 32px ${tint(bg, '55')}, 0 2px 10px rgba(0,0,0,0.4)`,
            }}
          >
            {label}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
