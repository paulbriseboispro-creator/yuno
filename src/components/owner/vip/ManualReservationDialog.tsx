import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { VipButton, VipInput, VipSelect, VipFieldLabel, T2, T3, BORDER } from './vip-ui';
import type { VipEvent } from '@/hooks/useOwnerVipData';

interface Zone {
  id: string;
  name: string;
  color: string;
}

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
 */
export function ManualReservationDialog({ open, events, zones, defaultEventId, onCreated, onClose }: ManualReservationDialogProps) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [eventId, setEventId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [guests, setGuests] = useState('2');
  const [total, setTotal] = useState('');
  const [minimum, setMinimum] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const validDefault = defaultEventId && defaultEventId !== 'all' && events.some(e => e.id === defaultEventId);
    setEventId(validDefault ? defaultEventId! : events[0]?.id || '');
    setZoneId(zones[0]?.id || '');
    setName(''); setPhone(''); setGuests('2'); setTotal(''); setMinimum('');
  }, [open, defaultEventId, events, zones]);

  const canSubmit = !!eventId && !!zoneId && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc('create_manual_table_reservation', {
        p_event_id: eventId,
        p_zone_id: zoneId,
        p_full_name: name.trim() || null,
        p_phone: phone.trim() || null,
        p_email: null,
        p_guest_count: Math.max(1, parseInt(guests, 10) || 1),
        p_total_price: Math.max(0, parseFloat(total) || 0),
        p_minimum_spend: Math.max(0, parseFloat(minimum) || 0),
        p_assigned_table_id: null,
        p_remarks: null,
      });
      if (error) throw error;
      toast.success(tt('Réservation créée', 'Reservation created', 'Reserva creada'));
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
            <UserPlus className="h-5 w-5" style={{ color: '#E7C15A' }} />
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

          <div>
            <VipFieldLabel>{tt('Nom du client', 'Guest name', 'Nombre del cliente')}</VipFieldLabel>
            <VipInput value={name} onChange={setName} placeholder={tt('Optionnel', 'Optional', 'Opcional')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <VipFieldLabel>{tt('Téléphone', 'Phone', 'Teléfono')}</VipFieldLabel>
              <VipInput value={phone} onChange={setPhone} type="tel" placeholder={tt('Optionnel', 'Optional', 'Opcional')} />
            </div>
            <div>
              <VipFieldLabel>{tt('Personnes', 'Guests', 'Personas')}</VipFieldLabel>
              <VipInput value={guests} onChange={setGuests} type="number" />
            </div>
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
