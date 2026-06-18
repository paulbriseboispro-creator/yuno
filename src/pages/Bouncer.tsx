import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { retrySupabaseAction } from '@/utils/retryAction';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStaffVenue } from '@/hooks/useStaffVenue';
import { RoleIntroGate } from '@/components/onboarding/RoleIntroGate';
import { QrCode, CheckCircle, XCircle, User, Ticket, Wine, Camera, RefreshCw, Users, Ban, AlertTriangle, ArrowLeft, Clock, Search, ShieldAlert, UserX } from 'lucide-react';
import { nowInParis } from '@/lib/timezone';
import { Link } from 'react-router-dom';


import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TopClientDialog } from '@/components/bouncer/TopClientDialog';
import { ScanOverlay } from '@/components/bouncer/ScanOverlay';
import { calcStripeFee } from '@/utils/fees';

interface TopClientInfo {
  rank: number;
  firstName: string | null;
  lastName: string | null;
  totalSpent: number;
  ticketCount: number;
  orderCount: number;
  tableCount: number;
  tier: string;
  firstVisit: string | null;
  lastVisit: string | null;
  favoriteDrinkCategory: string | null;
}

interface ScannedTicket {
  id: string;
  userEmail: string;
  fullName?: string;
  quantity: number;
  eventTitle: string;
  roundName: string;
  status: string;
  entryScanned: boolean;
  entryScannedAt: string | null;
  includesDrink: boolean;
  alcoholFree: boolean;
  drinkRedeemed: boolean;
  drinkName: string | null;
  totalPrice?: number;
  serviceFee?: number;
  userId?: string;
  entryDeadline?: string;
}

interface ScannedVipReservation {
  id: string;
  userEmail: string;
  fullName: string;
  guestCount: number;
  eventTitle: string;
  zoneName: string;
  packName: string;
  status: string;
  deposit: number;
  totalPrice: number;
  entryScanned: boolean;
  entryScannedAt: string | null;
}

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const mainCard: React.CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  padding: 18,
  overflow: 'hidden',
  position: 'relative',
};

const REFUND_REASONS = {
  intoxication: { fr: 'Ivresse', en: 'Intoxication', es: 'Intoxicación' },
  behavior: { fr: 'Comportement inapproprié', en: 'Inappropriate behavior', es: 'Comportamiento inapropiado' },
  documents: { fr: 'Documents non valides', en: 'Invalid documents', es: 'Documentos no válidos' },
  minor: { fr: 'Mineur', en: 'Minor', es: 'Menor de edad' },
  dress_code: { fr: 'Dress code non respecté', en: 'Dress code violation', es: 'Incumplimiento del código de vestimenta' },
  capacity: { fr: 'Capacité maximale atteinte', en: 'Maximum capacity reached', es: 'Capacidad máxima alcanzada' },
  other: { fr: 'Autre', en: 'Other', es: 'Otro' },
};

