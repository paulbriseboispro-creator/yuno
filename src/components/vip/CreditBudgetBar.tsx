import { useLanguage } from '@/contexts/LanguageContext';

interface CreditBudgetBarProps {
  includedBudget: number;
  cartTotal: number;
  packName?: string | null;
  zoneName?: string;
  zoneColor?: string;
}

export function CreditBudgetBar({
  includedBudget,
  cartTotal,
  packName,
  zoneName,
  zoneColor,
}: CreditBudgetBarProps) {
  const { t } = useLanguage();

  const coveredByCredit = Math.min(cartTotal, includedBudget);
  const extraAmount = Math.max(0, cartTotal - includedBudget);
  const usagePercent = includedBudget > 0 ? Math.min((coveredByCredit / includedBudget) * 100, 100) : 0;
  const remaining = Math.max(0, includedBudget - coveredByCredit);
  const accent = zoneColor || '#9A9A9A';

  return (
    <div className="yuno-card overflow-hidden">
      {/* Red top rule — editorial signal */}
      <div style={{ height: 2, background: '#E8192C' }} />

      <div className="p-4">
        {/* Kicker + zone/pack tags */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="font-mono uppercase" style={{ fontSize: 10, color: '#5A5A5E', letterSpacing: '0.14em' }}>
            {t('vipBudget.yourFormula')}
          </p>
          <div className="flex items-center gap-1.5">
            {zoneName && (
              <span
                className="font-mono uppercase"
                style={{ fontSize: 9.5, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 999, color: accent, background: `${accent}1A`, border: `1px solid ${accent}40` }}
              >
                {zoneName}
              </span>
            )}
            {packName && (
              <span
                className="font-mono uppercase"
                style={{ fontSize: 9.5, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 999, color: '#9A9A9A', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
              >
                {packName}
              </span>
            )}
          </div>
        </div>

        {/* Giant credit number */}
        <p className="font-mono uppercase" style={{ fontSize: 9.5, color: '#9A9A9A', letterSpacing: '0.12em' }}>
          {t('vipBudget.includedCredit')}
        </p>
        <p
          className="font-display font-bold text-white"
          style={{ fontSize: 'clamp(40px, 12vw, 56px)', letterSpacing: '-0.03em', lineHeight: 0.9, marginTop: 4 }}
        >
          {includedBudget}€
        </p>

        {/* Progress */}
        <div className="mt-4">
          <div className="w-full overflow-hidden" style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
            <div style={{ height: '100%', width: `${usagePercent}%`, background: '#E8192C', transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)', borderRadius: 1 }} />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="font-mono uppercase" style={{ fontSize: 10, color: '#5A5A5E', letterSpacing: '0.06em' }}>
              {coveredByCredit}€ / {includedBudget}€ {t('vipBudget.usedLabel')}
            </span>
            <span className="font-mono uppercase" style={{ fontSize: 10, color: '#9A9A9A', letterSpacing: '0.06em' }}>
              {remaining}€ {t('vipBudget.remaining')}
            </span>
          </div>
        </div>

        {/* Cart summary */}
        {cartTotal > 0 && (
          <div className="mt-3 pt-3 flex items-center justify-between gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="font-mono uppercase" style={{ fontSize: 10, color: '#9A9A9A', letterSpacing: '0.06em' }}>
              {t('vipBudget.cart')} · <span style={{ color: '#fff', fontWeight: 700 }}>{cartTotal}€</span>
            </span>
            {extraAmount === 0 ? (
              <span className="font-mono font-bold uppercase" style={{ fontSize: 10, color: '#E5E5E5', letterSpacing: '0.08em' }}>
                {t('vipBudget.covered')}
              </span>
            ) : (
              <span className="font-mono font-bold uppercase" style={{ fontSize: 10, color: '#E8192C', letterSpacing: '0.08em' }}>
                +{extraAmount}€ {t('vipBudget.extra')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
