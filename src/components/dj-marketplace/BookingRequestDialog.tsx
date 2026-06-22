import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import type { MarketplaceDJ } from './types';

/**
 * Booker -> DJ booking request for a date. Reads the DJ's free/busy calendar to
 * disable taken nights, then calls create_dj_booking_request with the current
 * dashboard scope (venue XOR organizer). Money/commission is out of scope:
 * agreed_fee is recorded only.
 */
export function BookingRequestDialog({
  dj,
  open,
  onOpenChange,
  onSubmitted,
}: {
  dj: MarketplaceDJ | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}) {
  const { scope, venueId, organizerUserId } = useVenueContext();
  const { language } = useLanguage();
  const tt = makeDjT(language);

  const [date, setDate] = useState<Date | undefined>(undefined);
  const [fee, setFee] = useState('');
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Load the DJ's free/busy for the next 6 months to disable taken nights.
  useEffect(() => {
    if (!open || !dj) return;
    setDate(undefined); setFee(''); setMessage('');
    const from = new Date();
    const to = new Date(); to.setMonth(to.getMonth() + 6);
    (async () => {
      const { data } = await supabase.rpc('get_dj_availability', {
        p_user_id: dj.user_id,
        p_from: format(from, 'yyyy-MM-dd'),
        p_to: format(to, 'yyyy-MM-dd'),
      });
      setBlocked(new Set((data || []).map((r: { d: string }) => r.d)));
    })();
  }, [open, dj]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const isBlocked = (d: Date) => d < today || blocked.has(format(d, 'yyyy-MM-dd'));

  const handleSubmit = async () => {
    if (!dj || !date) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('create_dj_booking_request', {
        p_dj_user_id: dj.user_id,
        p_requested_date: format(date, 'yyyy-MM-dd'),
        p_agreed_fee: fee ? Number(fee) : undefined,
        p_message: message || undefined,
        p_venue_id: scope === 'venue' ? venueId ?? undefined : undefined,
        p_organizer_user_id: scope === 'organizer' ? organizerUserId ?? undefined : undefined,
      });
      if (error) throw error;
      toast.success(tt('Demande envoyée', 'Request sent', 'Solicitud enviada'));
      onOpenChange(false);
      onSubmitted?.();
    } catch (e) {
      const msg = (e as { message?: string })?.message || '';
      if (msg.includes('duplicate') || msg.includes('pending_unique')) {
        toast.error(tt('Une demande est déjà en attente pour cette date', 'A request is already pending for this date', 'Ya hay una solicitud pendiente para esa fecha'));
      } else {
        toast.error(tt('Échec de l\'envoi', 'Could not send request', 'No se pudo enviar'));
      }
      console.error('booking request failed', e);
    } finally {
      setSubmitting(false);
    }
  };

  if (!dj) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tt(`Réserver ${dj.stage_name}`, `Book ${dj.stage_name}`, `Reservar ${dj.stage_name}`)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              {tt('Choisis une date', 'Pick a date', 'Elige una fecha')}
            </label>
            <div className="flex justify-center rounded-xl border border-white/10 bg-white/[0.02] p-2">
              <Calendar mode="single" selected={date} onSelect={setDate} disabled={isBlocked} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {tt('Les nuits déjà prises sont grisées.', 'Nights already taken are greyed out.', 'Las noches ya ocupadas están atenuadas.')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {tt('Cachet proposé (€)', 'Proposed fee (€)', 'Caché propuesto (€)')}
            </label>
            <Input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder={tt('Optionnel', 'Optional', 'Opcional')} />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {tt('Message', 'Message', 'Mensaje')}
            </label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
              placeholder={tt('Présente la soirée, le créneau, le lieu...', 'Pitch the night, slot, venue...', 'Presenta la noche, el horario, el lugar...')} />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!date || submitting}
            style={{
              width: '100%', padding: '11px', borderRadius: 12,
              background: !date || submitting ? 'rgba(232,25,44,0.4)' : '#E8192C',
              color: '#fff', border: 'none', fontSize: 14, fontWeight: 700,
              cursor: !date || submitting ? 'default' : 'pointer',
            }}
          >
            {submitting ? tt('Envoi...', 'Sending...', 'Enviando...') : tt('Envoyer la demande', 'Send request', 'Enviar solicitud')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
