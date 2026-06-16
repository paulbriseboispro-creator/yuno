import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Users, Clock, MapPin, Wine, Edit, Check, X, RotateCcw, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RefundReasonDialog } from '@/components/owner/RefundReasonDialog';
import type { RefundableItem } from '@/components/owner/RefundItemCard';
import { OwnerVipReservation, OwnerVipConsumption } from '@/hooks/useOwnerVipData';

interface OwnerTableDetailSheetProps {
  reservation: OwnerVipReservation | null;
  consumptions: OwnerVipConsumption[];
  open: boolean;
  onClose: () => void;
  onModifyPlacement: (reservation: OwnerVipReservation) => void;
  onChanged?: () => void;
  tableName?: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  waiting: { label: 'ownerTable.statusWaiting', className: 'bg-muted text-muted-foreground' },
  placed: { label: 'ownerTable.statusPlaced', className: 'bg-primary/20 text-primary' },
  active: { label: 'ownerTable.statusActive', className: 'bg-emerald-500/20 text-emerald-400' },
  finished: { label: 'ownerTable.statusFinished', className: 'bg-muted text-muted-foreground' },
  no_show: { label: 'vipHost.statusNoShow', className: 'bg-muted text-muted-foreground' },
  denied: { label: 'vipHost.statusDenied', className: 'bg-red-500/20 text-red-400' },
};

