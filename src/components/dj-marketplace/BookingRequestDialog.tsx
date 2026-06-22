import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { CalendarDays, Clock, Euro, Music, Sparkles } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { DJ_GENRES, type MarketplaceDJ } from './types';

/** A scheduled club/organizer night, keyed by local date, surfaced on the calendar. */
type ScheduledEvent = { id: string; title: string; start_at: string; end_at: string | null; music_genres: string[] | null };

/** Common nightlife windows offered as one-tap slot presets (start → end HH:MM). */
const SLOT_PRESETS: Array<[string, string]> = [
  ['22:00', '04:00'],
  ['23:00', '05:00'],
  ['00:00', '06:00'],
  ['21:00', '02:00'],
];

/** Build ISO start/end timestamps from a date + two HH:MM strings, rolling end past midnight. */
function buildSlot(day: Date, hhmmStart: string, hhmmEnd: string): { start: string; end: string } {
  const [sh, sm] = hhmmStart.split(':').map(Number);
  const [eh, em] = hhmmEnd.split(':').map(Number);
  const start = new Date(day); start.setHours(sh, sm, 0, 0);
  const end = new Date(day); end.setHours(eh, em, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1); // crosses midnight into the next day
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Booker -> DJ booking request. Reads the DJ's free/busy calendar to disable taken
 * nights, marks the club's own scheduled events so the owner books onto a real night,
 * then collects a full brief — time slot, fee, music style, message — and calls
 * create_dj_booking_request with the current dashboard scope (venue XOR organizer).
 * Money/commission is out of scope: agreed_fee is recorded only.
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
  const [startTime, setStartTime] = useState('22:00');
  const [endTime, setEndTime] = useState('04:00');
  const [fee, setFee] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<Map<string, ScheduledEvent>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  // On open: reset the form, load the DJ's free/busy (to disable taken nights), and
  // load the club's own scheduled events (to mark bookable nights) for ~6 months.
  useEffect(() => {
    if (!open || !dj) return;
    setDate(undefined); setStartTime('22:00'); setEndTime('04:00');
    setFee(''); setGenres([]); setMessage('');
    setBlocked(new Set()); setEvents(new Map());

    const from = new Date();
    const to = new Date(); to.setMonth(to.getMonth() + 6);
    const fromISO = from.toISOString();
    const toISO = to.toISOString();

    (async () => {
      const { data } = await supabase.rpc('get_dj_availability', {
        p_user_id: dj.user_id,
        p_from: format(from, 'yyyy-MM-dd'),
        p_to: format(to, 'yyyy-MM-dd'),
      });
      setBlocked(new Set((data || []).map((r: { d: string }) => r.d)));
    })();

    (async () => {
      let q = supabase
        .from('events')
        .select('id, title, start_at, end_at, music_genres')
        .gte('start_at', fromISO)
        .lte('start_at', toISO);
      if (scope === 'venue' && venueId) {
        q = q.or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`);
      } else if (scope === 'organizer' && organizerUserId) {
        q = q.or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`);
      } else {
        return;
      }
      const { data } = await q;
      const map = new Map<string, ScheduledEvent>();
      (data as ScheduledEvent[] | null)?.forEach((e) => {
        const key = format(new Date(e.start_at), 'yyyy-MM-dd');
        if (!map.has(key)) map.set(key, e); // one night usually has one headline event
      });
      setEvents(map);
    })();
  }, [open, dj, scope, venueId, organizerUserId]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const isBlocked = (d: Date) => d < today || blocked.has(format(d, 'yyyy-MM-dd'));

  const eventDays = useMemo(
    () => Array.from(events.keys()).map((k) => new Date(`${k}T00:00:00`)),
    [events],
  );
  const selectedEvent = date ? events.get(format(date, 'yyyy-MM-dd')) ?? null : null;

  // Picking a night that already has a scheduled event links it and prefills the slot +
  // music style from that event, so the owner starts from the real plan and tweaks.
  const pickDate = (d: Date | undefined) => {
    setDate(d);
    if (!d) return;
    const ev = events.get(format(d, 'yyyy-MM-dd'));
    if (!ev) return;
    setStartTime(format(new Date(ev.start_at), 'HH:mm'));
    if (ev.end_at) setEndTime(format(new Date(ev.end_at), 'HH:mm'));
    const evGenres = (ev.music_genres || []).filter((g) => (DJ_GENRES as readonly string[]).includes(g));
    if (evGenres.length) setGenres(evGenres);
  };

  const toggleGenre = (g: string) =>
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const feeRange = useMemo(() => {
    if (!dj) return null;
    const cur = dj.currency || '€';
    if (dj.min_fee != null && dj.max_fee != null) return `${Math.round(dj.min_fee)}–${Math.round(dj.max_fee)} ${cur}`;
    if (dj.min_fee != null) return `${tt('dès', 'from', 'desde')} ${Math.round(dj.min_fee)} ${cur}`;
    if (dj.max_fee != null) return `${tt('jusqu’à', 'up to', 'hasta')} ${Math.round(dj.max_fee)} ${cur}`;
    return null;
  }, [dj, tt]);

  const handleSubmit = async () => {
    if (!dj || !date) return;
    setSubmitting(true);
    try {
      const slot = buildSlot(date, startTime, endTime);
      const { error } = await supabase.rpc('create_dj_booking_request', {
        p_dj_user_id: dj.user_id,
        p_requested_date: format(date, 'yyyy-MM-dd'),
        p_start: slot.start,
        p_end: slot.end,
        p_agreed_fee: fee ? Number(fee) : undefined,
        p_message: message || undefined,
        p_event_id: selectedEvent?.id ?? undefined,
        p_requested_genres: genres.length ? genres : undefined,
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
      } else if (msg.includes('not an active DJ')) {
        toast.error(tt('Ce DJ n’est pas réservable pour le moment', 'This DJ is not bookable right now', 'Este DJ no se puede reservar ahora'));
      } else if (msg.includes('Unauthorized')) {
        toast.error(tt('Tu n’as pas les droits pour envoyer cette demande', 'You don’t have permission to send this request', 'No tienes permiso para enviar esta solicitud'));
      } else if (msg.includes('Not authenticated')) {
        toast.error(tt('Session expirée — reconnecte-toi', 'Session expired — sign in again', 'Sesión expirada — vuelve a iniciar sesión'));
      } else if (msg.includes('Could not find the function') || msg.includes('PGRST202') || msg.includes('schema cache')) {
        toast.error(tt('Service indisponible un instant, réessaie', 'Service hiccup, please retry', 'Servicio no disponible, reinténtalo'));
      } else {
        toast.error(tt('Échec de l\'envoi', 'Could not send request', 'No se pudo enviar'));
      }
      console.error('booking request failed', e);
    } finally {
      setSubmitting(false);
    }
  };

  if (!dj) return null;

  const labelCls = 'flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2';
  const chip = (active: boolean) => ({
    padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#E8192C' : 'rgba(255,255,255,0.12)'}`,
    background: active ? 'rgba(232,25,44,0.16)' : 'rgba(255,255,255,0.03)',
    color: active ? '#fff' : 'rgba(255,255,255,0.72)',
  } as const);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tt(`Réserver ${dj.stage_name}`, `Book ${dj.stage_name}`, `Reservar ${dj.stage_name}`)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Step 1 — date, with the club's scheduled nights ringed */}
          <div>
            <label className={labelCls}>
              <CalendarDays size={13} />{tt('Choisis une date', 'Pick a date', 'Elige una fecha')}
            </label>
            <div className="flex justify-center rounded-xl border border-white/10 bg-white/[0.02] p-2">
              <Calendar
                mode="single"
                selected={date}
                onSelect={pickDate}
                disabled={isBlocked}
                modifiers={{ hasEvent: eventDays }}
                modifiersStyles={{ hasEvent: { boxShadow: 'inset 0 0 0 1.5px rgba(232,25,44,0.65)' } }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span style={{ width: 11, height: 11, borderRadius: 4, boxShadow: 'inset 0 0 0 1.5px rgba(232,25,44,0.65)' }} />
                {tt('Soirée programmée', 'Scheduled event', 'Evento programado')}
              </span>
              <span>{tt('Les nuits déjà prises sont grisées.', 'Nights already taken are greyed out.', 'Las noches ya ocupadas están atenuadas.')}</span>
            </div>
          </div>

          {/* Steps 2+ unlock once a night is chosen */}
          {!date ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-center text-[12.5px] text-muted-foreground">
              {tt('Sélectionne une date pour compléter la demande.', 'Pick a date to complete the request.', 'Elige una fecha para completar la solicitud.')}
            </p>
          ) : (
            <>
              {selectedEvent && (
                <div className="rounded-xl border border-[#E8192C]/30 bg-[#E8192C]/10 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Sparkles size={13} />{tt('Lié à ta soirée', 'Linked to your event', 'Vinculado a tu evento')}
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    {selectedEvent.title} · {format(new Date(selectedEvent.start_at), 'HH:mm')}
                    {selectedEvent.end_at ? `–${format(new Date(selectedEvent.end_at), 'HH:mm')}` : ''}
                  </p>
                </div>
              )}

              {/* Time slot */}
              <div>
                <label className={labelCls}>
                  <Clock size={13} />{tt('Tranche horaire', 'Time slot', 'Franja horaria')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {SLOT_PRESETS.map(([s, e]) => {
                    const active = startTime === s && endTime === e;
                    return (
                      <button key={`${s}-${e}`} type="button" onClick={() => { setStartTime(s); setEndTime(e); }} style={chip(active)}>
                        {s} – {e}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="flex-1" />
                  <span className="text-muted-foreground">→</span>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="flex-1" />
                </div>
              </div>

              {/* Fee */}
              <div>
                <label className={labelCls}>
                  <Euro size={13} />{tt('Cachet proposé (€)', 'Proposed fee (€)', 'Caché propuesto (€)')}
                </label>
                <Input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder={tt('Optionnel', 'Optional', 'Opcional')} />
                {feeRange && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {tt('Fourchette du DJ', 'DJ’s range', 'Rango del DJ')}: {feeRange}
                  </p>
                )}
              </div>

              {/* Music style */}
              <div>
                <label className={labelCls}>
                  <Music size={13} />{tt('Style de musique à jouer', 'Music style to play', 'Estilo musical a tocar')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {DJ_GENRES.map((g) => (
                    <button key={g} type="button" onClick={() => toggleGenre(g)} style={chip(genres.includes(g))}>
                      {g}
                    </button>
                  ))}
                </div>
                {dj.music_genres?.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {tt('Styles du DJ', 'DJ plays', 'Estilos del DJ')}: {dj.music_genres.join(', ')}
                  </p>
                )}
              </div>

              {/* Message */}
              <div>
                <label className={labelCls}>{tt('Message', 'Message', 'Mensaje')}</label>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
                  placeholder={tt('Présente la soirée, l’ambiance, le lieu...', 'Pitch the night, the vibe, the venue...', 'Presenta la noche, el ambiente, el lugar...')} />
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  width: '100%', padding: '11px', borderRadius: 12,
                  background: submitting ? 'rgba(232,25,44,0.4)' : '#E8192C',
                  color: '#fff', border: 'none', fontSize: 14, fontWeight: 700,
                  cursor: submitting ? 'default' : 'pointer',
                }}
              >
                {submitting ? tt('Envoi...', 'Sending...', 'Enviando...') : tt('Envoyer la demande', 'Send request', 'Enviar solicitud')}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
