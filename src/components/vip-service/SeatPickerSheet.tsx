import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Loader2, MapPin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VenueFloorPlan } from '@/types';
import { ServiceFloorPlan } from './ServiceFloorPlan';
import { ServiceReservation, TableServiceInfo } from './serviceTypes';

interface SeatPickerSheetProps {
  open: boolean;
  reservation: ServiceReservation | null;
  /** true = déplacement d'un client déjà installé, false = installation initiale. */
  moveMode: boolean;
  floorPlan: VenueFloorPlan | null;
  reservations: ServiceReservation[];
  serviceInfo: Map<string, TableServiceInfo>;
  busy: boolean;
  disabled: boolean;
  onConfirm: (tableId: string) => void;
  onMarkAbsent: (status: 'no_show' | 'denied') => void;
  onClose: () => void;
}

/**
 * Choix de table sur le plan (installation ou déplacement). La table demandée
 * par le client au checkout est pré-sélectionnée et pulse en rouge — un tap
 * sur le CTA suffit dans le cas nominal.
 */
export function SeatPickerSheet({
  open,
  reservation,
  moveMode,
  floorPlan,
  reservations,
  serviceInfo,
  busy,
  disabled,
  onConfirm,
  onMarkAbsent,
  onClose,
}: SeatPickerSheetProps) {
  const { t } = useLanguage();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const requestedFree =
    !!reservation?.requestedTableId &&
    !reservations.some(
      r =>
        r.assignedTableId === reservation.requestedTableId &&
        (r.vipStatus === 'placed' || r.vipStatus === 'active') &&
        r.id !== reservation.id
    );

  useEffect(() => {
    if (!open || !reservation) {
      setSelectedTableId(null);
      return;
    }
    if (moveMode) setSelectedTableId(reservation.assignedTableId || null);
    else setSelectedTableId(requestedFree ? reservation.requestedTableId : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation?.id]);

  if (!reservation) return null;

  const tableName = (id: string | null) =>
    (floorPlan?.layout?.tables || []).find(tb => tb.id === id)?.name || id || '…';

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="flex h-[82vh] flex-col gap-0 rounded-t-3xl p-0">
        <SheetHeader className="shrink-0 px-4 pb-3 pr-12 pt-5 sm:px-6 sm:pr-14">
          <SheetTitle className="text-left">
            {(moveMode ? t('vipnight.moveGuest') : t('vipnight.seatGuest')).replace('{name}', reservation.fullName)}
          </SheetTitle>
          <p className="text-left text-sm text-muted-foreground">
            {reservation.guestCount} {t('vipnight.persons')} · {reservation.zoneName}
            {reservation.requestedTableName && !moveMode && (
              <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-primary">
                <MapPin className="h-3.5 w-3.5" />
                {t('vipnight.requestedTable').replace('{table}', reservation.requestedTableName)}
              </span>
            )}
          </p>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
          <ServiceFloorPlan
            floorPlan={floorPlan}
            reservations={reservations.filter(r => r.id !== reservation.id)}
            serviceInfo={serviceInfo}
            mode="pick"
            selectedTableId={selectedTableId}
            highlightTableId={!moveMode ? reservation.requestedTableId : null}
            onTableTap={tableId => setSelectedTableId(tableId)}
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">{t('vipnight.pickFree')}</p>
        </div>

        <div
          className="shrink-0 space-y-2 border-t bg-background/95 px-4 pt-3 backdrop-blur sm:px-6"
          style={{ paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <Button
            className="h-12 w-full font-semibold"
            disabled={!selectedTableId || busy || disabled}
            onClick={() => selectedTableId && onConfirm(selectedTableId)}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : disabled ? (
              <span className="truncate">{t('vipnight.offlineBlocked')}</span>
            ) : (
              <span className="truncate">
                {(moveMode ? t('vipnight.moveTo') : t('vipnight.seatAt')).replace('{table}', tableName(selectedTableId))}
              </span>
            )}
          </Button>

          {!moveMode && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-11 min-w-0 flex-1 hover:bg-muted"
                disabled={busy || disabled}
                onClick={() => onMarkAbsent('no_show')}
              >
                <span className="truncate">{t('vipnight.noShow')}</span>
              </Button>
              <Button
                variant="outline"
                className="h-11 min-w-0 flex-1 text-destructive hover:bg-muted hover:text-destructive"
                disabled={busy || disabled}
                onClick={() => onMarkAbsent('denied')}
              >
                <span className="truncate">{t('vipnight.denyEntry')}</span>
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
