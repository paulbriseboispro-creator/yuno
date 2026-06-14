import { useLanguage } from '@/contexts/LanguageContext';
import { Check, Circle, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StepState } from '@/hooks/useOwnerOnboarding';

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
  'onboarding.step8Title',
  'onboarding.step9Title',
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

        return (
          <button
            key={stepNum}
            onClick={() => onStepClick(stepNum)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-sm',
              isActive && 'bg-primary/10 border border-primary/30 text-foreground',
              !isActive && 'hover:bg-muted/50 text-muted-foreground',
              isCompleted && !isActive && 'text-green-500',
            )}
          >
            <div className={cn(
              'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border',
              isCompleted && 'bg-green-500 border-green-500 text-white',
              isSkipped && 'bg-muted border-muted-foreground/30 text-muted-foreground',
              isActive && !isCompleted && 'border-primary bg-primary/20 text-primary',
              !isActive && !isCompleted && !isSkipped && 'border-border text-muted-foreground',
            )}>
              {isCompleted ? <Check className="w-3.5 h-3.5" /> : isSkipped ? <SkipForward className="w-3 h-3" /> : stepNum}
            </div>
            <span className="truncate">{t(key)}</span>
          </button>
        );
      })}
    </div>
  );
}