export function OwnerTableDetailSheet({
  reservation,
  consumptions,
  open,
  onClose,
  onModifyPlacement,
  onChanged,
  tableName,
}: OwnerTableDetailSheetProps) {
  const { t } = useLanguage();
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundLoading, setRefundLoading] = useState(false);
  const [editingMin, setEditingMin] = useState(false);
  const [minInput, setMinInput] = useState('');
  const [savingMin, setSavingMin] = useState(false);

  if (!reservation) return null;

  const totalConsumed = consumptions.reduce((sum, c) => sum + c.totalPrice, 0);
  const minimumSpend = reservation.minimumSpend || 0;
  const progressPercent = minimumSpend > 0 ? Math.min(100, (totalConsumed / minimumSpend) * 100) : 100;
  const remaining = Math.max(0, minimumSpend - totalConsumed);
  const status = statusConfig[reservation.vipStatus] || statusConfig.waiting;

  // The customer paid the deposit online (+ Yuno's management fee, which is not
  // refundable). The club can refund up to the deposit. owner-refund clamps again
  // server-side and processes the Stripe reverse-transfer.
  const refundItem: RefundableItem = {
    id: reservation.id,
    type: 'table_reservation',
    email: reservation.userEmail,
    name: reservation.fullName,
    amount: reservation.totalPrice,
    serviceFee: 0,
    stripeFee: 0,
    clubReceived: reservation.deposit || 0,
    createdAt: reservation.createdAt,
    hasPaymentIntent: true,
  };

  const handleRefund = async (reason: string, amounts: Record<string, number>) => {
    setRefundLoading(true);
    try {
      const amount = amounts[reservation.id] || 0;
      const { data, error } = await supabase.functions.invoke('owner-refund', {
        body: { items: [{ type: 'table_reservation', id: reservation.id, amount }], reason },
      });
      if (error) throw error;
      const res = data?.results?.[0];
      if (res?.success) {
        toast.success(t('ownerTable.refundDone'));
        setRefundOpen(false);
        onChanged?.();
        onClose();
      } else {
        toast.error(res?.error || t('ownerTable.refundError'));
      }
    } catch (e) {
      toast.error((e as Error)?.message || t('ownerTable.refundError'));
    } finally {
      setRefundLoading(false);
    }
  };

  const startEditMin = () => {
    setMinInput(String(minimumSpend));
    setEditingMin(true);
  };

  const saveMin = async (value: number) => {
    setSavingMin(true);
    try {
      const { error } = await supabase
        .from('table_reservations')
        .update({ minimum_spend: Math.max(0, value) })
        .eq('id', reservation.id);
      if (error) throw error;
      toast.success(t('ownerTable.minSpendUpdated'));
      setEditingMin(false);
      onChanged?.();
    } catch (e) {
      toast.error((e as Error)?.message || t('common.error'));
    } finally {
      setSavingMin(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl">
        <SheetHeader className="pb-3">
          <SheetTitle className="flex items-center justify-between">
            <span className="text-lg">{reservation.fullName}</span>
            <Badge className={status.className}>{t(status.label)}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto pb-28">
          {/* Quick info */}
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {reservation.guestCount} pers.
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: reservation.zoneColor }} />
              {reservation.zoneName}
            </span>
            {tableName && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {tableName}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {new Date(reservation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Financial summary */}
          <Card className="p-4 border-0 bg-muted/30 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('ownerTable.depositPaid')}</span>
              <span className="font-semibold">{reservation.deposit}€</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total table</span>
              <span className="font-semibold">{reservation.totalPrice}€</span>
            </div>

            {/* Minimum spend — editable / waivable live */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('ownerTable.minSpend')}</span>
              {editingMin ? (
                <div className="flex items-center gap-1.5">
                  <div className="relative w-24">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={minInput}
                      onChange={(e) => setMinInput(e.target.value)}
                      className="h-8 text-right pr-6 text-sm"
                      disabled={savingMin}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={savingMin} onClick={() => saveMin(parseFloat(minInput) || 0)}>
                    {savingMin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={savingMin} onClick={() => setEditingMin(false)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{minimumSpend}€</span>
                  {minimumSpend > 0 && (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-muted-foreground" disabled={savingMin} onClick={() => saveMin(0)}>
                      <RotateCcw className="w-3 h-3 mr-1" />
                      {t('ownerTable.waiveMinSpend')}
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={startEditMin}>
                    <Edit className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>

            {minimumSpend > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('ownerTable.progress')}</span>
                  <span>{progressPercent.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${progressPercent}%`,
                      backgroundColor: progressPercent >= 100 ? 'rgb(16, 185, 129)' : progressPercent >= 50 ? 'rgb(59, 130, 246)' : 'rgb(245, 158, 11)',
                    }}
                  />
                </div>
                {remaining > 0 && (
                  <p className="text-xs text-muted-foreground">Reste {remaining.toFixed(0)}€ pour atteindre le minimum</p>
                )}
              </div>
            )}
          </Card>

          {/* Consumption summary */}
          <Card className="p-4 border-0 bg-muted/30">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm flex items-center gap-1.5">
                <Wine className="w-4 h-4 text-primary" />
                Consommations
              </h4>
              <span className="text-sm font-bold text-primary">{totalConsumed.toFixed(0)}€</span>
            </div>
            {consumptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('ownerTable.noConsumption')}</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {consumptions.map((c) => (
                  <div key={c.id} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {c.quantity}x {c.itemName}
                    </span>
                    <span className="font-medium">{c.totalPrice.toFixed(0)}€</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Contact info */}
          <Card className="p-4 border-0 bg-muted/30 space-y-1.5">
            <h4 className="font-semibold text-sm mb-2">Contact</h4>
            <p className="text-sm text-muted-foreground">{reservation.userEmail}</p>
            {reservation.phone && <p className="text-sm text-muted-foreground">{reservation.phone}</p>}
          </Card>
        </div>

        {/* Actions */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t flex gap-2" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
          <Button
            className="flex-1 h-12 font-semibold gap-2"
            variant="outline"
            onClick={() => {
              onModifyPlacement(reservation);
              onClose();
            }}
          >
            <Edit className="w-4 h-4" />
            {t('ownerTable.modifyPlacement')}
          </Button>
          <Button
            className="flex-1 h-12 font-semibold gap-2 text-destructive hover:text-destructive"
            variant="outline"
            onClick={() => setRefundOpen(true)}
          >
            <RotateCcw className="w-4 h-4" />
            {t('ownerTable.refund')}
          </Button>
        </div>
      </SheetContent>

      <RefundReasonDialog
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        onConfirm={handleRefund}
        items={[refundItem]}
        loading={refundLoading}
      />
    </Sheet>
  );
}
