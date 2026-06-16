import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Check, Users, SkipForward, ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StepHeader, PrimaryButton, GhostButton, InnerCard, DoneRow, OptionalPill, POS, T1, T2, T3, BORDER, TILE_BG } from './onboardingUI';

interface Props {
  venueId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingStepStaff({ venueId, onComplete, onSkip }: Props) {
  const { t } = useLanguage();
  const [staffCount, setStaffCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .not('employee_pin', 'is', null);
      setStaffCount(count || 0);
      setLoading(false);
    };
    check();
  }, [venueId]);

  const hasStaff = staffCount > 0;

  return (
    <div className="space-y-6">
      <StepHeader
        icon={Users}
        title={t('onboarding.step6Title')}
        subtitle={t('onboarding.step6Desc')}
        right={<OptionalPill label={t('onboarding.optional')} />}
      />

      <InnerCard>
        <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('onboarding.staffPinExplain')}</h3>
        <p style={{ color: T3, fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>{t('onboarding.staffPinDetail')}</p>
      </InnerCard>

      {loading ? (
        <div className="h-10" />
      ) : hasStaff ? (
        <DoneRow>
          <Check className="w-5 h-5 flex-none" style={{ color: POS }} />
          <span className="tabular-nums" style={{ color: POS, fontSize: 13, fontWeight: 600 }}>
            {staffCount} {t('onboarding.staffConfigured')}
          </span>
        </DoneRow>
      ) : null}

      <Link
        to="/owner/staff"
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-medium cursor-pointer transition-colors hover:bg-white/[0.04]"
        style={{ padding: '11px 18px', background: TILE_BG, border: `1px solid ${BORDER}`, color: T2 }}
      >
        <Users className="w-4 h-4" />
        {t('onboarding.goToStaffPage')}
        <ExternalLink className="w-3.5 h-3.5" />
      </Link>

      {hasStaff ? (
        <PrimaryButton fullWidth icon={ArrowRight} onClick={onComplete}>
          {t('onboarding.continue')}
        </PrimaryButton>
      ) : (
        <GhostButton fullWidth icon={SkipForward} onClick={onSkip}>
          {t('onboarding.skipForNow')}
        </GhostButton>
      )}
    </div>
  );
}
