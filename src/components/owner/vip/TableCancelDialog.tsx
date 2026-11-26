import { useState } from 'react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoneyAuto } from '@/lib/money';
import { cancelTable } from '@/lib/vipTableApi';
import { tableMoney } from '@/lib/vipTableRules';
import type { OwnerVipReservation } from '@/hooks/useOwnerVipData';

interface Props {
  reservation: OwnerVipReservation | null;
  open: boolean;
  onClose: () => void;
  /** Appelé après une annulation réussie ET après une erreur d'état (la liste doit être relue). */
  onChanged: () => void;
}

export function TableCancelDialog({ reservation, open, onClose, onChanged }: Props) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  if (!reservation) return null;
  const money = tableMoney({
    totalPrice: reservation.totalPrice, deposit: reservation.deposit, managementFee: reservation.managementFee, feeAbsorbed: reservation.feeAbsorbed,
    chargedTotal: reservation.chargedTotal, hasOnlinePayment: reservation.hasOnlinePayment,
  });
  // Ce que le serveur rendra : l'encaissé moins ce qui a déjà été remboursé (remboursements partiels précédents).
  const toRefund = Math.max(money.paidOnline - (reservation.refundedAmount || 0), 0);
  const refundsMoney = reservation.hasOnlinePayment && toRefund > 0;

  const confirm = async () => {
    setLoading(true);
    const res = await cancelTable(reservation.id);
    setLoading(false);
    if (res.ok) {
      toast.success(t(refundsMoney ? 'tblg.cancel.doneRefunded' : 'tblg.cancel.done').replace('{amount}', formatMoneyAuto(res.amount > 0 ? res.amount : toRefund)));
      onChanged();
      onClose();
    } else {
      toast.error(t(res.error.key));
      if (res.error.refresh) onChanged();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(refundsMoney ? 'tblg.cancel.titleRefund' : 'tblg.cancel.title')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>{reservation.fullName} · {reservation.guestCount} {t('tblg.guests')}</p>
              {refundsMoney ? (
                <p>
                  {t('tblg.cancel.refundBody').replace('{amount}', formatMoneyAuto(toRefund))}
                </p>
              ) : (
                <p>{t('tblg.cancel.noMoneyBody')}</p>
              )}
              <p>{t('tblg.cancel.emailBody')}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{t('tblg.cancel.keep')}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {t(refundsMoney ? 'tblg.cancel.confirmRefund' : 'tblg.cancel.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
