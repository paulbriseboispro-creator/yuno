import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail, setDemoPlan } from '@/lib/demoPlan';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { PLANS, PLAN_ORDER, PlanCode, FeatureKey, BillingCycle, planPrice, annualSavings, ANNUAL_BILLED_MONTHS, SUBSCRIPTIONS_ENABLED } from '@/lib/planFeatures';
import { Check, AlertTriangle, CreditCard, ExternalLink, AlertCircle, Loader2, Crown, Zap, Rocket, Shield, RefreshCw, Sparkles, ShieldCheck, Banknote, Receipt, Lock, Gem } from 'lucide-react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Display-only feature lists for the pricing page. The functional gate lives in
// planFeatures.ts — these must mirror that bucketing. `key` is optional so we can
// list cap-based perks (unlimited staff, branding removed) that aren't FeatureKeys.
type DisplayFeature = { key?: FeatureKey; labelKey: string };

// Core does a LOT for free (the strategy: never paywall what makes GMV).
const CORE_FEATURES_LIST: DisplayFeature[] = [
  { key: 'events', labelKey: 'plan.feature.events' },
  { key: 'entry_qr', labelKey: 'plan.feature.entryQr' },
  { key: 'guest_list', labelKey: 'plan.feature.guestList' },
  { key: 'orders_qr', labelKey: 'plan.feature.ordersQr' },
  { key: 'menu', labelKey: 'plan.feature.menu' },
  { key: 'vip_tables_basic', labelKey: 'plan.feature.vipTablesBasic' },
  { key: 'scarcity_tools', labelKey: 'plan.feature.scarcityTools' },
  { key: 'djs_connect', labelKey: 'plan.feature.djsConnect' },
  { key: 'organizations_connect', labelKey: 'plan.feature.organizationsConnect' },
  { key: 'promoters_basic', labelKey: 'plan.feature.promotersBasic' },
  { key: 'staff_pin', labelKey: 'plan.feature.staffPin' },
  { key: 'invoices_refunds', labelKey: 'plan.feature.invoicesRefunds' },
  { key: 'analytics_tickets', labelKey: 'plan.feature.analyticsTickets' },
  { key: 'analytics_basic', labelKey: 'plan.feature.analyticsBasic' },
  { key: 'email_campaigns_informational', labelKey: 'plan.feature.emailCampaignsInfo' },
];

// Essential: caps lifted (unlimited staff + branding removed) + first marketing tools.
const ESSENTIAL_FEATURES: DisplayFeature[] = [
  { labelKey: 'plan.feature.unlimitedStaff' },
  { labelKey: 'plan.feature.noBranding' },
  { key: 'email_campaigns_promotional', labelKey: 'plan.feature.emailCampaignsPromo' },
  { key: 'clients_basic', labelKey: 'plan.feature.clientsBasic' },
  { key: 'promoters', labelKey: 'plan.feature.promoters' },
];

const PRO_ONLY_FEATURES: DisplayFeature[] = [
  { key: 'analytics_advanced', labelKey: 'plan.feature.analyticsAdvanced' },
  { key: 'exports_csv', labelKey: 'plan.feature.exportsCsv' },
  { key: 'vip_tables', labelKey: 'plan.feature.vipTables' },
  { key: 'vip_service', labelKey: 'plan.feature.vipService' },
  { key: 'djs_orchestrate', labelKey: 'plan.feature.djsOrchestrate' },
  { key: 'organizations_orchestrate', labelKey: 'plan.feature.organizationsOrchestrate' },
  { key: 'live_night', labelKey: 'plan.feature.liveNight' },
  { key: 'offers_upsell', labelKey: 'plan.feature.offersUpsell' },
  { key: 'loyalty_crm', labelKey: 'plan.feature.loyaltyCrm' },
  { key: 'hype_analysis', labelKey: 'plan.feature.hypeAnalysis' },
  { key: 'client_leaderboard', labelKey: 'plan.feature.clientLeaderboard' },
  { key: 'personalization_advanced', labelKey: 'plan.feature.personalizationAdvanced' },
];

// Elite adds only unbuilt pillars — shown as "Bientôt", the tier is not purchasable.
const ELITE_ONLY_FEATURES: DisplayFeature[] = [
  { labelKey: 'plan.feature.multiVenue' },
  { labelKey: 'plan.feature.api' },
];

