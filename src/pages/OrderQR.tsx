import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { haptics } from '@/lib/haptics';
import QRCode from 'qrcode';
import { Copy, CheckCircle, Clock, Home } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/store/useStore';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { nowInParis, toParisTime } from '@/lib/timezone';
import { OrderQROverlay } from '@/components/orders/TemporalOrders';

/* Palette éditoriale publique — alignée sur TemporalOrders / DrinkOrderDetailModal. */
const RED = '#E8192C';
const CARD = '#141414';
const BORDER_STRONG = 'rgba(255,255,255,0.14)';
const G1 = '#E5E5E5';
const G2 = '#9A9A9A';
const G3 = '#5A5A5E';
const RED_TINT = 'rgba(232,25,44,0.06)';
const RED_SOFT = 'rgba(232,25,44,0.18)';

export default function OrderQR() {
  const { orderId: pathOrderId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
  const orderId = pathOrderId || searchParams.get('orderId');
  const sessionId = searchParams.get('session_id');
  const clearCart = useStore((state) => state.clearCart);

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(!!sessionId);
  const [clickCollectMode, setClickCollectMode] = useState(false);
  const [requestingPrep, setRequestingPrep] = useState(false);

  // Check if event has started (allow 5 min before) – using venue timezone
  const eventHasStarted = (() => {
    const startAt = order?.events?.start_at;
    if (!startAt) return true;

    const now = nowInParis();
    const eventStart = toParisTime(startAt);
    if (Number.isNaN(eventStart.getTime())) return true;

    const allowedTime = new Date(eventStart.getTime() - 5 * 60 * 1000);
    return now >= allowedTime;
  })();

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => {
    const verifyAndLoadOrder = async () => {
      try {
        // If we have a session_id, verify payment first
        if (sessionId) {
          setVerifying(true);
          const { error: verifyError } = await supabase.functions.invoke('verify-payment', {
            body: { sessionId, orderId },
          });

          if (verifyError) {
            console.error('Error verifying payment:', verifyError);
            toast({
              title: t('orderDetails.error'),
              description: t('orderDetails.cannotVerifyPayment'),
              variant: "destructive",
            });
          } else {
            // Clear cart after successful payment
            clearCart();
          }
          setVerifying(false);
        }

        // Load order from database
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .select('*, events(title, start_at, end_at, poster_url), venues!orders_venue_id_fkey(id, name)')
          .eq('id', orderId)
          .single();

        if (orderError) {
          console.error('Error loading order:', orderError);
          throw orderError;
        }

        setOrder(orderData);

        // Check Click & Collect mode for this order's venue
        if (orderData.venue_id) {
          const { data: venueData } = await supabase
            .from('venues')
            .select('click_collect_mode')
            .eq('id', orderData.venue_id)
            .single();

          setClickCollectMode(venueData?.click_collect_mode || false);
        }

        // Generate QR code - white background with black QR like ticket style
        if (orderData.token) {
          const qr = await QRCode.toDataURL(orderData.token, {
            width: 240,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#FFFFFF',
            },
          });
          setQrDataUrl(qr);
        }
      } catch (error) {
        console.error('Error:', error);
        toast({
          title: t('orderDetails.error'),
          description: t('orderDetails.cannotLoadOrder'),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    if (orderId) {
      verifyAndLoadOrder();
    }
  }, [orderId, sessionId, toast, clearCart]);

  // Haptique success UNE fois quand le QR devient visible (paiement confirmé)
  const qrHapticFired = useRef(false);
  useEffect(() => {
    if (!loading && !verifying && qrDataUrl && !qrHapticFired.current) {
      qrHapticFired.current = true;
      haptics.success();
    }
  }, [loading, verifying, qrDataUrl]);

  // Subscribe to venue changes for real-time click collect mode updates
  useEffect(() => {
    if (!order?.venue_id) return;

    const venueChannel = supabase
      .channel(`venue-mode-changes-${order.venue_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'venues',
          filter: `id=eq.${order.venue_id}`,
        },
        (payload) => {
          setClickCollectMode(payload.new.click_collect_mode || false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(venueChannel);
    };
  }, [order?.venue_id]);

  if (loading || verifying) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="text-center">
          <div className="mb-4 h-11 w-11 animate-spin rounded-full mx-auto" style={{ border: `3px solid ${BORDER_STRONG}`, borderTopColor: RED }} />
          <p className="font-mono uppercase" style={{ fontSize: 10.5, letterSpacing: '.1em', color: G2 }}>
            {verifying ? t('orderDetails.verifyingPayment') : t('orderDetails.loading')}
          </p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6" style={{ background: '#0A0A0A' }}>
        <div className="text-center">
          <h2 className="font-display uppercase mb-4" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{t('orderDetails.orderNotFound')}</h2>
          <button
            onClick={() => navigate('/')}
            className="cursor-pointer font-mono uppercase"
            style={{ padding: '11px 20px', borderRadius: 3, background: RED, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', border: 'none' }}
          >
            {t('orderDetails.backToMenu')}
          </button>
        </div>
      </div>
    );
  }

  const pin = order.token?.slice(-4).toUpperCase();

  // Use event end time if available, otherwise use token expiry
  const expiresAt = order.events?.end_at
    ? format(new Date(order.events.end_at), "PPp", { locale: dateLocale })
    : order.token_expires_at
    ? format(new Date(order.token_expires_at), "HH'h'mm", { locale: dateLocale })
    : '';

  const copyPin = () => {
    if (pin) {
      navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const requestPreparation = async () => {
    setRequestingPrep(true);
    try {
      // Check if event has started
      if (order?.events?.start_at) {
        const now = nowInParis();
        const eventStart = toParisTime(order.events.start_at);

        // Allow preparation 5 minutes before event start
        const allowedTime = new Date(eventStart.getTime() - 5 * 60 * 1000);

        if (now < allowedTime) {
          toast({
            title: t('orderDetails.error'),
            description: t('clickCollect.eventNotStarted'),
            variant: "destructive",
          });
          return;
        }
      }

      const { error } = await supabase
        .from('orders')
        .update({
          prep_requested: true,
          prep_status: 'queue'
        })
        .eq('id', orderId);

      if (error) throw error;

      setOrder((prev: any) => ({ ...prev, prep_requested: true, prep_status: 'queue' }));

      toast({
        title: t('orderDetails.prepRequested'),
        description: t('orderDetails.prepRequestedDesc'),
      });
    } catch (error) {
      console.error('Error requesting preparation:', error);
      toast({
        title: t('orderDetails.error'),
        description: t('orderDetails.cannotRequestPrep'),
        variant: "destructive",
      });
    } finally {
      setRequestingPrep(false);
    }
  };

  const labels = {
    scanThisQR: t('orders.scanThisQR'),
    shareThisQR: t('orders.shareThisQR'),
    valid: t('orders.valid'),
    scanned: t('orders.scannedLabel'),
  };

  // Click&Collect : le QR reste masqué tant que la préparation n'est pas demandée.
  const qrGated = clickCollectMode && !order.prep_requested;

  const items = (Array.isArray(order.items) ? order.items : []) as Array<{ name?: string; qty?: number; quantity?: number }>;
  const itemCount = items.reduce((sum, i) => sum + (i.qty || i.quantity || 1), 0);
  const idLabel = items.map(i => `${i.qty || i.quantity || 1}× ${i.name}`).join(' · ');

  const whenLabel = order.events?.start_at
    ? format(new Date(order.events.start_at), 'EEE d MMM · HH:mm', { locale: dateLocale }).toUpperCase()
    : undefined;

  return (
    <OrderQROverlay
      kind="drink"
      title={order.events?.title || t('orderDetails.yourOrder')}
      venueName={order.venues?.name || ''}
      qrImage={qrGated ? undefined : (qrDataUrl || undefined)}
      idLabel={idLabel || `${itemCount} ${t('orderDetails.items')}`}
      scanned={!!order.token_used}
      labels={labels}
      onClose={() => navigate('/my-orders')}
      whenLabel={whenLabel}
      posterUrl={order.events?.poster_url || undefined}
      posterThumb={order.events?.poster_url || undefined}
      footer={
        <div className="space-y-2.5 text-left">
          {/* Click&Collect : demander la préparation */}
          {!order.prep_requested && (
            <div style={{ padding: '12px 13px', borderRadius: 8, background: qrGated ? RED_TINT : CARD, border: `1px solid ${qrGated ? RED_SOFT : BORDER_STRONG}` }}>
              {qrGated && (
                <>
                  <p className="font-mono uppercase text-center" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: RED, marginBottom: 3 }}>
                    {t('orderDetails.clickCollectOnly')}
                  </p>
                  <p className="text-center" style={{ fontSize: 11.5, color: G2, marginBottom: 10 }}>
                    {t('orderDetails.requestPrepBelow')}
                  </p>
                </>
              )}
              <button
                onClick={requestPreparation}
                disabled={requestingPrep || !eventHasStarted}
                className="w-full flex items-center justify-center gap-2 cursor-pointer font-mono font-bold uppercase disabled:opacity-50"
                style={{ padding: '11px 12px', background: RED, color: '#fff', fontSize: 11, letterSpacing: '.1em', borderRadius: 3, border: 'none' }}
              >
                <Clock style={{ width: 14, height: 14 }} strokeWidth={2} />
                {requestingPrep
                  ? t('orderDetails.requestingPrep')
                  : !eventHasStarted
                    ? t('clickCollect.eventNotStartedYet')
                    : t('orderDetails.requestPreparation')}
              </button>
            </div>
          )}

          {/* PIN de secours */}
          <div
            className="flex items-center justify-between"
            style={{ padding: '10px 13px', borderRadius: 8, background: CARD, border: `1px solid ${BORDER_STRONG}` }}
          >
            <span className="font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: '.06em', color: G2 }}>{t('orderDetails.backupPin')}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '.2em', color: '#fff' }}>{pin}</span>
              <button
                onClick={copyPin}
                className="grid place-items-center cursor-pointer"
                style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER_STRONG}` }}
              >
                {copied ? <CheckCircle style={{ width: 13, height: 13, color: '#10B981' }} /> : <Copy style={{ width: 13, height: 13, color: G2 }} />}
              </button>
            </div>
          </div>

          {/* Total commande */}
          <div
            className="flex items-center justify-between"
            style={{ padding: '10px 13px', borderRadius: 8, background: CARD, border: `1px solid ${BORDER_STRONG}` }}
          >
            <span className="font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: '.06em', color: G2 }}>
              {itemCount} {t('orderDetails.items')}
            </span>
            <span className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: RED }}>{Number(order.total).toFixed(2)}€</span>
          </div>

          {/* Validité */}
          {expiresAt && (
            <p className="font-mono uppercase text-center" style={{ fontSize: 9, letterSpacing: '.1em', color: G3, paddingTop: 2 }}>
              {t('orderDetails.validUntil')} {expiresAt}
            </p>
          )}

          {/* Retour au menu du club */}
          <button
            onClick={() => navigate(`/club/${order.venue_id}`)}
            className="w-full flex items-center justify-center gap-2 cursor-pointer font-mono uppercase"
            style={{ padding: 11, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER_STRONG}`, color: G1, fontSize: 11, fontWeight: 600, letterSpacing: '.08em' }}
          >
            <Home style={{ width: 14, height: 14 }} strokeWidth={2} />
            {t('orderDetails.backToMenu')}
          </button>
        </div>
      }
    />
  );
}
