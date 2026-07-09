import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { usePushListener } from '@/hooks/usePushListener';
import { useLanguage } from '@/contexts/LanguageContext';
import { NativeCheckoutReturn } from '@/components/NativeCheckoutReturn';

export default function VerifyTablePayment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'nativeReturn'>('verifying');
  // Checkout lancé depuis l'app iOS : cette page tourne dans SafariVC côté web,
  // le retour se fait par deep link yuno:// vers la confirmation in-app.
  const isNativeReturn = searchParams.get('native') === '1';
  const [errorMessage, setErrorMessage] = useState('');
  const venueId = sessionStorage.getItem('yuno_venue_id') || undefined;
  const { trackOrderComplete } = useVisitorTracking(venueId);
  const { showFallbackToast } = usePushListener();
  
  const sessionId = searchParams.get('session_id');
  const reservationId = searchParams.get('reservation_id');

  useEffect(() => {
    if (sessionId && reservationId) {
      verifyPayment();
    } else {
      setStatus('error');
      setErrorMessage(t('verify.paymentInfoMissing'));
    }
  }, [sessionId, reservationId]);

  const verifyPayment = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-table-payment', {
        body: { sessionId, reservationId }
      });

      if (error) throw error;

      if (data?.paid) {
        if (reservationId) trackOrderComplete(reservationId);

        if (isNativeReturn) {
          setStatus('nativeReturn');
          return;
        }

        setStatus('success');
        if (!data.pushSent) {
          showFallbackToast(
            t('verify.reservationConfirmedToast'),
            t('verify.reservationRedirectingToast')
          );
        }

        setTimeout(() => {
          navigate(`/order-confirmation?type=table&id=${reservationId}`);
        }, 2000);
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

  if (status === 'nativeReturn') {
    return <NativeCheckoutReturn returnPath={`/order-confirmation?type=table&id=${reservationId}`} />;
  }

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          {status === 'verifying' && (
            <>
              <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">{t('verify.checking')}</h2>
              <p className="text-muted-foreground">{t('verify.pleaseWait')}</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">{t('verify.reservationConfirmed')}</h2>
              <p className="text-muted-foreground mb-4">{t('verify.reservationRedirecting')}</p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">{t('verify.paymentError')}</h2>
              <p className="text-muted-foreground mb-4">{errorMessage}</p>
              <Button onClick={() => navigate('/my-orders?tab=tables')}>
                {t('verify.viewReservations')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
