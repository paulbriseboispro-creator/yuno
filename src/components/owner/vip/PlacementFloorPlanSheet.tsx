import { useEffect, useMemo, useState } from 'react';
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
import { Loader2, MessageSquare, Check, ArrowRightLeft } from 'lucide-react';
import { formatMoneyAuto } from '@/lib/money';
import { setTablePlacement, sendTableChangedEmail, saveReservationNote } from '@/lib/vipTableApi';
import {
  adjustmentArgs, adjustmentNeed, freeTablesOfPack, vipErrorInfo, type PlacementAdjustment,
} from '@/lib/vipTableRules';

export interface PlacementSheetReservation {
  id: string;
  fullName: string;
  guestCount: number;
  zoneName?: string;
  packId?: string;
  requestedTableId?: string;
  requestedTableName?: string;
  assignedTableId?: string;
  /** État de placement vu à l'écran : le serveur refuse si un collègue est déjà passé. */
  placementStatus?: string;
}

interface PlacementFloorPlanSheetProps {
  open: boolean;
  onClose: () => void;
  reservation: PlacementSheetReservation | null;
  floorPlan: VenueFloorPlan | null;
  reservations: VipReservation[];
  onRefresh: () => void;
  /**
   * `propose` : « Proposer une autre table », plan filtré sur les tables libres de la
   * MÊME formule. `move` : déplacement libre ; une autre formule demande le choix
   * « Surclassement offert » / « Différence à régler sur place ».
   */
  mode?: 'propose' | 'move';
}

type PackLite = { id: string; name: string; base_price: number; event_id: string | null; venue_id: string | null };

