import { useState, useEffect, useMemo } from 'react';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VipFloorPlan } from '@/components/vip-host/VipFloorPlan';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { createManualReservation } from '@/lib/vipTableApi';
import { fillParams, freeTablesForManual } from '@/lib/vipManualRules';
import type { VenueFloorPlan, VipReservation } from '@/types';
import { VipButton, VipInput, VipSelect, VipFieldLabel, T1, T2, T3, BORDER } from './vip-ui';
import type { VipEvent } from '@/hooks/useOwnerVipData';

interface Zone {
  id: string;
  name: string;
  color: string;
}

interface PackOption { id: string; name: string; zoneId: string | null; price: number }
interface HeldRow { id: string; assignedTableId: string | null; requestedTableId: string | null; placementStatus: string | null }

interface ManualReservationDialogProps {
  open: boolean;
  events: VipEvent[];
  zones: Zone[];
  /** Soirée pré-sélectionnée (celle du filtre, sauf « all »). */
  defaultEventId?: string;
  onCreated: () => void;
  onClose: () => void;
}

/**
 * Création d'une réservation VIP « à la main » côté owner : réservation par
 * téléphone, walk-in comp, table réglée hors Yuno... Enregistrement seul (frais
 * Yuno à 0, marquée payée) via la RPC gardée create_manual_table_reservation —
 * elle entre dans le CA/analytics comme une réservation normale, sans commission
 * ni CRM nominatif (décision produit : CA/analytics d'abord).
 *
 * Vague C3b : table choisie sur le plan (tables libres de la zone), formule,
 * e-mail facultatif et case « Envoyer la confirmation au client » (e-mail + QR).
 */
