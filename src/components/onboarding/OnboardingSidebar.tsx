import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Check, SkipForward, ChevronRight, Rocket } from 'lucide-react';
import { motion } from 'framer-motion';
import type { StepState } from '@/hooks/useOwnerOnboarding';
import { TOTAL_STEPS, OPTIONAL_STEPS } from '@/hooks/useOwnerOnboarding';
import { RED, POS, T1, T2, T3, BORDER } from './onboardingUI';

const STEP_KEYS = [
  'onboarding.step1Title',
  'onboarding.step2Title',
  'onboarding.step3Title',
  'onboarding.step4Title',
  'onboarding.step5Title',
  'onboarding.step6Title',
  'onboarding.step7Title',
];

const STEP_DESCS = [
  'onboarding.step1Desc',
  'onboarding.step2Desc',
  'onboarding.step3Desc',
  'onboarding.step4Desc',
  'onboarding.step5Desc',
  'onboarding.step6Desc',
  'onboarding.step7Desc',
];

interface OnboardingSidebarProps {
  currentStep: number;
  stepStatuses: Record<string, StepState>;
}

export function OnboardingSidebar({ currentStep, stepStatuses }: OnboardingSidebarProps) {
  const [open, setOpen] = useState(true);
  const { t } = useLanguage();
  const navigate = useNavigate();

  const completedCount = Object.values(stepStatuses).filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;
  const progress = Math.round((completedCount / TOTAL_STEPS) * 100);
  const circumference = 2 * Math.PI * 13;

  const go = () => {
    setOpen(false);
    navigate('/owner/onboarding');
  };

  return (
    <>
      {/* Floating trigger — bottom right */}
      <motion.button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2.5 rounded-2xl px-4 py-3 cursor-pointer"
        style={{ background: RED, color: '#fff', boxShadow: `0 10px 30px -8px ${RED}99` }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.5 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
      >
        <Rocket className="w-4 h-4" />
        <div className="flex flex-col items-start">
          <span className="text-xs font-semibold leading-tight">{t('onboarding.title')}</span>
          <span className="text-[10px] opacity-80 tabular-nums">{completedCount}/{TOTAL_STEPS} · {progress}%</span>
        </div>
        <div className="relative w-8 h-8 ml-1">
          <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.25} />
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={`${(progress / 100) * circumference} ${circumference}`} strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums">{progress}%</span>
        </div>
      </motion.button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" style={{ background: '#0a0a0c', borderLeft: `1px solid ${BORDER}` }}>
          {/* Header */}
          <div className="px-5 pt-5 pb-4 space-y-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <SheetHeader className="p-0">
              <SheetTitle className="flex items-center gap-2.5" style={{ color: T1, fontSize: 16 }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                  <Rocket className="w-4 h-4" style={{ color: RED }} />
                </div>
                {t('onboarding.title')}
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span style={{ color: T3 }}>{completedCount} / {TOTAL_STEPS} {t('onboarding.complete')}</span>
                <span className="font-semibold" style={{ color: T1 }}>{progress}%</span>
              </div>
              <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: RED }} />
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
            {STEP_KEYS.map((key, i) => {
              const stepNum = i + 1;
              const step = stepStatuses[String(stepNum)];
              const isCompleted = step?.status === 'completed';
              const isSkipped = step?.status === 'skipped';
              const isCurrent = currentStep === stepNum;
              const isDone = isCompleted || isSkipped;
              const isOptional = OPTIONAL_STEPS.includes(String(stepNum));

              return (
                <button
                  key={stepNum}
                  onClick={go}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all cursor-pointer"
                  style={isCurrent && !isDone ? { background: 'rgba(232,25,44,0.09)', border: '1px solid rgba(232,25,44,0.22)' } : { border: '1px solid transparent' }}
                >
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={
                      isCompleted
                        ? { background: POS, color: '#04130d' }
                        : isSkipped
                        ? { background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T3 }
                        : isCurrent
                        ? { background: 'rgba(232,25,44,0.18)', border: `1px solid ${RED}`, color: RED }
                        : { border: `1px solid ${BORDER}`, color: T3 }
                    }
                  >
                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : isSkipped ? <SkipForward className="w-3 h-3" /> : stepNum}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-sm block truncate"
                      style={{
                        color: isCurrent && !isDone ? T1 : isDone ? T3 : T2,
                        fontWeight: isCurrent && !isDone ? 600 : 500,
                        textDecoration: isDone ? 'line-through' : 'none',
                      }}
                    >
                      {t(key)}
                    </span>
                    {isCurrent && !isDone && (
                      <span className="text-xs line-clamp-1 mt-0.5" style={{ color: T3 }}>{t(STEP_DESCS[i])}</span>
                    )}
                  </div>
                  {isOptional && !isDone && (
                    <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: T3 }}>{t('onboarding.optional')}</span>
                  )}
                  {isCurrent && !isDone && <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: RED }} />}
                </button>
              );
            })}
          </div>

          {/* Footer CTA */}
          <div className="px-5 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
            <button
              onClick={go}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold cursor-pointer transition-all"
              style={{ padding: '12px 18px', background: RED, color: '#fff', boxShadow: `0 0 22px -6px ${RED}99` }}
            >
              <Rocket className="w-4 h-4" />
              {t('onboarding.resumeSetup')}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
