import { useState, useEffect, useCallback } from 'react';
import { retrySupabaseAction } from '@/utils/retryAction';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shirt, ScanLine, Check, CreditCard, ArrowLeft, Package, QrCode, Users, DollarSign, Camera, Plus, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Scanner } from '@yudiel/react-qr-scanner';
import { LanguageSelector } from '@/components/LanguageSelector';
import { PublicPage } from '@/components/PublicPage';
import { StaffHeader } from '@/components/staff/StaffHeader';
import { RoleIntroGate } from '@/components/onboarding/RoleIntroGate';
import { readStaffSessionVenueId } from '@/components/RequireStaffSession';

import { useStaffIdentity } from '@/hooks/useStaffIdentity';
import { emitShiftStart } from '@/lib/liveops/shiftStart';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const BORDER   = 'rgba(255,255,255,0.085)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Carte principale (top-level)
const mainCard: React.CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  padding: 22,
  overflow: 'hidden',
  position: 'relative',
};

type ScanMode = 'idle' | 'deposit_pay' | 'deposit_prepaid' | 'retrieve';

interface ScanResult {
  mode: ScanMode;
  customerName: string;
  ticketId: string | null;
  attendeeQr: string;
  existingTransaction?: any;
  prepaidUpsell?: any;
}

export default function CloakroomDashboard() {
  const { t } = useLanguage();
  const { venueId: staffVenueId, loading: venueLoading } = useStaffIdentity();
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [cloakroomNumber, setCloakroomNumber] = useState('');
  const [itemsCount, setItemsCount] = useState(1);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [cloakroomPrice, setCloakroomPrice] = useState(4);
  const [activeDeposits, setActiveDeposits] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [currentEventId, setCurrentEventId] = useState<string | null>(null);
  const [activeDepositsList, setActiveDepositsList] = useState<any[]>([]);
  const [showActiveDeposits, setShowActiveDeposits] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Repli sur la session PIN quand le profil n'est pas encore chargé.
      // Cette session vit dans localStorage (persistance PWA iOS) — l'ancien
      // repli lisait sessionStorage et ne se déclenchait donc jamais.
      const vId = staffVenueId || readStaffSessionVenueId();

      if (!vId) return;
      setVenueId(vId);

      const { data: venue } = await supabase
        .from('venues')
        .select('cloakroom_price')
        .eq('id', vId)
        .single();
      if (venue?.cloakroom_price) setCloakroomPrice(Number(venue.cloakroom_price));

      const { data: events } = await supabase
        .from('events')
        .select('id')
        .eq('venue_id', vId)
        .eq('is_active', true)
        .order('start_at', { ascending: false })
        .limit(1);
      const eventId = events?.[0]?.id || null;
      if (eventId) setCurrentEventId(eventId);

      fetchStats(vId, eventId);
    };
    init();
  }, [staffVenueId]);

  // Prise de poste visible dans le centre de commandement owner (best-effort)
  useEffect(() => {
    if (venueId) emitShiftStart(venueId, 'cloakroom');
  }, [venueId]);

  // Realtime subscription for cloakroom transactions
  useEffect(() => {
    if (!venueId) return;

    const channel = supabase
      .channel(`cloakroom-realtime-${venueId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cloakroom_transactions',
          filter: `venue_id=eq.${venueId}`,
        },
        () => {
          fetchStats(venueId);
          fetchActiveDeposits();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId, currentEventId]);

  const fetchStats = async (vId: string, eventId?: string | null) => {
    const eid = eventId ?? currentEventId;
    
    // Active deposits: not retrieved, for current event (fallback to venue-wide)
    let depositQuery = supabase
      .from('cloakroom_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('venue_id', vId)
      .eq('retrieved', false);
    if (eid) depositQuery = depositQuery.eq('event_id', eid);
    const { count } = await depositQuery;
    setActiveDeposits(count || 0);

    // Revenue: confirmed payments for current event
    let revQuery = supabase
      .from('cloakroom_transactions')
      .select('price')
      .eq('venue_id', vId)
      .eq('payment_confirmed', true);
    if (eid) revQuery = revQuery.eq('event_id', eid);
    const { data: rev } = await revQuery;
    setTotalRevenue(rev?.reduce((sum, r) => sum + Number(r.price), 0) || 0);
  };

  const fetchActiveDeposits = async () => {
    if (!venueId) return;
    const eid = currentEventId;
    let query = supabase
      .from('cloakroom_transactions')
      .select('id, cloakroom_number, customer_name, deposited_at, items_count, price')
      .eq('venue_id', venueId)
      .eq('retrieved', false)
      .order('deposited_at', { ascending: false });
    if (eid) query = query.eq('event_id', eid);
    const { data } = await query;
    setActiveDepositsList(data || []);
  };

  const startScanning = () => {
    setScanResult(null);
    setScanning(true);
  };

  const handleScan = useCallback(async (result: any) => {
    if (!venueId || processing) return;
    const qrCode = result?.[0]?.rawValue;
    if (!qrCode) return;

    setProcessing(true);
    setScanning(false);

    try {
      // Check if there's an active deposit for this QR
      const { data: existingTx } = await supabase
        .from('cloakroom_transactions')
        .select('*')
        .eq('venue_id', venueId)
        .eq('attendee_qr', qrCode)
        .eq('retrieved', false)
        .maybeSingle();

      if (existingTx) {
        if (navigator.vibrate) navigator.vibrate(200);
        setScanResult({
          mode: 'retrieve',
          customerName: existingTx.customer_name || 'Client',
          ticketId: existingTx.ticket_id,
          attendeeQr: qrCode,
          existingTransaction: existingTx,
        });
        setProcessing(false);
        return;
      }

      // Find the ticket/attendee or guest list entry
      let customerName = 'Client';
      let ticketId: string | null = null;
      let isGuestList = false;

      const { data: attendee } = await supabase
        .from('ticket_attendees')
        .select('full_name, ticket_id')
        .eq('qr_code', qrCode)
        .maybeSingle();

      if (attendee) {
        customerName = attendee.full_name;
        ticketId = attendee.ticket_id;
      } else {
        const { data: ticket } = await supabase
          .from('tickets')
          .select('id, full_name')
          .eq('qr_code', qrCode)
          .maybeSingle();
        if (ticket) {
          customerName = ticket.full_name || 'Client';
          ticketId = ticket.id;
        } else {
          // Check guest list entries
          const { data: guestEntry } = await supabase
            .from('guest_list_entries')
            .select('id, full_name')
            .eq('qr_code', qrCode)
            .maybeSingle();
          if (guestEntry) {
            customerName = guestEntry.full_name || 'Client';
            ticketId = null; // No ticket, but valid QR
            isGuestList = true;
          }
        }
      }

      if (!ticketId && !isGuestList) {
        toast.error(t('cloakroom.unrecognizedQR'));
        resetScan();
        setProcessing(false);
        return;
      }

      if (navigator.vibrate) navigator.vibrate(200);

      // Check for prepaid cloakroom upsell (only for ticket-based QR)
      if (ticketId) {
        const { data: prepaidUpsell } = await supabase
          .from('ticket_upsell_selections')
          .select('*')
          .eq('ticket_id', ticketId)
          .eq('offer_type', 'cloakroom')
          .eq('cloakroom_deposited', false)
          .maybeSingle();

        if (prepaidUpsell) {
          setScanResult({
            mode: 'deposit_prepaid',
            customerName,
            ticketId,
            attendeeQr: qrCode,
            prepaidUpsell,
          });
        } else {
          // No unused prepaid upsell — always allow pay-on-site deposit
          setScanResult({
            mode: 'deposit_pay',
            customerName,
            ticketId,
            attendeeQr: qrCode,
          });
        }
      } else {
        // Guest list entry — always pay on site
        setScanResult({
          mode: 'deposit_pay',
          customerName,
          ticketId: null,
          attendeeQr: qrCode,
        });
      }
    } catch (err) {
      console.error('Scan error:', err);
      toast.error(t('cloakroom.scanError'));
      resetScan();
    }
    setProcessing(false);
  }, [venueId, processing]);

  const resetScan = () => {
    setScanResult(null);
    setCloakroomNumber('');
    setItemsCount(1);
    setPaymentConfirmed(false);
    setScanning(false);
    setProcessing(false);
  };

  const handleConfirmDeposit = async () => {
    if (!cloakroomNumber.trim() || !scanResult || !venueId) {
      toast.error(t('cloakroom.enterNumber'));
      return;
    }

    const isPrepaid = scanResult.mode === 'deposit_prepaid';
    const price = isPrepaid ? Number(scanResult.prepaidUpsell?.unit_price || 0) : cloakroomPrice * itemsCount;

    try {
      // Get current staff user
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await retrySupabaseAction(async () => {
        const res = await supabase.from('cloakroom_transactions').insert({
          venue_id: venueId,
          event_id: currentEventId!,
          ticket_id: scanResult.ticketId,
          attendee_qr: scanResult.attendeeQr,
          customer_name: scanResult.customerName,
          cloakroom_number: cloakroomNumber.trim(),
          items_count: itemsCount,
          price,
          paid_on_site: !isPrepaid,
          payment_confirmed: isPrepaid || paymentConfirmed,
          // `staff_id` = qui a déposé. C'est la colonne que lit l'activité staff
          // de la soirée ; `processed_by` reste écrit pour les lectures legacy.
          staff_id: user?.id,
          processed_by: user?.id,
        });
        if (res.error) throw res.error;
        return res;
      });

      if (error) throw error;

      if (isPrepaid && scanResult.prepaidUpsell) {
        await supabase
          .from('ticket_upsell_selections')
          .update({
            cloakroom_deposited: true,
            cloakroom_deposited_at: new Date().toISOString(),
            cloakroom_number: cloakroomNumber.trim(),
          })
          .eq('id', scanResult.prepaidUpsell.id);
      }

      toast.success(`${t('cloakroom.depositConfirmed')} — N°${cloakroomNumber}`);
      if (venueId) fetchStats(venueId);
      resetScan();
    } catch (err: any) {
      toast.error(err.message || t('staffLogin.error'));
    }
  };

  const handleConfirmRetrieval = async () => {
    if (!scanResult?.existingTransaction) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await retrySupabaseAction(async () => {
        const res = await supabase
          .from('cloakroom_transactions')
          .update({
            retrieved: true,
            retrieved_at: new Date().toISOString(),
            // Colonne dédiée : la restitution ne doit pas effacer l'identité de
            // la personne qui a enregistré le dépôt (souvent quelqu'un d'autre).
            retrieved_by: user?.id,
          })
          .eq('id', scanResult.existingTransaction.id)
          .eq('retrieved', false);
        if (res.error) throw res.error;
        return res;
      });

      if (scanResult.ticketId) {
        await supabase
          .from('ticket_upsell_selections')
          .update({
            cloakroom_retrieved: true,
            cloakroom_retrieved_at: new Date().toISOString(),
          })
          .eq('ticket_id', scanResult.ticketId)
          .eq('offer_type', 'cloakroom')
          .eq('cloakroom_deposited', true)
          .eq('cloakroom_retrieved', false);
      }

      toast.success(t('cloakroom.retrievalDone'));
      if (venueId) fetchStats(venueId);
      resetScan();
    } catch (err: any) {
      toast.error(err.message || t('staffLogin.error'));
    }
  };

  if (venueLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div
          className="h-12 w-12 animate-spin rounded-full border-2"
          style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      <RoleIntroGate role="cloakroom" />
      {/* Vignette ambiante */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
      />

      <StaffHeader role="cloakroom" actions={<LanguageSelector />} backButtonClassName="h-10 w-10 flex-none" />

      {/* PublicPage n'enveloppe QUE le contenu défilant : le header sticky et les
          éléments `fixed` restent en sibling (un ancêtre transformé casserait
          leur positionnement). */}
      <PublicPage variant="flow">
      <div className="relative z-10 container mx-auto px-3 py-4 space-y-4">
        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3">
          <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' }}>
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4" style={{ color: RED }} />
              <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('cloakroom.activeDeposits')}</span>
            </div>
            <div className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{activeDeposits}</div>
          </div>
          <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' }}>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4" style={{ color: RED }} />
              <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('cloakroom.revenue')}</span>
            </div>
            <div className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{totalRevenue.toFixed(0)}€</div>
          </div>
        </div>

        {/* Active Deposits List */}
        <div style={mainCard}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="flex min-w-0 items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
              <Package className="h-4 w-4 flex-none" style={{ color: RED }} />
              <span className="truncate">{t('cloakroom.activeDepositsList')}</span>
            </h3>
            <Button
              variant="outline"
              size="sm"
              className="h-9 flex-none text-xs"
              onClick={() => {
                fetchActiveDeposits();
                setShowActiveDeposits(!showActiveDeposits);
              }}
            >
              {showActiveDeposits ? t('cloakroom.hide') : t('cloakroom.show')}
            </Button>
          </div>
          {showActiveDeposits && (
            <>
              {activeDepositsList.length === 0 ? (
                <p className="text-center py-4" style={{ color: T3, fontSize: 12 }}>{t('cloakroom.noActiveDeposits')}</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {activeDepositsList.map((dep) => (
                    <div
                      key={dep.id}
                      className="flex items-center justify-between gap-3"
                      style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px' }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center tabular-nums flex-none"
                          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED, fontSize: 14, fontWeight: 700 }}
                        >
                          {dep.cloakroom_number}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{dep.customer_name || 'Client'}</p>
                          <p className="flex items-center gap-1 truncate" style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                            <Clock className="h-3 w-3 flex-none" />
                            {format(new Date(dep.deposited_at), 'HH:mm')}
                            {dep.items_count > 1 && ` • ${dep.items_count} ${t('cloakroom.slots')}`}
                          </p>
                        </div>
                      </div>
                      <span
                        className="tabular-nums flex-none whitespace-nowrap"
                        style={{ color: T1, fontSize: 13, fontWeight: 620, padding: '4px 10px', borderRadius: 999, background: C_FAINT, border: `1px solid ${BORDER}` }}
                      >
                        {dep.price}€
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Scanner Section */}
        <div style={mainCard}>
          <h3 className="flex items-center gap-2 mb-3" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
            <QrCode className="h-4 w-4" style={{ color: RED }} />
            {t('cloakroom.scanTicket')}
          </h3>
          <div className="space-y-3">
            {scanning ? (
              <div className="rounded-xl overflow-hidden bg-black" style={{ minHeight: '280px', border: '2px solid rgba(232,25,44,0.5)' }}>
                <Scanner onScan={handleScan} />
              </div>
            ) : !scanResult ? (
              <Button onClick={startScanning} className="w-full h-12 text-sm gap-2">
                <Camera className="h-4 w-4" />
                {t('cloakroom.scanQR')}
              </Button>
            ) : null}

            {scanning && (
              <Button variant="outline" onClick={() => setScanning(false)} className="w-full text-sm">
                {t('cloakroom.stopScan')}
              </Button>
            )}
          </div>
        </div>

        {/* Scan Results */}
        <AnimatePresence mode="wait">
          {/* Deposit - needs payment */}
          {scanResult?.mode === 'deposit_pay' && (
            <motion.div
              key="deposit_pay"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              <div style={mainCard} className="space-y-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center flex-none"
                    style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
                  >
                    <Shirt className="h-6 w-6" style={{ color: RED }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{scanResult.customerName}</h3>
                    <p className="truncate" style={{ color: T3, fontSize: 13, marginTop: 1 }}>{t('cloakroom.paymentRequired')}</p>
                  </div>
                </div>

                <div>
                  <Label style={{ color: T3, fontSize: 13 }}>{t('cloakroom.slotsCount')}</Label>
                  <div className="flex items-center gap-4 mt-2">
                    <Button variant="outline" size="sm" className="h-11 w-11 flex-none" onClick={() => setItemsCount(Math.max(1, itemsCount - 1))}>-</Button>
                    <span className="w-8 text-center tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }}>{itemsCount}</span>
                    <Button variant="outline" size="sm" className="h-11 w-11 flex-none" onClick={() => setItemsCount(itemsCount + 1)}>+</Button>
                  </div>
                </div>

                <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
                  <div className="flex justify-between items-center gap-3">
                    <span className="min-w-0" style={{ color: T3, fontSize: 13 }}>{t('cloakroom.totalToPay')}</span>
                    <span className="tabular-nums flex-none whitespace-nowrap" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>{(cloakroomPrice * itemsCount).toFixed(2)}€</span>
                  </div>
                </div>

                {!paymentConfirmed ? (
                  <Button className="w-full h-12 gap-2" onClick={() => setPaymentConfirmed(true)}>
                    <CreditCard className="h-5 w-5" />
                    {t('cloakroom.paymentValidated')}
                  </Button>
                ) : (
                  <>
                    <div className="flex items-center gap-2" style={{ color: POS, fontSize: 13, fontWeight: 500 }}>
                      <Check className="h-4 w-4" /> {t('cloakroom.paymentConfirmed')}
                    </div>
                    <div>
                      <Label style={{ color: T3, fontSize: 13 }}>{t('cloakroom.cloakroomNumber')}</Label>
                      <Input
                        value={cloakroomNumber}
                        onChange={e => setCloakroomNumber(e.target.value)}
                        placeholder="Ex: 42"
                        className="text-center text-2xl font-bold h-14 mt-2 tabular-nums"
                        autoFocus
                      />
                    </div>
                    <Button className="w-full h-12" onClick={handleConfirmDeposit} disabled={!cloakroomNumber.trim()}>
                      {t('cloakroom.confirmDeposit')}
                    </Button>
                  </>
                )}

                <Button variant="ghost" onClick={resetScan} className="w-full gap-2" style={{ color: T3 }}>
                  <ArrowLeft className="h-4 w-4" /> {t('cloakroom.newScan')}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Deposit - prepaid */}
          {scanResult?.mode === 'deposit_prepaid' && (
            <motion.div
              key="deposit_prepaid"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              <div style={mainCard} className="space-y-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center flex-none"
                    style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}
                  >
                    <Check className="h-6 w-6" style={{ color: POS }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{scanResult.customerName}</h3>
                    <p className="truncate" style={{ color: POS, fontSize: 13, fontWeight: 500, marginTop: 1 }}>{t('cloakroom.prepaidEntry')}</p>
                  </div>
                </div>

                <div>
                  <Label style={{ color: T3, fontSize: 13 }}>{t('cloakroom.cloakroomNumber')}</Label>
                  <Input
                    value={cloakroomNumber}
                    onChange={e => setCloakroomNumber(e.target.value)}
                    placeholder="Ex: 42"
                    className="text-center text-2xl font-bold h-14 mt-2 tabular-nums"
                    autoFocus
                  />
                </div>

                <Button className="w-full h-12" onClick={handleConfirmDeposit} disabled={!cloakroomNumber.trim()}>
                  {t('cloakroom.confirmPrepaid')}
                </Button>

                {/* Option to add extra paid deposit */}
                <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12 }}>
                  <p style={{ color: T3, fontSize: 12, marginBottom: 8 }}>{t('cloakroom.needExtra')}</p>
                  <Button
                    variant="outline"
                    className="w-full gap-2 text-sm"
                    onClick={() => {
                      // Switch to pay mode for additional deposit
                      setScanResult({
                        ...scanResult,
                        mode: 'deposit_pay',
                        prepaidUpsell: undefined,
                      });
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    {t('cloakroom.addExtra')} ({cloakroomPrice}€)
                  </Button>
                </div>

                <Button variant="ghost" onClick={resetScan} className="w-full gap-2" style={{ color: T3 }}>
                  <ArrowLeft className="h-4 w-4" /> {t('cloakroom.newScan')}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Retrieval */}
          {scanResult?.mode === 'retrieve' && (
            <motion.div
              key="retrieve"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              <div style={mainCard} className="space-y-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center flex-none"
                    style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }}
                  >
                    <Package className="h-6 w-6" style={{ color: '#FCD34D' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{scanResult.customerName}</h3>
                    <p className="truncate" style={{ color: T3, fontSize: 13, marginTop: 1 }}>{t('cloakroom.retrieval')}</p>
                  </div>
                </div>

                <div
                  className="text-center"
                  style={{ background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))', border: '1px solid rgba(232,25,44,0.22)', borderRadius: 14, padding: 32 }}
                >
                  <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>{t('cloakroom.cloakroomNumber')}</p>
                  <p className="tabular-nums" style={{ color: RED, fontSize: 48, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1 }}>{scanResult.existingTransaction?.cloakroom_number}</p>
                </div>

                <div className="text-center tabular-nums" style={{ color: T3, fontSize: 13 }}>
                  {scanResult.existingTransaction?.items_count} {t('cloakroom.slots')}
                </div>

                <Button className="w-full h-12" size="lg" onClick={handleConfirmRetrieval}>
                  <Check className="h-5 w-5 mr-2" />
                  {t('cloakroom.validateRetrieval')}
                </Button>

                <Button variant="ghost" onClick={resetScan} className="w-full gap-2" style={{ color: T3 }}>
                  <ArrowLeft className="h-4 w-4" /> {t('cloakroom.newScan')}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </PublicPage>
    </div>
  );
}