const PLAN_ICONS: Record<PlanCode, typeof Zap> = {
  core: Shield, collab: Shield, essential: Zap, pro: Rocket, elite: Crown,
};

type PlanAccent = { accent: string; glow: string; bg: string; badge: string };
const PLAN_ACCENTS: Record<PlanCode, PlanAccent> = {
  core:      { accent: T3,         glow: 'rgba(255,255,255,0.06)',  bg: 'rgba(255,255,255,0.04)',  badge: T3 },
  collab:    { accent: T3,         glow: 'rgba(255,255,255,0.06)',  bg: 'rgba(255,255,255,0.04)',  badge: T3 },
  essential: { accent: '#60A5FA',  glow: 'rgba(96,165,250,0.15)',   bg: 'rgba(96,165,250,0.08)',   badge: '#60A5FA' },
  pro:       { accent: RED,        glow: `rgba(232,25,44,0.18)`,    bg: `rgba(232,25,44,0.07)`,    badge: RED },
  elite:     { accent: '#A78BFA',  glow: 'rgba(167,139,250,0.18)',  bg: 'rgba(167,139,250,0.07)',  badge: '#A78BFA' },
};

function FeatureRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Check className="w-3 h-3 flex-shrink-0" style={{ color: POS }} />
      <span style={{ color: T2, fontSize: 11.5 }}>{label}</span>
    </div>
  );
}

