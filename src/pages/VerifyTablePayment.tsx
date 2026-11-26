import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { usePushListener } from '@/hooks/usePushListener';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { NativeCheckoutReturn } from '@/components/NativeCheckoutReturn';
import { useMetaPurchasePixel } from '@/hooks/useMetaPixel';
import { capturePosthog } from '@/lib/posthog';
import { fetchEventMarket } from '@/lib/eventMarket';
import { readReceiptToken, readReceiptQr, saveReceiptQr } from '@/lib/tableReceipt';

const PENDING_KEY = 'yuno:table-verify';

/** Paramètres de retour de Stripe, lus UNE fois puis retirés de l'URL (ils traînent dans les outils de mesure). */
function takeReturnParams(search: URLSearchParams): { sessionId: string | null; reservationId: string | null } {
  let sessionId = search.get('session_id');
  let reservationId = search.get('reservation_id');
  try {
    if (sessionId && reservationId) {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ sessionId, reservationId }));
    } else {
      // Rechargement après le nettoyage de l'URL : on reprend ce que cette session avait gardé.
      const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null') as { sessionId?: string; reservationId?: string } | null;
      if (saved?.sessionId && saved?.reservationId) { sessionId = saved.sessionId; reservationId = saved.reservationId; }
    }
  } catch { /* stockage indisponible : l'URL seule fait foi */ }
  return { sessionId, reservationId };
}

export default function VerifyTablePayment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'nativeReturn' | 'receiptRequired' | 'closed'>('verifying');
  // Checkout lancé depuis l'app iOS : cette page tourne dans SafariVC côté web,
  // le retour se fait par deep link yuno:// vers la confirmation in-app.
  const isNativeReturn = searchParams.get('native') === '1';
  const [errorMessage, setErrorMessage] = useState('');
  const venueId = sessionStorage.getItem('yuno_venue_id') || undefined;
  // Retour de paiement : la visite de l'onglet continue (jamais une nouvelle).
  const { trackOrderComplete } = useVisitorTracking(venueId, undefined, undefined, { keepSession: true });
  const { firePurchase } = useMetaPurchasePixel();
  const { showFallbackToast } = usePushListener();

  // Lus au premier rendu (avant tout pixel) et gardés : l'URL est nettoyée juste après.
  const params = useRef<{ sessionId: string | null; reservationId: string | null } | null>(null);
  if (params.current === null) params.current = takeReturnParams(searchParams);
  const { sessionId, reservationId } = params.current;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // session_id et reservation_id quittent l'URL AVANT les pixels et PostHog (secret de reçu, I4).
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('session_id') || url.searchParams.has('reservation_id')) {
        url.searchParams.delete('session_id');
        url.searchParams.delete('reservation_id');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    } catch { /* l'historique n'est pas critique */ }
  }, []);

  useEffect(() => {
    if (sessionId && reservationId) {
      void verifyPayment();
    } else {
      setStatus('error');
      setErrorMessage(t('verify.paymentInfoMissing'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relancé seulement par « Réessayer »
  }, [sessionId, reservationId, attempt]);

  const verifyPayment = async () => {
    setStatus('verifying');
    try {
      const { data, error } = await supabase.functions.invoke('verify-table-payment', {
        body: {
          sessionId,
          reservationId,
          receiptToken: readReceiptToken(localStorage, reservationId) ?? undefined,
        },
      });

      if (error) throw error;

      if (data?.paid) {
        if (reservationId) trackOrderComplete(reservationId, 'table');
        // PostHog : achat confirmé par CET appel (jamais sur un rechargement).
        if (reservationId && !data.alreadyProcessed) {
          // Marché de la soirée lu à part (une lecture légère), puis l'envoi.
          const purchase = {
            pillar: 'tables',
            payment: 'stripe',
            order_ref: `table:${reservationId}`,
            value: data.metaPurchase?.valueCents != null ? Math.round(data.metaPurchase.valueCents) / 100 : null,
            currency: (data.metaPurchase?.currency ?? 'eur').toUpperCase(),
          };
          void fetchEventMarket(data.metaPurchase?.eventId, null).then((market) =>
            capturePosthog('purchase_completed', { ...purchase, ...market }));
        }
        // Pixel Meta : Purchase navigateur (dédoublonné avec l'envoi serveur).
        if (reservationId && !data.alreadyProcessed && data.metaPurchase) {
          firePurchase({ eventID: `table:${reservationId}`, ...data.metaPurchase });
        }

        // Annulée ou remboursée entre-temps (conflit au paiement, annulation du club) : on le dit, jamais « table confirmée ».
        if (data.alreadyProcessed && ['cancelled', 'refunded'].includes(String(data.reservationStatus))) {
          setStatus('closed');
          return;
        }

        // QR de la réservation : gardé pour la page de confirmation (rechargement compris).
        if (reservationId && data.qrCode) {
          saveReceiptQr(sessionStorage, reservationId, data.qrCode);
          saveReceiptQr(localStorage, reservationId, data.qrCode);
        }
        try { sessionStorage.removeItem(PENDING_KEY); } catch { /* sans effet */ }

        if (isNativeReturn) {
          setStatus('nativeReturn');
          return;
        }

        // Payé, mais ce navigateur n'a pas le jeton de reçu (autre appareil, autre navigateur, stockage vidé) :
        // la table est confirmée, le QR est dans l'e-mail ; on ne l'affiche pas à qui n'en a pas la preuve.
        if (data.receiptRequired && !data.qrCode && !readReceiptQr(sessionStorage, reservationId) && !readReceiptQr(localStorage, reservationId)) {
          setStatus('receiptRequired');
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
          navigate(`/order-confirmation?type=table&id=${reservationId}`, { state: { tableQr: data.qrCode ?? null } });
        }, 2000);
      } else {
        setStatus('error');
        setErrorMessage(t('verify.paymentNotConfirmed'));
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      setStatus('error');
      setErrorMessage((error as Error).message || t('verify.verificationFailed'));
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

          {status === 'closed' && (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">{t('tblc.closed.title')}</h2>
              <p className="text-muted-foreground mb-4">{t('tblc.closed.body')}</p>
              {user ? (
                <Button onClick={() => navigate('/my-orders?tab=tables')}>{t('tblc.findReservation')}</Button>
              ) : (
                <Button variant="outline" onClick={() => navigate('/')}>{t('tblc.receipt.home')}</Button>
              )}
            </>
          )}

          {status === 'receiptRequired' && (
            <>
              <MailCheck className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">{t('tblc.receipt.title')}</h2>
              <p className="text-muted-foreground mb-4">{t('tblc.receipt.body')}</p>
              {user ? (
                <Button onClick={() => navigate('/my-orders?tab=tables')}>{t('tblc.findReservation')}</Button>
              ) : (
                <Button variant="outline" onClick={() => navigate('/')}>{t('tblc.receipt.home')}</Button>
              )}
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">{t('verify.paymentError')}</h2>
              <p className="text-muted-foreground mb-4">{errorMessage}</p>
              <div className="flex flex-col gap-2">
                {sessionId && reservationId && (
                  <Button onClick={() => setAttempt((n) => n + 1)}>{t('tblc.retry')}</Button>
                )}
                {user ? (
                  <Button variant="outline" onClick={() => navigate('/my-orders?tab=tables')}>
                    {t('tblc.findReservation')}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('tblc.checkEmailHint')}</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
