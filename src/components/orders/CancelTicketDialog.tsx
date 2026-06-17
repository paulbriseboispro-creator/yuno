import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';

interface CancelTicketDialogProps {
  open: boolean;
  refundAmount: number | null;
  cancelling: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

// Confirmation dialog for cancelling a ticket (from MyOrders).
export function CancelTicketDialog({ open, refundAmount, cancelling, onClose, onConfirm }: CancelTicketDialogProps) {
  const { t } = useLanguage();
  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('tickets.cancelConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {refundAmount !== null && t('tickets.cancelConfirmDesc').replace('{amount}', refundAmount.toFixed(2))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={cancelling}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {cancelling ? '...' : t('tickets.cancelTicket')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
