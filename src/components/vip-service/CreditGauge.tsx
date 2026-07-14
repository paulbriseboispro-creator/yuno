import { useLanguage } from '@/contexts/LanguageContext';
import { fmtEuro } from './serviceTypes';

const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const AMBER = 'rgb(245,158,11)';
const EMERALD = 'rgb(16,185,129)';
const GOLD = '#E7C15A';

interface CreditGaugeProps {
  consumed: number;
  budget: number;   // crédit prépayé = total_price de la résa
  minimum: number;  // minimum spend du pack
  compact?: boolean;
}

/**
 * La jauge unique de suivi conso : consommé vs crédit prépayé, avec le repère
 * du minimum. Ambre sous le minimum, émeraude une fois atteint, or au-delà du
 * crédit (le club encaisse de l'extra).
 */
export function CreditGauge({ consumed, budget, minimum, compact = false }: CreditGaugeProps) {
  const { t } = useLanguage();
  const scale = Math.max(budget, minimum, consumed, 1);
  const consumedPct = Math.min(100, (consumed / scale) * 100);
  const budgetPct = Math.min(100, (budget / scale) * 100);
  const minPct = minimum > 0 ? Math.min(100, (minimum / scale) * 100) : null;
  const minReached = minimum <= 0 || consumed >= minimum;
  const extra = Math.max(0, consumed - budget);
  const barColor = extra > 0 ? GOLD : minReached ? EMERALD : AMBER;

  return (
    <div className="w-full">
      <div
        className="relative w-full overflow-hidden rounded-full"
        style={{ height: compact ? 5 : 7, background: 'rgba(255,255,255,0.07)' }}
      >
        {/* fin du crédit prépayé */}
        {budgetPct < 100 && (
          <div
            className="absolute inset-y-0"
            style={{ left: `${budgetPct}%`, width: 1.5, background: 'rgba(255,255,255,0.22)' }}
          />
        )}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${consumedPct}%`, background: barColor }}
        />
        {minPct !== null && (
          <div
            className="absolute inset-y-0"
            style={{ left: `${minPct}%`, width: 2, background: minReached ? EMERALD : '#fff' }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2 tabular-nums">
        <span style={{ color: barColor, fontSize: compact ? 11 : 12.5, fontWeight: 700 }}>
          {fmtEuro(consumed)}
          <span style={{ color: T3, fontWeight: 500 }}> / {fmtEuro(budget)}</span>
        </span>
        <span className="truncate text-right" style={{ color: T2, fontSize: compact ? 10 : 11 }}>
          {extra > 0
            ? `${t('vipnight.extra')} +${fmtEuro(extra)}`
            : minReached
              ? minimum > 0
                ? t('vipnight.minReached')
                : `${t('vipnight.creditLeft')} ${fmtEuro(budget - consumed)}`
              : t('vipnight.underMin').replace('{amount}', fmtEuro(minimum - consumed))}
        </span>
      </div>
    </div>
  );
}
