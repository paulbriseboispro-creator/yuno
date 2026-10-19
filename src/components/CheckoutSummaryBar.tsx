import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface CheckoutSummaryBarProps {
  /** Total à payer. 0 = rien à payer en ligne : la barre ne porte que le bouton. */
  total: number;
  /** Frais de service ajoutés au client ; 0 = pas de ligne. */
  fee: number;
  buttonText: string;
  onClick: () => void;
  /** Libellé de la ligne des frais (défaut : « Frais de service »). */
  feeLabel?: string;
  /** Total sans la remise, barré à côté du total. */
  compareTotal?: number;
  /** Ligne rouge au-dessus du bouton (ce qui manque, après un tap). */
  alert?: ReactNode;
  /** Sous le bouton : où l'on paie, conditions de vente. */
  footnote?: ReactNode;
  /** Icône avant le libellé du bouton (cadenas au paiement). */
  icon?: ReactNode;
  loading?: boolean;
  /** Réservé aux blocages réels (limite atteinte) : un oubli de saisie garde le bouton actif. */
  disabled?: boolean;
  /** Pose dans la page un espace de la hauteur de la barre, pour que le bas du formulaire reste visible. */
  reserveSpace?: boolean;
}

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Space Grotesk', sans-serif";

/**
 * Barre collante du tunnel d'achat (choix du billet, puis vos infos) : le total,
 * les frais de service, un seul bouton. Posée sur le bord bas de l'écran (pas de
 * carte flottante) pour rester fine : la liste des tarifs porte déjà le détail.
 */
export function CheckoutSummaryBar({
  total, fee, buttonText, onClick, feeLabel, compareTotal, alert, footnote, icon, loading, disabled, reserveSpace,
}: CheckoutSummaryBarProps) {
  const { t, language } = useLanguage();
  const locale = language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR';
  const money = (v: number) => `${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  // Hauteur réelle de la barre (elle grandit avec la ligne d'alerte et la note) :
  // l'espace réservé dans la page la suit, rien ne reste caché dessous.
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    if (!reserveSpace || !barRef.current || typeof ResizeObserver === 'undefined') return;
    const el = barRef.current;
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    setBarHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [reserveSpace]);

  const inactive = disabled || loading;

  return (
    <>
      {reserveSpace && <div aria-hidden style={{ height: barHeight || 200 }} />}
      <div className="fixed bottom-0 left-0 right-0 z-50" ref={barRef}>
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
                  <span className="flex items-baseline gap-2 whitespace-nowrap">
                    {compareTotal != null && compareTotal > total && (
                      <span
                        className="line-through"
                        style={{ fontFamily: MONO, fontSize: '12px', color: 'var(--tx-9a9a9a)' }}
                      >
                        {money(compareTotal)}
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: DISPLAY, fontSize: '22px', fontWeight: 700,
                        letterSpacing: '-0.02em', lineHeight: 1, color: 'rgb(var(--ink))',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {money(total)}
                    </span>
                  </span>
                </div>
                {fee > 0 && (
                  <div className="flex items-baseline justify-between gap-3" style={{ marginTop: 5 }}>
                    <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.06em', color: 'var(--tx-9a9a9a)' }}>
                      {feeLabel ?? t('ticketSel.serviceFee')}
                    </span>
                    <span className="whitespace-nowrap" style={{ fontFamily: MONO, fontSize: '11px', color: 'var(--tx-9a9a9a)' }}>
                      {money(fee)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {alert && (
              <p
                role="alert"
                className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-medium leading-snug"
                style={{ color: '#FF5A68' }}
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{alert}</span>
              </p>
            )}

            <button
              onClick={onClick}
              disabled={inactive}
              aria-busy={loading || undefined}
              className="w-full h-12 inline-flex items-center justify-center gap-2.5 transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              style={{
                background: disabled ? 'rgb(var(--ink)/0.10)' : '#E8192C',
                color: disabled ? 'var(--tx-9a9a9a)' : '#fff',
                border: 'none', borderRadius: 4,
                fontFamily: MONO, fontSize: '12px', fontWeight: 700,
                letterSpacing: '0.10em', textTransform: 'uppercase',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <>
                  {icon}
                  {buttonText}
                </>
              )}
            </button>

            {footnote && (
              <p className="mt-2.5 text-center text-[11.5px] leading-[1.45]" style={{ color: 'var(--tx-9a9a9a)' }}>
                {footnote}
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
