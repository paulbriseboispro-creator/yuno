import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';

interface CheckoutSummaryBarProps {
  /** Total à payer. 0 = rien à payer en ligne : la barre ne porte que le bouton. */
  total: number;
  /** Frais de service ajoutés au client ; 0 = pas de ligne. */
  fee: number;
  buttonText: string;
  onClick: () => void;
}

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Space Grotesk', sans-serif";

/**
 * Barre collante de l'étape « choix du billet » : le total, les frais de
 * service, un seul bouton. Posée sur le bord bas de l'écran (pas de carte
 * flottante) pour rester fine : la liste des tarifs porte déjà le détail.
 */
export function CheckoutSummaryBar({ total, fee, buttonText, onClick }: CheckoutSummaryBarProps) {
  const { t, language } = useLanguage();
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR';
  const money = (v: number) => `${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 34 }}
        style={{
          background: 'rgb(var(--glass-14-14-16)/0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgb(var(--ink)/0.10)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="mx-auto w-full max-w-md px-4 pt-3 pb-3">
          {total > 0 && (
            <div className="mb-3">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  style={{
                    fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: 'var(--tx-9a9a9a)',
                  }}
                >
                  {t('ticketSel.total')}
                </span>
                <span
                  className="whitespace-nowrap"
                  style={{
                    fontFamily: DISPLAY, fontSize: '22px', fontWeight: 700,
                    letterSpacing: '-0.02em', lineHeight: 1, color: 'rgb(var(--ink))',
                  }}
                >
                  {money(total)}
                </span>
              </div>
              {fee > 0 && (
                <div className="flex items-baseline justify-between gap-3" style={{ marginTop: 5 }}>
                  <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.06em', color: 'var(--tx-9a9a9a)' }}>
                    {t('ticketSel.serviceFee')}
                  </span>
                  <span className="whitespace-nowrap" style={{ fontFamily: MONO, fontSize: '11px', color: 'var(--tx-9a9a9a)' }}>
                    {money(fee)}
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={onClick}
            className="w-full h-11 inline-flex items-center justify-center transition-all duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={{
              background: '#E8192C', color: '#fff', border: 'none', borderRadius: 4,
              fontFamily: MONO, fontSize: '12px', fontWeight: 700,
              letterSpacing: '0.10em', textTransform: 'uppercase',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {buttonText}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
