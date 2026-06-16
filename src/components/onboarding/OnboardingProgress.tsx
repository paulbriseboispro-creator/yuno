import { useLanguage } from '@/contexts/LanguageContext';
import { Check, SkipForward } from 'lucide-react';
import { RED, T1, T2, T3, POS, BORDER } from './onboardingUI';
import { OPTIONAL_STEPS, type StepState } from '@/hooks/useOwnerOnboarding';

interface OnboardingProgressProps {
  currentStep: number;
  stepStatuses: Record<string, StepState>;
  onStepClick: (step: number) => void;
}

const STEP_KEYS = [
  'onboarding.step1Title',
  'onboarding.step2Title',
  'onboarding.step3Title',
  'onboarding.step4Title',
  'onboarding.step5Title',
  'onboarding.step6Title',
  'onboarding.step7Title',
];

export function OnboardingProgress({ currentStep, stepStatuses, onStepClick }: OnboardingProgressProps) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col gap-1">
      {STEP_KEYS.map((key, i) => {
        const stepNum = i + 1;
        const step = stepStatuses[String(stepNum)];
        const isActive = currentStep === stepNum;
        const isCompleted = step?.status === 'completed';
        const isSkipped = step?.status === 'skipped';
        const isOptional = OPTIONAL_STEPS.includes(String(stepNum));

        return (
          <button
            key={stepNum}
            onClick={() => onStepClick(stepNum)}
            className="group relative flex items-center gap-3 px-3 py-2.5 w-full text-left rounded-xl transition-all cursor-pointer"
            style={
              isActive
                ? { background: 'rgba(232,25,44,0.09)', border: '1px solid rgba(232,25,44,0.22)' }
                : { border: '1px solid transparent' }
            }
          >
            <div
              className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={
                isCompleted
                  ? { background: POS, color: '#04130d' }
                  : isSkipped
                  ? { background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T3 }
                  : isActive
                  ? { background: 'rgba(232,25,44,0.18)', border: `1px solid ${RED}`, color: RED }
                  : { border: `1px solid ${BORDER}`, color: T3 }
              }
            >
              {isCompleted ? <Check className="w-3.5 h-3.5" /> : isSkipped ? <SkipForward className="w-3 h-3" /> : stepNum}
            </div>
            <span
              className="truncate flex-1"
              style={{
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? T1 : isCompleted ? T2 : T3,
              }}
            >
              {t(key)}
            </span>
            {isOptional && !isCompleted && !isSkipped && (
              <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: T3 }}>
                {t('onboarding.optional')}
              </span>
            )}
            {isActive && (
              <span className="absolute right-1 w-1 h-5 rounded-full flex-none" style={{ background: RED, opacity: 0.85 }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