export default function Bouncer() {
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const { venueId, loading: venueLoading } = useStaffVenue();
  
  const [activeTab, setActiveTab] = useState<'entry' | 'cancel' | 'client'>('entry');
  const [scanning, setScanning] = useState(false);
  const [scannedTicket, setScannedTicket] = useState<ScannedTicket | null>(null);
  const [scannedVipReservation, setScannedVipReservation] = useState<ScannedVipReservation | null>(null);
  const [scanResult, setScanResult] = useState<'success' | 'error' | 'already' | 'vip_success' | 'cancel_ready' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [stats, setStats] = useState({ scanned: 0, total: 0 });
  const [isRequestingCamera, setIsRequestingCamera] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  
  // New states for refund reason and ban
  const [refundReason, setRefundReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [banCustomer, setBanCustomer] = useState(false);
  
  // Top client detection
  const [showTopClientDialog, setShowTopClientDialog] = useState(false);
  const [topClientInfo, setTopClientInfo] = useState<TopClientInfo | null>(null);
  const [pendingTicketHolderName, setPendingTicketHolderName] = useState<string | undefined>(undefined);
  
  // Scan overlay
  const [overlayResult, setOverlayResult] = useState<'success' | 'error' | 'already' | 'vip_success' | null>(null);
  const [overlayName, setOverlayName] = useState<string | undefined>(undefined);
  
  // Cached top clients
  const [topClientsCache, setTopClientsCache] = useState<any[] | null>(null);
  const [topClientsCacheTime, setTopClientsCacheTime] = useState(0);

  // Free drink mode
  const [freeDrinkMode, setFreeDrinkMode] = useState<'credits' | 'bouncer_notify'>('credits');

  // Warn / flag a customer (warning incident, no ticket cancel)
  type FlagTarget = { userId?: string | null; email: string; name?: string };
  const [warnDialogOpen, setWarnDialogOpen] = useState(false);
  const [warnTarget, setWarnTarget] = useState<FlagTarget | null>(null);
  const [warnReason, setWarnReason] = useState('');
  const [warnCustom, setWarnCustom] = useState('');
  const [warnProcessing, setWarnProcessing] = useState(false);

  // Ban a customer by account/email from the client search panel
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [banTarget, setBanTarget] = useState<FlagTarget | null>(null);
  const [banReasonClient, setBanReasonClient] = useState('');
  const [banCustomReason, setBanCustomReason] = useState('');
  const [banProcessing, setBanProcessing] = useState(false);

  // Client search (warn/ban without scanning a ticket — walk-ins, known troublemakers)
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<Array<{ id: string; user_id: string | null; email: string; first_name: string | null; last_name: string | null; is_banned: boolean }>>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [clientSearched, setClientSearched] = useState(false);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => {
    if (venueId) {
      fetchStats();
      // Fetch free drink mode
      supabase.from('venues').select('free_drink_mode').eq('id', venueId).single().then(({ data }) => {
        if (data) setFreeDrinkMode((data as any).free_drink_mode || 'credits');
      });
    }
    
    return () => {
      stopScanning();
    };
  }, [venueId]);

  // Realtime subscription for live occupancy updates
  useEffect(() => {
    if (!venueId) return;

    const channelId = `bouncer-tickets-${venueId}-${Date.now()}`;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.entry_scanned) {
            // Debounce to avoid excessive refetches when multiple bouncers scan simultaneously
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => fetchStats(), 500);
          }
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [venueId]);

  const fetchStats = async () => {
    if (!venueId) return;
    
    try {
      const now = new Date().toISOString();
      
      // Only fetch currently active events (started and not ended)
      const { data: events } = await supabase
        .from('events')
        .select('id')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .lte('start_at', now)
        .gte('end_at', now);

      if (!events || events.length === 0) {
        // Fallback: fetch today's events if no active event right now
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { data: todayEvents } = await supabase
          .from('events')
          .select('id')
          .eq('venue_id', venueId)
          .gte('end_at', today.toISOString())
          .lte('start_at', new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString());
        
        if (!todayEvents || todayEvents.length === 0) {
          setStats({ scanned: 0, total: 0 });
          return;
        }
        
        const eventIds = todayEvents.map(e => e.id);
        const { data: tickets } = await supabase
          .from('tickets')
          .select('id, entry_scanned, quantity')
          .in('event_id', eventIds)
          .eq('status', 'paid');

        if (tickets) {
          const total = tickets.reduce((sum, t) => sum + t.quantity, 0);
          const scanned = tickets.filter(t => t.entry_scanned).reduce((sum, t) => sum + t.quantity, 0);
          setStats({ scanned, total });
        }
        return;
      }

      const eventIds = events.map(e => e.id);

      const { data: tickets } = await supabase
        .from('tickets')
        .select('id, entry_scanned, quantity')
        .in('event_id', eventIds)
        .eq('status', 'paid');

      if (tickets) {
        const total = tickets.reduce((sum, t) => sum + t.quantity, 0);
        const scanned = tickets.filter(t => t.entry_scanned).reduce((sum, t) => sum + t.quantity, 0);
        setStats({ scanned, total });
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  // Refresh top clients cache every 5 minutes
  const refreshTopClientsCache = async () => {
    if (!venueId) return;
    const now = Date.now();
    if (topClientsCache && now - topClientsCacheTime < 5 * 60 * 1000) return;
    
    const { data } = await supabase
      .from('venue_customers')
      .select('user_id, first_name, last_name, total_spent, ticket_count, order_count, table_count, first_visit_at, last_visit_at, favorite_drink_category')
      .eq('venue_id', venueId)
      .order('total_spent', { ascending: false })
      .limit(100);
    
    if (data) {
      setTopClientsCache(data);
      setTopClientsCacheTime(now);
    }
  };

  useEffect(() => {
    if (venueId) refreshTopClientsCache();
  }, [venueId]);

  // Check if a user is in the top 100 customers (using cache)
  const checkTopClient = async (userId: string | null | undefined): Promise<TopClientInfo | null> => {
    if (!userId || !venueId) return null;
    
    try {
      await refreshTopClientsCache();
      const topCustomers = topClientsCache;
      if (!topCustomers) return null;
      
      // Find if this user is in the top 100
      const customerIndex = topCustomers.findIndex(c => c.user_id === userId);
      if (customerIndex === -1) return null;
      
      const customer = topCustomers[customerIndex];
      const totalSpent = Number(customer.total_spent || 0);
      
      // Calculate tier
      let tier = 'bronze';
      if (totalSpent >= 1000) tier = 'platinum';
      else if (totalSpent >= 500) tier = 'gold';
      else if (totalSpent >= 200) tier = 'silver';
      
      return {
        rank: customerIndex + 1,
        firstName: customer.first_name,
        lastName: customer.last_name,
        totalSpent,
        ticketCount: customer.ticket_count || 0,
        orderCount: customer.order_count || 0,
        tableCount: customer.table_count || 0,
        tier,
        firstVisit: customer.first_visit_at,
        lastVisit: customer.last_visit_at,
        favoriteDrinkCategory: customer.favorite_drink_category,
      };
    } catch (error) {
      console.error('Error checking top client:', error);
      return null;
    }
  };

  const startScanning = async () => {
    setScanResult(null);
    setErrorMessage('');
    setIsRequestingCamera(true);
    setScanning(true);
    setIsRequestingCamera(false);
  };

  const stopScanning = async () => {
    setScanning(false);
  };

  const onScanSuccess = async (decodedText: string) => {
    await stopScanning();

    const qrCode = decodedText.trim();

    try {
      // First try to find a ticket_attendee with this qr_code (nominative tickets)
      const { data: attendee, error: attendeeError } = await supabase
        .from('ticket_attendees')
        .select(`
          id, full_name, qr_code, entry_scanned, entry_scanned_at, ticket_id,
          tickets!inner(
            id, user_email, full_name, quantity, status, user_id, total_price,
            drink_redeemed, drink_name, entry_scanned,
            events!inner(title, venue_id, alcohol_free),
            ticket_rounds!inner(name, includes_drink, entry_deadline)
          )
        `)
        .eq('qr_code', qrCode)
        .maybeSingle();

      if (attendee && !attendeeError) {
        const ticket = attendee.tickets as any;

        if (ticket.events.venue_id !== venueId) {
          setScanResult('error');
          setErrorMessage(t('bouncer.wrongVenue'));
          return;
        }

        // Cancel mode
        if (activeTab === 'cancel') {
          if (ticket.status !== 'paid') {
            setScanResult('error');
            setErrorMessage(t('bouncer.notPaidOrCancelled'));
            return;
          }
          if (ticket.entry_scanned) {
            setScanResult('error');
            setErrorMessage(t('bouncer.cannotCancelScanned'));
            return;
          }
          setRefundReason('');
          setCustomReason('');
          setBanCustomer(false);

          setScannedTicket({
            id: ticket.id,
            userEmail: ticket.user_email,
            fullName: attendee.full_name || ticket.full_name,
            quantity: ticket.quantity,
            eventTitle: ticket.events.title,
            roundName: ticket.ticket_rounds.name,
            status: ticket.status,
            entryScanned: false,
            entryScannedAt: null,
            includesDrink: ticket.ticket_rounds.includes_drink,
            alcoholFree: ticket.events.alcohol_free ?? false,
            drinkRedeemed: ticket.drink_redeemed,
            drinkName: ticket.drink_name,
            totalPrice: ticket.total_price,
            serviceFee: Number(ticket.service_fee) || 0,
            userId: ticket.user_id,
            entryDeadline: ticket.ticket_rounds.entry_deadline ? ticket.ticket_rounds.entry_deadline.substring(0, 5) : undefined,
          });
          setScanResult('cancel_ready');
          return;
        }

        // Normal entry mode - check attendee-level scan
        if (attendee.entry_scanned) {
          setScanResult('already');
          setScannedTicket({
            id: ticket.id,
            userEmail: ticket.user_email,
            fullName: attendee.full_name || ticket.full_name,
            quantity: ticket.quantity,
            eventTitle: ticket.events.title,
            roundName: ticket.ticket_rounds.name,
            status: ticket.status,
            entryScanned: true,
            entryScannedAt: attendee.entry_scanned_at,
            includesDrink: ticket.ticket_rounds.includes_drink,
            alcoholFree: ticket.events.alcohol_free ?? false,
            drinkRedeemed: ticket.drink_redeemed,
            drinkName: ticket.drink_name,
            entryDeadline: ticket.ticket_rounds.entry_deadline ? ticket.ticket_rounds.entry_deadline.substring(0, 5) : undefined,
          });
          return;
        }

        if (ticket.status !== 'paid') {
          setScanResult('error');
          setErrorMessage(t('bouncer.ticketNotPaid'));
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();

        // Mark the attendee as scanned (optimistic lock: only if not already scanned)
        const { data: updatedAttendee, error: updateAttendeeError } = await retrySupabaseAction(async () => {
          const res = await supabase
            .from('ticket_attendees')
            .update({
              entry_scanned: true,
              entry_scanned_at: new Date().toISOString(),
              entry_scanned_by: user?.id,
            })
            .eq('id', attendee.id)
            .eq('entry_scanned', false)
            .select();
          if (res.error) throw res.error;
          return res;
        });

        if (updateAttendeeError) {
          console.error('Failed to update attendee:', updateAttendeeError);
          throw updateAttendeeError;
        }
        if (!updatedAttendee || updatedAttendee.length === 0) {
          setScanResult('already');
          setOverlayResult('already');
          setOverlayName(attendee.full_name || ticket.full_name || undefined);
          return;
        }

        // Also mark the parent ticket as scanned (for stats/compatibility)
        await retrySupabaseAction(async () => {
          const res = await supabase
            .from('tickets')
            .update({
              entry_scanned: true,
              entry_scanned_at: new Date().toISOString(),
              entry_scanned_by: user?.id,
            })
            .eq('id', ticket.id)
            .eq('entry_scanned', false);
          if (res.error) throw res.error;
          return res;
        });

        // Fire-and-forget Top 100 VIP scan notification
        if (ticket.user_id && venueId) {
          supabase.functions.invoke('notify-top-customer-scan', {
            body: {
              venue_id: venueId,
              user_id: ticket.user_id,
              full_name: attendee.full_name || ticket.full_name,
              event_id: (ticket as any).events?.id ?? null,
            },
          }).catch((e) => console.warn('top-customer-scan notify failed', e));
        }

        setScanResult('success');
        setOverlayResult('success');
        setOverlayName(attendee.full_name || ticket.full_name || undefined);
        setScannedTicket({
          id: ticket.id,
          userEmail: ticket.user_email,
          fullName: attendee.full_name || ticket.full_name,
          quantity: ticket.quantity,
          eventTitle: ticket.events.title,
          roundName: ticket.ticket_rounds.name,
          status: ticket.status,
          entryScanned: true,
          entryScannedAt: new Date().toISOString(),
          includesDrink: ticket.ticket_rounds.includes_drink,
          alcoholFree: ticket.events.alcohol_free ?? false,
          drinkRedeemed: ticket.drink_redeemed,
          drinkName: ticket.drink_name,
          entryDeadline: ticket.ticket_rounds.entry_deadline ? ticket.ticket_rounds.entry_deadline.substring(0, 5) : undefined,
        });

        // Check if this is a top 100 client
        const topClient = await checkTopClient(ticket.user_id);
        if (topClient) {
          setTopClientInfo(topClient);
          setPendingTicketHolderName(attendee.full_name || ticket.full_name);
          setShowTopClientDialog(true);
        }

        fetchStats();
        return;
      }

      // Fallback: try to find a ticket with this qr_code (legacy / single tickets)
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select(`
          *,
          events!inner(title, venue_id, alcohol_free),
          ticket_rounds!inner(name, includes_drink, entry_deadline)
        `)
        .eq('qr_code', qrCode)
        .maybeSingle();

      if (ticket && !ticketError) {
        
        if (ticket.events.venue_id !== venueId) {
          setScanResult('error');
          setErrorMessage(t('bouncer.wrongVenue'));
          return;
        }

        // Cancel mode
        if (activeTab === 'cancel') {
          if (ticket.status !== 'paid') {
            setScanResult('error');
            setErrorMessage(t('bouncer.notPaidOrCancelled'));
            return;
          }
          if (ticket.entry_scanned) {
            setScanResult('error');
            setErrorMessage(t('bouncer.cannotCancelScanned'));
            return;
          }
          // Reset refund form
          setRefundReason('');
          setCustomReason('');
          setBanCustomer(false);
          
          setScannedTicket({
            id: ticket.id,
            userEmail: ticket.user_email,
            fullName: ticket.full_name,
            quantity: ticket.quantity,
            eventTitle: ticket.events.title,
            roundName: ticket.ticket_rounds.name,
            status: ticket.status,
            entryScanned: false,
            entryScannedAt: null,
            includesDrink: ticket.ticket_rounds.includes_drink,
            alcoholFree: ticket.events.alcohol_free ?? false,
            drinkRedeemed: ticket.drink_redeemed,
            drinkName: ticket.drink_name,
            totalPrice: ticket.total_price,
            serviceFee: Number(ticket.service_fee) || 0,
            userId: ticket.user_id,
            entryDeadline: ticket.ticket_rounds.entry_deadline ? ticket.ticket_rounds.entry_deadline.substring(0, 5) : undefined,
          });
          setScanResult('cancel_ready');
          return;
        }

        // Normal entry mode
        if (ticket.entry_scanned) {
          setScanResult('already');
          setScannedTicket({
            id: ticket.id,
            userEmail: ticket.user_email,
            fullName: ticket.full_name,
            quantity: ticket.quantity,
            eventTitle: ticket.events.title,
            roundName: ticket.ticket_rounds.name,
            status: ticket.status,
            entryScanned: true,
            entryScannedAt: ticket.entry_scanned_at,
            includesDrink: ticket.ticket_rounds.includes_drink,
            alcoholFree: ticket.events.alcohol_free ?? false,
            drinkRedeemed: ticket.drink_redeemed,
            drinkName: ticket.drink_name,
            entryDeadline: ticket.ticket_rounds.entry_deadline ? ticket.ticket_rounds.entry_deadline.substring(0, 5) : undefined,
          });
          return;
        }

        if (ticket.status !== 'paid') {
          setScanResult('error');
          setErrorMessage(t('bouncer.ticketNotPaid'));
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();

        const { data: updatedData, error: updateError } = await retrySupabaseAction(async () => {
          const res = await supabase
            .from('tickets')
            .update({
              entry_scanned: true,
              entry_scanned_at: new Date().toISOString(),
              entry_scanned_by: user?.id,
            })
            .eq('id', ticket.id)
            .eq('entry_scanned', false)
            .select();
          if (res.error) throw res.error;
          return res;
        });

        if (updateError) {
          console.error('Failed to update ticket:', updateError);
          throw updateError;
        }
        if (!updatedData || updatedData.length === 0) {
          setScanResult('already');
          setOverlayResult('already');
          setOverlayName(ticket.full_name || undefined);
          return;
        }

        setScanResult('success');
        setOverlayResult('success');
        setOverlayName(ticket.full_name || undefined);
        setScannedTicket({
          id: ticket.id,
          userEmail: ticket.user_email,
          fullName: ticket.full_name,
          quantity: ticket.quantity,
          eventTitle: ticket.events.title,
          roundName: ticket.ticket_rounds.name,
          status: ticket.status,
          entryScanned: true,
          entryScannedAt: new Date().toISOString(),
          includesDrink: ticket.ticket_rounds.includes_drink,
          alcoholFree: ticket.events.alcohol_free ?? false,
          drinkRedeemed: ticket.drink_redeemed,
          drinkName: ticket.drink_name,
          entryDeadline: ticket.ticket_rounds.entry_deadline ? ticket.ticket_rounds.entry_deadline.substring(0, 5) : undefined,
        });

        // Check if this is a top 100 client
        const topClient = await checkTopClient(ticket.user_id);
        if (topClient) {
          setTopClientInfo(topClient);
          setPendingTicketHolderName(ticket.full_name);
          setShowTopClientDialog(true);
        }

        // Fire-and-forget VIP scan push notification (Top 100)
        if (ticket.user_id && venueId) {
          supabase.functions.invoke('notify-top-customer-scan', {
            body: {
              venue_id: venueId,
              user_id: ticket.user_id,
              full_name: ticket.full_name,
              event_id: (ticket as any).event_id ?? null,
            },
          }).catch((e) => console.warn('top-customer-scan notify failed', e));
        }

        fetchStats();
        return;
      }

      // If no ticket, check for VIP reservation
      const { data: reservation, error: reservationError } = await supabase
        .from('table_reservations')
        .select(`
          *,
          events!inner(title, venue_id),
          table_zones(name),
          table_packs(name)
        `)
        .eq('qr_code', qrCode)
        .maybeSingle();

      if (reservation && !reservationError) {
        
        if (reservation.events.venue_id !== venueId) {
          setScanResult('error');
          setErrorMessage(t('bouncer.wrongVenue'));
          return;
        }

        if (reservation.status !== 'paid') {
          setScanResult('error');
          setErrorMessage(t('bouncer.ticketNotPaid'));
          return;
        }

        if (reservation.entry_scanned) {
          setScanResult('already');
          setScannedVipReservation({
            id: reservation.id,
            userEmail: reservation.user_email,
            fullName: reservation.full_name || '',
            guestCount: reservation.guest_count || 1,
            eventTitle: reservation.events.title,
            zoneName: (reservation.table_zones as any)?.name || '',
            packName: (reservation.table_packs as any)?.name || '',
            status: reservation.status,
            deposit: Number(reservation.deposit || 0),
            totalPrice: Number(reservation.total_price),
            entryScanned: true,
            entryScannedAt: reservation.entry_scanned_at,
          });
          return;
        }

        const { data: { user: currentUser } } = await supabase.auth.getUser();

        const checkInTime = new Date().toISOString();
        const { data: updatedRes, error: updateError } = await retrySupabaseAction(async () => {
          const res = await supabase
            .from('table_reservations')
            .update({
              entry_scanned: true,
              entry_scanned_at: checkInTime,
              entry_scanned_by: currentUser?.id,
              checked_in_at: checkInTime,
            })
            .eq('id', reservation.id)
            .eq('entry_scanned', false)
            .select();
          if (res.error) throw res.error;
          return res;
        });

        if (!updatedRes || updatedRes.length === 0) {
          setScanResult('already');
          return;
        }

        if (updateError) {
          console.error('Failed to update VIP reservation:', updateError);
        } else {
          // Send notification to VIP Host
          const zoneName = (reservation.table_zones as any)?.name || '';
          const packName = (reservation.table_packs as any)?.name || '';
          
          await supabase.from('staff_notifications').insert({
            venue_id: venueId,
            event_id: reservation.event_id,
            target_role: 'vip_host',
            notification_type: 'vip_entry',
            title: 'Arrivée VIP',
            message: `${reservation.full_name || 'VIP'} (${reservation.guest_count || 1} pers.) est arrivé - ${zoneName}`,
            reference_type: 'table_reservation',
            reference_id: reservation.id,
            priority: 'high',
            metadata: {
              guest_name: reservation.full_name,
              guest_count: reservation.guest_count || 1,
              zone_name: zoneName,
              pack_name: packName,
              deposit: Number(reservation.deposit || 0)
            }
          });
        }

        setScannedVipReservation({
          id: reservation.id,
          userEmail: reservation.user_email,
          fullName: reservation.full_name || '',
          guestCount: reservation.guest_count || 1,
          eventTitle: reservation.events.title,
          zoneName: (reservation.table_zones as any)?.name || '',
          packName: (reservation.table_packs as any)?.name || '',
          status: reservation.status,
          deposit: Number(reservation.deposit || 0),
          totalPrice: Number(reservation.total_price),
          entryScanned: true,
          entryScannedAt: new Date().toISOString(),
        });
        setScanResult('vip_success');
        setOverlayResult('vip_success');
        setOverlayName(reservation.full_name || undefined);
        
        // Check if this is a top 100 client for VIP reservations too
        const topClient = await checkTopClient(reservation.user_id);
        if (topClient) {
          setTopClientInfo(topClient);
          setPendingTicketHolderName(reservation.full_name);
          setShowTopClientDialog(true);
        }
        
        fetchStats();
        return;
      }

      // Check for Guest List entry (GL- prefix)
      if (qrCode.startsWith('GL-')) {
        const { data: glEntry, error: glError } = await supabase
          .from('guest_list_entries')
          .select(`
            *,
            guest_lists!inner(free_before_time, entry_deadline, includes_drink, venue_id, events!inner(title, venue_id, start_at))
          `)
          .eq('qr_code', qrCode)
          .maybeSingle();

        if (glEntry && !glError) {
          const glVenueId = (glEntry.guest_lists as any).venue_id;
          if (glVenueId !== venueId) {
            setScanResult('error');
            setErrorMessage(t('bouncer.wrongVenue'));
            return;
          }

          if (glEntry.entry_scanned) {
            setScanResult('already');
            setScannedTicket({
              id: glEntry.id,
              userEmail: glEntry.email,
              fullName: glEntry.full_name,
              quantity: 1,
              eventTitle: (glEntry.guest_lists as any).events.title,
              roundName: 'Guest List',
              status: 'paid',
              entryScanned: true,
              entryScannedAt: glEntry.entry_scanned_at,
              includesDrink: (glEntry.guest_lists as any).includes_drink,
              alcoholFree: false,
              drinkRedeemed: false,
              drinkName: null,
            });
            return;
          }

          if (glEntry.status === 'cancelled') {
            setScanResult('error');
            setErrorMessage(t('guestList.cancelled'));
            return;
          }

          // Check time deadline (use entry-level deadline first, then GL-level, then free_before_time)
          const entryDeadline = glEntry.entry_deadline || (glEntry.guest_lists as any).entry_deadline;
          const freeBeforeTime = (glEntry.guest_lists as any).free_before_time;
          const deadlineTime = entryDeadline || freeBeforeTime;
          const now = new Date();
          const [fbH, fbM] = deadlineTime.substring(0, 5).split(':').map(Number);
          const eventStart = new Date((glEntry.guest_lists as any).events.start_at);
          const deadline = new Date(eventStart);
          deadline.setHours(fbH, fbM, 0, 0);
          if (deadline < eventStart) deadline.setDate(deadline.getDate() + 1);

          if (now > deadline) {
            setScanResult('error');
            setErrorMessage(entryDeadline ? 'Heure limite d\'entrée dépassée' : t('guestList.timeExpired'));
            return;
          }

          // Mark as entered
          const { data: { user: glUser } } = await supabase.auth.getUser();
          await supabase
            .from('guest_list_entries')
            .update({
              entry_scanned: true,
              entry_scanned_at: new Date().toISOString(),
              entry_scanned_by: glUser?.id,
              status: 'entered',
            })
            .eq('id', glEntry.id);

          // Bouncer view: show entry type info
          const entryType = glEntry.entry_type || 'normal';
          const entryTypeLabel = entryType === 'table' ? 'Guest List VIP' : entryType === 'drink' ? 'Guest List + Boisson' : 'Guest List';
          const includesDrinkFromEntry = entryType === 'drink' || (glEntry.guest_lists as any).includes_drink;

        setScanResult('success');
        setOverlayResult('success');
        setOverlayName(glEntry.full_name || undefined);
        setScannedTicket({
            id: glEntry.id,
            userEmail: glEntry.email,
            fullName: glEntry.full_name,
            quantity: 1,
            eventTitle: (glEntry.guest_lists as any).events.title,
            roundName: entryTypeLabel,
            status: 'paid',
            entryScanned: true,
            entryScannedAt: new Date().toISOString(),
            includesDrink: includesDrinkFromEntry,
            alcoholFree: false,
            drinkRedeemed: false,
            drinkName: null,
          });
          fetchStats();
          return;
        }
      }

      // No ticket or reservation found
      setScanResult('error');
      setErrorMessage(t('bouncer.ticketNotFound'));
    } catch (error) {
      console.error('Error processing scan:', error);
      setScanResult('error');
      setErrorMessage(t('bouncer.scanError'));
    }
  };

  const resetScan = () => {
    setScannedTicket(null);
    setScannedVipReservation(null);
    setScanResult(null);
    setErrorMessage('');
    setRefundReason('');
    setCustomReason('');
    setBanCustomer(false);
    setTopClientInfo(null);
    setPendingTicketHolderName(undefined);
    setScanning(true);
  };

  const getRefundReasonLabel = (key: keyof typeof REFUND_REASONS) => {
    return REFUND_REASONS[key]?.[language] || REFUND_REASONS[key]?.en || key;
  };

  const getFinalReason = () => {
    if (refundReason === 'other') {
      return customReason || t('bouncer.otherReason');
    }
    return REFUND_REASONS[refundReason as keyof typeof REFUND_REASONS]?.[language] || refundReason;
  };

  const handleCancelTicket = async () => {
    if (!scannedTicket) return;
    
    const finalReason = getFinalReason();
    if (!finalReason) {
      toast({
        title: t('bouncer.reasonRequired'),
        description: t('bouncer.selectReasonDesc'),
        variant: 'destructive',
      });
      return;
    }
    
    setIsCancelling(true);
    try {
      // Get current user ID to pass as staffId fallback
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('staff-cancel', {
        body: { 
          type: 'ticket', 
          id: scannedTicket.id,
          reason: finalReason,
          banCustomer: banCustomer,
          staffId: user?.id, // Fallback for PIN-based auth
        }
      });

      if (error) throw error;

      let message = `${t('bouncer.refundAmount')} ${data.refundAmount.toFixed(2)}€ (${t('bouncer.fees')}: ${data.cancellationFee.toFixed(2)}€)`;
      if (data.customerBanned) {
        message += ` - ${t('bouncer.customerBanned')}`;
      }

      toast({
        title: t('bouncer.cancelledToast'),
        description: message,
      });
      
      setShowCancelConfirm(false);
      resetScan();
    } catch (error: any) {
      console.error('Error cancelling ticket:', error);
      toast({
        title: t('bouncer.cancelError'),
        description: error.message || t('bouncer.cancelError'),
        variant: 'destructive',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const reasonLabel = (key: string, custom: string) =>
    key === 'other'
      ? (custom.trim() || t('bouncer.otherReason'))
      : (REFUND_REASONS[key as keyof typeof REFUND_REASONS]?.[language] || REFUND_REASONS[key as keyof typeof REFUND_REASONS]?.en || key);

  const openWarn = (target: FlagTarget) => {
    setWarnTarget(target); setWarnReason(''); setWarnCustom(''); setWarnDialogOpen(true);
  };

  const submitWarn = async () => {
    if (!warnTarget || !venueId || !warnReason) return;
    setWarnProcessing(true);
    try {
      const { error } = await supabase.rpc('staff_warn_customer', {
        p_venue_id: venueId,
        p_user_id: warnTarget.userId ?? null,
        p_email: warnTarget.email,
        p_reason: reasonLabel(warnReason, warnCustom),
        p_details: null,
        p_first_name: null,
        p_last_name: null,
      });
      if (error) throw error;
      toast({ title: t('bouncer.warnIssued'), description: warnTarget.name || warnTarget.email });
      setWarnDialogOpen(false); setWarnTarget(null);
    } catch (err: any) {
      toast({ title: t('bouncer.warnError'), description: err.message, variant: 'destructive' });
    } finally {
      setWarnProcessing(false);
    }
  };

  const openBan = (target: FlagTarget) => {
    setBanTarget(target); setBanReasonClient(''); setBanCustomReason(''); setBanDialogOpen(true);
  };

  const submitBanClient = async () => {
    if (!banTarget || !venueId || !banReasonClient) return;
    setBanProcessing(true);
    try {
      const { error } = await supabase.rpc('staff_ban_customer', {
        p_venue_id: venueId,
        p_user_id: banTarget.userId ?? null,
        p_email: banTarget.email,
        p_reason: reasonLabel(banReasonClient, banCustomReason),
        p_first_name: null,
        p_last_name: null,
      });
      if (error) throw error;
      toast({ title: t('bouncer.banIssued'), description: banTarget.name || banTarget.email });
      setBanDialogOpen(false); setBanTarget(null);
      if (clientSearched) searchClients();
    } catch (err: any) {
      toast({ title: t('bouncer.banError'), description: err.message, variant: 'destructive' });
    } finally {
      setBanProcessing(false);
    }
  };

  const searchClients = async () => {
    if (!venueId || !clientQuery.trim()) return;
    setClientSearching(true); setClientSearched(false);
    try {
      const q = clientQuery.trim().toLowerCase().replace(/[%,]/g, '');
      const { data } = await supabase
        .from('venue_customers')
        .select('id, user_id, email, first_name, last_name, is_banned')
        .eq('venue_id', venueId)
        .or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .order('last_visit_at', { ascending: false })
        .limit(20);
      setClientResults(data || []);
    } catch {
      setClientResults([]);
    } finally {
      setClientSearching(false); setClientSearched(true);
    }
  };

  const queryLooksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientQuery.trim());

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
      <RoleIntroGate role="bouncer" />
      {/* Vignette ambiante */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
      />

      {/* Header */}
      <header
        className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ background: 'rgba(10,10,12,0.72)', borderBottom: `1px solid ${BORDER}`, paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <Link to="/profile">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-none"
              style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
            >
              <QrCode className="h-4 w-4" style={{ color: RED }} />
            </div>
            <h1 className="truncate" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('bouncer.scanner')}</h1>
          </div>
          <div className="flex items-center gap-1">
          </div>
        </div>
      </header>

      <div className="relative z-10 container mx-auto px-3 py-4 space-y-4">
        {/* Stats */}
        <div
          className="flex items-center justify-between"
          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' }}
        >
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5" style={{ color: RED }} />
            <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('bouncer.scannedToday')}</span>
          </div>
          <div className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{stats.scanned}</div>
        </div>

        {/* Scanner with Tabs */}
        <div style={mainCard}>
          <h3 className="flex items-center gap-2 mb-3" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
            <QrCode className="h-4 w-4" style={{ color: RED }} />
            Scanner
          </h3>
            {/* Mode Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'entry' | 'cancel' | 'client'); resetScan(); setScanning(false); }} className="mb-4">
              <TabsList className="owner-tabs grid w-full grid-cols-3">
                <TabsTrigger value="entry" className="gap-1.5 text-xs">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {t('bouncer.entry')}
                </TabsTrigger>
                <TabsTrigger value="cancel" className="gap-1.5 text-xs text-destructive data-[state=active]:text-destructive">
                  <Ban className="h-3.5 w-3.5" />
                  {t('bouncer.cancelTab')}
                </TabsTrigger>
                <TabsTrigger value="client" className="gap-1.5 text-xs">
                  <Search className="h-3.5 w-3.5" />
                  {t('bouncer.clientTab')}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {activeTab === 'client' && (
              <div className="space-y-4">
                <div className="flex items-start gap-2" style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 12, padding: 12 }}>
                  <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" style={{ color: '#60A5FA' }} />
                  <div>
                    <p style={{ color: '#93C5FD', fontSize: 14, fontWeight: 500 }}>{t('bouncer.clientMode')}</p>
                    <p style={{ color: T3, fontSize: 13 }}>{t('bouncer.clientModeDesc')}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: T3 }} />
                    <input
                      type="text"
                      value={clientQuery}
                      onChange={(e) => setClientQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') searchClients(); }}
                      placeholder={t('bouncer.clientSearchPlaceholder')}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[13px]"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                    />
                  </div>
                  <Button onClick={searchClients} disabled={clientSearching || !clientQuery.trim()}>
                    {clientSearching ? '...' : t('bouncer.search')}
                  </Button>
                </div>

                {clientSearched && clientResults.length === 0 && (
                  <div className="text-center py-8 space-y-3">
                    <p style={{ color: T3, fontSize: 13 }}>{t('bouncer.clientNoResults')}</p>
                    {queryLooksLikeEmail && (
                      <Button
                        variant="destructive"
                        onClick={() => openBan({ email: clientQuery.trim().toLowerCase() })}
                      >
                        <UserX className="h-4 w-4 mr-2" />
                        {t('bouncer.banThisEmail')}
                      </Button>
                    )}
                  </div>
                )}

                {clientResults.map((c) => {
                  const cName = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
                  return (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{cName}</span>
                          {c.is_banned && (
                            <span style={{ background: 'rgba(232,25,44,0.12)', color: RED, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999 }}>
                              {t('bouncer.bannedBadge')}
                            </span>
                          )}
                        </div>
                        <p className="truncate" style={{ color: T3, fontSize: 12 }}>{c.email}</p>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0"
                        onClick={() => openWarn({ userId: c.user_id, email: c.email, name: cName })}>
                        <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />{t('bouncer.warn')}
                      </Button>
                      {!c.is_banned && (
                        <Button variant="destructive" size="sm" className="shrink-0"
                          onClick={() => openBan({ userId: c.user_id, email: c.email, name: cName })}>
                          <Ban className="h-3.5 w-3.5 mr-1.5" />{t('bouncer.ban')}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'cancel' && !scanResult && (
              <div className="mb-4" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', borderRadius: 12, padding: 12 }}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: RED }} />
                  <div>
                    <p style={{ color: RED, fontSize: 14, fontWeight: 500 }}>{t('bouncer.cancelMode')}</p>
                    <p style={{ color: T3, fontSize: 13 }}>
                      {t('bouncer.cancelModeDesc')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* QR Scanner — hidden in client search mode */}
            {activeTab !== 'client' && (<>
            <div className="mb-4 space-y-4">
              {scanning && (
                <div className={`rounded-lg overflow-hidden border-2 bg-black ${activeTab === 'cancel' ? 'border-destructive/50' : 'border-primary/50'}`} style={{ minHeight: '300px' }}>
                  <Scanner
                    onScan={(result) => {
                      if (!result) return;

                      let value: string | undefined;
                      if (typeof result === 'string') {
                        value = result;
                      } else if (Array.isArray(result) && result[0]) {
                        value = (result[0] as any).rawValue ?? String(result[0]);
                      } else if (typeof (result as any).rawValue === 'string') {
                        value = (result as any).rawValue;
                      }

                      if (value) {
                        onScanSuccess(value);
                      }
                    }}
                    onError={(error) => {
                      console.error('Scanner error', error);
                    }}
                    formats={['qr_code']}
                    scanDelay={50}
                    styles={{
                      container: { width: '100%', height: '100%' },
                      video: { width: '100%', height: '100%', objectFit: 'cover' },
                    }}
                    components={{
                      tracker: undefined,
                    }}
                    constraints={{
                      facingMode: 'environment',
                      width: { ideal: 1280 },
                      height: { ideal: 720 },
                    }}
                  />
                </div>
              )}

              {!scanResult && (
                scanning ? (
                  <Button onClick={stopScanning} variant="outline" className="w-full">
                    {t('bouncer.stopScanning')}
                  </Button>
                ) : (
                  <Button
                    onClick={startScanning}
                    className="w-full"
                    size="lg"
                    disabled={isRequestingCamera}
                    variant={activeTab === 'cancel' ? 'destructive' : 'default'}
                  >
                    {isRequestingCamera ? (
                      <>
                        <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        {t('bouncer.requestingCamera')}
                      </>
                    ) : (
                      <>
                        <Camera className="mr-2 h-5 w-5" />
                        {activeTab === 'cancel' ? t('bouncer.scanToCancel') : t('bouncer.startScanning')}
                      </>
                    )}
                  </Button>
                )
              )}
            </div>

            <AnimatePresence mode="wait">
              {scanResult && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="space-y-4"
                >
                  {/* Result Banner */}
                  <div className={`p-6 rounded-lg text-center ${
                    scanResult === 'success' || scanResult === 'vip_success'
                      ? 'bg-green-500/20 border border-green-500' 
                      : scanResult === 'already'
                      ? 'bg-yellow-500/20 border border-yellow-500'
                      : scanResult === 'cancel_ready'
                      ? 'bg-orange-500/20 border border-orange-500'
                      : 'bg-red-500/20 border border-red-500'
                  }`}>
                    {scanResult === 'success' && (
                      <>
                        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-3" />
                        <h3 className="text-xl font-bold text-green-500">{t('bouncer.entryApproved')}</h3>
                      </>
                    )}
                    {scanResult === 'vip_success' && (
                      <>
                        <CheckCircle className="h-16 w-16 text-amber-500 mx-auto mb-3" />
                        <h3 className="text-xl font-bold text-amber-500">VIP - {t('bouncer.entryApproved')}</h3>
                      </>
                    )}
                    {scanResult === 'already' && (
                      <>
                        <XCircle className="h-16 w-16 text-yellow-500 mx-auto mb-3" />
                        <h3 className="text-xl font-bold text-yellow-500">{t('bouncer.alreadyScanned')}</h3>
                      </>
                    )}
                    {scanResult === 'cancel_ready' && (
                      <>
                        <Ban className="h-16 w-16 text-orange-500 mx-auto mb-3" />
                        <h3 className="text-xl font-bold text-orange-500">{t('bouncer.readyToCancel')}</h3>
                        <p className="text-sm text-orange-400 mt-2">
                          {t('bouncer.refund90')}
                        </p>
                      </>
                    )}
                    {scanResult === 'error' && (
                      <>
                        <XCircle className="h-16 w-16 text-red-500 mx-auto mb-3" />
                        <h3 className="text-xl font-bold text-red-500">{t('bouncer.entryDenied')}</h3>
                        <p className="text-sm text-red-400 mt-2">{errorMessage}</p>
                      </>
                    )}
                  </div>

                  {/* Ticket Details */}
                  {scannedTicket && (
                    <div style={mainCard} className="space-y-3">
                        {/* Entry deadline alert */}
                        {scannedTicket.entryDeadline && (() => {
                          const now = nowInParis();
                          const [dH, dM] = scannedTicket.entryDeadline!.split(':').map(Number);
                          const currentMinutes = now.getHours() * 60 + now.getMinutes();
                          let deadlineMinutes = dH * 60 + dM;
                          // Handle after-midnight deadlines (e.g., 02:00 means next day if event starts evening)
                          const isPastDeadline = deadlineMinutes < 6 * 60
                            ? (currentMinutes >= 6 * 60 ? false : currentMinutes > deadlineMinutes)
                            : currentMinutes > deadlineMinutes;
                          
                          const lateMinutes = (() => {
                            let diff = currentMinutes - deadlineMinutes;
                            if (diff < 0) diff += 24 * 60; // crossed midnight
                            return diff;
                          })();
                          const lateH = Math.floor(lateMinutes / 60);
                          const lateM = lateMinutes % 60;
                          const lateLabel = lateH > 0 ? `${lateH}h${lateM.toString().padStart(2, '0')}` : `${lateM} min`;

                          return isPastDeadline ? (
                            <div className="space-y-3">
                              <div className="p-4 rounded-lg bg-orange-500/15 border border-orange-500/40">
                                <div className="flex items-center gap-3">
                                  <AlertTriangle className="h-7 w-7 text-orange-500 shrink-0" />
                                  <div className="flex-1">
                          <p className="font-bold text-orange-500">{t('bouncer.outOfSlot')}</p>
                                    <p className="text-xs text-orange-400">
                                      {t('tickets.entryBefore')} {scannedTicket.entryDeadline}
                                    </p>
                                    <p className="text-sm font-semibold text-orange-500 mt-1">
                                      +{lateLabel} {t('bouncer.late')}
                                    </p>
                                  </div>
                                </div>
                                  </div>
                              {scanResult === 'success' && (
                                <div className="space-y-3">
                                  <div className="grid grid-cols-2 gap-3">
                                    <Button
                                      variant="destructive"
                                      disabled={isCancelling}
                                      onClick={async () => {
                                        // Auto-refund at 90% for late arrival
                                        setIsCancelling(true);
                                        try {
                                          const { data: { user: staffUser } } = await supabase.auth.getUser();
                                          const { data, error } = await supabase.functions.invoke('staff-cancel', {
                                            body: {
                                              type: 'ticket',
                                              id: scannedTicket.id,
                                              reason: `Arrivée hors créneau (+${lateLabel})`,
                                              banCustomer: false,
                                              staffId: staffUser?.id,
                                            }
                                          });
                                          if (error) throw error;
                                          toast({
                                            title: t('bouncer.entryDenied'),
                                            description: `${scannedTicket.fullName || scannedTicket.userEmail} — ${t('bouncer.refundAmount')} ${data.refundAmount?.toFixed(2)}€`,
                                            variant: 'destructive',
                                          });
                                          resetScan();
                                          setScanning(false);
                                        } catch (err: any) {
                                          toast({ title: t('bouncer.cancelError'), description: err.message, variant: 'destructive' });
                                        } finally {
                                          setIsCancelling(false);
                                        }
                                      }}
                                    >
                                      <XCircle className="h-4 w-4 mr-2" />
                                      {isCancelling ? '...' : `${t('bouncer.deny')} + ${t('bouncer.refund90')}`}
                                    </Button>
                                    <Button
                                      className="bg-green-600 hover:bg-green-700 text-white"
                                      onClick={() => {
                                        toast({
                                          title: t('bouncer.entryApproved'),
                                          description: `${scannedTicket.fullName || scannedTicket.userEmail} — ${t('bouncer.despiteLate')} ${lateLabel}`,
                                        });
                                      }}
                                    >
                                      <CheckCircle className="h-4 w-4 mr-2" />
                                      {t('bouncer.accept')}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-3 rounded-lg flex items-center gap-3" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
                              <Clock className="h-5 w-5 shrink-0" style={{ color: POS }} />
                              <p className="text-sm flex items-center gap-1" style={{ color: POS }}>
                                {t('tickets.entryBefore')} {scannedTicket.entryDeadline}
                                <CheckCircle className="h-3.5 w-3.5" />
                              </p>
                            </div>
                          );
                        })()}

                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" style={{ color: T3 }} />
                          <div>
                            {scannedTicket.fullName && (
                              <span className="block" style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{scannedTicket.fullName}</span>
                            )}
                            <span style={{ color: T3, fontSize: 13 }}>{scannedTicket.userEmail}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <span style={{ color: T3, fontSize: 13 }}>{t('bouncer.event')}</span>
                          <span style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{scannedTicket.eventTitle}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span style={{ color: T3, fontSize: 13 }}>{t('bouncer.ticketType')}</span>
                          <span style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999 }}>{scannedTicket.roundName}</span>
                        </div>

                        {scannedTicket.alcoholFree && (
                          <div className="p-4 rounded-lg" style={{ background: 'rgba(245,158,11,0.15)', border: '2px solid rgba(245,158,11,0.55)' }}>
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full flex-none" style={{ background: 'rgba(245,158,11,0.22)' }}>
                                <AlertTriangle className="h-6 w-6" style={{ color: '#F59E0B' }} />
                              </div>
                              <div className="flex-1">
                                <p className="font-bold text-base" style={{ color: '#F59E0B' }}>{t('bouncer.minorNoAlcohol')}</p>
                                <p style={{ color: T2, fontSize: 13 }}>{t('bouncer.minorNoAlcoholDesc')}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {scannedTicket.entryDeadline && (
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5" style={{ color: T3, fontSize: 13 }}>
                              <Clock className="h-3.5 w-3.5" />
                              {t('tickets.entryDeadline')}
                            </span>
                            <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{scannedTicket.entryDeadline}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span style={{ color: T3, fontSize: 13 }}>{t('bouncer.quantity')}</span>
                          <span className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 700 }}>{scannedTicket.quantity}x</span>
                        </div>

                        {scannedTicket.entryScannedAt && scanResult === 'already' && (
                          <div className="flex items-center justify-between" style={{ color: '#FCD34D' }}>
                            <span style={{ fontSize: 13 }}>{t('bouncer.scannedAt')}</span>
                            <span className="tabular-nums" style={{ fontSize: 13 }}>
                              {format(new Date(scannedTicket.entryScannedAt), 'HH:mm', { locale: dateLocale })}
                            </span>
                          </div>
                        )}

                        {scannedTicket.includesDrink && (
                          <div className="pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                            {freeDrinkMode === 'bouncer_notify' ? (
                              <div className="p-4 rounded-lg bg-green-500/15 border-2 border-green-500/50">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20">
                                    <Wine className="h-6 w-6 text-green-500" />
                                  </div>
                                  <div className="flex-1">
                                    <p className="font-bold text-green-500 text-base">{t('bouncer.giveDrink')}</p>
                                    <p className="text-xs text-green-400 mt-0.5">
                                      {scannedTicket.quantity}x — {t('bouncer.giveDrinkDesc')}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <Wine className="h-4 w-4" style={{ color: RED }} />
                                <span style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{t('bouncer.freeDrinkIncluded')}</span>
                                {scannedTicket.drinkRedeemed ? (
                                  <span className="ml-2" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999 }}>
                                    {t('bouncer.drinkRedeemed')}
                                  </span>
                                ) : (
                                  <span className="ml-2" style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999 }}>
                                    {t('bouncer.drinkPending')}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Warn this customer (no ticket cancel) — entry context only */}
                        {(scanResult === 'success' || scanResult === 'already') && (
                          <button
                            onClick={() => openWarn({ userId: scannedTicket.userId, email: scannedTicket.userEmail, name: scannedTicket.fullName })}
                            className="w-full mt-1 py-2.5 rounded-xl text-[13px] font-medium flex items-center justify-center gap-2"
                            style={{ background: 'rgba(252,211,77,0.08)', border: '1px solid rgba(252,211,77,0.25)', color: '#FCD34D' }}
                          >
                            <AlertTriangle className="h-4 w-4" />
                            {t('bouncer.warnThisCustomer')}
                          </button>
                        )}
                    </div>
                  )}

                  {/* VIP Reservation Details */}
                  {scannedVipReservation && (
                    <div style={{ ...mainCard, borderLeft: '4px solid #FCD34D' }} className="space-y-3">
                        <span className="inline-block" style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', color: '#FCD34D', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>VIP</span>

                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" style={{ color: T3 }} />
                          <span style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{scannedVipReservation.fullName}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span style={{ color: T3, fontSize: 12 }}>{scannedVipReservation.userEmail}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span style={{ color: T3, fontSize: 13 }}>{t('bouncer.event')}</span>
                          <span style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{scannedVipReservation.eventTitle}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span style={{ color: T3, fontSize: 13 }}>Zone</span>
                          <span style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)', color: '#FCD34D', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999 }}>{scannedVipReservation.zoneName}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span style={{ color: T3, fontSize: 13 }}>Pack</span>
                          <span style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999 }}>{scannedVipReservation.packName}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span style={{ color: T3, fontSize: 13 }}>{t('vipTable.guests')}</span>
                          <div className="flex items-center gap-1 tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 700 }}>
                            <Users className="h-4 w-4" />
                            {scannedVipReservation.guestCount}
                          </div>
                        </div>

                        <div className="pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                          <div className="flex items-center justify-between">
                            <span style={{ color: T3, fontSize: 13 }}>{t('tickets.remainingOnSite')}</span>
                            <span className="tabular-nums" style={{ color: '#FCD34D', fontSize: 18, fontWeight: 700 }}>
                              {(scannedVipReservation.totalPrice - scannedVipReservation.deposit).toFixed(2)}€
                            </span>
                          </div>
                        </div>
                    </div>
                  )}

                  {/* Cancellation Action Buttons */}
                  {scanResult === 'cancel_ready' && scannedTicket ? (
                    <div className="space-y-4">
                      {/* Price breakdown */}
                       {(() => {
                        const total = scannedTicket.totalPrice || 0;
                        const yunoFee = scannedTicket.serviceFee || 0;
                        const stripeFee = calcStripeFee(total);
                        const netRefund = Math.max(0, Math.round((total - yunoFee - stripeFee) * 100) / 100);
                        return (
                          <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12 }}>
                            <div className="flex items-center justify-between mb-2">
                              <span style={{ color: T3, fontSize: 13 }}>{t('bouncer.originalPrice')}</span>
                              <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 500 }}>{total.toFixed(2)}€</span>
                            </div>
                            <div className="flex items-center justify-between mb-2">
                              <span style={{ color: T3, fontSize: 13 }}>Frais de service Yuno</span>
                              <span className="tabular-nums" style={{ color: RED, fontSize: 14, fontWeight: 500 }}>-{yunoFee.toFixed(2)}€</span>
                            </div>
                            <div className="flex items-center justify-between mb-2">
                              <span style={{ color: T3, fontSize: 13 }}>Frais Stripe</span>
                              <span className="tabular-nums" style={{ color: RED, fontSize: 14, fontWeight: 500 }}>-{stripeFee.toFixed(2)}€</span>
                            </div>
                            <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                              <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{t('bouncer.customerRefund')}</span>
                              <span className="tabular-nums" style={{ color: POS, fontSize: 14, fontWeight: 700 }}>{netRefund.toFixed(2)}€</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Reason selection */}
                      <div className="space-y-3">
                        <Label style={{ color: T1, fontSize: 13, fontWeight: 500 }}>
                          {t('bouncer.refusalReason')} *
                        </Label>
                        <Select value={refundReason} onValueChange={setRefundReason}>
                          <SelectTrigger>
                            <SelectValue placeholder={t('bouncer.selectReason')} />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(REFUND_REASONS).map(([key, labels]) => (
                              <SelectItem key={key} value={key}>
                                {labels[language] || labels.en}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        
                        {refundReason === 'other' && (
                          <Textarea
                            placeholder={t('bouncer.specifyReason')}
                            value={customReason}
                            onChange={(e) => setCustomReason(e.target.value)}
                            className="mt-2"
                          />
                        )}
                      </div>

                      {/* Ban checkbox */}
                      <div className="flex items-start space-x-3" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', borderRadius: 12, padding: 12 }}>
                        <Checkbox
                          id="ban-customer"
                          checked={banCustomer}
                          onCheckedChange={(checked) => setBanCustomer(checked as boolean)}
                        />
                        <div className="space-y-1">
                          <Label htmlFor="ban-customer" className="cursor-pointer" style={{ color: RED, fontSize: 13, fontWeight: 500 }}>
                            {t('bouncer.banCustomer')}
                          </Label>
                          <p style={{ color: T3, fontSize: 12 }}>
                            {t('bouncer.banDesc')}
                          </p>
                        </div>
                      </div>

                      <Button 
                        variant="destructive" 
                        className="w-full" 
                        size="lg"
                        onClick={() => setShowCancelConfirm(true)}
                        disabled={!refundReason || (refundReason === 'other' && !customReason)}
                      >
                        <Ban className="mr-2 h-5 w-5" />
                        {banCustomer ? t('bouncer.cancelAndBan') : t('bouncer.confirmCancellation')}
                      </Button>
                      <Button onClick={resetScan} variant="outline" className="w-full">
                        {t('bouncer.back')}
                      </Button>
                    </div>
                  ) : (
                    <Button onClick={resetScan} className="w-full" size="lg">
                      <RefreshCw className="mr-2 h-5 w-5" />
                      {t('bouncer.scanNext')}
                    </Button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            </>)}
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {banCustomer ? t('bouncer.confirmCancelBanTitle') : t('bouncer.confirmCancelTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {t('bouncer.confirmCancelDesc')}
              </p>
              <p className="font-medium">
                {t('bouncer.reason')}: {getFinalReason()}
              </p>
              {banCustomer && (
                <p className="text-destructive font-medium">
                  {t('bouncer.banWarning')}
                </p>
              )}
              <p className="text-sm text-muted-foreground">{t('bouncer.irreversible')}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>{t('bouncer.back')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelTicket}
              disabled={isCancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isCancelling ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t('bouncer.cancelling')}
                </>
              ) : (
                banCustomer ? t('bouncer.cancelAndBan') : t('bouncer.confirmCancellation')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Warn Customer Dialog */}
      <AlertDialog open={warnDialogOpen} onOpenChange={setWarnDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" style={{ color: '#FCD34D' }} />
              {t('bouncer.warnCustomer')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {warnTarget?.name || warnTarget?.email} — {t('bouncer.warnDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Select value={warnReason} onValueChange={setWarnReason}>
              <SelectTrigger><SelectValue placeholder={t('bouncer.selectReason')} /></SelectTrigger>
              <SelectContent>
                {Object.entries(REFUND_REASONS).filter(([k]) => k !== 'capacity').map(([key, labels]) => (
                  <SelectItem key={key} value={key}>{labels[language] || labels.en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {warnReason === 'other' && (
              <Textarea placeholder={t('bouncer.specifyReason')} value={warnCustom} onChange={(e) => setWarnCustom(e.target.value)} />
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={warnProcessing}>{t('bouncer.back')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); submitWarn(); }}
              disabled={warnProcessing || !warnReason || (warnReason === 'other' && !warnCustom.trim())}
              style={{ background: '#D4A017', color: '#000' }}
            >
              {warnProcessing ? '...' : t('bouncer.confirmWarn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Ban Customer Dialog (from client search) */}
      <AlertDialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              {t('bouncer.banCustomerTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {banTarget?.name || banTarget?.email} — {t('bouncer.banDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Select value={banReasonClient} onValueChange={setBanReasonClient}>
              <SelectTrigger><SelectValue placeholder={t('bouncer.selectReason')} /></SelectTrigger>
              <SelectContent>
                {Object.entries(REFUND_REASONS).filter(([k]) => k !== 'capacity').map(([key, labels]) => (
                  <SelectItem key={key} value={key}>{labels[language] || labels.en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {banReasonClient === 'other' && (
              <Textarea placeholder={t('bouncer.specifyReason')} value={banCustomReason} onChange={(e) => setBanCustomReason(e.target.value)} />
            )}
            <p className="text-destructive text-sm">{t('bouncer.banWarning')}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={banProcessing}>{t('bouncer.back')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); submitBanClient(); }}
              disabled={banProcessing || !banReasonClient || (banReasonClient === 'other' && !banCustomReason.trim())}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {banProcessing ? '...' : t('bouncer.confirmBan')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Top Client Dialog */}
      <TopClientDialog
        open={showTopClientDialog}
        onClose={() => setShowTopClientDialog(false)}
        clientInfo={topClientInfo}
        ticketHolderName={pendingTicketHolderName}
      />

      {/* Full-screen scan overlay */}
      <ScanOverlay
        result={overlayResult}
        onDismiss={() => setOverlayResult(null)}
        holderName={overlayName}
      />
    </div>
  );
}
