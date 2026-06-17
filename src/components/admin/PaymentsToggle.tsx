import { useState } from 'react';
import { usePaymentsEnabled } from '@/hooks/usePaymentsEnabled';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { CreditCard, Ban, AlertTriangle } from 'lucide-react';

// ─── Yuno Design Tokens (mirror MaintenanceToggle) ─────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const NEG         = '#FF5C63';
const T1          = 'rgba(255,255,255,0.96)';
const T3          = 'rgba(255,255,255,0.36)';
const BORDER      = 'rgba(255,255,255,0.085)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative flex-none transition-all duration-200"
      style={{
        width: 46, height: 26, borderRadius: 13, cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? RED : 'rgba(255,255,255,0.1)',
        border: `1px solid ${on ? 'rgba(232,25,44,0.5)' : BORDER}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="absolute top-1/2 transition-all duration-200"
        style={{
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          transform: 'translateY(-50%)', left: on ? 22 : 2,
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  );
}

export function PaymentsToggle() {
  const { t } = useLanguage();
  const { paymentsDisabled, loading, togglePaymentsDisabled } = usePaymentsEnabled();
  const [updating, setUpdating] = useState(false);

  const handleToggle = async (disabled: boolean) => {
    setUpdating(true);
    const result = await togglePaymentsDisabled(disabled);
    setUpdating(false);
    if (result.success) toast.success(disabled ? t('payments.toggleEnabled') : t('payments.toggleDisabled'));
    else toast.error(result.error || 'Error');
  };

  const cardBase: React.CSSProperties = {
    background: CARD_BG,
    border: `1px solid ${paymentsDisabled ? 'rgba(255,92,99,0.3)' : BORDER}`,
    borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden',
  };

  if (loading) {
    return (
      <div style={cardBase}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  return (
    <div style={cardBase}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
            style={paymentsDisabled
              ? { background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)' }
              : { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}
          >
            {paymentsDisabled
              ? <Ban className="h-4 w-4" style={{ color: NEG }} />
              : <CreditCard className="h-4 w-4" style={{ color: POS }} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('payments.title')}</h3>
              {paymentsDisabled && (
                <span style={{ background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.3)', color: NEG, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('payments.blocked')}
                </span>
              )}
            </div>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('payments.lockDesc')}</p>
          </div>
        </div>
        <Toggle on={paymentsDisabled} disabled={updating} onChange={handleToggle} />
      </div>

      {paymentsDisabled && (
        <div className="flex items-start gap-2.5 mt-4 p-3 rounded-xl" style={{ background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.2)' }}>
          <AlertTriangle className="h-4 w-4 flex-none mt-0.5" style={{ color: NEG }} />
          <p style={{ color: 'rgba(255,140,145,0.95)', fontSize: 12.5, lineHeight: 1.5 }}>{t('payments.warningMsg')}</p>
        </div>
      )}
    </div>
  );
}
