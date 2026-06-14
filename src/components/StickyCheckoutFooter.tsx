import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StickyCheckoutFooterProps {
  amount: number;
  label?: string;
  subtitle?: string;
  subtitleText?: string;
  buttonText: string;
  isLoading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  accentColor?: string;
  className?: string;
}

export function StickyCheckoutFooter({
  amount,
  label,
  subtitle,
  subtitleText,
  buttonText,
  isLoading = false,
  disabled = false,
  onClick,
  icon,
  accentColor,
  className
}: StickyCheckoutFooterProps) {
  const isCtaOnly = amount <= 0 && !label && !subtitle;
  const btnBg = accentColor ?? '#E8192C';

  return (
    <div
      className={cn('fixed bottom-0 left-0 right-0 z-50', className)}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32, delay: 0.15 }}
      >
        <div className="flex justify-center pb-4 px-4">
          <div
            className={cn(
              'inline-flex items-center w-full max-w-md gap-4 px-5 py-3',
              'rounded-xl',
              isCtaOnly ? 'justify-center' : 'justify-between'
            )}
            style={{
              background: 'rgba(14, 14, 16, 0.92)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.10)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(232,25,44,0.08)',
            }}
          >
            {/* Prix */}
            {amount > 0 ? (
              <div className="flex flex-col min-w-0">
                {label && (
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '9px',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: '#5A5A5E',
                    }}
                  >
                    {label}
                  </span>
                )}
                <span
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: '22px',
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: '#FFFFFF',
                    lineHeight: 1.1,
                  }}
                >
                  {amount.toFixed(2)} €
                </span>
                {subtitleText && (
                  <span style={{ fontSize: '10px', color: '#5A5A5E', marginTop: '1px' }}>
                    {subtitleText}
                  </span>
                )}
              </div>
            ) : label ? (
              <div className="flex flex-col min-w-0">
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#9A9A9A' }}>
                  {label}
                </span>
              </div>
            ) : null}

            {/* Bouton CTA */}
            <button
              onClick={onClick}
              disabled={disabled || isLoading}
              className={cn(
                'inline-flex items-center justify-center gap-2',
                'rounded-lg font-semibold transition-all duration-150',
                isCtaOnly ? 'w-full h-12 text-base' : 'h-11 px-6 shrink-0 text-sm',
                disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:brightness-110 active:scale-[0.97]'
              )}
              style={{
                background: disabled ? 'rgba(255,255,255,0.08)' : btnBg,
                color: '#fff',
                border: 'none',
                boxShadow: disabled ? 'none' : `0 6px 24px ${btnBg}55, 0 2px 8px rgba(0,0,0,0.3)`,
                fontFamily: "'Inter', sans-serif",
                letterSpacing: '0.01em',
              }}
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  {icon && <span className="opacity-90">{icon}</span>}
                  {buttonText}
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
