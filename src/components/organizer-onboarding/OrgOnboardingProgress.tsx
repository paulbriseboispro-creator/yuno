import { Check, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StepState } from '@/hooks/useOrganizerOnboarding';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

interface Props {
  currentStep: number;
  stepStatuses: Record<string, StepState>;
  onStepClick: (step: number) => void;
}

export function OrgOnboardingProgress({ currentStep, stepStatuses, onStepClick }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const STEPS = [
    tt('Bienvenue', 'Welcome'),
    tt('Identité visuelle', 'Visual identity'),
    tt('Profil public', 'Public profile'),
    tt('Paiements Stripe', 'Stripe payments'),
    tt('Premier événement', 'First event'),
    tt('Équipe & promoteurs', 'Team & promoters'),
    tt("Tour de l'app", 'App tour'),
  ];

  return (
    <div className="flex flex-col gap-1">
      {STEPS.map((label, i) => {
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
              isCompleted && !isActive && 'text-emerald-400',
            )}
          >
            <div
              className={cn(
                'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border',
                isCompleted && 'bg-emerald-500 border-emerald-500 text-white',
                isSkipped && 'bg-muted border-muted-foreground/30 text-muted-foreground',
                isActive && !isCompleted && 'border-primary bg-primary/20 text-primary',
                !isActive && !isCompleted && !isSkipped && 'border-border text-muted-foreground',
              )}
            >
              {isCompleted ? <Check className="w-3.5 h-3.5" /> : isSkipped ? <SkipForward className="w-3 h-3" /> : stepNum}
            </div>
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
