import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ScanLine, CheckCircle2, XCircle, Clock, Ticket as TicketIcon,
  Wine, Shirt, Ban, AlertTriangle, User,
} from 'lucide-react';
import OrgQRScanner from '@/components/organizer-app/OrgQRScanner';
import { toast } from 'sonner';
import { retrySupabaseAction } from '@/utils/retryAction';
import { calcStripeFee } from '@/utils/fees';
import {
  OrgPage, OrgPageHeader, OrgCard, OrgButton, OrgTabs, OrgEmptyState,
  FieldLabel, DarkSelect, DarkTextarea,
  POS, RED, RED_SOFT, T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';

type ScanTab = 'tickets' | 'drinks' | 'cloakroom';
type TicketMode = 'entry' | 'cancel';

interface ScannedTicket {
  id: string;
  attendeeId?: string;
  fullName: string | null;
  userEmail: string | null;
  totalPrice: number;
  serviceFee: number;
  eventId: string;
  eventTitle: string;
  status: string;
  entryScanned: boolean;
  paymentIntentId: string | null;
}

const REFUND_REASONS: Record<string, { fr: string; en: string; es: string }> = {
  intoxication: { fr: 'Ivresse', en: 'Intoxication', es: 'Embriaguez' },
  behavior: { fr: 'Comportement inapproprié', en: 'Inappropriate behavior', es: 'Comportamiento inadecuado' },
  documents: { fr: 'Documents non valides', en: 'Invalid documents', es: 'Documentos no válidos' },
  minor: { fr: 'Mineur', en: 'Minor', es: 'Menor de edad' },
  dress_code: { fr: 'Dress code non respecté', en: 'Dress code violation', es: 'Incumplimiento del código de vestimenta' },
  capacity: { fr: 'Capacité maximale atteinte', en: 'Max capacity reached', es: 'Aforo máximo alcanzado' },
  other: { fr: 'Autre', en: 'Other', es: 'Otro' },
};

// Big success / error scan result banner
function ScanResult({ ok, title, sub }: { ok: boolean; title: string; sub?: string }) {
  return (
    <OrgCard style={ok
      ? { border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.06)' }
      : { border: '1px solid rgba(255,92,99,0.4)', background: 'rgba(255,92,99,0.06)' }}>
      <div className="flex items-center gap-3 p-5">
        {ok ? <CheckCircle2 className="h-8 w-8" style={{ color: POS }} /> : <XCircle className="h-8 w-8" style={{ color: RED_SOFT }} />}
        <div>
          <div style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{title}</div>
          {sub && <div style={{ color: T3, fontSize: 12.5 }}>{sub}</div>}
        </div>
      </div>
    </OrgCard>
  );
}

export default function OrgAppCheckin() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [events, setEvents] = useState<any[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [tab, setTab] = useState<ScanTab>('tickets');
  const [ticketMode, setTicketMode] = useState<TicketMode>('entry');
  const [processing, setProcessing] = useState(false);
  const [lastScan, setLastScan] = useState<{ ok: boolean; name?: string; reason?: string } | null>(null);
  const [recent, setRecent] = useState<{ name: string | null; at: Date }[]>([]);
  const [scannedTicket, setScannedTicket] = useState<ScannedTicket | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [drinkResult, setDrinkResult] = useState<{ ok: boolean; label?: string; reason?: string } | null>(null);
  const [drinkProcessing, setDrinkProcessing] = useState(false);
  const [cloakResult, setCloakResult] = useState<{ ok: boolean; label?: string; reason?: string } | null>(null);
  const [cloakProcessing, setCloakProcessing] = useState(false);

  const selectedEvent = useMemo(() => events.find(e => e.id === eventId), [events, eventId]);
  const eventVenueId: string | null = selectedEvent?.venue_id ?? selectedEvent?.partner_venue_id ?? null;

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at, venue_id, partner_venue_id')
        .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`)
        .gte('end_at', new Date(Date.now() - 86_400_000).toISOString())
        .order('start_at', { ascending: true });
      setEvents(data ?? []);
      if (data?.[0]) setEventId(data[0].id);
    })();
  }, [user]);

  const resetTicketScan = () => {
    setLastScan(null); setScannedTicket(null); setRefundReason(''); setCustomReason(''); setShowCancelConfirm(false);
  };

  const handleEntryScan = async (qrText: string) => {
    const qrCode = qrText.trim();
    if (!eventId || !qrCode || processing) return;
    setProcessing(true);
    setLastScan(null);
    try {
      const { data: att } = await supabase
        .from('ticket_attendees')
        .select('id, ticket_id, full_name, entry_scanned')
        .eq('qr_code', qrCode)
        .maybeSingle();

      if (att) {
        const { data: parent } = await supabase
          .from('tickets')
          .select('id, status, event_id, full_name')
          .eq('id', att.ticket_id)
          .maybeSingle();
        if (!parent || parent.event_id !== eventId) { setLastScan({ ok: false, reason: t('Mauvais événement', 'Wrong event') }); return; }
        if (parent.status !== 'paid') { setLastScan({ ok: false, reason: t('Non payé', 'Not paid') }); return; }
        if (att.entry_scanned) { setLastScan({ ok: false, name: att.full_name ?? undefined, reason: t('Déjà scanné', 'Already scanned') }); return; }

        const { data: updated } = await retrySupabaseAction(async () => {
          const r = await supabase.from('ticket_attendees')
            .update({ entry_scanned: true, entry_scanned_at: new Date().toISOString(), entry_scanned_by: user!.id })
            .eq('id', att.id).eq('entry_scanned', false).select();
          if (r.error) throw r.error; return r;
        });
        if (!updated || updated.length === 0) { setLastScan({ ok: false, name: att.full_name ?? undefined, reason: t('Déjà scanné', 'Already scanned') }); return; }

        await retrySupabaseAction(async () => {
          const r = await supabase.from('tickets')
            .update({ entry_scanned: true, entry_scanned_at: new Date().toISOString(), entry_scanned_by: user!.id })
            .eq('id', parent.id).eq('entry_scanned', false);
          if (r.error) throw r.error; return r;
        });

        setLastScan({ ok: true, name: att.full_name ?? undefined });
        setRecent(r => [{ name: att.full_name, at: new Date() }, ...r].slice(0, 5));
        toast.success(`✓ ${att.full_name ?? t('Entrée validée', 'Entry validated')}`);
        return;
      }

      const { data: ticket } = await supabase
        .from('tickets')
        .select('id, full_name, entry_scanned, status, event_id')
        .eq('qr_code', qrCode).maybeSingle();
      if (ticket) {
        if (ticket.event_id !== eventId) { setLastScan({ ok: false, reason: t('Mauvais événement', 'Wrong event') }); return; }
        if (ticket.status !== 'paid') { setLastScan({ ok: false, reason: t('Non payé', 'Not paid') }); return; }
        if (ticket.entry_scanned) { setLastScan({ ok: false, name: ticket.full_name ?? undefined, reason: t('Déjà scanné', 'Already scanned') }); return; }

        const { data: updated } = await retrySupabaseAction(async () => {
          const r = await supabase.from('tickets')
            .update({ entry_scanned: true, entry_scanned_at: new Date().toISOString(), entry_scanned_by: user!.id })
            .eq('id', ticket.id).eq('entry_scanned', false).select();
          if (r.error) throw r.error; return r;
        });
        if (!updated || updated.length === 0) { setLastScan({ ok: false, name: ticket.full_name ?? undefined, reason: t('Déjà scanné', 'Already scanned') }); return; }

        setLastScan({ ok: true, name: ticket.full_name ?? undefined });
        setRecent(r => [{ name: ticket.full_name, at: new Date() }, ...r].slice(0, 5));
        toast.success(`✓ ${ticket.full_name ?? t('Entrée validée', 'Entry validated')}`);
        return;
      }

      const { data: reservation } = await supabase
        .from('table_reservations')
        .select('id, full_name, entry_scanned, status, event_id')
        .eq('qr_code', qrCode).maybeSingle();
      if (reservation) {
        if (reservation.event_id !== eventId) { setLastScan({ ok: false, reason: t('Mauvais événement', 'Wrong event') }); return; }
        if (!['paid', 'confirmed'].includes(reservation.status)) { setLastScan({ ok: false, reason: t('Non payé', 'Not paid') }); return; }
        if (reservation.entry_scanned) { setLastScan({ ok: false, name: reservation.full_name ?? undefined, reason: t('Déjà scanné', 'Already scanned') }); return; }

        const { data: updated } = await retrySupabaseAction(async () => {
          const r = await supabase.from('table_reservations')
            .update({ entry_scanned: true, entry_scanned_at: new Date().toISOString(), entry_scanned_by: user!.id })
            .eq('id', reservation.id).eq('entry_scanned', false).select();
          if (r.error) throw r.error; return r;
        });
        if (!updated || updated.length === 0) { setLastScan({ ok: false, name: reservation.full_name ?? undefined, reason: t('Déjà scanné', 'Already scanned') }); return; }

        setLastScan({ ok: true, name: reservation.full_name ?? undefined });
        setRecent(r => [{ name: reservation.full_name, at: new Date() }, ...r].slice(0, 5));
        toast.success(`✓ ${reservation.full_name ?? t('Entrée validée', 'Entry validated')}`);
        return;
      }

      // Guest list entries (promoter free guestlists). The door scan is the source
      // of truth: marking the entry validated triggers the promoter commission
      // asynchronously, with the scan timestamp making the (time-windowed) rules.
      const { data: gle } = await supabase
        .from('guest_list_entries')
        .select('id, full_name, entry_scanned, promoter_id, guest_list:guest_lists!inner(event_id)')
        .or(`qr_code.eq.${qrCode},reservation_code.eq.${qrCode}`)
        .maybeSingle();
      if (gle) {
        const glEventId = (gle.guest_list as any)?.event_id;
        if (glEventId !== eventId) { setLastScan({ ok: false, reason: t('Mauvais événement', 'Wrong event') }); return; }
        if (gle.entry_scanned) { setLastScan({ ok: false, name: gle.full_name ?? undefined, reason: t('Déjà scanné', 'Already scanned') }); return; }

        const scanAt = new Date().toISOString();
        const { data: updated } = await retrySupabaseAction(async () => {
          const r = await supabase.from('guest_list_entries')
            .update({ entry_scanned: true, entry_scanned_at: scanAt, entry_scanned_by: user!.id })
            .eq('id', gle.id).eq('entry_scanned', false).select();
          if (r.error) throw r.error; return r;
        });
        if (!updated || updated.length === 0) { setLastScan({ ok: false, name: gle.full_name ?? undefined, reason: t('Déjà scanné', 'Already scanned') }); return; }

        // Record the promoter commission without blocking the door flow.
        if (gle.promoter_id) {
          supabase.rpc('record_promoter_conversion', {
            p_promoter_id: gle.promoter_id,
            p_conversion_type: 'guestlist',
            p_amount: 0,
            p_event_id: glEventId,
            p_guest_list_entry_id: gle.id,
            p_scan_at: scanAt,
          }).then(({ error }) => { if (error) console.error('record_promoter_conversion (guestlist)', error); });
        }

        setLastScan({ ok: true, name: gle.full_name ?? undefined });
        setRecent(r => [{ name: gle.full_name, at: new Date() }, ...r].slice(0, 5));
        toast.success(`✓ ${gle.full_name ?? t('Entrée validée', 'Entry validated')}`);
        return;
      }

      setLastScan({ ok: false, reason: t('Billet introuvable', 'Ticket not found') });
    } catch (e: any) {
      setLastScan({ ok: false, reason: e.message ?? t('Erreur de scan', 'Scan error') });
      toast.error(e.message ?? t('Erreur de scan', 'Scan error'));
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelScan = async (qrText: string) => {
    const qrCode = qrText.trim();
    if (!eventId || !qrCode || processing) return;
    setProcessing(true);
    setLastScan(null);
    setScannedTicket(null);
    try {
      const { data: att } = await supabase
        .from('ticket_attendees')
        .select('id, ticket_id, full_name')
        .eq('qr_code', qrCode).maybeSingle();

      let parentTicketId: string | null = null;
      let attendeeId: string | undefined;
      if (att) { parentTicketId = att.ticket_id; attendeeId = att.id; }
      else {
        const { data: tk } = await supabase
          .from('tickets').select('id').eq('qr_code', qrCode).maybeSingle();
        if (tk) parentTicketId = tk.id;
      }
      if (!parentTicketId) { setLastScan({ ok: false, reason: t('Billet introuvable', 'Ticket not found') }); return; }

      const { data: full } = await supabase
        .from('tickets')
        .select('id, full_name, user_email, total_price, service_fee, event_id, status, entry_scanned, stripe_payment_intent_id, events!inner(id, title)')
        .eq('id', parentTicketId).maybeSingle();
      if (!full) { setLastScan({ ok: false, reason: t('Billet introuvable', 'Ticket not found') }); return; }
      if (full.event_id !== eventId) { setLastScan({ ok: false, reason: t('Mauvais événement', 'Wrong event') }); return; }
      if (full.status !== 'paid') { setLastScan({ ok: false, reason: t('Non remboursable (statut)', 'Not refundable (status)') }); return; }
      if (full.entry_scanned) { setLastScan({ ok: false, reason: t('Déjà entré : annulation impossible', 'Already entered: cannot cancel') }); return; }

      setScannedTicket({
        id: full.id,
        attendeeId,
        fullName: att?.full_name ?? full.full_name ?? null,
        userEmail: full.user_email ?? null,
        totalPrice: Number(full.total_price ?? 0),
        serviceFee: Number(full.service_fee ?? 0),
        eventId: full.event_id,
        eventTitle: (full as any).events?.title ?? '',
        status: full.status,
        entryScanned: full.entry_scanned,
        paymentIntentId: full.stripe_payment_intent_id ?? null,
      });
    } catch (e: any) {
      setLastScan({ ok: false, reason: e.message ?? t('Erreur de scan', 'Scan error') });
    } finally {
      setProcessing(false);
    }
  };

  const getFinalReason = () => {
    if (refundReason === 'other') return customReason || REFUND_REASONS.other[language];
    return REFUND_REASONS[refundReason]?.[language] || '';
  };

  const confirmCancelTicket = async () => {
    if (!scannedTicket) return;
    const finalReason = getFinalReason();
    if (!finalReason) { toast.error(t('Sélectionnez un motif', 'Select a reason')); return; }
    setIsCancelling(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke('staff-cancel', {
        body: { type: 'ticket', id: scannedTicket.id, reason: finalReason, banCustomer: false, staffId: authUser?.id },
      });
      if (error) throw error;
      toast.success(`${t('Billet annulé', 'Ticket cancelled')} — ${Number(data.refundAmount).toFixed(2)}€ ${t('remboursés', 'refunded')}`);
      setShowCancelConfirm(false);
      resetTicketScan();
    } catch (e: any) {
      toast.error(e.message ?? t("Erreur lors de l'annulation", 'Cancel error'));
    } finally {
      setIsCancelling(false);
    }
  };

  const refundPreview = useMemo(() => {
    if (!scannedTicket) return null;
    const total = scannedTicket.totalPrice;
    const yunoFee = scannedTicket.serviceFee;
    const stripeFee = calcStripeFee(Math.round(total * 100));
    const net = Math.max(0, Math.round((total - yunoFee - stripeFee) * 100) / 100);
    return { total, yunoFee, stripeFee, net };
  }, [scannedTicket]);

  const handleDrinkScan = async (qrText: string) => {
    const code = qrText.trim();
    if (!eventId || !code || drinkProcessing) return;
    setDrinkProcessing(true);
    setDrinkResult(null);
    try {
      const { data: order } = await supabase
        .from('orders')
        .select('id, token, status, served_at, token_used, event_id, items')
        .eq('token', code).maybeSingle();
      if (!order) { setDrinkResult({ ok: false, reason: t('Commande introuvable', 'Order not found') }); return; }
      if (order.event_id && order.event_id !== eventId) { setDrinkResult({ ok: false, reason: t('Mauvais événement', 'Wrong event') }); return; }
      if (order.status !== 'paid') { setDrinkResult({ ok: false, reason: t('Non payée', 'Not paid') }); return; }
      if (order.served_at || order.token_used) { setDrinkResult({ ok: false, reason: t('Déjà servie', 'Already served') }); return; }
      const { data: { user: serveUser } } = await supabase.auth.getUser();
      const { error } = await supabase.from('orders')
        .update({ served_at: new Date().toISOString(), token_used: true, status: 'served', served_by: serveUser?.id })
        .eq('id', order.id).is('served_at', null);
      if (error) throw error;
      const itemsLabel = Array.isArray(order.items)
        ? (order.items as any[]).map(i => `${i.qty ?? i.quantity ?? 1}× ${i.name ?? '—'}`).join(', ')
        : '';
      setDrinkResult({ ok: true, label: itemsLabel || t('Commande validée', 'Order validated') });
      toast.success(t('Commande servie', 'Order served'));
    } catch (e: any) {
      setDrinkResult({ ok: false, reason: e.message ?? t('Erreur de scan', 'Scan error') });
    } finally {
      setDrinkProcessing(false);
    }
  };

  const handleCloakroomScan = async (qrText: string) => {
    const code = qrText.trim();
    if (!eventId || !code || cloakProcessing) return;
    if (!eventVenueId) { setCloakResult({ ok: false, reason: t('Vestiaire dispo uniquement en événement club', 'Cloakroom only for venue events') }); return; }
    setCloakProcessing(true);
    setCloakResult(null);
    try {
      const { data: tx } = await supabase
        .from('cloakroom_transactions')
        .select('id, retrieved, retrieved_at, cloakroom_number, items_count, attendee_qr')
        .eq('attendee_qr', code)
        .eq('venue_id', eventVenueId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!tx) { setCloakResult({ ok: false, reason: t('Aucun dépôt actif pour ce QR', 'No active deposit for this QR') }); return; }
      const statusLabel = tx.retrieved ? t('récupéré', 'retrieved') : t('en dépôt', 'in storage');
      setCloakResult({ ok: true, label: `${t('Vestiaire', 'Cloakroom')} #${tx.cloakroom_number ?? '—'} · ${tx.items_count ?? 1} ${t('pièce(s)', 'item(s)')} — ${statusLabel}` });
    } catch (e: any) {
      setCloakResult({ ok: false, reason: e.message ?? t('Erreur de scan', 'Scan error') });
    } finally {
      setCloakProcessing(false);
    }
  };

  if (events.length === 0) {
    return (
      <OrgPage className="mx-auto max-w-[1340px]">
        <OrgPageHeader title={t('Check-in', 'Check-in')} subtitle={t('Scannez les QR codes des participants.', "Scan attendees' QR codes.")} />
        <OrgEmptyState icon={ScanLine} title={t('Aucun événement actif.', 'No active events.')} />
      </OrgPage>
    );
  }

  const infoBanner = (icon: any, text: string, tone: 'info' | 'danger' = 'info') => {
    const Icon = icon;
    const styles = tone === 'danger'
      ? { background: 'rgba(255,92,99,0.06)', border: '1px solid rgba(255,92,99,0.25)', color: RED_SOFT }
      : { background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.2)', color: RED };
    return (
      <div className="flex items-start gap-2 rounded-xl p-3" style={{ background: styles.background, border: styles.border }}>
        <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: styles.color }} />
        <p style={{ color: T3, fontSize: 11.5 }}>{text}</p>
      </div>
    );
  };

  return (
    <OrgPage className="mx-auto max-w-[1340px]">
      <OrgPageHeader
        title={t('Check-in', 'Check-in')}
        subtitle={t('Différenciez les scans par type pour ne rien mélanger.', 'Differentiate scans by type to keep things tidy.')}
      />

      <div className="space-y-4">
        <OrgCard>
          <div className="p-4">
            <FieldLabel>{t('Événement', 'Event')}</FieldLabel>
            <DarkSelect value={eventId} onChange={(v) => { setEventId(v); resetTicketScan(); setDrinkResult(null); setCloakResult(null); }} placeholder={t('Choisir un événement', 'Select event')}>
              {events.map(e => <option key={e.id} value={e.id} style={{ background: '#0a0a0c' }}>{e.title}</option>)}
            </DarkSelect>
          </div>
        </OrgCard>

        <OrgTabs<ScanTab>
          value={tab}
          onChange={(v) => { setTab(v); resetTicketScan(); setDrinkResult(null); setCloakResult(null); }}
          className="w-full justify-center"
          tabs={[
            { value: 'tickets', label: t('Billets', 'Tickets'), icon: <TicketIcon className="h-4 w-4" /> },
            { value: 'drinks', label: t('Boissons', 'Drinks'), icon: <Wine className="h-4 w-4" /> },
            { value: 'cloakroom', label: t('Vestiaire', 'Cloakroom'), icon: <Shirt className="h-4 w-4" /> },
          ]}
        />

        {/* TICKETS */}
        {tab === 'tickets' && (
          <div className="space-y-4">
            <OrgTabs<TicketMode>
              value={ticketMode}
              onChange={(v) => { setTicketMode(v); resetTicketScan(); }}
              className="w-full justify-center"
              tabs={[
                { value: 'entry', label: t('Accepter', 'Accept'), icon: <CheckCircle2 className="h-4 w-4" /> },
                { value: 'cancel', label: t('Annuler', 'Cancel'), icon: <Ban className="h-4 w-4" /> },
              ]}
            />

            {ticketMode === 'entry' && (
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Left — scanner */}
                <div className="space-y-4">
                  <OrgQRScanner onScan={handleEntryScan} />
                </div>
                {/* Right — result + recent */}
                <div className="space-y-4">
                  {lastScan
                    ? <ScanResult ok={lastScan.ok} title={lastScan.ok ? t('Entrée validée', 'Entry validated') : (lastScan.reason ?? t('Refusé', 'Denied'))} sub={lastScan.name} />
                    : <WaitingPanel text={t('Scannez un billet pour valider l\'entrée.', 'Scan a ticket to validate entry.')} />}
                  {recent.length > 0 && (
                    <OrgCard>
                      <div className="p-4">
                        <h3 className="mb-2 flex items-center gap-2" style={{ color: T1, fontSize: 13, fontWeight: 600 }}><Clock className="h-4 w-4" style={{ color: T3 }} />{t('Derniers scans', 'Recent scans')}</h3>
                        <div className="space-y-1">
                          {recent.map((r, i) => (
                            <div key={i} className="flex justify-between py-1" style={{ fontSize: 13 }}>
                              <span style={{ color: T2 }}>{r.name ?? '—'}</span>
                              <span style={{ color: T3, fontSize: 11.5 }}>{r.at.toLocaleTimeString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </OrgCard>
                  )}
                </div>
              </div>
            )}

            {ticketMode === 'cancel' && (
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Left — scanner + policy */}
                <div className="space-y-4">
                  {infoBanner(AlertTriangle, t('Politique Yuno : remboursement = montant payé − frais de service − frais Stripe.', 'Yuno policy: refund = paid − service fee − Stripe fee.'), 'danger')}
                  {!scannedTicket && <OrgQRScanner onScan={handleCancelScan} />}
                </div>
                {/* Right — result / refund panel */}
                <div className="space-y-4">
                  {lastScan && !lastScan.ok && !scannedTicket && <ScanResult ok={false} title={lastScan.reason ?? '—'} />}
                  {!scannedTicket && (!lastScan || lastScan.ok) && <WaitingPanel text={t('Scannez un billet à annuler.', 'Scan a ticket to cancel.')} />}
                  {scannedTicket && refundPreview && (
                    <OrgCard>
                      <div className="space-y-4 p-5">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" style={{ color: T3 }} />
                          <div>
                            <div style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{scannedTicket.fullName ?? scannedTicket.userEmail ?? '—'}</div>
                            <div style={{ color: T3, fontSize: 11.5 }}>{scannedTicket.eventTitle}</div>
                          </div>
                        </div>

                        <div className="space-y-1 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, fontSize: 13 }}>
                          <Row label={t('Total payé', 'Total paid')} value={`${refundPreview.total.toFixed(2)}€`} />
                          <Row label={t('Frais Yuno', 'Yuno fee')} value={`−${refundPreview.yunoFee.toFixed(2)}€`} />
                          <Row label={t('Frais Stripe', 'Stripe fee')} value={`−${refundPreview.stripeFee.toFixed(2)}€`} />
                          <div className="mt-1 flex justify-between border-t pt-2" style={{ borderColor: BORDER }}>
                            <span style={{ color: T1, fontWeight: 600 }}>{t('Remboursement client', 'Customer refund')}</span>
                            <span style={{ color: POS, fontWeight: 700 }}>{refundPreview.net.toFixed(2)}€</span>
                          </div>
                        </div>

                        <div>
                          <FieldLabel>{t('Motif du refus', 'Refusal reason')} *</FieldLabel>
                          <DarkSelect value={refundReason} onChange={setRefundReason} placeholder={t('Choisir un motif', 'Select a reason')}>
                            {Object.keys(REFUND_REASONS).map(key => (
                              <option key={key} value={key} style={{ background: '#0a0a0c' }}>{REFUND_REASONS[key][language]}</option>
                            ))}
                          </DarkSelect>
                          {refundReason === 'other' && (
                            <div className="mt-2">
                              <DarkTextarea placeholder={t('Précisez le motif…', 'Specify the reason…')} value={customReason} onChange={setCustomReason} rows={2} />
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <OrgButton variant="secondary" onClick={resetTicketScan} disabled={isCancelling}>{t('Annuler', 'Cancel')}</OrgButton>
                          <OrgButton variant="primary" onClick={() => setShowCancelConfirm(true)} disabled={!refundReason || (refundReason === 'other' && !customReason.trim()) || isCancelling}>
                            <Ban className="h-4 w-4" />{t('Annuler le billet', 'Cancel ticket')}
                          </OrgButton>
                        </div>
                      </div>
                    </OrgCard>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DRINKS */}
        {tab === 'drinks' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              {infoBanner(Wine, t("Scannez le QR de retrait d'une commande boisson pour la marquer servie.", 'Scan a drink order pickup QR to mark it served.'))}
              <OrgQRScanner onScan={handleDrinkScan} />
            </div>
            <div className="space-y-4">
              {drinkResult
                ? <ScanResult ok={drinkResult.ok} title={drinkResult.ok ? t('Commande servie', 'Order served') : (drinkResult.reason ?? '—')} sub={drinkResult.label} />
                : <WaitingPanel text={t('Scannez une commande boisson.', 'Scan a drink order.')} />}
            </div>
          </div>
        )}

        {/* CLOAKROOM */}
        {tab === 'cloakroom' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              {infoBanner(Shirt, eventVenueId
                ? t("Scannez le QR d'un participant pour voir son dépôt vestiaire.", 'Scan an attendee QR to view their cloakroom deposit.')
                : t('Le vestiaire est disponible uniquement pour les événements hébergés dans un club.', 'Cloakroom is only available for events hosted at a venue.'))}
              {eventVenueId && <OrgQRScanner onScan={handleCloakroomScan} />}
            </div>
            <div className="space-y-4">
              {cloakResult
                ? <ScanResult ok={cloakResult.ok} title={cloakResult.ok ? t('Dépôt trouvé', 'Deposit found') : (cloakResult.reason ?? '—')} sub={cloakResult.label} />
                : <WaitingPanel text={t('Scannez le QR d\'un participant.', 'Scan an attendee QR.')} />}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Confirmer l'annulation", 'Confirm cancellation')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Le billet sera annulé et un remboursement sera initié selon la politique Yuno. Le client recevra un e-mail.',
                 'The ticket will be cancelled and a refund initiated per Yuno policy. The customer will receive an email.')}
              {refundPreview && (
                <span className="mt-2 block font-semibold text-foreground">
                  {t('Remboursement', 'Refund')} : {refundPreview.net.toFixed(2)}€
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>{t('Retour', 'Back')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmCancelTicket(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={isCancelling}>
              {isCancelling ? '...' : t('Confirmer & rembourser', 'Confirm & refund')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OrgPage>
  );
}

function WaitingPanel({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-2xl px-4 py-10 text-center"
      style={{ border: `1px dashed ${BORDER}`, background: 'rgba(255,255,255,0.012)' }}>
      <ScanLine className="mb-3 h-9 w-9" style={{ color: 'rgba(255,255,255,0.14)' }} />
      <p style={{ color: T3, fontSize: 12.5 }}>{text}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: T3 }}>{label}</span>
      <span style={{ color: T2 }}>{value}</span>
    </div>
  );
}
