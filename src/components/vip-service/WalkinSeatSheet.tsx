import { useState, useEffect, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Minus, Plus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { VenueFloorPlan } from '@/types';
import { ServiceFloorPlan } from './ServiceFloorPlan';
import { ServiceReservation, TableServiceInfo } from './serviceTypes';

const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';

interface WalkinSeatSheetProps {
  open: boolean;
  floorPlan: VenueFloorPlan | null;
  reservations: ServiceReservation[];
  serviceInfo: Map<string, TableServiceInfo>;
  busy: boolean;
  disabled: boolean;
  onCreate: (input: { tableId: string; zoneId: string; fullName: string | null; guestCount: number }) => void;
  onClose: () => void;
}

/**
 * Créer un walk-in et le placer sur le plan DÈS L'ENTRÉE, sans passer par la
 * commande. Nom + personnes, puis un tap sur une table libre du plan crée la
 * réservation (addition ouverte : le CA suivra les consos) et l'installe.
 */
export function WalkinSeatSheet({ open, floorPlan, reservations, serviceInfo, busy, disabled, onCreate, onClose }: WalkinSeatSheetProps) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [guests, setGuests] = useState(2);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setName(''); setGuests(2); setSelectedTableId(null); }
  }, [open]);

  const tables = useMemo(() => (floorPlan?.layout?.tables || []), [floorPlan]);
  const selectedTable = selectedTableId ? tables.find(t => t.id === selectedTableId) : undefined;

  const confirm = () => {
    if (!selectedTable) return;
    if (!selectedTable.zoneId) {
      toast.error(t('vipnight.error'));
      return;
    }
    onCreate({
      tableId: selectedTable.id,
      zoneId: selectedTable.zoneId,
      fullName: name.trim() || null,
      guestCount: guests,
    });
  };

  const tableName = selectedTable?.name || '…';

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="flex h-[86vh] flex-col gap-0 rounded-t-3xl p-0">
        <SheetHeader className="shrink-0 px-4 pb-2 pr-12 pt-5 sm:px-6">
          <SheetTitle className="flex items-center gap-2 text-left">
            <UserPlus className="h-5 w-5" style={{ color: '#E7C15A' }} />
            {t('vipnight.walkinNew')}
          </SheetTitle>
          <p className="text-left text-sm text-muted-foreground">{t('vipnight.walkinSeatHint')}</p>
        </SheetHeader>

        {/* Nom + personnes */}
        <div className="shrink-0 space-y-2.5 px-4 pb-2 sm:px-6">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('vippos.walkinFallbackName')} className="h-10" />
          <div className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
            <span style={{ color: T2, fontSize: 13 }}>{t('vippos.walkinGuests')}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setGuests(g => Math.max(1, g - 1))} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: '#fff' }}><Minus className="h-4 w-4" /></button>
              <span className="w-6 text-center tabular-nums" style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{guests}</span>
              <button type="button" onClick={() => setGuests(g => g + 1)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: '#fff' }}><Plus className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        {/* Plan : tap une table libre */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 sm:px-6">
          <ServiceFloorPlan
            floorPlan={floorPlan}
            reservations={reservations}
            serviceInfo={serviceInfo}
            mode="pick"
            selectedTableId={selectedTableId}
            onTableTap={(tableId, reservation) => {
              if (reservation) return; // table occupée
              setSelectedTableId(tableId);
            }}
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">{t('vipnight.pickFree')}</p>
        </div>

        {/* CTA */}
        <div
          className="shrink-0 border-t bg-background/95 px-4 pt-3 backdrop-blur sm:px-6"
          style={{ borderColor: BORDER, paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <Button className="h-12 w-full font-semibold" disabled={!selectedTable || busy || disabled} onClick={confirm}>
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : disabled ? (
              <span className="truncate">{t('vipnight.offlineBlocked')}</span>
            ) : (
              <span className="truncate">{t('vipnight.walkinPlaceAt').replace('{table}', tableName)}</span>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
