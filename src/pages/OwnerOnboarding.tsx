import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useOwnerOnboarding, TOTAL_STEPS, type Pillar } from '@/hooks/useOwnerOnboarding';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { OnboardingStepWelcome } from '@/components/onboarding/OnboardingStepWelcome';
import { OnboardingStepBasics } from '@/components/onboarding/OnboardingStepBasics';
import { OnboardingStepStripe } from '@/components/onboarding/OnboardingStepStripe';
import { OnboardingStepOffer } from '@/components/onboarding/OnboardingStepOffer';
import { OnboardingStepPolish } from '@/components/onboarding/OnboardingStepPolish';
import { OnboardingStepStaff } from '@/components/onboarding/OnboardingStepStaff';
import { OnboardingStepGoLive } from '@/components/onboarding/OnboardingStepGoLive';
import { OnbCard, RED, T1, T2, T3, C_FAINT, BORDER } from '@/components/onboarding/onboardingUI';
import { ArrowLeft, Rocket } from 'lucide-react';
import { BrandedLoader } from '@/components/BrandedLoader';
import { motion, AnimatePresence } from 'framer-motion';

const STEP_TITLE_KEYS = [
  'onboarding.step1Title',
  'onboarding.step2Title',
  'onboarding.step3Title',
  'onboarding.step4Title',
  'onboarding.step5Title',
  'onboarding.step6Title',
  'onboarding.step7Title',
];

export default function OwnerOnboarding() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { venueId, venue, loading: venueLoading } = useOwnerVenue();
  const {
    loading: onbLoading,
    currentStep,
    stepStatuses,
    pillars,
    isComplete,
    completeStep,
    skipStep,
    goToStep,
  } = useOwnerOnboarding(venueId);
  const { stripeStatus, subscription, loading: stripeLoading, refreshStatus, startOnboarding, startSubscription, checkSubscription } = useStripeConnect(venueId);
  const stripeHandled = useRef(false);

  // Detect ?stripe=success return and auto-complete the Payments step (step 3)
  useEffect(() => {
    if (stripeHandled.current) return;
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'success' || stripeParam === 'refresh') {
      stripeHandled.current = true;
      searchParams.delete('stripe');
      setSearchParams(searchParams, { replace: true });
      refreshStatus().then(() => {
        if (currentStep === 3) completeStep(3);
      });
    }
  }, [searchParams, setSearchParams, refreshStatus, currentStep, completeStep]);

  useEffect(() => {
    if (!onbLoading && isComplete) {
      navigate('/owner/dashboard', { replace: true });
    }
  }, [isComplete, onbLoading, navigate]);

  if (venueLoading || onbLoading) return <BrandedLoader />;
  if (!venueId) {
    navigate('/owner/dashboard');
    return null;
  }

  const completedCount = Object.values(stepStatuses).filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;
  const progress = Math.round((completedCount / TOTAL_STEPS) * 100);
  const venueSlug = venue?.name?.toLowerCase().replace(/\s+/g, '-');

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <OnboardingStepWelcome
            venueId={venueId}
            initialPillars={pillars}
            onComplete={(p: Pillar[]) => completeStep(1, { pillars: p })}
          />
        );
      case 2:
        return <OnboardingStepBasics venueId={venueId} onComplete={() => completeStep(2)} />;
      case 3:
        return (
          <OnboardingStepStripe
            venueId={venueId}
            onComplete={() => completeStep(3)}
            stripeStatus={stripeStatus}
            subscription={subscription}
            loading={stripeLoading}
            startOnboarding={startOnboarding}
            refreshStatus={refreshStatus}
            startSubscription={startSubscription}
            checkSubscription={checkSubscription}
          />
        );
      case 4:
        return <OnboardingStepOffer venueId={venueId} pillars={pillars} onComplete={() => completeStep(4)} />;
      case 5:
        return <OnboardingStepPolish venueId={venueId} onComplete={() => completeStep(5)} onSkip={() => skipStep(5)} />;
      case 6:
        return <OnboardingStepStaff venueId={venueId} onComplete={() => completeStep(6)} onSkip={() => skipStep(6)} />;
      case 7:
        return (
          <OnboardingStepGoLive
            venueId={venueId}
            venueSlug={venueSlug}
            pillars={pillars}
            stepStatuses={stepStatuses}
            onComplete={() => completeStep(7)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="min-h-[100dvh] flex flex-col"
      style={{ background: '#000', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Ambient vignette */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }}
      />

      {/* Header */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3 backdrop-blur-xl"
        style={{
          background: 'rgba(10,10,12,0.82)',
          borderBottom: `1px solid ${BORDER}`,
          paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
        }}
      >
        <button
          onClick={() => navigate('/owner/dashboard')}
          className="flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.05]"
          style={{ color: T2 }}
          aria-label="Back"
        >
          <ArrowLeft className="w-[18px] h-[18px]" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 style={{ color: T1, fontSize: 14, fontWeight: 640, letterSpacing: '-0.01em', margin: 0 }}>
            {t('onboarding.title')}
          </h1>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }} className="tabular-nums">
            {progress}% · {t('onboarding.stepCounter').replace('{n}', String(Math.min(currentStep, TOTAL_STEPS))).replace('{total}', String(TOTAL_STEPS))}
          </p>
        </div>
        <div
          className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
        >
          <Rocket className="w-4 h-4" style={{ color: RED }} />
        </div>
      </div>

      {/* Progress track */}
      <div className="w-full relative z-10" style={{ height: 2, background: C_FAINT }}>
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${progress}%`, background: RED, boxShadow: `0 0 12px -2px ${RED}` }}
        />
      </div>

      <div className="relative z-10 flex-1 flex flex-col lg:flex-row max-w-5xl mx-auto w-full">
        {/* Desktop nav rail */}
        <aside className="hidden lg:block w-64 p-4 flex-shrink-0" style={{ borderRight: `1px solid ${BORDER}` }}>
          <OnboardingProgress currentStep={currentStep} stepStatuses={stepStatuses} onStepClick={goToStep} />
        </aside>

        {/* Mobile stepper — labeled segments */}
        <div className="lg:hidden px-4 pt-4 pb-1">
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => {
              const status = stepStatuses[String(s)]?.status;
              const active = s === currentStep;
              const done = status === 'completed' || status === 'skipped';
              return (
                <button
                  key={s}
                  onClick={() => goToStep(s)}
                  className="flex-1 rounded-full transition-all cursor-pointer"
                  style={{
                    height: 3,
                    background: active ? RED : done ? 'rgba(52,211,153,0.55)' : C_FAINT,
                    boxShadow: active ? `0 0 10px -2px ${RED}` : 'none',
                  }}
                  aria-label={t(STEP_TITLE_KEYS[s - 1])}
                />
              );
            })}
          </div>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 8 }}>
            {t(STEP_TITLE_KEYS[Math.min(currentStep, TOTAL_STEPS) - 1])}
          </p>
        </div>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24">
          <div className="max-w-2xl mx-auto w-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <OnbCard padding={24}>{renderStep()}</OnbCard>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
