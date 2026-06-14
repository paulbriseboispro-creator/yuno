import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Check, SkipForward, ChevronRight, Rocket, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import type { StepState } from '@/hooks/useOwnerOnboarding';

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

const STEP_DESCS = [
  'onboarding.step1Desc',
  'onboarding.step2Desc',
  'onboarding.step3Desc',
  'onboarding.step4Desc',
  'onboarding.step5Desc',
  'onboarding.step6Desc',
  'onboarding.step7Desc',
  'onboarding.step8Desc',
  'onboarding.step9Desc',
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
    s => s.status === 'completed' || s.status === 'skipped'
  ).length;
  const totalSteps = STEP_KEYS.length;
  const progress = Math.round((completedCount / totalSteps) * 100);

  const handleStepClick = (stepNum: number) => {
    setOpen(false);
    navigate('/owner/onboarding');
  };

  return (
    <>
      {/* Floating trigger button — bottom right */}
      <motion.button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2.5 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-shadow"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.5 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
      >
        <Rocket className="w-4 h-4" />
        <div className="flex flex-col items-start">
          <span className="text-xs font-semibold leading-tight">{t('onboarding.title')}</span>
          <span className="text-[10px] opacity-80">{completedCount}/{totalSteps} — {progress}%</span>
        </div>
        {/* Mini progress ring */}
        <div className="relative w-8 h-8 ml-1">
          <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" opacity={0.2} />
            <circle
              cx="16" cy="16" r="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray={`${(progress / 100) * 81.68} 81.68`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold">
            {progress}%
          </span>
        </div>
      </motion.button>

      {/* Sidebar Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 bg-background border-l border-border flex flex-col">
          {/* Header */}
          <div className="px-5 pt-5 pb-4 border-b border-border space-y-3">
            <SheetHeader className="p-0">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Rocket className="w-5 h-5 text-primary" />
                {t('onboarding.title')}
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{completedCount} / {totalSteps} {t('onboarding.complete')}</span>
                <span className="font-medium text-foreground">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </div>

          {/* Steps list */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
            {STEP_KEYS.map((key, i) => {
              const stepNum = i + 1;
              const step = stepStatuses[String(stepNum)];
              const isCompleted = step?.status === 'completed';
              const isSkipped = step?.status === 'skipped';
              const isCurrent = currentStep === stepNum;
              const isDone = isCompleted || isSkipped;

              return (
                <button
                  key={stepNum}
                  onClick={() => handleStepClick(stepNum)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all group',
                    isCurrent && !isDone && 'bg-primary/10 border border-primary/30',
                    !isCurrent && 'hover:bg-muted/50',
                  )}
                >
                  {/* Step indicator */}
                  <div className={cn(
                    'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors',
                    isCompleted && 'bg-green-500 border-green-500 text-white',
                    isSkipped && 'bg-amber-500/20 border-amber-500/40 text-amber-500',
                    isCurrent && !isDone && 'border-primary bg-primary/20 text-primary',
                    !isCurrent && !isDone && 'border-border text-muted-foreground',
                  )}>
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : isSkipped ? (
                      <SkipForward className="w-3 h-3" />
                    ) : (
                      stepNum
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <span className={cn(
                      'text-sm block truncate',
                      isDone && 'text-muted-foreground line-through',
                      isCurrent && !isDone && 'font-semibold text-foreground',
                      !isCurrent && !isDone && 'text-foreground',
                    )}>
                      {t(key)}
                    </span>
                    {isCurrent && !isDone && (
                      <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {t(STEP_DESCS[i])}
                      </span>
                    )}
                  </div>

                  {/* Arrow for current */}
                  {isCurrent && !isDone && (
                    <ChevronRight className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer CTA */}
          <div className="px-5 py-4 border-t border-border">
            <Button 
              onClick={() => {
                setOpen(false);
                navigate('/owner/onboarding');
              }}
              className="w-full"
              size="lg"
            >
              <Rocket className="w-4 h-4 mr-2" />
              {t('onboarding.continue')}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
