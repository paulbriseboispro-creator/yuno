import { useState } from 'react';
import { usePaymentsEnabled } from '@/hooks/usePaymentsEnabled';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { CreditCard } from 'lucide-react';
import { Card, Toggle, Pill, NEG, T2, RED_SOFT_BG, RED_SOFT_BORDER } from '@/components/admin/ui';

/**
 * Coupe-circuit des paiements (app_settings.payments_disabled). Interrupteur
 * ALLUMÉ = paiements COUPÉS : tout checkout réel est refusé côté serveur, les
 * comptes démo continuent leur simulation sans débit.
 */
export function PaymentsToggle() {
  const { t } = useLanguage();
  const { paymentsDisabled, loading, togglePaymentsDisabled } = usePaymentsEnabled();
  const [busy, setBusy] = useState(false);

  const handleToggle = async (disabled: boolean) => {
    setBusy(true);
    const result = await togglePaymentsDisabled(disabled);
    setBusy(false);
    if (result.success) toast.success(disabled ? t('payments.toggleEnabled') : t('payments.toggleDisabled'));
    else toast.error(result.error ?? t('adm.common.actionFailed'));
  };

  return (
    <Card title={t('payments.title')} subtitle={t('payments.lockDesc')} icon={CreditCard} accent={paymentsDisabled}
      right={<div className="flex items-center gap-2">{paymentsDisabled && <Pill tone="hot">{t('payments.blocked')}</Pill>}<Toggle checked={paymentsDisabled} onChange={handleToggle} disabled={loading || busy} /></div>}>
      {paymentsDisabled ? (
        <div className="rounded-xl px-3 py-2.5" style={{ background: RED_SOFT_BG, border: `1px solid ${RED_SOFT_BORDER}` }}>
          <p style={{ color: NEG, fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>{t('payments.warningMsg')}</p>
        </div>
      ) : (
        <p style={{ color: T2, fontSize: 12.5, margin: 0 }}>{t('adm.system.paymentsDesc')}</p>
      )}
    </Card>
  );
}
