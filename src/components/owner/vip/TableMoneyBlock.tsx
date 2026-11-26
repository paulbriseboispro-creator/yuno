import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoneyAuto } from '@/lib/money';
import { tableMoney } from '@/lib/vipTableRules';
import type { OwnerVipReservation } from '@/hooks/useOwnerVipData';
import { T1, T3, F_BORDER } from './vip-ui';

/** Trois chiffres nommés (P4.7) : jamais « 0 € » seul pour une table réglée sur place. */
export function TableMoneyBlock({ reservation, compact = false }: { reservation: OwnerVipReservation; compact?: boolean }) {
  const { t } = useLanguage();
  const m = tableMoney({
    totalPrice: reservation.totalPrice, deposit: reservation.deposit, managementFee: reservation.managementFee, feeAbsorbed: reservation.feeAbsorbed,
    chargedTotal: reservation.chargedTotal, hasOnlinePayment: reservation.hasOnlinePayment,
    onSiteAdjustment: reservation.placementAdjustment === 'pay_on_site' ? reservation.placementAdjustmentAmount : null,
  });
  const rows: [string, number][] = [
    ['tblg.money.paidOnline', m.paidOnline],
    ['tblg.money.remainingOnSite', m.remainingOnSite],
    ['tblg.money.commitment', m.commitment],
  ];
  if (compact) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-lg px-2.5 py-2" style={{ border: `1px solid ${F_BORDER}` }}>
            <div className="tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 640 }}>{formatMoneyAuto(v)}</div>
            <div style={{ color: T3, fontSize: 10.5 }}>{t(k)}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t(k)}</span>
          <span className="font-semibold tabular-nums">{formatMoneyAuto(v)}</span>
        </div>
      ))}
    </>
  );
}

/** Ligne d'ajustement posé par un déplacement vers une autre formule (D3). */
export function PlacementAdjustmentLine({ adjustment, amount }: { adjustment?: string; amount?: number }) {
  const { t } = useLanguage();
  if (adjustment === 'upgrade_free') return <span>{t('tblg.adj.upgradeFree')}</span>;
  if (adjustment === 'pay_on_site') {
    return <span>{t('tblg.adj.payOnSite').replace('{amount}', formatMoneyAuto(amount ?? 0))}</span>;
  }
  return null;
}
