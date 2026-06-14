import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { usePushListener } from '@/hooks/usePushListener';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';

export default function VerifyTicketPayment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');
  const [isGuestTicket, setIsGuestTicket] = useState(false);
  const [guestTicketDetails, setGuestTicketDetails] = useState<any>(null);
  const venueId = sessionStorage.getItem('yuno_venue_id') || undefined;
  const { trackOrderComplete } = useVisitorTracking(venueId);
  const { showFallbackToast } = usePushListener();
  
  const sessionId = searchParams.get('session_id');
  const ticketId = searchParams.get('ticket_id');

  useEffect(() => {
    if (sessionId && ticketId) {
      verifyPayment();
    } else {
      setStatus('error');
      setErrorMessage(t('verify.paymentInfoMissing'));
    }
  }, [sessionId, ticketId]);

  const verifyPayment = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-ticket-payment', {
        body: { sessionId, ticketId }
      });

      if (error) throw error;

      if (data?.paid) {
        setStatus('success');
        if (ticketId) trackOrderComplete(ticketId);
        
        if (data.isGuest) {
          setIsGuestTicket(true);
          if (data.ticketDetails) {
            setGuestTicketDetails(data.ticketDetails);
          }
        }
        
        if (!data.pushSent) {
          showFallbackToast(
            t('verify.ticketConfirmedToast'),
            t('verify.ticketRedirectingToast')
          );
        }
        
        if (!data.isGuest) {
          setTimeout(() => {
            navigate(`/order-confirmation?type=ticket&id=${ticketId}`);
          }, 2000);
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

  const navigateToConfirmation = () => {
    navigate(`/order-confirmation?type=ticket&id=${ticketId}`, {
      state: { guestTicketData: guestTicketDetails }
    });
  };

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
              <h2 className="text-xl font-bold mb-2">{t('verify.ticketConfirmed')}</h2>
              
              {!isGuestTicket && (
                <p className="text-muted-foreground mb-4">{t('verify.ticketRedirecting')}</p>
              )}

              {isGuestTicket && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="w-full mt-4 space-y-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    {t('verify.ticketSentByEmail')}
                  </p>

                  {/* PRIMARY: see ticket NOW (no email needed) */}
                  <Button
                    onClick={navigateToConfirmation}
                    className="w-full h-12 rounded-xl bg-primary text-base font-semibold"
                  >
                    {t('verify.viewTickets') || 'Voir mon billet'}
                  </Button>

                  {!user && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => navigate(`/guest/finalize?type=ticket&id=${ticketId}`)}
                        className="w-full h-12 rounded-xl text-base font-semibold"
                      >
                        <UserPlus className="h-5 w-5 mr-2" />
                        {t('finalize.createAccountRecommended')}
                      </Button>
                      <p className="text-xs text-center text-muted-foreground">
                        {t('finalize.ticketLoyaltyHint')}
                      </p>
                    </>
                  )}
                </motion.div>
              )}
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">{t('verify.paymentError')}</h2>
              <p className="text-muted-foreground mb-4">{errorMessage}</p>
              <Button onClick={() => navigate('/my-orders?tab=tickets')}>
                {t('verify.viewTickets')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
