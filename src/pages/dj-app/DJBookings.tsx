import { useEffect, useMemo, useState } from 'react';
import { format, addMonths } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Check, X, Inbox, CalendarDays, Euro, Clock, CreditCard, ShieldCheck, FileSignature,
  Loader2, ExternalLink, AlertCircle, Banknote, Lock, FileDown,
} from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDJData, type DJBookingRequest, type DJSecuredContract } from '@/contexts/DJDataContext';
import { useDJStripeConnect } from '@/hooks/useDJStripeConnect';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { downloadDJContractPDF } from '@/lib/generateDJContractPDF';
import { DJPage, DJHeading, PCard, Pill, ZoneHeading, DJSpinner, RED, POS, NEG, WARN, T1, T2, T3, BORDER, INNER_BG } from '@/components/dj/dj-ui';

const eur = (cents: number) => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

type AvailStatus = 'manual' | 'set' | 'booking';

export default function DJBookings() {
  const { user } = useAuth();
  const { dj, bookingRequests, securedContracts, refetchBookingRequests, refetchAllSets, refetchSecuredContracts, loading } = useDJData();
  const { stripe, loading: stripeLoading, refresh: refreshStripe, startOnboarding, openDashboard } = useDJStripeConnect();
  const { language } = useLanguage();
  const tt = makeDjT(language);
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [avail, setAvail] = useState<Record<string, AvailStatus>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);

  // Stripe returns the DJ here with ?stripe=success after onboarding — resync.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe')) {
      refreshStripe();
      refetchSecuredContracts();
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signContract = async (c: DJSecuredContract) => {
    setSigningId(c.id);
    try {
      const rpcAny = supabase.rpc.bind(supabase) as unknown as (
        fn: string, args?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
      const { error } = await rpcAny('sign_dj_booking_contract', {
        p_contract_id: c.id,
        p_ip: null,
        p_user_agent: navigator.userAgent.slice(0, 300),
      });
      if (error) throw error;
      toast.success(tt('Contrat signé', 'Contract signed', 'Contrato firmado'));
      await refetchSecuredContracts();
    } catch (e) {
      console.error('sign contract failed', e);
      toast.error(tt('Erreur lors de la signature', 'Error signing', 'Error al firmar'));
    } finally {
      setSigningId(null);
    }
  };

  const stripeActive = stripe.status === 'active' && stripe.payoutsEnabled;
  const stripePending = stripe.status === 'pending' || stripe.status === 'restricted' || (stripe.connected && !stripe.payoutsEnabled);
  const stripeNone = !stripe.connected || stripe.status === 'none';

  const pending = useMemo(() => bookingRequests.filter((r) => r.status === 'pending'), [bookingRequests]);
  const history = useMemo(() => bookingRequests.filter((r) => r.status !== 'pending'), [bookingRequests]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const loadAvail = async () => {
    if (!user) return;
    const from = new Date();
    const to = addMonths(from, 12);
    const { data } = await supabase.rpc('get_dj_availability', {
      p_user_id: user.id,
      p_from: format(from, 'yyyy-MM-dd'),
      p_to: format(to, 'yyyy-MM-dd'),
    });
    const map: Record<string, AvailStatus> = {};
    (data || []).forEach((r: { d: string; status: AvailStatus }) => {
      // a real gig (set/booking) wins over a manual block for display
      if (!map[r.d] || r.status !== 'manual') map[r.d] = r.status;
    });
    setAvail(map);
  };

  useEffect(() => {
    loadAvail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const respond = async (id: string, accept: boolean) => {
    setBusyId(id);
    try {
      const { error } = await supabase.rpc(
        accept ? 'accept_dj_booking_request' : 'decline_dj_booking_request',
        { p_id: id },
      );
      if (error) throw error;
      toast.success(accept
        ? tt('Booking accepté — ajouté à ton planning', 'Booking accepted — added to your schedule', 'Reserva aceptada — añadida a tu agenda')
        : tt('Demande refusée', 'Request declined', 'Solicitud rechazada'));
      await Promise.all([refetchBookingRequests(), refetchAllSets(), loadAvail()]);
    } catch (e) {
      toast.error(tt('Action échouée', 'Action failed', 'Acción fallida'));
      console.error('booking response failed', e);
    } finally {
      setBusyId(null);
    }
  };

  const toggleDay = async (day?: Date) => {
    if (!day) return;
    const key = format(day, 'yyyy-MM-dd');
    const st = avail[key];
    // Any real gig (set / event line-up / accepted booking) can't be toggled — only manual blocks.
    if (st && st !== 'manual') {
      toast.error(tt('Tu as déjà un gig ce soir-là', 'You already have a gig that night', 'Ya tienes un gig esa noche'));
      return;
    }
    try {
      if (st === 'manual') await supabase.rpc('clear_dj_availability_block', { p_date: key });
      else await supabase.rpc('set_dj_availability_block', { p_date: key });
      await loadAvail();
    } catch (e) {
      toast.error(tt('Échec', 'Failed', 'Error'));
      console.error('toggle availability failed', e);
    }
  };

  const manualDays = useMemo(
    () => Object.entries(avail).filter(([, v]) => v === 'manual').map(([k]) => new Date(`${k}T00:00:00`)),
    [avail],
  );
  const busyDays = useMemo(
    () => Object.entries(avail).filter(([, v]) => v !== 'manual').map(([k]) => new Date(`${k}T00:00:00`)),
    [avail],
  );

  const bookerName = (r: DJBookingRequest) =>
    r.venue?.name || tt('Organisateur', 'Organizer', 'Organizador');

  const fmtDate = (iso: string) => format(new Date(`${iso}T00:00:00`), 'EEEE d MMMM yyyy', { locale: dateLocale });

  if (loading) return <DJSpinner />;

  const statusPill = (s: DJBookingRequest['status']) => {
    const map: Record<string, { label: string; color: string }> = {
      accepted: { label: tt('Accepté', 'Accepted', 'Aceptado'), color: POS },
      declined: { label: tt('Refusé', 'Declined', 'Rechazado'), color: NEG },
      cancelled: { label: tt('Annulé', 'Cancelled', 'Cancelado'), color: T3 },
      expired: { label: tt('Expiré', 'Expired', 'Expirado'), color: T3 },
    };
    const m = map[s] || { label: s, color: T3 };
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: m.color, border: `1px solid ${m.color}40`, background: `${m.color}14`, padding: '2px 9px', borderRadius: 999 }}>
        {m.label}
      </span>
    );
  };

  return (
    <DJPage maxWidth={820}>
      <DJHeading
        title={tt('Réservations', 'Bookings', 'Reservas')}
        subtitle={tt('Réponds aux demandes et gère tes disponibilités.', 'Respond to requests and manage your availability.', 'Responde a las solicitudes y gestiona tu disponibilidad.')}
      />

      {/* Stripe Connect — required to receive secured fees */}
      <PCard icon={<CreditCard className="w-4 h-4" />} accent
        title={tt('Recevoir tes cachets', 'Get paid', 'Cobrar tus cachés')}
        right={
          stripeActive ? <Pill tone="pos">{tt('Actif', 'Active', 'Activo')}</Pill>
          : stripePending ? <Pill tone="warn">{tt('En attente', 'Pending', 'Pendiente')}</Pill>
          : <Pill>{tt('Non configuré', 'Not set up', 'Sin configurar')}</Pill>
        }
      >
        {stripeLoading ? (
          <div className="flex items-center justify-center py-3"><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div>
        ) : stripeNone ? (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: T2 }}>
              {tt('Connecte ton compte Stripe pour recevoir tes cachets sécurisés directement sur ton compte bancaire (2 min).',
                 'Connect Stripe to receive your secured fees straight to your bank (2 min).',
                 'Conecta Stripe para recibir tus cachés en tu banco (2 min).')}
            </p>
            <button onClick={startOnboarding} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ background: RED, color: '#fff' }}>
              <CreditCard className="w-4 h-4" />{tt('Activer les paiements', 'Activate payments', 'Activar pagos')}
            </button>
          </div>
        ) : stripePending ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl p-3" style={{ background: 'rgba(252,211,77,0.06)', border: '1px solid rgba(252,211,77,0.2)' }}>
              <AlertCircle className="mt-0.5 w-4 h-4 shrink-0" style={{ color: WARN }} />
              <p className="text-[12.5px]" style={{ color: T2 }}>{tt('Onboarding incomplet. Termine les vérifications Stripe pour être payé.', 'Onboarding incomplete. Finish Stripe checks to get paid.', 'Onboarding incompleto. Termina las verificaciones para cobrar.')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={startOnboarding} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ background: RED, color: '#fff' }}>{tt('Reprendre', 'Resume', 'Reanudar')}</button>
              <button onClick={refreshStripe} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>{tt('Actualiser', 'Refresh', 'Actualizar')}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
              <Banknote className="w-3.5 h-3.5" style={{ color: POS }} />{tt('Virements actifs — tu touches 100% du cachet (frais payés par le club).', 'Payouts on — you keep 100% of the fee (fees paid by the club).', 'Pagos activos — recibes el 100% (comisiones las paga el club).')}
            </div>
            <button onClick={openDashboard} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
              <ExternalLink className="w-4 h-4" />{tt('Dashboard Stripe', 'Stripe dashboard', 'Panel Stripe')}
            </button>
          </div>
        )}
      </PCard>

      {/* Secured contracts (option) */}
      {securedContracts.length > 0 && (
        <>
          <ZoneHeading icon={<FileSignature size={15} />} label={tt('Contrats sécurisés', 'Secured contracts', 'Contratos seguros')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {securedContracts.map((c) => {
              const balanceCents = c.cachet_cents - c.acompte_cents;
              const needsDjSign = c.status === 'pending_signatures' && !c.dj_signed_at;
              const waitingClub = c.status === 'pending_signatures' && !!c.dj_signed_at && !c.club_signed_at;
              const title = c.dj_set?.event?.title || c.dj_set?.venue?.name || tt('Prestation DJ', 'DJ gig', 'Actuación DJ');
              const when = c.dj_set?.start_time ? format(new Date(c.dj_set.start_time), 'dd MMM yyyy', { locale: dateLocale }) : null;
              return (
                <PCard key={c.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-[600] text-[15px] truncate" style={{ color: T1 }}>{title}</p>
                      {when && <p className="text-xs mt-0.5" style={{ color: T3 }}>{when}{c.dj_set?.venue?.name ? ` • ${c.dj_set.venue.name}` : ''}</p>}
                    </div>
                    <ContractStatusPill status={c.status} tt={tt} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <MoneyTile label={tt('Cachet', 'Fee', 'Caché')} value={`${eur(c.cachet_cents)} €`} color={T1} />
                    <MoneyTile label={tt('Acompte', 'Deposit', 'Anticipo')} value={`${eur(c.acompte_cents)} €`} color={c.acompte_released_at ? POS : T2} hint={c.acompte_released_at ? tt('versé', 'paid', 'pagado') : undefined} />
                    <MoneyTile label={tt('Solde', 'Balance', 'Saldo')} value={`${eur(balanceCents)} €`} color={c.released_at ? POS : WARN} hint={c.released_at ? tt('versé', 'paid', 'pagado') : tt('après presta', 'after gig', 'tras actuación')} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {c.status === 'pending_dj_setup' && (
                      <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: WARN }}>
                        <Lock className="w-3.5 h-3.5" />{tt('Active tes paiements Stripe ci-dessus pour signer.', 'Activate Stripe above to sign.', 'Activa Stripe arriba para firmar.')}
                      </span>
                    )}
                    {needsDjSign && (
                      <button onClick={() => signContract(c)} disabled={signingId === c.id} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: RED, color: '#fff' }}>
                        {signingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
                        {tt('Signer le contrat', 'Sign the contract', 'Firmar el contrato')}
                      </button>
                    )}
                    {waitingClub && <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: T2 }}><Clock className="w-3.5 h-3.5" />{tt('En attente de la signature du club.', 'Waiting for the club to sign.', 'Esperando la firma del club.')}</span>}
                    {c.status === 'pending_payment' && <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: T2 }}><Clock className="w-3.5 h-3.5" />{tt('Signé. En attente du paiement du club.', 'Signed. Waiting for the club to pay.', 'Firmado. Esperando el pago del club.')}</span>}
                    {c.status === 'funds_held' && <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: POS }}><ShieldCheck className="w-3.5 h-3.5" />{tt('Argent sécurisé chez Yuno. Solde versé après la presta.', 'Money secured at Yuno. Balance after the gig.', 'Dinero seguro en Yuno. Saldo tras la actuación.')}</span>}
                    {c.club_signed_at && c.dj_signed_at && (
                      <button onClick={() => downloadDJContractPDF({
                        contractId: c.id,
                        clubName: c.dj_set?.venue?.name || '—',
                        djName: dj?.stage_name || `${dj?.first_name ?? ''} ${dj?.last_name ?? ''}`.trim() || 'DJ',
                        eventTitle: c.dj_set?.event?.title,
                        eventDate: c.dj_set?.start_time ? new Date(c.dj_set.start_time) : undefined,
                        setStart: c.dj_set?.start_time ? new Date(c.dj_set.start_time) : undefined,
                        setEnd: c.dj_set?.end_time ? new Date(c.dj_set.end_time) : undefined,
                        cachetEur: c.cachet_cents / 100,
                        acompteEur: c.acompte_cents / 100,
                        cancellationPolicy: c.cancellation_policy,
                        clubSignedAt: c.club_signed_at ? new Date(c.club_signed_at) : null,
                        clubSignedName: c.dj_set?.venue?.name,
                        djSignedAt: c.dj_signed_at ? new Date(c.dj_signed_at) : null,
                        djSignedName: dj?.stage_name || `${dj?.first_name ?? ''} ${dj?.last_name ?? ''}`.trim(),
                        language: (language === 'en' || language === 'es') ? language : 'fr',
                      })} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                        <FileDown className="w-3.5 h-3.5" />{tt('Contrat PDF', 'Contract PDF', 'Contrato PDF')}
                      </button>
                    )}
                  </div>
                </PCard>
              );
            })}
          </div>
        </>
      )}

      {/* Incoming requests */}
      <ZoneHeading icon={<Inbox size={15} />} label={tt('Demandes reçues', 'Incoming requests', 'Solicitudes recibidas')} />
      {pending.length === 0 ? (
        <PCard><p style={{ color: T3, fontSize: 13, margin: 0 }}>{tt('Aucune demande en attente.', 'No pending requests.', 'Ninguna solicitud pendiente.')}</p></PCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pending.map((r) => (
            <PCard key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T1 }}>{bookerName(r)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: 12.5, color: T2 }}>
                    <CalendarDays size={13} />{fmtDate(r.requested_date)}
                  </div>
                  {r.agreed_fee != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 12.5, color: T2 }}>
                      <Euro size={13} />{Math.round(r.agreed_fee)} {r.currency}
                    </div>
                  )}
                  {r.message && <p style={{ marginTop: 8, fontSize: 13, color: T2, lineHeight: 1.5 }}>{r.message}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <button onClick={() => respond(r.id, true)} disabled={busyId === r.id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 11, background: RED, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    <Check size={15} />{tt('Accepter', 'Accept', 'Aceptar')}
                  </button>
                  <button onClick={() => respond(r.id, false)} disabled={busyId === r.id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 11, background: 'transparent', color: T2, border: `1px solid ${BORDER}`, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    <X size={15} />{tt('Refuser', 'Decline', 'Rechazar')}
                  </button>
                </div>
              </div>
            </PCard>
          ))}
        </div>
      )}

      {/* Availability */}
      <ZoneHeading icon={<CalendarDays size={15} />} label={tt('Mes disponibilités', 'My availability', 'Mi disponibilidad')} />
      <PCard>
        <p style={{ color: T2, fontSize: 13, marginTop: 0, marginBottom: 12 }}>
          {tt('Tu es dispo par défaut. Touche une nuit pour la bloquer.', 'You are available by default. Tap a night to block it.', 'Estás disponible por defecto. Toca una noche para bloquearla.')}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Calendar
            mode="single"
            onDayClick={toggleDay}
            disabled={(d) => d < today}
            modifiers={{ blocked: manualDays, busy: busyDays }}
            modifiersStyles={{
              blocked: { background: 'rgba(255,92,99,0.22)', color: '#fff', borderRadius: 8 },
              busy: { background: 'rgba(96,165,250,0.22)', color: '#fff', borderRadius: 8 },
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11.5, color: T3, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: 'rgba(255,92,99,0.5)' }} />{tt('Bloqué', 'Blocked', 'Bloqueado')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: 'rgba(96,165,250,0.5)' }} />{tt('Gig confirmé', 'Confirmed gig', 'Gig confirmado')}
          </span>
        </div>
      </PCard>

      {/* History */}
      {history.length > 0 && (
        <>
          <ZoneHeading icon={<Clock size={15} />} label={tt('Historique', 'History', 'Historial')} />
          <PCard>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {history.map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: T1 }}>{bookerName(r)}</div>
                    <div style={{ fontSize: 12, color: T3 }}>{fmtDate(r.requested_date)}</div>
                  </div>
                  {statusPill(r.status)}
                </div>
              ))}
            </div>
          </PCard>
        </>
      )}
    </DJPage>
  );
}

