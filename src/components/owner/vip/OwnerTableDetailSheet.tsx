import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Users, Clock, MapPin, Wine, Edit, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerVipReservation, OwnerVipConsumption } from '@/hooks/useOwnerVipData';

interface OwnerTableDetailSheetProps {
  reservation: OwnerVipReservation | null;
  consumptions: OwnerVipConsumption[];
  open: boolean;
  onClose: () => void;
  onModifyPlacement: (reservation: OwnerVipReservation) => void;
  tableName?: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  waiting: { label: 'ownerTable.statusWaiting', className: 'bg-muted text-muted-foreground' },
  placed: { label: 'ownerTable.statusPlaced', className: 'bg-primary/20 text-primary' },
  active: { label: 'ownerTable.statusActive', className: 'bg-emerald-500/20 text-emerald-400' },
  finished: { label: 'ownerTable.statusFinished', className: 'bg-muted text-muted-foreground' },
};

export function OwnerTableDetailSheet({
  reservation,
  consumptions,
  open,
  onClose,
  onModifyPlacement,
  tableName,
}: OwnerTableDetailSheetProps) {
  const { t } = useLanguage();

  if (!reservation) return null;

  const totalConsumed = consumptions.reduce((sum, c) => sum + c.totalPrice, 0);
  const minimumSpend = reservation.minimumSpend || 0;
  const progressPercent = minimumSpend > 0 ? Math.min(100, (totalConsumed / minimumSpend) * 100) : 100;
  const remaining = Math.max(0, minimumSpend - totalConsumed);
  const status = statusConfig[reservation.vipStatus] || statusConfig.waiting;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[75vh] rounded-t-3xl">
        <SheetHeader className="pb-3">
          <SheetTitle className="flex items-center justify-between">
            <span className="text-lg">{reservation.fullName}</span>
            <Badge className={status.className}>{t(status.label)}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto pb-24">
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
            {minimumSpend > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('ownerTable.minSpend')}</span>
                  <span className="font-semibold">{minimumSpend}€</span>
                </div>
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
              </>
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
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
          <Button
            className="w-full h-12 font-semibold gap-2"
            variant="outline"
            onClick={() => {
              onModifyPlacement(reservation);
              onClose();
            }}
          >
            <Edit className="w-4 h-4" />
            Modifier le placement
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
