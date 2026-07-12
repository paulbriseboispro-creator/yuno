import { useEffect, useState, type CSSProperties } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, XCircle, Check, QrCode, Sparkles, Zap, Bell, Eye, EyeOff, UserPlus, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { usePushListener } from '@/hooks/usePushListener';
import { useGuestSignup } from '@/hooks/useGuestSignup';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, enUS, es } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { motion } from 'framer-motion';
import { NativeCheckoutReturn } from '@/components/NativeCheckoutReturn';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

export default function VerifyTicketPayment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const [status, setStatus] = useState<'verifying' | 'guest' | 'error' | 'nativeReturn'>('verifying');
  // Checkout lancé depuis l'app iOS : cette page tourne dans SafariVC côté web,
  // le retour se fait par deep link yuno:// vers la confirmation in-app.
  const isNativeReturn = searchParams.get('native') === '1';
  const [errorMessage, setErrorMessage] = useState('');
  const [guestDetails, setGuestDetails] = useState<any>(null);
  const [guestEmail, setGuestEmail] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { submitting, error: signupError, setError: setSignupError, signup } = useGuestSignup();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, ticketId]);

  const verifyPayment = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-ticket-payment', {
        body: { sessionId, ticketId },
      });

      if (error) throw error;

      if (data?.paid) {
        if (ticketId) trackOrderComplete(ticketId);

        if (data.isGuest) {
          // A guest checkout is the one case where this screen earns its keep:
          // it's the moment to turn a one-off buyer into a Yuno account.
          setGuestDetails(data.ticketDetails ?? null);
          setGuestEmail(data.guestEmail || data.ticketDetails?.customerEmail || '');
          setStatus('guest');
          if (!data.pushSent) {
            showFallbackToast(t('verify.ticketConfirmedToast'), t('verify.ticketRedirectingToast'));
          }
        } else if (isNativeReturn) {
          // Acheteur connecté venu de l'app iOS : on le renvoie dans l'app,
          // la confirmation s'affiche là-bas.
          setStatus('nativeReturn');
        } else {
          // Logged-in buyers already get a full confirmation on /order-confirmation.
          // A second "Ticket confirmed!" interstitial is pure friction — skip it.
          // Détour par l'upsell boissons (prix presale) : la page redirige
          // elle-même vers la confirmation si le club n'y est pas éligible.
          navigate(`/order/upsell?ticket=${ticketId}`, { replace: true });
        }
      } else {
        setStatus('error');
        setErrorMessage(t('verify.paymentNotConfirmed'));
      }
    } catch (err: any) {
      console.error('Payment verification error:', err);
      setStatus('error');
      setErrorMessage(err.message || t('verify.verificationFailed'));
    }
  };

  const goToTicket = () => {
    navigate(`/order-confirmation?type=ticket&id=${ticketId}`, {
      state: { guestTicketData: guestDetails },
    });
  };

  const handleCreateAccount = () => {
    if (!guestEmail) return;
    const [firstName, ...rest] = (guestDetails?.customerName || '').trim().split(' ');
    signup(
      {
        email: guestEmail,
        firstName: firstName || undefined,
        lastName: rest.join(' ') || undefined,
        reference: guestDetails?.qrCode,
        purchaseId: ticketId || '',
        purchaseType: 'ticket',
      },
      password,
      confirmPassword,
      () => navigate('/my-orders?tab=tickets'),
    );
  };

  const locale = language === 'es' ? es : language === 'fr' ? fr : enUS;
  const eventDate = guestDetails?.eventDate ? new Date(guestDetails.eventDate) : null;

  // ── Retour app native ────────────────────────────────────────────────────
  // Même détour upsell que le web : la page renvoie vers la confirmation si inéligible.
  if (status === 'nativeReturn') {
    return <NativeCheckoutReturn returnPath={`/order/upsell?ticket=${ticketId}`} />;
  }

  // ── Verifying ───────────────────────────────────────────────────────────
  if (status === 'verifying') {
    return (
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-6"
        style={{ background: '#0A0A0A', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: '#E8192C' }} />
        <p className="font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.14em', color: '#9A9A9A' }}>
          {t('verify.checking')}
        </p>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ background: '#0A0A0A', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <XCircle className="h-12 w-12" style={{ color: '#E8192C' }} />
        <h2 className="font-display font-bold uppercase" style={{ fontSize: 'clamp(22px, 6vw, 28px)', color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 }}>
          {t('verify.paymentError')}
        </h2>
        <p className="font-sans" style={{ fontSize: '14px', color: '#9A9A9A', maxWidth: 320 }}>{errorMessage}</p>
        <button className="btn btn--ghost" style={{ width: '100%', maxWidth: 320 }} onClick={() => navigate('/my-orders?tab=tickets')}>
          {t('verify.viewTickets')}
        </button>
      </div>
    );
  }

  // ── Guest success — account-creation incentive ────────────────────────────
  const perks: Array<{ Icon: typeof QrCode; label: string }> = [
    { Icon: QrCode, label: t('tconf.perkTickets') },
    { Icon: Sparkles, label: t('tconf.perkLoyalty') },
    { Icon: Zap, label: t('tconf.perkCheckout') },
    { Icon: Bell, label: t('tconf.perkAlerts') },
  ];

  const inputStyle: CSSProperties = {
    width: '100%',
    height: 48,
    background: '#1F1F22',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#fff',
    padding: '0 44px 0 14px',
    fontSize: '15px',
    fontFamily: 'Inter, sans-serif',
    outline: 'none',
  };

  return (
    <div
      className="min-h-[100dvh] overflow-x-hidden"
      style={{ background: '#0A0A0A', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(40px + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto px-5" style={{ maxWidth: 460 }}>
        {/* Confirmation stamp */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="flex justify-center"
          style={{ paddingTop: 'clamp(40px, 12vw, 72px)', marginBottom: 22 }}
        >
          <div
            className="flex items-center justify-center"
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'rgba(232,25,44,0.10)',
              border: '1px solid rgba(232,25,44,0.32)',
              boxShadow: '0 0 44px rgba(232,25,44,0.20)',
            }}
          >
            <Check strokeWidth={2.5} style={{ width: 32, height: 32, color: '#E8192C' }} />
          </div>
        </motion.div>

        {/* Kicker + headline */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
          className="text-center"
        >
          <p className="font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#E8192C', marginBottom: 12 }}>
            {t('tconf.kicker')}
          </p>
          <h1 className="font-display font-bold uppercase" style={{ fontSize: 'clamp(36px, 11vw, 56px)', color: '#fff', letterSpacing: '-0.03em', lineHeight: 0.92 }}>
            {t('tconf.headline')}
          </h1>
          <p className="font-sans" style={{ fontSize: '15px', color: '#9A9A9A', marginTop: 14, lineHeight: 1.5 }}>
            {t('tconf.emailNote')}
          </p>
        </motion.div>

        {/* Event context */}
        {guestDetails?.eventTitle && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.18 }}
            className="flex items-center gap-3.5"
            style={{ marginTop: 28, padding: 12, background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
          >
            {guestDetails.eventPosterUrl && (
              <img
                src={guestDetails.eventPosterUrl}
                alt=""
                style={{ width: 56, height: 56, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <h2 className="font-display font-bold uppercase truncate" style={{ fontSize: '15px', color: '#fff', letterSpacing: '-0.005em', lineHeight: 1.1 }}>
                {guestDetails.eventTitle}
              </h2>
              <p className="font-mono uppercase truncate" style={{ fontSize: '10.5px', color: '#9A9A9A', letterSpacing: '0.04em', marginTop: 5 }}>
                {[
                  guestDetails.quantity ? `${guestDetails.quantity}× ${guestDetails.roundName || ''}`.trim() : guestDetails.roundName,
                  eventDate ? formatInTimeZone(eventDate, PARIS_TIMEZONE, 'dd MMM', { locale }) : null,
                  guestDetails.venueName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </motion.div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '34px 0 26px' }} />

        {/* Account incentive */}
        {guestEmail ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.26 }}
          >
            <p className="section-label-ruled" style={{ marginBottom: 14 }}>{t('tconf.accountLabel')}</p>
            <h2 className="font-display font-bold" style={{ fontSize: 'clamp(21px, 5vw, 26px)', color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.05 }}>
              {t('tconf.accountPitch')}
            </h2>

            {/* Perks */}
            <ul style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 13 }}>
              {perks.map(({ Icon, label }) => (
                <li key={label} className="flex items-center gap-3">
                  <span
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.20)' }}
                  >
                    <Icon style={{ width: 16, height: 16, color: '#E8192C' }} />
                  </span>
                  <span className="font-sans" style={{ fontSize: '14px', color: '#E5E5E5' }}>{label}</span>
                </li>
              ))}
            </ul>

            {/* Password fields */}
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (signupError) setSignupError(''); }}
                  placeholder={t('finalize.passwordPlaceholder')}
                  autoComplete="new-password"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(232,25,44,0.5)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute"
                  style={{ right: 12, top: '50%', transform: 'translateY(-50%)', color: '#9A9A9A', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0 }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff style={{ width: 18, height: 18 }} /> : <Eye style={{ width: 18, height: 18 }} />}
                </button>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); if (signupError) setSignupError(''); }}
                placeholder={t('finalize.confirmPlaceholder')}
                autoComplete="new-password"
                style={{ ...inputStyle, padding: '0 14px' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(232,25,44,0.5)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
              />
            </div>

            {signupError && (
              <p className="font-sans text-center" style={{ fontSize: '13px', color: '#E8192C', marginTop: 12 }}>{signupError}</p>
            )}

            {/* Primary CTA */}
            <button
              className="btn btn--primary"
              style={{ width: '100%', marginTop: 16, opacity: submitting || !password || !confirmPassword ? 0.55 : 1 }}
              disabled={submitting || !password || !confirmPassword}
              onClick={handleCreateAccount}
            >
              {submitting ? (
                <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} />
              ) : (
                <>
                  <UserPlus style={{ width: 18, height: 18 }} />
                  {t('tconf.createCta')}
                </>
              )}
            </button>

            {/* Linked-to email */}
            <p className="font-mono uppercase text-center truncate" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.06em', marginTop: 12 }}>
              {t('tconf.accountFor')} {guestEmail}
            </p>

            {/* Secondary — straight to the ticket */}
            <button className="btn btn--ghost" style={{ width: '100%', marginTop: 18 }} onClick={goToTicket}>
              {t('tconf.viewTicket')}
              <ArrowRight style={{ width: 16, height: 16 }} />
            </button>
            <p className="font-sans text-center" style={{ fontSize: '12px', color: '#5A5A5E', marginTop: 12 }}>{t('tconf.skipNote')}</p>
          </motion.div>
        ) : (
          // No email captured at checkout — nothing to seed an account with, just
          // get the buyer to their ticket.
          <button className="btn btn--primary" style={{ width: '100%' }} onClick={goToTicket}>
            {t('tconf.viewTicket')}
            <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>
    </div>
  );
}
