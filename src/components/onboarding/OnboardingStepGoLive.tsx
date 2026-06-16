import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Check, X, Rocket, Eye, ExternalLink, PartyPopper } from 'lucide-react';
import type { StepState, Pillar } from '@/hooks/useOwnerOnboarding';
import { REQUIRED_STEPS, OPTIONAL_STEPS } from '@/hooks/useOwnerOnboarding';
import { StepHeader, PrimaryButton, GhostButton, InnerCard, RED, POS, T1, T2, T3, BORDER } from './onboardingUI';

interface Props {
  venueId: string;
  venueSlug?: string;
  pillars: Pillar[];
  stepStatuses: Record<string, StepState>;
  onComplete: () => void;
}

const STEP_LABEL_KEYS: Record<string, string> = {
  '1': 'onboarding.step1Title',
  '2': 'onboarding.step2Title',
  '3': 'onboarding.step3Title',
  '4': 'onboarding.step4Title',
  '5': 'onboarding.step5Title',
  '6': 'onboarding.step6Title',
};

export function OnboardingStepGoLive({ venueId, venueSlug, pillars, stepStatuses, onComplete }: Props) {
  const { t } = useLanguage();
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const isDone = (k: string) => stepStatuses[k]?.status === 'completed' || stepStatuses[k]?.status === 'skipped';
  const coreReady = REQUIRED_STEPS.every(isDone);
  const previewUrl = venueSlug ? `/club/${venueSlug}` : `/club/${venueId}`;

  const handlePublish = async () => {
    if (!coreReady) return;
    setPublishing(true);
    try {
      const { error } = await supabase.from('venues').update({ is_hidden: false } as any).eq('id', venueId);
      if (error) throw error;
      setPublished(true);
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setPublishing(false);
    }
  };

  // ── Celebration ──
  if (published) {
    return (
      <div className="text-center py-6 space-y-5">
        <motion.div
          initial={{ scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 16 }}
          className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)' }}
        >
          <PartyPopper className="w-9 h-9" style={{ color: RED }} />
        </motion.div>
        <div>
          <h2 style={{ color: T1, fontSize: 22, fontWeight: 680, letterSpacing: '-0.02em' }}>{t('onboarding.liveTitle')}</h2>
          <p style={{ color: T2, fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }} className="max-w-sm mx-auto">
            {t('onboarding.liveDesc')}
          </p>
        </div>
        <div className="flex flex-col gap-2.5 max-w-xs mx-auto">
          <GhostButton fullWidth icon={Eye} onClick={() => window.open(previewUrl, '_blank')}>
            {t('onboarding.viewLivePage')}
          </GhostButton>
          <PrimaryButton fullWidth icon={Rocket} onClick={onComplete}>
            {t('onboarding.goToDashboard')}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader icon={Rocket} accent title={t('onboarding.step7Title')} subtitle={t('onboarding.step7Desc')} />

      {/* Required checklist */}
      <div>
        <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
          {t('onboarding.requiredSection')}
        </p>
        <div className="space-y-2">
          {REQUIRED_STEPS.map(k => {
            const done = isDone(k);
            return (
              <div
                key={k}
                className="flex items-center gap-3 rounded-xl"
                style={{
                  padding: '11px 14px',
                  background: done ? 'rgba(52,211,153,0.07)' : 'rgba(255,255,255,0.025)',
                  border: done ? '1px solid rgba(52,211,153,0.2)' : `1px solid ${BORDER}`,
                }}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-none"
                  style={done ? { background: POS, color: '#04130d' } : { border: `1.5px solid ${BORDER}` }}
                >
                  {done ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" style={{ color: T3 }} />}
                </div>
                <span style={{ color: done ? T1 : T2, fontSize: 13.5, fontWeight: 500 }}>{t(STEP_LABEL_KEYS[k])}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Optional checklist */}
      <div>
        <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
          {t('onboarding.optionalSection')}
        </p>
        <div className="space-y-2">
          {OPTIONAL_STEPS.map(k => {
            const done = stepStatuses[k]?.status === 'completed';
            return (
              <div key={k} className="flex items-center gap-3 rounded-xl" style={{ padding: '11px 14px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}` }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-none" style={done ? { background: POS, color: '#04130d' } : { border: `1.5px solid ${BORDER}` }}>
                  {done && <Check className="w-3 h-3" />}
                </div>
                <span style={{ color: done ? T1 : T3, fontSize: 13.5, fontWeight: 500 }}>{t(STEP_LABEL_KEYS[k])}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Order-flow explainer (drinks pillar only) */}
      {pillars.includes('drinks') && (
        <InnerCard>
          <h3 style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>{t('onboarding.orderFlowTitle')}</h3>
          <ol className="space-y-2">
            {['onboarding.orderFlow1', 'onboarding.orderFlow2', 'onboarding.orderFlow3', 'onboarding.orderFlow4'].map((key, i) => (
              <li key={key} className="flex items-center gap-2.5">
                <span className="w-5 h-5 rounded-full flex items-center justify-center flex-none tabular-nums" style={{ background: 'rgba(255,255,255,0.05)', color: T2, fontSize: 11, fontWeight: 600 }}>
                  {i + 1}
                </span>
                <span style={{ color: T2, fontSize: 12.5 }}>{t(key)}</span>
              </li>
            ))}
          </ol>
        </InnerCard>
      )}

      {/* Preview */}
      <GhostButton fullWidth icon={Eye} onClick={() => window.open(previewUrl, '_blank')}>
        {t('onboarding.previewAsClient')}
        <ExternalLink className="w-3.5 h-3.5" />
      </GhostButton>

      {!coreReady && (
        <p style={{ color: '#FCD34D', fontSize: 12.5, lineHeight: 1.45 }}>{t('onboarding.goLiveWarning')}</p>
      )}

      <PrimaryButton fullWidth icon={Rocket} onClick={handlePublish} disabled={!coreReady} loading={publishing}>
        {t('onboarding.finishOnboarding')}
      </PrimaryButton>
    </div>
  );
}
