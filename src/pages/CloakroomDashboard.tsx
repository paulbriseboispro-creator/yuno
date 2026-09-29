import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { retrySupabaseAction } from '@/utils/retryAction';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shirt, Check, CreditCard, ArrowLeft, Package, QrCode, Users, DollarSign, Camera, Plus, Clock, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import { useStaffNightPulse } from '@/hooks/useStaffNightPulse';
import { toast } from 'sonner';
import { Scanner } from '@yudiel/react-qr-scanner';
import { classifyCameraError } from '@/lib/cameraPermission';
import { CameraPermissionNotice } from '@/components/pro/CameraPermissionNotice';
import { LanguageSelector } from '@/components/LanguageSelector';
import { PublicPage } from '@/components/PublicPage';
import { StaffHeader } from '@/components/staff/StaffHeader';
import { StaffOnboardingGate } from '@/components/staff/StaffOnboardingGate';
import { StaffNightPanel } from '@/components/staff/StaffNightPanel';
import { readStaffSessionVenueId } from '@/components/RequireStaffSession';

import { useStaffIdentity } from '@/hooks/useStaffIdentity';
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

const LOCALE_TAG: Record<string, string> = { fr: 'fr-FR', es: 'es-ES', en: 'en-GB' };

type ScanMode = 'idle' | 'deposit_pay' | 'deposit_prepaid' | 'retrieve';

interface ScanResult {
  mode: ScanMode;
  customerName: string;
  ticketId: string | null;
  attendeeQr: string;
  /** Dépôt sans QR Yuno : le nom se saisit à la main. */
  manual?: boolean;
  existingTransaction?: { id: string; cloakroom_number: string; items_count: number; customer_name: string | null; ticket_id: string | null };
  prepaidUpsell?: { id: string; unit_price: number | string | null };
}

type DepositRow = {
  id: string;
  cloakroom_number: string;
  customer_name: string | null;
  deposited_at: string;
  items_count: number;
  price: number;
  attendee_qr: string | null;
  ticket_id: string | null;
};

type DepositReason = 'number_taken' | 'already_deposited' | 'prepaid_used' | 'no_event' | 'forbidden' | 'number_required';

// RPC vestiaire (migration 20260929235000) pas encore dans les types générés.
const untyped = supabase as unknown as SupabaseClient;

