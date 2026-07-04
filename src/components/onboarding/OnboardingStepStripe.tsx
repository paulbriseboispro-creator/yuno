import { useLanguage } from '@/contexts/LanguageContext';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, Loader2, Clock, CreditCard, Handshake, Sparkles, ArrowRight, Gift } from 'lucide-react';
import { PlanCode, SUBSCRIPTIONS_ENABLED } from '@/lib/planFeatures';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { StepHeader, PrimaryButton, GhostButton, InnerCard, POS, T1, T2, T3, BORDER } from './onboardingUI';

interface StripeConnectStatus {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingComplete: boolean;
  accountId: string | null;
}

interface SubscriptionStatus {
  subscribed: boolean;
  status: string;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  daysRemaining: number | null;
  isTrial: boolean;
}

interface Props {
  venueId: string;
  onComplete: () => void;
  stripeStatus: StripeConnectStatus;
  subscription: SubscriptionStatus;
  loading: boolean;
  startOnboarding: (opts?: { returnUrl?: string; refreshUrl?: string }) => Promise<void>;
  refreshStatus: () => Promise<void>;
  startSubscription: (planCode?: PlanCode) => Promise<void>;
  checkSubscription: () => Promise<void>;
}

export function OnboardingStepStripe({
  venueId,
  onComplete,
  stripeStatus,
  subscription,
  loading,
  startOnboarding,
  refreshStatus,
  checkSubscription,
}: Props) {
  const { t } = useLanguage();
  const [collabInvitation, setCollabInvitation] = useState<{
    organizer_name: string | null;
    event_title: string | null;
  } | null>(null);

  // Detect whether this venue was created via an organizer collab invitation.
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    (async () => {
      const { data: inv } = await supabase
        .from('venue_claim_invitations')
        .select('id, event_id, organizer_user_id')
        .eq('created_venue_id', venueId)
        .eq('status', 'accepted')
        .maybeSingle();
      if (!inv || cancelled) return;
      const [eventRes, profileRes] = await Promise.all([
        inv.event_id ? supabase.from('events').select('title').eq('id', inv.event_id).maybeSingle() : Promise.resolve({ data: null }),
        inv.organizer_user_id ? supabase.from('profiles').select('full_name').eq('id', inv.organizer_user_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setCollabInvitation({
        organizer_name: (profileRes.data as any)?.full_name ?? null,
        event_title: (eventRes.data as any)?.title ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  const isConnected = stripeStatus.connected;
  const isFullyVerified = stripeStatus.connected && stripeStatus.chargesEnabled;

  const handleStartOnboarding = () => {
    const origin = window.location.origin;
    startOnboarding({
      returnUrl: `${origin}/owner/onboarding?stripe=success`,
      refreshUrl: `${origin}/owner/onboarding?stripe=refresh`,
    });
  };

  const handleRefresh = async () => {
    await Promise.all([refreshStatus(), checkSubscription()]);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <StepHeader icon={CreditCard} title={t('onboarding.step3Title')} subtitle={t('onboarding.step3Desc')} />
        <div className="flex items-center gap-2" style={{ color: T3 }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span style={{ fontSize: 13 }}>{t('onboarding.checkingStripe')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader icon={CreditCard} title={t('onboarding.step3Title')} subtitle={t('onboarding.step3Desc')} />

      {/* Collab account info */}
      {collabInvitation && (
        <InnerCard style={{ border: '1px solid rgba(168,85,247,0.28)', background: 'rgba(168,85,247,0.05)' }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(168,85,247,0.15)' }}>
              <Handshake className="w-5 h-5" style={{ color: '#c084fc' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('onboarding.collabAccountTitle')}</h3>
                <span
                  className="inline-flex items-center gap-1 rounded-full text-[10px] font-bold uppercase"
                  style={{ letterSpacing: '0.06em', padding: '2px 8px', background: 'rgba(168,85,247,0.18)', color: '#d8b4fe' }}
                >
                  <Sparkles className="w-3 h-3" />
                  {t('onboarding.collabAccountActive')}
                </span>
              </div>
              <p style={{ color: T3, fontSize: 12, marginTop: 4 }}>{t('onboarding.collabAccountDesc')}</p>
            </div>
          </div>
        </InnerCard>
      )}

      {/* Stripe Connect */}
      <InnerCard>
        <div className="flex items-center gap-2.5 mb-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-none"
            style={isConnected ? { background: POS, color: '#04130d' } : { background: 'rgba(255,255,255,0.06)', color: T3, border: `1px solid ${BORDER}` }}
          >
            {isConnected ? <Check className="w-3.5 h-3.5" /> : '1'}
          </div>
          <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('onboarding.stripeStep1')}</h3>
        </div>
        <p style={{ color: T3, fontSize: 12.5, paddingLeft: 34, marginBottom: 12, lineHeight: 1.45 }}>
          {t('onboarding.stripeStep1Desc')}
        </p>

        <div style={{ paddingLeft: 34 }}>
          {isFullyVerified ? (
            <div className="flex items-center gap-2" style={{ color: POS }}>
              <Check className="w-4 h-4" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t('onboarding.stripeConnected')}</span>
            </div>
          ) : isConnected ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2" style={{ color: '#FCD34D' }}>
                <Clock className="w-4 h-4" />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t('onboarding.stripePending')}</span>
              </div>
              <p style={{ color: T3, fontSize: 12 }}>{t('onboarding.stripePendingHint')}</p>
              <GhostButton icon={Loader2} onClick={handleRefresh} style={{ padding: '8px 12px', fontSize: 13 }}>
                {t('onboarding.refreshStatus')}
              </GhostButton>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg" style={{ padding: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}` }}>
                <p style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{t('onboarding.stripeWhatIs')}</p>
                <p style={{ color: T3, fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>{t('onboarding.stripeExplain')}</p>
              </div>
              <PrimaryButton icon={ExternalLink} onClick={handleStartOnboarding} style={{ padding: '9px 14px', fontSize: 13 }}>
                {t('onboarding.connectStripe')}
              </PrimaryButton>
            </div>
          )}
        </div>
      </InnerCard>

      {/* Free trial — plan choice deferred (no paywall in the flow).
          Abonnement coupé (lancement) : le bandeau essai/plans est masqué. */}
      {SUBSCRIPTIONS_ENABLED && (
      <div
        className="flex items-start gap-3 rounded-2xl"
        style={{ padding: '14px 16px', background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)' }}
      >
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(52,211,153,0.14)' }}>
          <Gift className="w-5 h-5" style={{ color: POS }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
            {subscription.subscribed && subscription.isTrial ? t('onboarding.trialActiveTitle') : t('onboarding.trialFreeTitle')}
          </h3>
          <p style={{ color: T3, fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>
            {subscription.subscribed && subscription.isTrial && subscription.daysRemaining !== null
              ? t('onboarding.trialDaysLeft').replace('{days}', String(subscription.daysRemaining))
              : t('onboarding.trialDeferDesc')}
          </p>
          <Link
            to="/owner/billing"
            className="inline-flex items-center gap-1 mt-2 text-[12px] font-semibold transition-opacity hover:opacity-80"
            style={{ color: POS }}
          >
            {t('onboarding.seePlans')}
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
      )}

      {/* Continue — available once Stripe is connected */}
      <PrimaryButton fullWidth icon={isConnected ? ArrowRight : undefined} onClick={onComplete} disabled={!isConnected}>
        {isConnected ? t('onboarding.continue') : t('onboarding.connectStripeFirst')}
      </PrimaryButton>
    </div>
  );
}
