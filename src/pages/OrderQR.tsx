import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import QRCode from 'qrcode';
import { CheckCircle2, Home, ArrowLeft, Copy, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/store/useStore';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { nowInParis, toParisTime } from '@/lib/timezone';

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
          .select('*, events(title, start_at, end_at), venues!orders_venue_id_fkey(id, name)')
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
            width: 400,
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">
            {verifying ? t('orderDetails.verifyingPayment') : t('orderDetails.loading')}
          </p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <h2 className="mb-4 text-2xl font-bold">{t('orderDetails.orderNotFound')}</h2>
          <Button onClick={() => navigate('/')}>{t('orderDetails.backToMenu')}</Button>
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-4 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/my-orders')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">{t('orderDetails.yourOrder')}</h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl p-6">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="space-y-6"
        >
          {/* Success Message */}
          <Card className="border-0 bg-gradient-to-br from-primary to-primary-hover p-6 text-center shadow-primary">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-primary-foreground" />
            <h2 className="mb-2 text-2xl font-bold text-primary-foreground">{t('orderDetails.paymentSuccess')}</h2>
            <p className="text-sm text-primary-foreground/90">
              {t('orderDetails.showQRCode')}
            </p>
          </Card>

          {/* QR Code - Ticket style white card */}
          <div 
            className="bg-white rounded-2xl p-6 shadow-soft text-center cursor-pointer"
            onClick={() => !clickCollectMode || order.prep_requested ? null : null}
          >
            <h3 className="font-bold text-lg text-gray-900 mb-1">
              {order.events?.title || t('orderDetails.yourOrder')}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {order.items?.length} {t('orderDetails.items')}
            </p>
            
            {qrDataUrl ? (
              <div className="relative mb-4 inline-block">
                <div className={`bg-white p-4 rounded-lg ${clickCollectMode && !order.prep_requested ? 'blur-xl opacity-30' : ''}`}>
                  <img
                    src={qrDataUrl}
                    alt="QR Code"
                    className="w-48 h-48 mx-auto"
                  />
                </div>
                {clickCollectMode && !order.prep_requested && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="bg-primary text-primary-foreground px-6 py-4 rounded-2xl shadow-primary text-center">
                      <p className="text-lg font-bold mb-2">{t('orderDetails.clickCollectOnly')}</p>
                      <p className="text-sm opacity-90">{t('orderDetails.requestPrepBelow')}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-4 h-48 w-48 animate-pulse rounded-lg bg-gray-200 mx-auto" />
            )}

            <p className="text-xs text-gray-500 mb-4">{t('orderDetails.showQRCode')}</p>

            {/* Backup PIN */}
            <div className="border-t border-gray-200 pt-4">
              <p className="text-xs text-gray-500 mb-2">
                {t('orderDetails.backupPin')}
              </p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl font-bold tracking-wider text-gray-900">
                  {pin}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={copyPin}
                  className="h-8 w-8 text-gray-600 hover:text-gray-900"
                >
                  {copied ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Order Details */}
          <Card className="border-0 bg-surface p-6 shadow-soft">
            <h3 className="mb-4 text-lg font-semibold">{t('orderDetails.orderDetails')}</h3>
            {order.events?.title && (
              <div className="mb-4 pb-3 border-b border-border/40">
                <p className="text-sm text-muted-foreground">{t('orderDetails.event')}</p>
                <p className="text-base font-semibold text-primary">{order.events.title}</p>
              </div>
            )}
            <div className="space-y-3">
              {order.items?.map((item: any, index: number) => (
                <div key={index} className="flex justify-between text-sm">
                  <span>
                    {item.qty || item.quantity || 1}x {item.name}
                  </span>
                  <span className="font-semibold">
                    {((item.unitPrice || item.price || 0) * (item.qty || item.quantity || 1)).toFixed(2)}€
                  </span>
                </div>
              ))}
              <div className="border-t border-border/40 pt-3">
                <div className="flex justify-between font-bold">
                  <span>{t('orderDetails.total')}</span>
                  <span className="text-accent">{order.total.toFixed(2)}€</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Click & Collect Button */}
          {!order.prep_requested && (
            <Button
              onClick={requestPreparation}
              disabled={requestingPrep || !eventHasStarted}
              className="w-full h-12 bg-accent text-accent-foreground rounded-full font-semibold shadow-gold hover:bg-accent/90 disabled:opacity-50"
            >
              {requestingPrep 
                ? t('orderDetails.requestingPrep') 
                : !eventHasStarted 
                  ? t('clickCollect.eventNotStartedYet') 
                  : t('orderDetails.requestPreparation')}
            </Button>
          )}

          {/* Action Button */}
          <Button
            onClick={() => navigate(`/club/${order.venue_id}`)}
            className="w-full h-12 bg-primary rounded-full font-semibold shadow-primary hover:bg-primary-hover"
          >
            <Home className="mr-2 h-5 w-5" />
            {t('orderDetails.backToMenu')}
          </Button>

          {/* Expiration Notice */}
          {expiresAt && (
            <Card className="border border-accent/20 bg-accent/5 p-4">
              <p className="text-center text-sm text-accent">
                {t('orderDetails.validUntil')} {expiresAt}
              </p>
            </Card>
          )}
        </motion.div>
      </div>
    </div>
  );
}
