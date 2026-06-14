import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useOwnerOnboarding } from '@/hooks/useOwnerOnboarding';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { OnboardingStepBasics } from '@/components/onboarding/OnboardingStepBasics';
import { OnboardingStepDesign } from '@/components/onboarding/OnboardingStepDesign';
import { OnboardingStepBranding } from '@/components/onboarding/OnboardingStepBranding';
import { OnboardingStepStripe } from '@/components/onboarding/OnboardingStepStripe';
import { OnboardingStepStaff } from '@/components/onboarding/OnboardingStepStaff';
import { OnboardingStepMenu } from '@/components/onboarding/OnboardingStepMenu';
import { OnboardingStepEvent } from '@/components/onboarding/OnboardingStepEvent';
import { OnboardingStepPreview } from '@/components/onboarding/OnboardingStepPreview';
import { OnboardingStepGoLive } from '@/components/onboarding/OnboardingStepGoLive';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Rocket } from 'lucide-react';
import { BrandedLoader } from '@/components/BrandedLoader';
import { motion, AnimatePresence } from 'framer-motion';

const TOTAL_STEPS = 9;

export default function OwnerOnboarding() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { venueId, venue, loading: venueLoading } = useOwnerVenue();
  const {
    loading: onbLoading,
    currentStep,
    stepStatuses,
    isComplete,
    completeStep,
    skipStep,
    goToStep,
  } = useOwnerOnboarding(venueId);
  const { stripeStatus, subscription, loading: stripeLoading, refreshStatus, startOnboarding, startSubscription, checkSubscription } = useStripeConnect(venueId);
  const stripeHandled = useRef(false);

  // Detect ?stripe=success return and auto-complete step 4 (Stripe)
  useEffect(() => {
    if (stripeHandled.current) return;
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'success' || stripeParam === 'refresh') {
      stripeHandled.current = true;
      searchParams.delete('stripe');
      setSearchParams(searchParams, { replace: true });
      refreshStatus().then(() => {
        if (currentStep === 4) {
          completeStep(4);
        }
      });
    }
  }, [searchParams, setSearchParams, refreshStatus, currentStep, completeStep]);

  // Auto-complete step 4 if Stripe is already connected (e.g. from venue settings page)
  useEffect(() => {
    if (
      !stripeLoading &&
      stripeStatus.connected &&
      currentStep === 4 &&
      stepStatuses['4']?.status !== 'completed' &&
      stepStatuses['4']?.status !== 'skipped'
    ) {
      // Don't auto-advance, but user can click continue
    }
  }, [stripeLoading, stripeStatus.connected, currentStep, stepStatuses]);

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
    s => s.status === 'completed' || s.status === 'skipped'
  ).length;
  const progress = Math.round((completedCount / TOTAL_STEPS) * 100);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <OnboardingStepBasics venueId={venueId} onComplete={() => completeStep(1)} />;
      case 2:
        return <OnboardingStepDesign venueId={venueId} onComplete={() => completeStep(2)} onSkip={() => skipStep(2)} />;
      case 3:
        return <OnboardingStepBranding venueId={venueId} onComplete={() => completeStep(3)} onSkip={() => skipStep(3)} />;
      case 4:
        return (
          <OnboardingStepStripe
            venueId={venueId}
            onComplete={() => completeStep(4)}
            stripeStatus={stripeStatus}
            subscription={subscription}
            loading={stripeLoading}
            startOnboarding={startOnboarding}
            refreshStatus={refreshStatus}
            startSubscription={startSubscription}
            checkSubscription={checkSubscription}
          />
        );
      case 5:
        return (
          <OnboardingStepStaff
            venueId={venueId}
            onComplete={() => completeStep(5)}
            onSkip={() => skipStep(5)}
          />
        );
      case 6:
        return <OnboardingStepMenu venueId={venueId} onComplete={() => completeStep(6)} />;
      case 7:
        return (
          <OnboardingStepEvent
            venueId={venueId}
            onComplete={() => completeStep(7)}
            onSkip={() => skipStep(7)}
          />
        );
      case 8:
        return (
          <OnboardingStepPreview
            venueId={venueId}
            venueSlug={venue?.name?.toLowerCase().replace(/\s+/g, '-')}
            onComplete={() => completeStep(8)}
          />
        );
      case 9:
        return (
          <OnboardingStepGoLive
            stepStatuses={stepStatuses}
            onComplete={() => completeStep(9)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <button onClick={() => navigate('/owner/dashboard')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-bold">{t('onboarding.title')}</h1>
          <p className="text-xs text-muted-foreground">{progress}% {t('onboarding.complete')}</p>
        </div>
        <Rocket className="w-5 h-5 text-primary" />
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-muted">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex flex-col lg:flex-row max-w-6xl mx-auto w-full">
        {/* Sidebar - desktop only */}
        <aside className="hidden lg:block w-64 border-r border-border p-4 flex-shrink-0">
          <OnboardingProgress
            currentStep={currentStep}
            stepStatuses={stepStatuses}
            onStepClick={goToStep}
          />
        </aside>

        {/* Mobile stepper */}
        <div className="lg:hidden px-4 pt-4 pb-2 overflow-x-auto">
          <div className="flex gap-1.5 min-w-max">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => {
              const status = stepStatuses[String(s)]?.status;
              return (
                <button
                  key={s}
                  onClick={() => goToStep(s)}
                  className={`h-1.5 rounded-full transition-all ${
                    s === currentStep ? 'w-8 bg-primary' :
                    status === 'completed' ? 'w-4 bg-green-500' :
                    status === 'skipped' ? 'w-4 bg-amber-500' :
                    'w-4 bg-muted'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