export function ManualReservationDialog({ open, events, zones, defaultEventId, onCreated, onClose }: ManualReservationDialogProps) {
  const { language, t } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [eventId, setEventId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [packId, setPackId] = useState('');
  const [tableId, setTableId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sendConfirmation, setSendConfirmation] = useState(false);
  const [guests, setGuests] = useState('2');
  const [total, setTotal] = useState('');
  const [minimum, setMinimum] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<VenueFloorPlan | null>(null);
  const [held, setHeld] = useState<HeldRow[]>([]);
  const [packs, setPacks] = useState<PackOption[]>([]);

  useEffect(() => {
    if (!open) return;
    const validDefault = defaultEventId && defaultEventId !== 'all' && events.some(e => e.id === defaultEventId);
    setEventId(validDefault ? defaultEventId! : events[0]?.id || '');
    setZoneId(zones[0]?.id || '');
    setPackId(''); setTableId('');
    setName(''); setPhone(''); setEmail(''); setSendConfirmation(false); setGuests('2'); setTotal(''); setMinimum('');
  }, [open, defaultEventId, events, zones]);

  // Plan, formules et tables tenues de la soirée choisie.
  useEffect(() => {
    if (!open || !eventId) { setPlan(null); setHeld([]); setPacks([]); return; }
    let alive = true;
    (async () => {
      const { data: ev } = await supabase.from('events').select('venue_id, partner_venue_id').eq('id', eventId).maybeSingle();
      const clubId = ev?.venue_id ?? ev?.partner_venue_id ?? null;
      const [evPlan, resas, packRows] = await Promise.all([
        supabase.from('venue_floor_plans').select('*').eq('event_id', eventId).maybeSingle(),
        supabase.from('table_reservations')
          .select('id, assigned_table_id, requested_table_id, placement_status, status, vip_status, created_at')
          .eq('event_id', eventId).in('status', ['paid', 'confirmed', 'pending']),
        supabase.from('table_packs').select('id, name, zone_id, base_price, event_id, venue_id').eq('is_active', true)
          .or(clubId ? `event_id.eq.${eventId},and(event_id.is.null,venue_id.eq.${clubId})` : `event_id.eq.${eventId}`),
      ]);
      let row = evPlan.data as { id: string; venue_id: string | null; background_image_url: string | null; layout: unknown; created_at: string; updated_at: string } | null;
      if (!row && clubId) {
        const { data } = await supabase.from('venue_floor_plans').select('*').eq('venue_id', clubId).is('event_id', null).maybeSingle();
        row = data as typeof row;
      }
      if (!alive) return;
      setPlan(row ? {
        id: row.id,
        venueId: row.venue_id ?? '',
        backgroundImageUrl: row.background_image_url,
        layout: row.layout as VenueFloorPlan['layout'],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } : null);
      const youngPending = Date.now() - 35 * 60 * 1000;
      setHeld((resas.data ?? [])
        .filter(r => !['finished', 'no_show', 'denied'].includes(r.vip_status ?? 'waiting')
          && (r.status !== 'pending' || new Date(r.created_at).getTime() > youngPending))
        .map(r => ({ id: r.id, assignedTableId: r.assigned_table_id, requestedTableId: r.requested_table_id, placementStatus: r.placement_status })));
      setPacks((packRows.data ?? []).map(p => ({ id: p.id, name: p.name, zoneId: p.zone_id, price: Number(p.base_price) || 0 })));
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [open, eventId]);

  const zonePacks = useMemo(() => packs.filter(p => !p.zoneId || p.zoneId === zoneId), [packs, zoneId]);
  const freeTables = useMemo(
    () => freeTablesForManual(plan?.layout?.tables ?? [], held, zoneId),
    [plan, held, zoneId],
  );
  const shownPlan = useMemo<VenueFloorPlan | null>(
    () => (plan ? { ...plan, layout: { ...plan.layout, tables: freeTables as VenueFloorPlan['layout']['tables'] } } : null),
    [plan, freeTables],
  );

  // Une zone qui change : la formule et la table choisies ne valent plus forcément.
  useEffect(() => {
    if (packId && !zonePacks.some(p => p.id === packId)) setPackId('');
    if (tableId && !freeTables.some(tb => tb.id === tableId)) setTableId('');
  }, [zonePacks, freeTables, packId, tableId]);

  const pickTable = (id: string) => {
    const next = tableId === id ? '' : id;
    setTableId(next);
    const linked = freeTables.find(tb => tb.id === id)?.packId;
    if (next && linked && zonePacks.some(p => p.id === linked)) {
      setPackId(linked);
      if (!total) setTotal(String(zonePacks.find(p => p.id === linked)?.price ?? ''));
    }
  };

  const emailOk = email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const confirmationBlocked = sendConfirmation && email.trim() === '';
  const canSubmit = !!eventId && !!zoneId && !busy && emailOk && !confirmationBlocked;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await createManualReservation({
        eventId, zoneId,
        packId: packId || null,
        tableId: tableId || null,
        fullName: name, phone, email,
        guestCount: parseInt(guests, 10) || 1,
        totalPrice: parseFloat(total) || 0,
        minimumSpend: parseFloat(minimum) || 0,
        sendConfirmation,
      });
      if (!res.ok) {
        toast.error(res.error ? fillParams(t(res.error.key), res.error.params) : tt('Erreur', 'Error', 'Error'));
        if (res.error?.refresh) onCreated();
        return;
      }
      toast.success(tt('Réservation créée', 'Reservation created', 'Reserva creada'));
      if (res.email === 'sent') toast.success(t('tblm.manual.emailSent'));
      else if (res.email === 'queued') toast.success(t('tblm.manual.emailQueued'));
      else if (res.email === 'failed') toast.warning(t('tblm.manual.emailFailed'));
      onCreated();
      onClose();
    } catch (e) {
      toast.error((e as Error)?.message || tt('Erreur', 'Error', 'Error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" style={{ color: 'var(--acc-e7c15a)' }} />
            {tt('Réservation à la main', 'Manual reservation', 'Reserva manual')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          <div>
            <VipFieldLabel>{tt('Soirée', 'Event', 'Noche')}</VipFieldLabel>
            <VipSelect value={eventId} onChange={setEventId} className="h-10 w-full">
              {events.length === 0 && <option value="">{tt('Aucune soirée', 'No event', 'Ninguna noche')}</option>}
              {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </VipSelect>
          </div>

          <div>
            <VipFieldLabel>{tt('Zone', 'Zone', 'Zona')}</VipFieldLabel>
            <VipSelect value={zoneId} onChange={setZoneId} className="h-10 w-full">
              {zones.length === 0 && <option value="">{tt('Aucune zone', 'No zone', 'Ninguna zona')}</option>}
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </VipSelect>
          </div>

          {zonePacks.length > 0 && (
            <div>
              <VipFieldLabel>{t('tblm.manual.pack')}</VipFieldLabel>
              <VipSelect value={packId} onChange={setPackId} className="h-10 w-full">
                <option value="">{t('tblm.manual.noPack')}</option>
                {zonePacks.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </VipSelect>
            </div>
          )}

          {shownPlan && freeTables.length > 0 && (
            <div>
              <VipFieldLabel>{t('tblm.manual.table')}</VipFieldLabel>
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                <VipFloorPlan
                  floorPlan={shownPlan}
                  reservations={[] as VipReservation[]}
                  mode="placement"
                  selectedTableId={tableId || undefined}
                  onTableSelect={pickTable}
                />
              </div>
              <p style={{ color: T3, fontSize: 11, lineHeight: 1.5, paddingTop: 4 }}>
                {tableId
                  ? fillParams(t('tblm.manual.tableChosen'), { name: freeTables.find(tb => tb.id === tableId)?.name ?? '' })
                  : t('tblm.manual.tableHint')}
              </p>
            </div>
          )}

          <div>
            <VipFieldLabel>{tt('Nom du client', 'Guest name', 'Nombre del cliente')}</VipFieldLabel>
            <VipInput value={name} onChange={setName} placeholder={tt('Optionnel', 'Optional', 'Opcional')} />
          </div>

          <div>
            <VipFieldLabel>{tt('Téléphone (optionnel)', 'Phone (optional)', 'Teléfono (opcional)')}</VipFieldLabel>
            <PhoneInputWithCountry value={phone} onChange={setPhone} size="sm" />
          </div>

          <div>
            <VipFieldLabel>{t('tblm.manual.email')}</VipFieldLabel>
            <VipInput value={email} onChange={setEmail} type="email" placeholder={tt('Optionnel', 'Optional', 'Opcional')} />
            {!emailOk && <p style={{ color: 'var(--acc-ff5c63)', fontSize: 11, paddingTop: 4 }}>{t('tblm.err.emailInvalid')}</p>}
          </div>

          <label className="flex cursor-pointer items-start gap-2" style={{ color: T1, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={sendConfirmation}
              onChange={(e) => setSendConfirmation(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t('tblm.manual.sendConfirmation')}
              <span style={{ display: 'block', color: confirmationBlocked ? 'var(--acc-ff5c63)' : T3, fontSize: 11, lineHeight: 1.5 }}>
                {confirmationBlocked ? t('tblm.err.emailRequired') : t('tblm.manual.sendConfirmationHint')}
              </span>
            </span>
          </label>

          <div>
            <VipFieldLabel>{tt('Personnes', 'Guests', 'Personas')}</VipFieldLabel>
            <VipInput value={guests} onChange={setGuests} type="number" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <VipFieldLabel>{tt('Montant € (payé)', 'Amount € (paid)', 'Importe € (pagado)')}</VipFieldLabel>
              <VipInput value={total} onChange={setTotal} type="number" placeholder="0" />
            </div>
            <div>
              <VipFieldLabel>{tt('Minimum €', 'Minimum €', 'Mínimo €')}</VipFieldLabel>
              <VipInput value={minimum} onChange={setMinimum} type="number" placeholder="0" />
            </div>
          </div>

          <p style={{ color: T3, fontSize: 11, lineHeight: 1.5, paddingTop: 2 }}>
            {tt(
              'Enregistrée comme payée (réglée au club). Elle compte dans le CA sans commission Yuno.',
              'Recorded as paid (settled at the club). Counts toward revenue with no Yuno fee.',
              'Registrada como pagada (liquidada en el club). Cuenta en los ingresos sin comisión Yuno.'
            )}
          </p>

          <div className="flex gap-2 border-t pt-3.5" style={{ borderColor: BORDER }}>
            <VipButton variant="secondary" full onClick={onClose}>
              {tt('Annuler', 'Cancel', 'Cancelar')}
            </VipButton>
            <VipButton variant="primary" full disabled={!canSubmit} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: T2 }} /> : tt('Créer', 'Create', 'Crear')}
            </VipButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
