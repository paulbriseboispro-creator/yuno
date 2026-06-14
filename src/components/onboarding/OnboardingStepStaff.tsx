import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Check, Users, SkipForward } from 'lucide-react';
import { Link } from 'react-router-dom';

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
      // Count profiles with venue_id that have staff roles
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
      <div>
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step5Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step5Desc')}</p>
      </div>

      <div className="rounded-lg bg-muted/50 border border-border p-4 space-y-3">
        <h3 className="font-semibold text-sm">{t('onboarding.staffPinExplain')}</h3>
        <p className="text-sm text-muted-foreground">{t('onboarding.staffPinDetail')}</p>
      </div>

      {loading ? (
        <div className="h-12 flex items-center"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : hasStaff ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
          <Check className="w-5 h-5 text-green-500" />
          <span className="text-sm font-medium text-green-500">
            {staffCount} {t('onboarding.staffConfigured')}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-muted border border-border">
          <Users className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t('onboarding.noStaffYet')}</span>
        </div>
      )}

      <Button variant="outline" asChild className="w-full gap-2">
        <Link to="/owner/staff">
          <Users className="w-4 h-4" />
          {t('onboarding.goToStaffPage')}
        </Link>
      </Button>

      <div className="flex gap-2">
        {hasStaff ? (
          <Button onClick={onComplete} className="flex-1">
            {t('onboarding.continue')}
          </Button>
        ) : (
          <Button variant="outline" onClick={onSkip} className="flex-1 gap-2">
            <SkipForward className="w-4 h-4" />
            {t('onboarding.skipForNow')}
          </Button>
        )}
      </div>
    </div>
  );
}
