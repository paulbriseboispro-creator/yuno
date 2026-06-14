import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useOrganizerOnboarding } from '@/hooks/useOrganizerOnboarding';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { OrgOnboardingProgress } from '@/components/organizer-onboarding/OrgOnboardingProgress';
import { OrgOnboardingStepWelcome } from '@/components/organizer-onboarding/OrgOnboardingStepWelcome';
import { OrgOnboardingStepIdentity } from '@/components/organizer-onboarding/OrgOnboardingStepIdentity';
import { OrgOnboardingStepPublic } from '@/components/organizer-onboarding/OrgOnboardingStepPublic';
import { OrgOnboardingStepStripe } from '@/components/organizer-onboarding/OrgOnboardingStepStripe';
import { OrgOnboardingStepFirstEvent } from '@/components/organizer-onboarding/OrgOnboardingStepFirstEvent';
import { OrgOnboardingStepTeam } from '@/components/organizer-onboarding/OrgOnboardingStepTeam';
import { OrgOnboardingStepTour } from '@/components/organizer-onboarding/OrgOnboardingStepTour';
import { ArrowLeft, Rocket } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrandedLoader } from '@/components/BrandedLoader';

const TOTAL_STEPS = 7;

export default function OrgAppOnboarding() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const userId = user?.id ?? null;
  const {
    loading,
    currentStep,
    stepStatuses,
    isComplete,
    completeStep,
    skipStep,
    goToStep,
  } = useOrganizerOnboarding(userId);

  const { refresh: refreshStripe } = useOrganizerStripe(userId);
  const stripeHandled = useRef(false);

  // Detect Stripe return → auto-complete step 4
  useEffect(() => {
    if (stripeHandled.current) return;
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'success' || stripeParam === 'refresh') {
      stripeHandled.current = true;
      searchParams.delete('stripe');
      setSearchParams(searchParams, { replace: true });
      refreshStripe().then(() => {
        if (currentStep === 4 && stripeParam === 'success') {
          completeStep(4);
        }
      });
    }
  }, [searchParams, setSearchParams, refreshStripe, currentStep, completeStep]);

  // When fully complete → go to dashboard.
  // Use a hard navigation (not SPA navigate) so the route guard re-reads the
  // freshly-written `onboarding_completed` from the DB. The cached profile in
  // useProfileType would otherwise still report `false` and bounce the user
  // straight back into onboarding (the "restart to step 0" bug).
  useEffect(() => {
    if (!loading && isComplete) {
      window.location.assign('/organizer-app');
    }
  }, [isComplete, loading]);

  if (loading || !userId) return <BrandedLoader />;

  const completedCount = Object.values(stepStatuses).filter(
    s => s.status === 'completed' || s.status === 'skipped'
  ).length;
  const progress = Math.round((completedCount / TOTAL_STEPS) * 100);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <OrgOnboardingStepWelcome userId={userId} onComplete={() => completeStep(1)} />;
      case 2:
        return <OrgOnboardingStepIdentity userId={userId} onComplete={() => completeStep(2)} onSkip={() => skipStep(2)} />;
      case 3:
        return <OrgOnboardingStepPublic userId={userId} onComplete={() => completeStep(3)} onSkip={() => skipStep(3)} />;
      case 4:
        return <OrgOnboardingStepStripe userId={userId} onComplete={() => completeStep(4)} onSkip={() => skipStep(4)} />;
      case 5:
        return <OrgOnboardingStepFirstEvent userId={userId} onComplete={() => completeStep(5)} onSkip={() => skipStep(5)} />;
      case 6:
        return <OrgOnboardingStepTeam onComplete={() => completeStep(6)} onSkip={() => skipStep(6)} />;
      case 7:
        return <OrgOnboardingStepTour onComplete={() => completeStep(7)} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="min-h-[100dvh] dashboard-gradient-bg flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-30 bg-background/70 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3 flex items-center gap-3"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
      >
        <button onClick={() => navigate('/')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold truncate">{tt('Configuration de votre organisation', 'Set up your organization')}</h1>
          <p className="text-xs text-muted-foreground">
            {progress}% {tt('terminé', 'complete')} · {tt('Étape', 'Step')} {currentStep}/{TOTAL_STEPS}
          </p>
        </div>
        <Rocket className="w-5 h-5 text-primary" />
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-muted">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex flex-col lg:flex-row max-w-6xl mx-auto w-full">
        <aside className="hidden lg:block w-72 border-r border-white/[0.06] p-4 flex-shrink-0">
          <OrgOnboardingProgress
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
                    s === currentStep
                      ? 'w-8 bg-primary'
                      : status === 'completed'
                      ? 'w-4 bg-emerald-500'
                      : status === 'skipped'
                      ? 'w-4 bg-amber-500'
                      : 'w-4 bg-muted'
                  }`}
                  aria-label={`Step ${s}`}
                />
              );
            })}
          </div>
        </div>

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
