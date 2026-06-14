import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { VipFloorPlan } from '@/components/vip-host/VipFloorPlan';
import { VenueFloorPlan, VipReservation } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Loader2, MapPin, MessageSquare, Check, ArrowRightLeft } from 'lucide-react';

interface PlacementFloorPlanSheetProps {
  open: boolean;
  onClose: () => void;
  reservation: {
    id: string;
    fullName: string;
    guestCount: number;
    zoneName?: string;
    requestedTableId?: string;
    requestedTableName?: string;
  } | null;
  floorPlan: VenueFloorPlan | null;
  reservations: VipReservation[];
  onRefresh: () => void;
}

export function PlacementFloorPlanSheet({
  open,
  onClose,
  reservation,
  floorPlan,
  reservations,
  onRefresh,
}: PlacementFloorPlanSheetProps) {
  const { t } = useLanguage();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirmModification = async () => {
    if (!reservation || !selectedTableId) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('table_reservations')
        .update({
          placement_status: 'modified',
          assigned_table_id: selectedTableId,
          placement_note: note.trim() || null,
          placement_reviewed_by: user?.id,
          placement_reviewed_at: new Date().toISOString(),
        })
        .eq('id', reservation.id);

      if (error) throw error;

      // Send VIP modification email
      supabase.functions.invoke('send-vip-confirmation', {
        body: { reservation_id: reservation.id, type: 'modified' },
      }).catch(err => console.error('Error sending VIP email:', err));

      toast.success(t('vipPlacement.modificationSuccess'));
      onRefresh();
      onClose();
      setSelectedTableId(null);
      setNote('');
    } catch {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const tableName = selectedTableId
    ? floorPlan?.layout?.tables?.find(tbl => tbl.id === selectedTableId)?.name || selectedTableId
    : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl">
        <SheetHeader className="pb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            {t('vipPlacement.modifyPlacement')}
          </SheetTitle>
          {reservation && (
            <p className="text-sm text-muted-foreground">
              {reservation.fullName} • {reservation.guestCount} {t('tableCheckout.guests')}
              {reservation.zoneName && ` • ${reservation.zoneName}`}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pb-32">
          {/* Floor plan */}
          {floorPlan && (
            <VipFloorPlan
              floorPlan={floorPlan}
              reservations={reservations}
              mode="placement"
              selectedTableId={selectedTableId || undefined}
              onTableSelect={(tableId) => setSelectedTableId(tableId)}
            />
          )}

          {/* Note to client */}
          <div className="space-y-2 px-1">
            <Label className="flex items-center gap-1.5 text-sm">
              <MessageSquare className="w-3.5 h-3.5" />
              {t('vipPlacement.noteToClient')}
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('vipPlacement.notePlaceholder')}
              rows={2}
              className="text-sm"
            />
          </div>
        </div>

        {/* Action button */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
          <Button
            className="w-full h-12 font-semibold gap-2"
            disabled={!selectedTableId || loading}
            onClick={handleConfirmModification}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                {tableName
                  ? `${t('vipPlacement.confirmTo')} ${tableName}`
                  : t('vipPlacement.selectTableFirst')
                }
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