export function PlacementFloorPlanSheet({
  open, onClose, reservation, floorPlan, reservations, onRefresh, mode = 'move',
}: PlacementFloorPlanSheetProps) {
  const { t } = useLanguage();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [packs, setPacks] = useState<Record<string, PackLite>>({});
  const [choice, setChoice] = useState<PlacementAdjustment | null>(null);
  const [amountInput, setAmountInput] = useState('');

  const planTables = floorPlan?.layout?.tables;
  const packIds = useMemo(() => {
    const ids = new Set<string>();
    (planTables ?? []).forEach(tb => { if (tb.packId) ids.add(tb.packId); });
    if (reservation?.packId) ids.add(reservation.packId);
    return [...ids];
  }, [planTables, reservation?.packId]);

  // Prix des formules POUR CETTE SOIRÉE (preset ou prix personnalisés, comme le checkout) : sert à proposer l'écart
  // de « différence à régler sur place ». Sans prix de soirée, le prix catalogue de la formule.
  useEffect(() => {
    if (!open || packIds.length === 0 || !reservation) return;
    let alive = true;
    (async () => {
      const [{ data: packRows }, { data: resaRow }] = await Promise.all([
        supabase.from('table_packs').select('id, name, base_price, event_id, venue_id').in('id', packIds),
        supabase.from('table_reservations').select('event_id').eq('id', reservation.id).maybeSingle(),
      ]);
      const overrides = new Map<string, number>();
      const collect = (list: { packId: string; customPrice: number | null }[] | null | undefined) => {
        for (const o of list ?? []) if (o.customPrice != null) overrides.set(o.packId, Number(o.customPrice));
      };
      if (resaRow?.event_id) {
        const { data: settings } = await supabase.from('event_table_settings').select('preset_id, custom_prices').eq('event_id', resaRow.event_id).maybeSingle();
        if (settings?.preset_id) {
          const { data: preset } = await supabase.from('table_pack_presets').select('packs').eq('id', settings.preset_id).maybeSingle();
          collect(preset?.packs as { packId: string; customPrice: number | null }[] | undefined);
        } else {
          collect(settings?.custom_prices as { packId: string; customPrice: number | null }[] | undefined);
        }
      }
      if (!alive) return;
      const map: Record<string, PackLite> = {};
      (packRows ?? []).forEach(p => { map[p.id] = { ...(p as PackLite), base_price: overrides.get(p.id) ?? Number(p.base_price) }; });
      setPacks(map);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [open, packIds, reservation]);

  useEffect(() => {
    if (!open) { setSelectedTableId(null); setNote(''); setChoice(null); setAmountInput(''); }
  }, [open]);

  // Mode « proposer » : le plan ne montre que les tables libres de la même formule.
  const shownPlan = useMemo(() => {
    if (!floorPlan || mode !== 'propose' || !reservation) return floorPlan;
    const allowed = new Set(freeTablesOfPack(planTables ?? [], reservations, reservation.packId, reservation.id));
    return { ...floorPlan, layout: { ...floorPlan.layout, tables: (planTables ?? []).filter(tb => allowed.has(tb.id)) } };
  }, [floorPlan, mode, reservation, reservations, planTables]);

  const selectedTable = selectedTableId ? planTables?.find(tb => tb.id === selectedTableId) : undefined;
  const need = useMemo(() => {
    if (!reservation || !selectedTable) return { required: false, difference: 0 };
    const resaPack = packs[reservation.packId ?? ''];
    const target = packs[selectedTable.packId ?? ''];
    // Même règle que le serveur : le choix n'est demandé que si la formule liée à la table vit dans le MÊME périmètre
    // (soirée / club) que la formule de la réservation ; sinon la liaison ne s'applique pas.
    if (resaPack && target && (resaPack.event_id !== target.event_id || resaPack.venue_id !== target.venue_id)) {
      return { required: false, difference: 0 };
    }
    return adjustmentNeed({
      reservationPackId: reservation.packId,
      targetPackId: selectedTable.packId,
      reservationPrice: resaPack?.base_price ?? 0,
      targetPrice: target?.base_price ?? 0,
    });
  }, [reservation, selectedTable, packs]);

  // À chaque nouvelle table : le choix d'ajustement repart de zéro, l'écart est proposé.
  useEffect(() => {
    setChoice(null);
    setAmountInput(need.required ? String(need.difference) : '');
  }, [selectedTableId, need.required, need.difference]);

  const adj = need.required ? adjustmentArgs(choice, parseFloat(amountInput.replace(',', '.')) || 0) : null;
  const adjustmentMissing = need.required && !adj;

  const handleConfirm = async () => {
    if (!reservation || !selectedTableId || adjustmentMissing) return;
    setLoading(true);
    const res = await setTablePlacement({
      reservationId: reservation.id,
      action: 'assign',
      tableId: selectedTableId,
      adjustment: need.required ? adj : null,
      expectedPlacementStatus: reservation.placementStatus ?? null,
    });
    if (!res.ok) {
      setLoading(false);
      toast.error(t(res.error.key));
      if (res.error.refresh) { onRefresh(); onClose(); }
      return;
    }
    // Remarque au client : champ de service, jamais un champ de placement.
    const noteSaved = note.trim() ? await saveReservationNote(reservation.id, note.trim()) : true;
    // E-mail « ta table change » seulement quand le serveur le décide.
    let emailError: ReturnType<typeof vipErrorInfo> | null = null;
    if (res.notify === 'table_changed') emailError = await sendTableChangedEmail(reservation.id);
    setLoading(false);
    toast.success(t('vipPlacement.modificationSuccess'));
    if (!noteSaved) toast.warning(t('tblg.noteNotSaved'));
    if (emailError) toast.warning(`${t('tblg.emailNotSent')} ${t(emailError.key)}`);
    onRefresh();
    onClose();
  };

  const tableName = selectedTable?.name || selectedTableId;
  const targetPack = selectedTable?.packId ? packs[selectedTable.packId] : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl">
        <SheetHeader className="pb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            {t(mode === 'propose' ? 'tblg.proposeTitle' : 'vipPlacement.modifyPlacement')}
          </SheetTitle>
          {reservation && (
            <p className="text-sm text-muted-foreground">
              {reservation.fullName} • {reservation.guestCount} {t('tableCheckout.guests')}
              {reservation.zoneName && ` • ${reservation.zoneName}`}
            </p>
          )}
          {mode === 'propose' && (
            <p className="text-xs text-muted-foreground">{t('tblg.proposeHint')}</p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pb-32">
          {shownPlan && (
            <VipFloorPlan
              floorPlan={shownPlan}
              reservations={reservations}
              mode="placement"
              selectedTableId={selectedTableId || undefined}
              onTableSelect={(tableId) => setSelectedTableId(tableId)}
            />
          )}

          {need.required && (
            <div className="space-y-3 rounded-xl border p-3 mx-1" role="group" aria-label={t('tblg.adj.title')}>
              <p className="text-sm font-semibold">{t('tblg.adj.title')}</p>
              <p className="text-xs text-muted-foreground">
                {t('tblg.adj.intro').replace('{pack}', targetPack?.name ?? '')}
              </p>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="radio" name="adj" checked={choice === 'upgrade_free'} onChange={() => setChoice('upgrade_free')} className="mt-1" />
                <span>{t('tblg.adj.upgradeFreeOption')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="radio" name="adj" checked={choice === 'pay_on_site'} onChange={() => setChoice('pay_on_site')} className="mt-1" />
                <span className="flex-1">
                  {t('tblg.adj.payOnSiteOption').replace('{amount}', formatMoneyAuto(need.difference))}
                </span>
              </label>
              {choice === 'pay_on_site' && (
                <div className="flex items-center gap-2 pl-6">
                  <Input
                    type="number" min="0" step="1" inputMode="decimal" value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)} className="h-9 w-28 text-right"
                    aria-label={t('tblg.adj.amountLabel')}
                  />
                  <span className="text-sm">€</span>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">{t('tblg.adj.noOnlineCharge')}</p>
            </div>
          )}

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

        <div className="absolute bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
          <Button
            className="w-full h-12 font-semibold gap-2"
            disabled={!selectedTableId || loading || adjustmentMissing}
            onClick={handleConfirm}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                {!tableName
                  ? t('vipPlacement.selectTableFirst')
                  : adjustmentMissing
                    ? t('tblg.adj.chooseFirst')
                    : `${t('vipPlacement.confirmTo')} ${tableName}`}
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
