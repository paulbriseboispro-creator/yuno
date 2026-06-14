import { Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface CheckoutStepsProps {
  currentStep: 1 | 2 | 3;
}

export function CheckoutSteps({ currentStep }: CheckoutStepsProps) {
  const { t } = useLanguage();

  const steps = [
    { label: t('checkoutSteps.selection') },
    { label: t('checkoutSteps.summary') },
    { label: t('checkoutSteps.payment') },
  ];

  return (
    <div className="flex items-center w-full max-w-md mx-auto py-2">
      {steps.map((step, i) => {
        const stepNum = i + 1;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;

        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center transition-all"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '10px',
                  fontWeight: 700,
                  border: '1px solid',
                  ...(isCompleted
                    ? { background: '#E8192C', borderColor: '#E8192C', color: '#fff' }
                    : isCurrent
                      ? { background: 'rgba(232,25,44,0.10)', borderColor: 'rgba(232,25,44,0.55)', color: '#E8192C' }
                      : { background: 'transparent', borderColor: 'rgba(255,255,255,0.10)', color: '#3A3A3E' }),
                }}
              >
                {isCompleted ? <Check className="h-3 w-3" strokeWidth={3} /> : stepNum}
              </div>
              <span
                className="font-mono uppercase whitespace-nowrap"
                style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  color: isCurrent ? '#E5E5E5' : isCompleted ? '#E8192C' : '#3A3A3E',
                }}
              >
                {step.label}
              </span>
            </div>

            {i < steps.length - 1 && (
              <div className="flex-1 mx-2.5 mb-[1.1rem]">
                <div
                  className="h-px w-full transition-colors duration-300"
                  style={{ background: stepNum < currentStep ? 'rgba(232,25,44,0.50)' : 'rgba(255,255,255,0.08)' }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
