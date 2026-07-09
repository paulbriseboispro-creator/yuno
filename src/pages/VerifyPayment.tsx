import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, Sparkles, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { useStore } from '@/store/useStore';
import { usePushListener } from '@/hooks/usePushListener';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';
import { NativeCheckoutReturn } from '@/components/NativeCheckoutReturn';

export default function VerifyPayment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'nativeReturn'>('verifying');
  // Checkout lancé depuis l'app iOS : cette page tourne dans SafariVC côté web,
  // le retour se fait par deep link yuno:// vers la confirmation in-app.
  const isNativeReturn = searchParams.get('native') === '1';
  const [errorMessage, setErrorMessage] = useState('');
  const [pointsEarned, setPointsEarned] = useState<number>(0);
  const [orderNumber, setOrderNumber] = useState('');
  const [isGuestOrder, setIsGuestOrder] = useState(false);
  const clearCart = useStore((state) => state.clearCart);
  const { showFallbackToast } = usePushListener();
  const venueId = sessionStorage.getItem('yuno_venue_id') || undefined;
  const { trackOrderComplete } = useVisitorTracking(venueId);
  
  const sessionId = searchParams.get('session_id');
  const orderId = searchParams.get('order_id');

  useEffect(() => {
    if (sessionId && orderId) {
      verifyPayment();
    } else {
      setStatus('error');
      setErrorMessage(t('verify.paymentInfoMissing'));
    }
  }, [sessionId, orderId]);

  const verifyPayment = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-payment', {
        body: { sessionId, orderId }
      });

      if (error) throw error;

      if (data?.paid) {
        setStatus('success');
        clearCart();
        if (orderId) trackOrderComplete(orderId);
        
        if (data.pointsEarned && data.pointsEarned > 0) {
          setPointsEarned(data.pointsEarned);
        }

        if (data.orderNumber) {
          setOrderNumber(data.orderNumber);
        }

        if (data.isGuest) {
          setIsGuestOrder(true);
        }

        if (!data.pushSent) {
          showFallbackToast(
            t('guest.orderConfirmedToast'),
            t('guest.paymentValidated')
          );
        }
        
        if (!data.isGuest) {
          if (isNativeReturn) {
            setStatus('nativeReturn');
          } else {
            setTimeout(() => {
              navigate(`/order-confirmation?type=order&id=${orderId}`);
            }, 2500);
          }
        }
      } else {
        setStatus('error');
        setErrorMessage(t('verify.paymentNotConfirmed'));
      }
    } catch (error: any) {
      console.error('Payment verification error:', error);
      setStatus('error');
      setErrorMessage(error.message || t('verify.verificationFailed'));
    }
  };

  const handleCreateAccount = () => {
    navigate(`/guest/finalize?type=order&id=${orderId}`);
  };

  if (status === 'nativeReturn') {
    return <NativeCheckoutReturn returnPath={`/order-confirmation?type=order&id=${orderId}`} />;
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-6" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {status === 'verifying' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <h2 className="text-lg font-semibold text-foreground">{t('verify.checking')}</h2>
          <p className="text-sm text-muted-foreground">{t('verify.pleaseWait')}</p>
        </motion.div>
      )}

      {status === 'success' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="flex flex-col items-center gap-4 w-full max-w-sm"
        >
          <CheckCircle className="h-14 w-14 text-green-500" />
          <h2 className="text-lg font-semibold text-foreground">{t('verify.paymentConfirmed')}</h2>
          
          {orderNumber && (
            <p className="text-sm font-mono text-muted-foreground">{orderNumber}</p>
          )}

          {!isGuestOrder && (
            <p className="text-sm text-muted-foreground">{t('verify.redirecting')}</p>
          )}
          
          {pointsEarned > 0 && (
            <div className="flex items-center gap-2 mt-2 px-4 py-2 bg-primary/10 rounded-full">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">
                +{pointsEarned} points
              </span>
            </div>
          )}

          {isGuestOrder && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="w-full mt-4 space-y-3">
              <Button
                onClick={handleCreateAccount}
                className="w-full h-12 rounded-xl bg-primary text-base font-semibold"
              >
                <UserPlus className="h-5 w-5 mr-2" />
                {t('finalize.createAccountRecommended')}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                {t('finalize.loyaltyHint')}
              </p>
              <Button
                variant="ghost"
                onClick={() => navigate(`/order-confirmation?type=order&id=${orderId}`)}
                className="w-full text-sm text-muted-foreground"
              >
                {t('finalize.later')}
              </Button>
            </motion.div>
          )}
        </motion.div>
      )}

      {status === 'error' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <XCircle className="h-14 w-14 text-destructive" />
          <h2 className="text-lg font-semibold text-foreground">{t('verify.paymentError')}</h2>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <Button variant="outline" onClick={() => navigate('/my-orders')} className="mt-2">
            {t('verify.viewOrders')}
          </Button>
        </motion.div>
      )}
    </div>
  );
}