export default function CloakroomDashboard() {
  const { t, language } = useLanguage();
  const { venueId: staffVenueId, loading: venueLoading } = useStaffIdentity();
  const [scanning, setScanning] = useState(false);
  const [cameraIssue, setCameraIssue] = useState<'denied' | 'unavailable' | null>(null);
  const [scannerKey, setScannerKey] = useState(0);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [cloakroomNumber, setCloakroomNumber] = useState('');
  const [manualName, setManualName] = useState('');
  const [itemsCount, setItemsCount] = useState(1);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [cloakroomPrice, setCloakroomPrice] = useState(4);
  const [cashRevenue, setCashRevenue] = useState(0);
  const [prepaidRevenue, setPrepaidRevenue] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeDepositsList, setActiveDepositsList] = useState<DepositRow[]>([]);
  const [showActiveDeposits, setShowActiveDeposits] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [returningId, setReturningId] = useState<string | null>(null);

  // Verrous synchrones : deux frames caméra ou un double tap arrivent avant le
  // prochain rendu, un état React ne les arrête pas.
  const scanLockRef = useRef(false);
  const submitLockRef = useRef(false);
  // Identifiant du dépôt en cours, choisi à l'ouverture de la fiche : un renvoi
  // après une réponse perdue retombe sur la même ligne au lieu d'en créer une.
  const depositIdRef = useRef<string>(crypto.randomUUID());
  const refreshSeqRef = useRef(0);

  // La soirée de CE soir, résolue par le serveur (club hôte ou lead d'une
  // co-soirée) — la même que le panneau « Ce soir ». L'ancienne lecture
  // prenait la DERNIÈRE soirée active, souvent une date future : tous les
  // dépôts de la nuit étaient rangés sur une autre soirée.
  const { pulse } = useStaffNightPulse(venueId);
  const currentEventId = pulse?.event?.id ?? null;

  const money = useMemo(
    () => new Intl.NumberFormat(LOCALE_TAG[language] ?? 'fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }),
    [language],
  );

  useEffect(() => {
    // Repli sur la session PIN quand le profil n'est pas encore chargé.
    const vId = staffVenueId || readStaffSessionVenueId();
    if (!vId) return;
    setVenueId(vId);
    supabase
      .from('venues')
      .select('cloakroom_price')
      .eq('id', vId)
      .maybeSingle()
      .then(({ data: venue }) => {
        // 0 € = vestiaire gratuit, un vrai réglage (l'ancien test le prenait
        // pour « non renseigné » et facturait 4 €).
        if (venue && venue.cloakroom_price != null) setCloakroomPrice(Number(venue.cloakroom_price));
      });
  }, [staffVenueId]);

  // Une seule lecture pour la liste ET les compteurs : ils ne peuvent plus se
  // contredire. La plus récente gagne si deux lectures se croisent.
  const refresh = useCallback(async () => {
    if (!venueId || !currentEventId) {
      setActiveDepositsList([]);
      return;
    }
    const seq = ++refreshSeqRef.current;
    const [openQ, revQ] = await Promise.all([
      supabase
        .from('cloakroom_transactions')
        .select('id, cloakroom_number, customer_name, deposited_at, items_count, price, attendee_qr, ticket_id')
        .eq('venue_id', venueId)
        .eq('event_id', currentEventId)
        .eq('retrieved', false)
        .order('deposited_at', { ascending: false }),
      supabase
        .from('cloakroom_transactions')
        .select('price, paid_on_site, payment_confirmed')
        .eq('venue_id', venueId)
        .eq('event_id', currentEventId)
        .eq('payment_confirmed', true),
    ]);
    if (seq !== refreshSeqRef.current) return;
    if (!openQ.error) setActiveDepositsList((openQ.data || []) as DepositRow[]);
    if (!revQ.error) {
      const rows = revQ.data || [];
      // « À encaisser » = ce qui a été payé AU VESTIAIRE ; le prépayé en ligne
      // ne se retrouve pas dans la caisse.
      setCashRevenue(rows.filter(r => r.paid_on_site).reduce((sum, r) => sum + Number(r.price), 0));
      setPrepaidRevenue(rows.filter(r => !r.paid_on_site).reduce((sum, r) => sum + Number(r.price), 0));
    }
  }, [venueId, currentEventId]);

  // Partage entre téléphones : realtime + rattrapage à la (re)connexion, au
  // retour au premier plan, et un filet toutes les 30 s.
  const scanResultRef = useRef<ScanResult | null>(null);
  scanResultRef.current = scanResult;
  useEffect(() => {
    if (!venueId) return;
    refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refresh(), 400);
    };
    const channel = supabase
      .channel(uniqueChannel('cloakroom-realtime'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloakroom_transactions', filter: `venue_id=eq.${venueId}` },
        (payload) => {
          schedule();
          // La fiche ouverte vient d'être rendue par un collègue : on la ferme.
          const row = payload.new as { id?: string; retrieved?: boolean } | null;
          const open = scanResultRef.current;
          if (row?.retrieved && open?.mode === 'retrieve' && open.existingTransaction?.id === row.id) {
            toast.info(t('cloakroom.alreadyRetrieved'));
            setScanResult(null);
          }
        },
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') refresh();
      });
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(refresh, 30_000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [venueId, refresh, t]);

  const startScanning = () => {
    setScanResult(null);
    setCameraIssue(null);
    setScanning(true);
  };

  const openDeposit = (next: ScanResult) => {
    depositIdRef.current = crypto.randomUUID();
    setCloakroomNumber('');
    setItemsCount(1);
    setPaymentConfirmed(false);
    setScanResult(next);
  };

  const handleScan = useCallback(async (result: { rawValue?: string }[] | undefined) => {
    const qrCode = result?.[0]?.rawValue?.trim();
    if (!venueId || !qrCode || scanLockRef.current) return;
    scanLockRef.current = true;
    setProcessing(true);
    setScanning(false);

    try {
      // Dépôt ouvert pour ce QR ? (au plus un : index unique en base)
      const { data: existing, error: existingError } = await supabase
        .from('cloakroom_transactions')
        .select('*')
        .eq('venue_id', venueId)
        .eq('attendee_qr', qrCode)
        .eq('retrieved', false)
        .order('deposited_at', { ascending: false })
        .limit(1);
      if (existingError) throw existingError;
      const existingTx = existing?.[0];

      if (existingTx) {
        if (navigator.vibrate) navigator.vibrate(200);
        setScanResult({
          mode: 'retrieve',
          customerName: existingTx.customer_name || t('cloakroom.guestFallback'),
          ticketId: existingTx.ticket_id,
          attendeeQr: qrCode,
          existingTransaction: existingTx,
        });
        return;
      }

      if (!currentEventId) {
        toast.error(t('cloakroom.noEventTonight'));
        return;
      }

      // Qui porte ce QR, et pour quelle soirée : un billet d'un autre soir ou
      // remboursé n'ouvre pas le vestiaire (ni son option prépayée).
      let customerName = t('cloakroom.guestFallback');
      let ticketId: string | null = null;
      let valid = false;
      let otherNight = false;

      const { data: attendee } = await supabase
        .from('ticket_attendees')
        .select('full_name, ticket_id, tickets!inner(event_id, status)')
        .eq('qr_code', qrCode)
        .maybeSingle();
      if (attendee) {
        const tk = attendee.tickets as unknown as { event_id: string; status: string };
        customerName = attendee.full_name || customerName;
        ticketId = attendee.ticket_id;
        valid = tk.status === 'paid';
        otherNight = tk.event_id !== currentEventId;
      } else {
        const { data: ticket } = await supabase
          .from('tickets')
          .select('id, full_name, event_id, status')
          .eq('qr_code', qrCode)
          .maybeSingle();
        if (ticket) {
          customerName = ticket.full_name || customerName;
          ticketId = ticket.id;
          valid = ticket.status === 'paid';
          otherNight = ticket.event_id !== currentEventId;
        } else {
          const { data: guestEntry } = await supabase
            .from('guest_list_entries')
            .select('id, full_name, status, guest_lists!inner(event_id)')
            .eq('qr_code', qrCode)
            .maybeSingle();
          if (guestEntry) {
            customerName = guestEntry.full_name || customerName;
            valid = guestEntry.status !== 'cancelled';
            otherNight = (guestEntry.guest_lists as unknown as { event_id: string }).event_id !== currentEventId;
          }
        }
      }

      if (!valid) {
        toast.error(t('cloakroom.unrecognizedQR'));
        return;
      }
      if (otherNight) {
        toast.error(t('cloakroom.otherNight'));
        return;
      }

      if (navigator.vibrate) navigator.vibrate(200);

      if (ticketId) {
        const { data: prepaid } = await supabase
          .from('ticket_upsell_selections')
          .select('*')
          .eq('ticket_id', ticketId)
          .eq('offer_type', 'cloakroom')
          .eq('cloakroom_deposited', false)
          .limit(1);
        const prepaidUpsell = prepaid?.[0];
        openDeposit({
          mode: prepaidUpsell ? 'deposit_prepaid' : 'deposit_pay',
          customerName,
          ticketId,
          attendeeQr: qrCode,
          prepaidUpsell,
        });
      } else {
        openDeposit({ mode: 'deposit_pay', customerName, ticketId: null, attendeeQr: qrCode });
      }
    } catch (err) {
      console.error('Scan error:', err);
      toast.error(t('cloakroom.scanError'));
      setScanResult(null);
    } finally {
      setProcessing(false);
      scanLockRef.current = false;
    }
  }, [venueId, currentEventId, t]);

  /** Dépôt sans QR Yuno (billet papier, autre billetterie, entrée libre). */
  const startManualDeposit = () => {
    if (!currentEventId) {
      toast.error(t('cloakroom.noEventTonight'));
      return;
    }
    setScanning(false);
    setManualName('');
    openDeposit({ mode: 'deposit_pay', customerName: '', ticketId: null, attendeeQr: '', manual: true });
  };

  const resetScan = () => {
    setScanResult(null);
    setCloakroomNumber('');
    setManualName('');
    setItemsCount(1);
    setPaymentConfirmed(false);
    setScanning(false);
    setProcessing(false);
  };

  const depositErrorMessage = (reason: DepositReason | string | undefined) => {
    switch (reason) {
      case 'number_taken': return t('cloakroom.numberTaken').replace('{n}', cloakroomNumber.trim());
      case 'already_deposited': return t('cloakroom.alreadyDeposited');
      case 'prepaid_used': return t('cloakroom.prepaidUsed');
      case 'no_event': return t('cloakroom.noEventTonight');
      case 'number_required': return t('cloakroom.enterNumber');
      default: return t('cloakroom.saveError');
    }
  };

  const handleConfirmDeposit = async () => {
    if (!cloakroomNumber.trim() || !scanResult || !venueId) {
      toast.error(t('cloakroom.enterNumber'));
      return;
    }
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);

    const isPrepaid = scanResult.mode === 'deposit_prepaid';
    const name = scanResult.manual ? manualName.trim() : scanResult.customerName;
    try {
      const { data, error } = await retrySupabaseAction(async () => {
        const res = await untyped.rpc('cloakroom_deposit', {
          p_id: depositIdRef.current,
          p_venue_id: venueId,
          p_event_id: currentEventId,
          p_attendee_qr: scanResult.attendeeQr || null,
          p_ticket_id: scanResult.ticketId,
          p_customer_name: name || null,
          p_number: cloakroomNumber.trim(),
          p_items: itemsCount,
          p_prepaid_selection_id: isPrepaid ? scanResult.prepaidUpsell?.id ?? null : null,
          p_payment_confirmed: paymentConfirmed,
        });
        if (res.error) throw res.error;
        return res;
      });
      if (error) throw error;
      const outcome = data as { ok: boolean; reason?: string; number?: string } | null;
      if (!outcome?.ok) {
        toast.error(depositErrorMessage(outcome?.reason));
        if (outcome?.reason === 'already_deposited' || outcome?.reason === 'prepaid_used') resetScan();
        return;
      }
      toast.success(`${t('cloakroom.depositConfirmed')} — ${t('cloakroom.numberShort').replace('{n}', outcome.number ?? cloakroomNumber.trim())}`);
      refresh();
      resetScan();
    } catch (err) {
      console.error('Deposit error:', err);
      toast.error(t('cloakroom.saveError'));
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  /** Restitution, depuis un scan ou depuis la liste (téléphone du client mort). */
  const retrieve = async (txId: string): Promise<boolean> => {
    if (submitLockRef.current) return false;
    submitLockRef.current = true;
    setSubmitting(true);
    setReturningId(txId);
    try {
      const { data, error } = await retrySupabaseAction(async () => {
        const res = await untyped.rpc('cloakroom_retrieve', { p_tx: txId });
        if (res.error) throw res.error;
        return res;
      });
      if (error) throw error;
      const outcome = data as { ok: boolean; reason?: string; at?: string; mine?: boolean } | null;
      if (!outcome?.ok) {
        // Notre propre premier essai dont la réponse s'était perdue : c'est un succès.
        if (outcome?.reason === 'already_retrieved' && outcome.mine
            && outcome.at && Date.now() - new Date(outcome.at).getTime() < 60_000) {
          toast.success(t('cloakroom.retrievalDone'));
          refresh();
          return true;
        }
        toast.error(outcome?.reason === 'already_retrieved' && outcome.at
          ? t('cloakroom.alreadyRetrievedAt').replace('{time}', format(new Date(outcome.at), 'HH:mm'))
          : t('cloakroom.saveError'));
        refresh();
        return outcome?.reason === 'already_retrieved';
      }
      toast.success(t('cloakroom.retrievalDone'));
      refresh();
      return true;
    } catch (err) {
      console.error('Retrieval error:', err);
      toast.error(t('cloakroom.saveError'));
      return false;
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
      setReturningId(null);
    }
  };

  const handleConfirmRetrieval = async () => {
    if (!scanResult?.existingTransaction) return;
    if (await retrieve(scanResult.existingTransaction.id)) resetScan();
  };

  const handleListReturn = async (dep: DepositRow) => {
    const label = `${t('cloakroom.numberShort').replace('{n}', dep.cloakroom_number)}${dep.customer_name ? ` · ${dep.customer_name}` : ''}`;
    if (!window.confirm(t('cloakroom.confirmListReturn').replace('{label}', label))) return;
    await retrieve(dep.id);
  };

  const filteredDeposits = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return activeDepositsList;
    return activeDepositsList.filter(d =>
      d.cloakroom_number.toLowerCase().includes(q) || (d.customer_name || '').toLowerCase().includes(q));
  }, [activeDepositsList, listQuery]);

  const depositTotal = scanResult?.mode === 'deposit_prepaid'
    ? Number(scanResult.prepaidUpsell?.unit_price || 0) + cloakroomPrice * (itemsCount - 1)
    : cloakroomPrice * itemsCount;
  // Paiement sur place requis : tout dépôt payant, et les emplacements en plus
  // d'un prépayé.
  const needsPayment = scanResult?.mode === 'deposit_pay' ? cloakroomPrice > 0 : itemsCount > 1 && cloakroomPrice > 0;

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
      <StaffOnboardingGate />
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
        {/* Ce soir : consigne, dépôts/rendus, équipe, appels */}
        <StaffNightPanel role="cloakroom" />

        {/* Préposé sans club (invité par un organisateur) : le vestiaire
            Yuno est rattaché à un club — on le dit au lieu d'une page muette. */}
        {!venueId && !staffVenueId && (
          <div className="rounded-2xl px-4 py-3" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 13 }}>
            {t('cloakroom.noVenue')}
          </div>
        )}

        {venueId && pulse && !currentEventId && (
          <div className="rounded-2xl px-4 py-3" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 13 }}>
            {t('cloakroom.noEventTonight')}
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3">
          <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' }}>
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4" style={{ color: RED }} />
              <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('cloakroom.activeDeposits')}</span>
            </div>
            <div className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{activeDepositsList.length}</div>
          </div>
          <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' }}>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4" style={{ color: RED }} />
              <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('cloakroom.cashCollected')}</span>
            </div>
            <div className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{money.format(cashRevenue)}</div>
            {prepaidRevenue > 0 && (
              <div className="tabular-nums" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                {t('cloakroom.prepaidOnline').replace('{amount}', money.format(prepaidRevenue))}
              </div>
            )}
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
                refresh();
                setShowActiveDeposits(!showActiveDeposits);
              }}
            >
              {showActiveDeposits ? t('cloakroom.hide') : t('cloakroom.show')}
            </Button>
          </div>
          {showActiveDeposits && (
            <>
              {activeDepositsList.length > 6 && (
                <Input
                  value={listQuery}
                  onChange={e => setListQuery(e.target.value)}
                  placeholder={t('cloakroom.searchPlaceholder')}
                  className="mb-2 h-10"
                />
              )}
              {filteredDeposits.length === 0 ? (
                <p className="text-center py-4" style={{ color: T3, fontSize: 12 }}>{t('cloakroom.noActiveDeposits')}</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {filteredDeposits.map((dep) => (
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
                          <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{dep.customer_name || t('cloakroom.guestFallback')}</p>
                          <p className="flex items-center gap-1 truncate" style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                            <Clock className="h-3 w-3 flex-none" />
                            {format(new Date(dep.deposited_at), 'HH:mm')}
                            {dep.items_count > 1 && ` • ${dep.items_count} ${t('cloakroom.slots')}`}
                            {` • ${money.format(Number(dep.price))}`}
                          </p>
                        </div>
                      </div>
                      {/* Rendre sans scan : téléphone du client éteint, ticket
                          sur le téléphone d'un ami — le vêtement ne reste pas
                          « en dépôt » jusqu'au matin. */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 flex-none text-xs"
                        disabled={submitting}
                        onClick={() => handleListReturn(dep)}
                      >
                        {returningId === dep.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('cloakroom.returnShort')}
                      </Button>
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
              <div className="relative rounded-xl overflow-hidden bg-black" style={{ minHeight: '280px', border: '2px solid rgba(232,25,44,0.5)' }}>
                <Scanner
                  key={scannerKey}
                  onScan={handleScan}
                  onError={(err: unknown) => setCameraIssue(classifyCameraError(err) === 'denied' ? 'denied' : 'unavailable')}
                />
                {cameraIssue && (
                  <CameraPermissionNotice
                    className="absolute inset-0"
                    denied={cameraIssue === 'denied'}
                    onRetry={() => { setCameraIssue(null); setScannerKey((k) => k + 1); }}
                    title={t(cameraIssue === 'denied' ? 'camera.blockedTitle' : 'camera.unavailableTitle')}
                    body={t(cameraIssue === 'denied' ? 'camera.blockedBody' : 'camera.unavailableBody')}
                    openSettingsLabel={t('camera.openSettings')}
                    retryLabel={t('camera.retry')}
                    webHint={t('camera.webHint')}
                  />
                )}
              </div>
            ) : !scanResult ? (
              <>
                <Button onClick={startScanning} className="w-full h-12 text-sm gap-2" disabled={processing}>
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  {t('cloakroom.scanQR')}
                </Button>
                <Button variant="outline" onClick={startManualDeposit} className="w-full h-11 text-sm gap-2">
                  <Plus className="h-4 w-4" />
                  {t('cloakroom.manualDeposit')}
                </Button>
              </>
            ) : null}

            {scanning && (
              <Button variant="outline" onClick={() => { setScanning(false); setCameraIssue(null); }} className="w-full text-sm">
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
                    <h3 className="truncate" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>
                      {scanResult.manual ? t('cloakroom.manualDeposit') : scanResult.customerName}
                    </h3>
                    <p className="truncate" style={{ color: T3, fontSize: 13, marginTop: 1 }}>
                      {cloakroomPrice > 0 ? t('cloakroom.paymentRequired') : t('cloakroom.freeCloakroom')}
                    </p>
                  </div>
                </div>

                {scanResult.manual && (
                  <Input
                    value={manualName}
                    onChange={e => setManualName(e.target.value)}
                    placeholder={t('cloakroom.manualNamePlaceholder')}
                    className="h-11"
                  />
                )}

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
                    <span className="tabular-nums flex-none whitespace-nowrap" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>{money.format(depositTotal)}</span>
                  </div>
                </div>

                {needsPayment && !paymentConfirmed ? (
                  <Button className="w-full h-12 gap-2" onClick={() => setPaymentConfirmed(true)}>
                    <CreditCard className="h-5 w-5" />
                    {t('cloakroom.paymentValidated')}
                  </Button>
                ) : (
                  <>
                    {needsPayment && (
                      <div className="flex items-center gap-2" style={{ color: POS, fontSize: 13, fontWeight: 500 }}>
                        <Check className="h-4 w-4" /> {t('cloakroom.paymentConfirmed')}
                      </div>
                    )}
                    <div>
                      <Label style={{ color: T3, fontSize: 13 }}>{t('cloakroom.cloakroomNumber')}</Label>
                      <Input
                        value={cloakroomNumber}
                        onChange={e => setCloakroomNumber(e.target.value)}
                        placeholder={t('cloakroom.numberPlaceholder')}
                        className="text-center text-2xl font-bold h-14 mt-2 tabular-nums"
                        autoFocus
                      />
                    </div>
                    <Button className="w-full h-12" onClick={handleConfirmDeposit} disabled={!cloakroomNumber.trim() || submitting}>
                      {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : t('cloakroom.confirmDeposit')}
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
                    placeholder={t('cloakroom.numberPlaceholder')}
                    className="text-center text-2xl font-bold h-14 mt-2 tabular-nums"
                    autoFocus
                  />
                </div>

                {/* Emplacements en plus du prépayé : au tarif du club, payés ici. */}
                <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12 }}>
                  <p style={{ color: T3, fontSize: 12, marginBottom: 8 }}>{t('cloakroom.needExtra')}</p>
                  <div className="flex items-center gap-4">
                    <Button variant="outline" size="sm" className="h-11 w-11 flex-none" onClick={() => { setItemsCount(Math.max(1, itemsCount - 1)); setPaymentConfirmed(false); }}>-</Button>
                    <span className="w-8 text-center tabular-nums" style={{ color: T1, fontSize: 22, fontWeight: 640 }}>{itemsCount}</span>
                    <Button variant="outline" size="sm" className="h-11 w-11 flex-none" onClick={() => { setItemsCount(itemsCount + 1); setPaymentConfirmed(false); }}>+</Button>
                    {itemsCount > 1 && (
                      <span className="ml-auto tabular-nums" style={{ color: T1, fontSize: 15, fontWeight: 620 }}>
                        + {money.format(cloakroomPrice * (itemsCount - 1))}
                      </span>
                    )}
                  </div>
                </div>

                {needsPayment && !paymentConfirmed ? (
                  <Button className="w-full h-12 gap-2" onClick={() => setPaymentConfirmed(true)}>
                    <CreditCard className="h-5 w-5" />
                    {t('cloakroom.paymentValidated')}
                  </Button>
                ) : (
                  <Button className="w-full h-12" onClick={handleConfirmDeposit} disabled={!cloakroomNumber.trim() || submitting}>
                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : t('cloakroom.confirmPrepaid')}
                  </Button>
                )}

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

                <Button className="w-full h-12" size="lg" onClick={handleConfirmRetrieval} disabled={submitting}>
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5 mr-2" />{t('cloakroom.validateRetrieval')}</>}
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