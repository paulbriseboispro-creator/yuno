import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Check, X, Rocket } from 'lucide-react';
import type { StepState } from '@/hooks/useOwnerOnboarding';

interface Props {
  stepStatuses: Record<string, StepState>;
  onComplete: () => void;
}

const REQUIRED_STEPS = [
  { step: '1', key: 'onboarding.checkBasics' },
  { step: '2', key: 'onboarding.checkDesign' },
  { step: '3', key: 'onboarding.checkBranding' },
  { step: '4', key: 'onboarding.checkStripe' },
  { step: '5', key: 'onboarding.checkStaff' },
  { step: '6', key: 'onboarding.checkMenu' },
];

export function OnboardingStepGoLive({ stepStatuses, onComplete }: Props) {
  const { t } = useLanguage();

  const allReady = REQUIRED_STEPS.every(
    r => stepStatuses[r.step]?.status === 'completed' || stepStatuses[r.step]?.status === 'skipped'
  );
  const coreReady = ['1', '4', '6'].every(
    k => stepStatuses[k]?.status === 'completed'
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step9Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step9Desc')}</p>
      </div>

      <div className="space-y-3">
        {REQUIRED_STEPS.map(({ step, key }) => {
          const done = stepStatuses[step]?.status === 'completed';
          const skipped = stepStatuses[step]?.status === 'skipped';
          return (
            <div
              key={step}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                done ? 'bg-green-500/10 border-green-500/30' : skipped ? 'bg-amber-500/10 border-amber-500/30' : 'bg-muted border-border'
              }`}
            >
              {done ? (
                <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
              ) : (
                <X className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              )}
              <span className={`text-sm ${done ? 'text-green-500' : 'text-muted-foreground'}`}>
                {t(key)}
              </span>
            </div>
          );
        })}
      </div>

      {!coreReady && (
        <p className="text-sm text-amber-500">{t('onboarding.goLiveWarning')}</p>
      )}

      <Button onClick={onComplete} disabled={!coreReady} className="w-full gap-2">
        <Rocket className="w-4 h-4" />
        {t('onboarding.finishOnboarding')}
      </Button>
    </div>
  );
}
