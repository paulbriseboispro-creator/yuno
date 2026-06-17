import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useOrganizerOnboarding, TOTAL_STEPS } from '@/hooks/useOrganizerOnboarding';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { OrgOnboardingProgress } from '@/components/organizer-onboarding/OrgOnboardingProgress';
import { OrgOnboardingStepWelcome } from '@/components/organizer-onboarding/OrgOnboardingStepWelcome';
import { OrgOnboardingStepStripe } from '@/components/organizer-onboarding/OrgOnboardingStepStripe';
import { OrgOnboardingStepFirstEvent } from '@/components/organizer-onboarding/OrgOnboardingStepFirstEvent';
import { OrgOnboardingStepPublic } from '@/components/organizer-onboarding/OrgOnboardingStepPublic';
import { OrgOnboardingStepTeam } from '@/components/organizer-onboarding/OrgOnboardingStepTeam';
import { OrgOnboardingStepTour } from '@/components/organizer-onboarding/OrgOnboardingStepTour';
import { OnbCard, RED, T1, T2, T3, C_FAINT, BORDER } from '@/components/onboarding/onboardingUI';
import { ArrowLeft, Rocket } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrandedLoader } from '@/components/BrandedLoader';

export default function OrgAppOnboarding() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const STEP_TITLES = [
    tt('Bienvenue', 'Welcome', 'Bienvenida'),
    tt('Paiements', 'Payments', 'Pagos'),
    tt('Premier événement', 'First event', 'Primer evento'),
    tt('Profil public', 'Public profile', 'Perfil público'),
    tt('Équipe & promoteurs', 'Team & promoters', 'Equipo y promotores'),
    tt("Tour de l'app", 'App tour', 'Tour de la app'),
  ];

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

  // Detect Stripe return → auto-complete the Payments step (step 2)
  useEffect(() => {
    if (stripeHandled.current) return;
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'success' || stripeParam === 'refresh') {
      stripeHandled.current = true;
      searchParams.delete('stripe');
      setSearchParams(searchParams, { replace: true });
      refreshStripe().then(() => {
        if (currentStep === 2 && stripeParam === 'success') {
          completeStep(2);
        }
      });
    }
  }, [searchParams, setSearchParams, refreshStripe, currentStep, completeStep]);

  // ?preview=1 : mode démo — on reste sur l'onboarding même complété (pour le
  // montrer en appel), sans rien modifier en base.
  const isPreview = searchParams.get('preview') === '1';
  const previewInit = useRef(false);

  // When fully complete → go to dashboard.
  // Hard navigation (not SPA navigate) so the route guard re-reads the
  // freshly-written `onboarding_completed` instead of bouncing back here.
  useEffect(() => {
    if (!loading && isComplete && !isPreview) {
      window.location.assign('/organizer-app');
    }
  }, [isComplete, loading, isPreview]);

  useEffect(() => {
    if (!loading && isPreview && !previewInit.current) {
      previewInit.current = true;
      goToStep(1);
    }
  }, [loading, isPreview, goToStep]);

  if (loading || !userId) return <BrandedLoader />;

  const completedCount = Object.values(stepStatuses).filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;
  const progress = Math.round((completedCount / TOTAL_STEPS) * 100);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <OrgOnboardingStepWelcome userId={userId} onComplete={() => completeStep(1)} />;
      case 2:
        return <OrgOnboardingStepStripe userId={userId} onComplete={() => completeStep(2)} onSkip={() => skipStep(2)} />;
      case 3:
        return <OrgOnboardingStepFirstEvent userId={userId} onComplete={() => completeStep(3)} onSkip={() => skipStep(3)} />;
      case 4:
        return <OrgOnboardingStepPublic userId={userId} onComplete={() => completeStep(4)} onSkip={() => skipStep(4)} />;
      case 5:
        return <OrgOnboardingStepTeam onComplete={() => completeStep(5)} onSkip={() => skipStep(5)} />;
      case 6:
        return <OrgOnboardingStepTour onComplete={() => completeStep(6)} />;
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
          onClick={() => navigate('/')}
          className="flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.05]"
          style={{ color: T2 }}
          aria-label="Back"
        >
          <ArrowLeft className="w-[18px] h-[18px]" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 style={{ color: T1, fontSize: 14, fontWeight: 640, letterSpacing: '-0.01em', margin: 0 }} className="truncate">
            {tt('Configuration de votre organisation', 'Set up your organization', 'Configuración de tu organización')}
          </h1>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }} className="tabular-nums">
            {progress}% · {tt('Étape', 'Step', 'Paso')} {Math.min(currentStep, TOTAL_STEPS)}/{TOTAL_STEPS}
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
          <OrgOnboardingProgress currentStep={currentStep} stepStatuses={stepStatuses} onStepClick={goToStep} />
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
                  aria-label={STEP_TITLES[s - 1]}
                />
              );
            })}
          </div>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 8 }}>{STEP_TITLES[Math.min(currentStep, TOTAL_STEPS) - 1]}</p>
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