export default function OwnerBilling() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { venueId } = useOwnerVenue();
  const { plan, status, isTrial, daysRemaining, currentPeriodEnd, isEarlyAdopter, priceLocked, billingInterval, loading, refreshPlan } = useSubscriptionPlan();
  const { stripeStatus, loading: stripeLoading, startOnboarding, openDashboard, refreshStatus, manageSubscription } = useStripeConnect(venueId);
  const [subscribing, setSubscribing] = useState<PlanCode | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const [searchParams, setSearchParams] = useSearchParams();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => {
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'success') {
      toast.success(t('plan.stripeOnboardingSuccess'));
      searchParams.delete('stripe'); setSearchParams(searchParams, { replace: true }); refreshStatus();
    } else if (stripeParam === 'refresh') {
      toast.error(t('plan.stripeOnboardingIncomplete'));
      searchParams.delete('stripe'); setSearchParams(searchParams, { replace: true });
    }
    const subParam = searchParams.get('subscription');
    if (subParam === 'success') {
      toast.success(t('plan.subscriptionActivated'));
      searchParams.delete('subscription'); setSearchParams(searchParams, { replace: true }); refreshPlan();
    } else if (subParam === 'canceled') {
      toast.info(t('plan.subscriptionCanceled'));
      searchParams.delete('subscription'); setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSubscribe = async (planCode: PlanCode) => {
    if (!venueId) return;
    // Aperçu lecture seule : même la bascule de plan démo (localStorage) est bloquée.
    if (isPreviewActive()) { toast.error('Aperçu en lecture seule'); return; }
    // Elite is not purchasable at launch — the backend rejects it too (defense in depth).
    if (planCode === 'elite') { toast.info(t('plan.comingSoon')); return; }
    // Comptes démo @womber.fr : bascule instantanée du plan, sans Stripe ni edge
    // function (CORS-lock yunoapp.eu). Le hook relit l'override localStorage.
    if (isDemoEmail(user?.email)) {
      setDemoPlan(planCode);
      toast.success(t('plan.planChanged'));
      refreshPlan();
      return;
    }
    setSubscribing(planCode);
    try {
      const { data, error } = await supabase.functions.invoke('club-subscription', { body: { action: 'create', venueId, planCode, billingCycle: cycle } });
      if (error) throw error;
      if (data?.code === 'PAYMENTS_DISABLED') { toast.error(t('payments.disabledBanner')); }
      else if (data?.updated) { toast.success(t('plan.planChanged')); refreshPlan(); }
      else if (data?.url) { window.open(data.url, '_blank'); }
      else if (data?.error) { toast.error(data.error); }
    } catch { toast.error(t('plan.subscribeError')); }
    finally { setSubscribing(null); }
  };

  if (loading) return <OwnerPageSkeleton />;

  const currentPlanInfo = PLANS[plan];
  const isCore = plan === 'core';
  const isActive = isCore || status === 'active' || status === 'trialing';
  const isPastDue = status === 'past_due';

  const getFeaturesForPlan = (code: PlanCode) => {
    const groups: { title: string; features: { key: FeatureKey; labelKey: string }[] }[] = [
      { title: t('plan.coreFeatures'), features: CORE_FEATURES_LIST },
    ];
    if (code === 'essential' || code === 'pro' || code === 'elite') groups.push({ title: t('plan.essentialFeatures'), features: ESSENTIAL_FEATURES });
    if (code === 'pro' || code === 'elite') groups.push({ title: t('plan.proFeatures'), features: PRO_ONLY_FEATURES });
    if (code === 'elite') groups.push({ title: t('plan.eliteFeatures'), features: ELITE_ONLY_FEATURES });
    return groups;
  };

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      {/* Abonnement coupé (lancement) : la page ne montre que Stripe Connect → titre « Paiements ». */}
      <OwnerHeader title={t(SUBSCRIPTIONS_ENABLED ? 'plan.billing' : 'plan.payments')} showBackButton backTo="/owner/dashboard" />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-5">

        {/* Banners */}
        {SUBSCRIPTIONS_ENABLED && isPastDue && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.25)' }}>
            <AlertTriangle className="h-4 w-4 flex-shrink-0" style={{ color: RED }} />
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('plan.paymentPending')}</p>
              <p style={{ color: T2, fontSize: 12, marginTop: 1 }}>{t('plan.paymentPendingDesc')}</p>
            </div>
            <button onClick={manageSubscription}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold flex-shrink-0 cursor-pointer"
              style={{ background: RED, color: '#fff' }}>
              {t('plan.resolvePayment')}
            </button>
          </div>
        )}

        {SUBSCRIPTIONS_ENABLED && isTrial && daysRemaining !== null && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={isEarlyAdopter
              ? { background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.2)' }
              : { background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)' }}>
            {isEarlyAdopter
              ? <Gem className="h-4 w-4 flex-shrink-0" style={{ color: '#A78BFA' }} />
              : <Sparkles className="h-4 w-4 flex-shrink-0" style={{ color: POS }} />}
            <p style={{ color: isEarlyAdopter ? '#A78BFA' : POS, fontSize: 13, fontWeight: 500 }}>
              {(isEarlyAdopter ? t('plan.earlyAccessActive') : t('plan.trialActive')).replace('{days}', String(daysRemaining))}
            </p>
          </div>
        )}

        {/* Current Plan Card */}
        {SUBSCRIPTIONS_ENABLED && (
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 24 }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                {t('plan.currentPlan')}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <p style={{ color: T1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {currentPlanInfo.name}
                </p>
                {isEarlyAdopter && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider"
                    style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', color: '#A78BFA' }}>
                    <Gem className="w-3 h-3" />{t('plan.earlyAdopterBadge')}
                  </span>
                )}
                {priceLocked && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider"
                    style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }}>
                    <Lock className="w-3 h-3" />{t('plan.priceLockedBadge')}
                  </span>
                )}
              </div>
              <p style={{ color: T2, fontSize: 13, marginTop: 3 }}>
                {isCore
                  ? t('plan.ticketFeesOnly')
                  : billingInterval === 'annual'
                    ? `${currentPlanInfo.priceAnnual}€ / ${t('plan.year')}`
                    : `${currentPlanInfo.price}€ / ${t('plan.month')}`}
              </p>
              {!isCore && currentPeriodEnd && isActive && (
                <p style={{ color: T3, fontSize: 12, marginTop: 4 }}>
                  {t('plan.nextRenewal')} : {format(new Date(currentPeriodEnd), 'd MMMM yyyy', { locale: dateLocale })}
                </p>
              )}
              {isCore && <p style={{ color: T3, fontSize: 12, marginTop: 4 }}>{t('plan.upgradeFullExperience')}</p>}
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold"
              style={isActive
                ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }
                : isPastDue
                  ? { background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: RED }
                  : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T3 }
              }>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: isActive ? POS : isPastDue ? RED : T3 }} />
              {isCore ? 'Yuno Core' : isActive ? t('plan.active') : isPastDue ? t('plan.pastDue') : t('plan.inactive')}
            </span>
          </div>
          {!isCore && isActive && (
            <button onClick={manageSubscription}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12.5px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
              <CreditCard className="w-4 h-4" />{t('plan.managePayment')}
            </button>
          )}
        </div>
        )}

        {/* Stripe Connect */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 24 }}>
          <p style={{ color: T1, fontSize: 14.5, fontWeight: 600, marginBottom: 2 }}>{t('plan.stripeAccount')}</p>
          <p style={{ color: T3, fontSize: 12.5, marginBottom: 16 }}>{t('plan.stripeAccountDesc')}</p>

          {stripeLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} />
            </div>
          ) : !stripeStatus.connected ? (
            <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: T3 }} />
                <span style={{ color: T2, fontSize: 13 }}>{t('plan.stripeConnectPrompt')}</span>
              </div>
              <button onClick={() => startOnboarding()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold w-fit cursor-pointer transition-all duration-150"
                style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}>
                <CreditCard className="w-4 h-4" />{t('plan.connectStripe')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4" style={{ color: POS }} />
                <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{t('plan.stripeConnected')}</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                  style={stripeStatus.chargesEnabled
                    ? { background: 'rgba(52,211,153,0.1)', color: POS }
                    : { background: 'rgba(232,25,44,0.08)', color: RED }}>
                  {stripeStatus.chargesEnabled ? t('plan.active') : t('plan.stripeConfigRequired')}
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={openDashboard}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                  <ExternalLink className="w-3.5 h-3.5" />{t('plan.stripeDashboard')}
                </button>
                {!stripeStatus.chargesEnabled && (
                  <button onClick={() => startOnboarding()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold cursor-pointer"
                    style={{ background: RED, color: '#fff' }}>
                    {t('plan.finishConfig')}
                  </button>
                )}
                <button onClick={refreshStatus}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3 }}>
                  <RefreshCw className="w-3.5 h-3.5" />{t('plan.refresh')}
                </button>
              </div>
            </div>
          )}

          {/* About Stripe — reassurance for owners new to Stripe */}
          <div className="mt-4 p-4 rounded-xl space-y-3" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0" style={{ background: 'rgba(99,91,255,0.14)' }}>
                <Lock className="w-3.5 h-3.5" style={{ color: '#8B85FF' }} />
              </div>
              <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('plan.stripeAboutTitle')}</p>
            </div>
            <p style={{ color: T2, fontSize: 12, lineHeight: 1.55 }}>{t('plan.stripeAboutIntro')}</p>
            <div className="space-y-2.5 pt-0.5">
              {[
                { icon: ShieldCheck, color: POS, title: t('plan.stripeSecureTitle'), desc: t('plan.stripeSecureDesc') },
                { icon: Banknote, color: '#60A5FA', title: t('plan.stripePayoutTitle'), desc: t('plan.stripePayoutDesc') },
                { icon: Receipt, color: T2, title: t('plan.stripeFeesTitle'), desc: t('plan.stripeFeesDesc') },
              ].map(({ icon: Icon, color, title, desc }, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
                  <div>
                    <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{title}</p>
                    <p style={{ color: T3, fontSize: 12, lineHeight: 1.5, marginTop: 1 }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Plan Comparison */}
        {SUBSCRIPTIONS_ENABLED && (
        <div>
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <p style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('plan.comparePlans')}</p>
            {/* Monthly / Annual toggle */}
            <div className="inline-flex items-center p-1 rounded-full" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              {(['monthly', 'annual'] as BillingCycle[]).map((c) => {
                const active = cycle === c;
                return (
                  <button key={c} onClick={() => setCycle(c)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-all duration-150"
                    style={active
                      ? { background: '#fff', color: '#0a0a0c' }
                      : { background: 'transparent', color: T2 }}>
                    {c === 'monthly' ? t('plan.monthly') : t('plan.annual')}
                    {c === 'annual' && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide"
                        style={active
                          ? { background: 'rgba(52,211,153,0.16)', color: '#059669' }
                          : { background: 'rgba(52,211,153,0.12)', color: POS }}>
                        {t('plan.twoMonthsFree')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PLAN_ORDER.filter(code => code !== 'collab' || plan === 'collab').map((code, i) => {
              const p = PLANS[code];
              const isCurrent = isCore ? code === 'core' : (plan === code && isActive);
              const acc = PLAN_ACCENTS[code];
              const Icon = PLAN_ICONS[code];
              const isPopular = code === 'pro';
              const isComingSoon = code === 'elite'; // not purchasable at launch (features unbuilt)
              const isUpgrade = code !== 'core' && PLAN_ORDER.indexOf(code) > PLAN_ORDER.indexOf(plan);
              const isDowngrade = PLAN_ORDER.indexOf(code) < PLAN_ORDER.indexOf(plan) && !isCore && isActive;

              return (
                <motion.div key={code} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                  className="flex flex-col"
                  style={{
                    borderRadius: 18,
                    border: isCurrent ? `1.5px solid ${acc.accent}` : `1px solid ${BORDER}`,
                    background: isCurrent
                      ? `linear-gradient(180deg,${acc.bg} 0%,rgba(255,255,255,.005) 100%),#0a0a0c`
                      : CARD_BG,
                    boxShadow: isCurrent ? `0 0 28px -8px ${acc.glow}, ${CARD_SHADOW}` : CARD_SHADOW,
                    overflow: 'hidden',
                    position: 'relative',
                    opacity: isComingSoon ? 0.82 : 1,
                  }}>
                  {/* Popular ribbon */}
                  {isPopular && !isCurrent && (
                    <div className="absolute top-0 right-0 px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
                      style={{ background: RED, color: '#fff', borderBottomLeftRadius: 10 }}>
                      {t('plan.popular')}
                    </div>
                  )}
                  {/* Coming-soon ribbon — Elite is defined but not purchasable at launch */}
                  {isComingSoon && !isCurrent && (
                    <div className="absolute top-0 right-0 px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
                      style={{ background: acc.accent, color: '#fff', borderBottomLeftRadius: 10 }}>
                      {t('plan.comingSoon')}
                    </div>
                  )}
                  {/* Current ribbon */}
                  {isCurrent && (
                    <div className="py-1.5 text-center text-[11px] font-bold uppercase tracking-widest"
                      style={{ background: acc.accent, color: '#000' }}>
                      {t('plan.yourPlan')}
                    </div>
                  )}

                  <div className="flex flex-col flex-1 p-5 gap-4">
                    {/* Plan name + icon */}
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: acc.bg, border: `1px solid ${isCurrent ? acc.accent : BORDER}` }}>
                        <Icon className="w-4 h-4" style={{ color: acc.accent }} />
                      </div>
                      <div>
                        <p style={{ color: T1, fontSize: 14, fontWeight: 700 }}>{p.name}</p>
                        <p style={{ color: T3, fontSize: 11 }}>{t(`plan.tagline.${code}`)}</p>
                      </div>
                    </div>

                    {/* Price — always lead with a per-month number; show yearly savings below */}
                    <div style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 14 }}>
                      {code === 'core' ? (
                        <p style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{t('plan.ticketFeesOnly')}</p>
                      ) : cycle === 'annual' ? (
                        <div>
                          <div className="flex items-baseline gap-1">
                            <span style={{ color: T1, fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>{Math.round(planPrice(code, 'annual') / 12)}€</span>
                            <span style={{ color: T3, fontSize: 12 }}>/{t('plan.month')}</span>
                          </div>
                          <p style={{ color: T3, fontSize: 11, marginTop: 3 }}>{t('plan.billedAnnually')}</p>
                          <p style={{ color: POS, fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                            {t('plan.savePerYear').replace('{amount}', String(annualSavings(code)))}
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span style={{ color: T1, fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>{p.price}€</span>
                          <span style={{ color: T3, fontSize: 12 }}>/{t('plan.month')}</span>
                        </div>
                      )}
                    </div>

                    {/* CTA — Elite has none (not purchasable at launch) */}
                    {isComingSoon ? (
                      <div className="w-full py-2.5 rounded-xl text-[12.5px] font-semibold text-center"
                        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3 }}>
                        {t('plan.comingSoon')}
                      </div>
                    ) : !isCurrent && code !== 'core' && (
                      <button
                        onClick={() => handleSubscribe(code)}
                        disabled={subscribing !== null}
                        className="w-full py-2.5 rounded-xl text-[12.5px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-50"
                        style={isUpgrade || isPopular
                          ? { background: acc.accent, color: '#fff', boxShadow: `0 0 18px -6px ${acc.glow}` }
                          : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }
                        }>
                        {subscribing === code ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                          : isUpgrade ? t('plan.upgrade') : isDowngrade ? t('plan.downgrade') : t('plan.subscribe')}
                      </button>
                    )}

                    {/* Features */}
                    <div className="flex-1 space-y-4">
                      {getFeaturesForPlan(code).map(group => (
                        <div key={group.title} className="space-y-1.5">
                          <p style={{ color: T3, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                            {group.title}
                          </p>
                          {group.features.map(({ labelKey }) => (
                            <FeatureRow key={labelKey} label={t(labelKey)} />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