function MoneyTile({ label, value, color, hint }: { label: string; value: string; color: string; hint?: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.07em]" style={{ color: T3 }}>{label}</p>
      <p className="mt-1 text-[15px] font-[640] tabular-nums leading-none" style={{ color }}>{value}</p>
      {hint && <p className="mt-1 text-[10px]" style={{ color: T3 }}>{hint}</p>}
    </div>
  );
}

function ContractStatusPill({ status, tt }: { status: DJSecuredContract['status']; tt: (fr: string, en: string, es?: string) => string }) {
  switch (status) {
    case 'released': return <Pill tone="pos">{tt('Payé', 'Paid', 'Pagado')}</Pill>;
    case 'funds_held': return <Pill tone="pos">{tt('Sécurisé', 'Secured', 'Seguro')}</Pill>;
    case 'pending_payment': return <Pill tone="warn">{tt('Paiement club', 'Club payment', 'Pago club')}</Pill>;
    case 'pending_signatures': return <Pill tone="warn">{tt('À signer', 'To sign', 'Por firmar')}</Pill>;
    case 'pending_dj_setup': return <Pill tone="warn">{tt('Setup Stripe', 'Stripe setup', 'Setup Stripe')}</Pill>;
    case 'refunded': return <Pill>{tt('Remboursé', 'Refunded', 'Reembolsado')}</Pill>;
    case 'cancelled': return <Pill>{tt('Annulé', 'Cancelled', 'Cancelado')}</Pill>;
    default: return <Pill>{status}</Pill>;
  }
}
