import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';
import type { RefundableItem } from './RefundItemCard';
import { ShoppingBag, Ticket, Crown } from 'lucide-react';

interface RefundReasonDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string, amounts: Record<string, number>) => void;
  items: RefundableItem[];
  loading?: boolean;
}

export function RefundReasonDialog({ open, onClose, onConfirm, items, loading }: RefundReasonDialogProps) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  // Pre-fill amounts with max (clubReceived - stripeFee)
  useEffect(() => {
    if (open) {
      const initial: Record<string, number> = {};
      for (const item of items) {
        initial[item.id] = Math.max(0, Math.round((item.clubReceived - item.stripeFee) * 100) / 100);
      }
      setAmounts(initial);
      setReason('');
    }
  }, [open, items]);

  const setAmount = (id: string, value: number) => {
    setAmounts(prev => ({ ...prev, [id]: value }));
  };

  const totalRefund = Object.values(amounts).reduce((s, v) => s + (v || 0), 0);

  const isValid = reason.trim().length > 0 && items.every(item => {
    const amt = amounts[item.id] || 0;
    return amt >= 0 && amt <= item.clubReceived;
  });

  const handleConfirm = () => {
    if (isValid) {
      onConfirm(reason.trim(), amounts);
    }
  };

  const typeIcons = {
    order: <ShoppingBag className="h-3.5 w-3.5" />,
    ticket: <Ticket className="h-3.5 w-3.5" />,
    table_reservation: <Crown className="h-3.5 w-3.5" />,
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('refund.confirmTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Per-item amounts */}
          <div className="space-y-3">
            {items.map(item => {
              const maxAmount = item.clubReceived;
              const currentAmount = amounts[item.id] || 0;
              const isOverMax = currentAmount > maxAmount;

              return (
                <div key={item.id} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground">{typeIcons[item.type]}</span>
                      <span className="text-sm font-medium truncate">{item.name || item.email}</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>{t('refund.clubReceived')}: <span className="text-foreground font-medium">{item.clubReceived.toFixed(2)} €</span></div>
                    <div>{t('refund.stripeFees')}: <span className="text-orange-400 font-medium">{item.stripeFee.toFixed(2)} €</span></div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">{t('refund.enterAmount')}:</label>
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max={maxAmount}
                        value={currentAmount}
                        onChange={(e) => setAmount(item.id, parseFloat(e.target.value) || 0)}
                        className={`text-right pr-8 h-8 text-sm ${isOverMax ? 'border-red-500' : ''}`}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
                    </div>
                  </div>
                  {isOverMax && (
                    <p className="text-xs text-red-400">{t('refund.maxRefund')}: {maxAmount.toFixed(2)} €</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Total */}
          <div className="rounded-lg bg-muted/50 p-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t('refund.totalAmount')}</span>
            <span className="text-lg font-bold text-green-500">{totalRefund.toFixed(2)} €</span>
          </div>

          {/* Reason */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('refund.reasonLabel')} *</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('refund.reasonPlaceholder')}
              rows={3}
            />
          </div>

          <p className="text-xs text-muted-foreground">{t('refund.reasonNote')}</p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>{t('common.cancel')}</Button>
          <Button onClick={handleConfirm} disabled={!isValid || loading} className="bg-red-600 hover:bg-red-700">
            {loading ? t('refund.processing') : `${t('refund.confirmRefund')} — ${totalRefund.toFixed(2)} €`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
