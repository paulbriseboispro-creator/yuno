import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Check, ExternalLink, Loader2, Clock, CreditCard, Zap, Rocket, Crown, Handshake, Sparkles } from 'lucide-react';
import { PLANS, PAID_PLANS, PlanCode } from '@/lib/planFeatures';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

const PLAN_ICONS: Record<PlanCode, typeof Zap> = {
  core: Zap,
  collab: Zap,
  essential: Zap,
  pro: Rocket,
  elite: Crown,
};

const PLAN_ACCENTS: Record<PlanCode, { border: string; bg: string; icon: string }> = {
  core: { border: '', bg: 'bg-muted/30', icon: 'text-muted-foreground' },
  collab: { border: '', bg: 'bg-muted/30', icon: 'text-muted-foreground' },
  essential: { border: '', bg: 'bg-muted/50', icon: 'text-muted-foreground' },
  pro: { border: 'ring-1 ring-primary/30', bg: 'bg-primary/5', icon: 'text-primary' },
  elite: { border: '', bg: 'bg-purple-500/5', icon: 'text-purple-500' },
};

export function OnboardingStepStripe({
  venueId,
  onComplete,
  stripeStatus,
  subscription,
  loading,
  startOnboarding,
  refreshStatus,
  startSubscription,
  checkSubscription,
}: Props) {
  const { t } = useLanguage();
  const [subscribing, setSubscribing] = useState<PlanCode | null>(null);
  const [collabInvitation, setCollabInvitation] = useState<{
    organizer_name: string | null;
    event_title: string | null;
  } | null>(null);

  // Detect if this venue was created via a collab invitation (so we show the Collab info block)
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
        inv.event_id
          ? supabase.from('events').select('title').eq('id', inv.event_id).maybeSingle()
          : Promise.resolve({ data: null }),
        inv.organizer_user_id
          ? supabase.from('profiles').select('full_name').eq('id', inv.organizer_user_id).maybeSingle()
          : Promise.resolve({ data: null }),
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
  const isSubscribed = subscription.subscribed;
  const bothDone = isConnected && isSubscribed;

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

  const handleSelectPlan = async (code: PlanCode) => {
    setSubscribing(code);
    try {
      await startSubscription(code);
    } finally {
      setSubscribing(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold mb-1">{t('onboarding.step4Title')}</h2>
          <p className="text-sm text-muted-foreground">{t('onboarding.step4Desc')}</p>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">{t('onboarding.checkingStripe')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step4Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step4Desc')}</p>
      </div>

      {/* Collab account info — shown when this venue was created via an organizer invitation */}
      {collabInvitation && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
              <Handshake className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-sm">{t('onboarding.collabAccountTitle')}</h3>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                  <Sparkles className="w-3 h-3" />
                  {t('onboarding.collabAccountActive')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t('onboarding.collabAccountDesc')}</p>
              {(collabInvitation.organizer_name || collabInvitation.event_title) && (
                <p className="text-xs text-purple-300/80 mt-2">
                  {collabInvitation.organizer_name && <strong>{collabInvitation.organizer_name}</strong>}
                  {collabInvitation.organizer_name && collabInvitation.event_title && ' — '}
                  {collabInvitation.event_title && <em>{collabInvitation.event_title}</em>}
                </p>
              )}
            </div>
          </div>
          <div className="border-t border-purple-500/20 pt-3">
            <p className="text-xs text-muted-foreground">{t('onboarding.collabVsSubscription')}</p>
          </div>
        </div>
      )}

      {/* All done banner */}
      {bothDone && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
          <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
          <span className="text-sm font-medium text-green-500">{t('onboarding.stripeBothDone')}</span>
        </div>
      )}

      {/* Sub-step 1: Stripe Connect */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isConnected ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'}`}>
            {isConnected ? <Check className="w-3.5 h-3.5" /> : '1'}
          </div>
          <h3 className="font-semibold text-sm">{t('onboarding.stripeStep1')}</h3>
        </div>
        <p className="text-xs text-muted-foreground pl-8">{t('onboarding.stripeStep1Desc')}</p>

        <div className="pl-8">
          {isFullyVerified ? (
            <div className="flex items-center gap-2 text-green-500">
              <Check className="w-4 h-4" />
              <span className="text-sm font-medium">{t('onboarding.stripeConnected')}</span>
            </div>
          ) : isConnected ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-500">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-medium">{t('onboarding.stripePending')}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('onboarding.stripePendingHint')}</p>
              <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
                <Loader2 className="w-3 h-3" />
                {t('onboarding.refreshStatus')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-xs font-medium">{t('onboarding.stripeWhatIs')}</p>
                <p className="text-xs text-muted-foreground">{t('onboarding.stripeExplain')}</p>
              </div>
              <Button onClick={handleStartOnboarding} size="sm" className="gap-2">
                <ExternalLink className="w-4 h-4" />
                {t('onboarding.connectStripe')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Sub-step 2: Plan Selection */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isSubscribed ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'}`}>
            {isSubscribed ? <Check className="w-3.5 h-3.5" /> : '2'}
          </div>
          <h3 className="font-semibold text-sm">{t('onboarding.stripeStep2')}</h3>
        </div>
        <p className="text-xs text-muted-foreground pl-8">{t('onboarding.stripeStep2Desc')}</p>

        <div className="pl-8">
          {isSubscribed ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-green-500">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {subscription.isTrial ? t('onboarding.subscriptionTrial') : t('onboarding.subscriptionActive')}
                </span>
              </div>
              {subscription.isTrial && subscription.daysRemaining !== null && (
                <p className="text-xs text-muted-foreground">
                  {t('onboarding.trialDaysLeft').replace('{days}', String(subscription.daysRemaining))}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
              {PAID_PLANS.map((code) => {
                const p = PLANS[code];
                const accent = PLAN_ACCENTS[code];
                const Icon = PLAN_ICONS[code];
                const isPopular = code === 'pro';

                return (
                  <Card
                    key={code}
                    className={`relative overflow-visible p-4 pt-7 flex flex-col gap-3 min-w-0 ${accent.border} ${isPopular ? 'ring-1 ring-primary/30' : ''}`}
                  >
                    {isPopular && (
                      <div className="absolute -top-2 right-3 bg-primary text-primary-foreground text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shadow-sm">
                        {t('plan.popular')}
                      </div>
                    )}

                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-7 h-7 rounded-md ${accent.bg} flex items-center justify-center shrink-0`}>
                        <Icon className={`h-3.5 w-3.5 ${accent.icon}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm leading-tight truncate">{p.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{t(`plan.tagline.${code}`)}</p>
                      </div>
                    </div>

                    <div className="flex items-baseline gap-0.5">
                      <span className="text-2xl font-extrabold">{p.price}€</span>
                      <span className="text-xs text-muted-foreground">/{t('plan.month')}</span>
                    </div>

                    <Button
                      size="sm"
                      className="w-full mt-auto whitespace-normal h-auto py-2 text-xs leading-tight"
                      variant={isPopular ? 'default' : 'outline'}
                      onClick={() => handleSelectPlan(code)}
                      disabled={subscribing !== null}
                    >
                      {subscribing === code ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : null}
                      {t('onboarding.startTrial')}
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Continue button — available once Stripe is connected */}
      {isConnected && (
        <Button onClick={onComplete} className="w-full gap-2">
          <CreditCard className="w-4 h-4" />
          {t('onboarding.continue')}
        </Button>
      )}
    </div>
  );
}
