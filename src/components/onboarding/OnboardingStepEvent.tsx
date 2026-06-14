import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Check, Calendar, SkipForward } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  venueId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingStepEvent({ venueId, onComplete, onSkip }: Props) {
  const { t } = useLanguage();
  const [eventCount, setEventCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const { count } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId);
      setEventCount(count || 0);
      setLoading(false);
    };
    check();
  }, [venueId]);

  const hasEvent = eventCount > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step7Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step7Desc')}</p>
      </div>

      <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
        <p className="text-xs text-primary font-medium">{t('onboarding.recommended')}</p>
      </div>

      {loading ? (
        <div className="h-12 flex items-center"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : hasEvent ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
          <Check className="w-5 h-5 text-green-500" />
          <span className="text-sm font-medium text-green-500">
            {eventCount} {t('onboarding.eventsCreated')}
          </span>
        </div>
      ) : null}

      <Button variant="outline" asChild className="w-full gap-2">
        <Link to="/owner/events">
          <Calendar className="w-4 h-4" />
          {t('onboarding.goToEventsPage')}
        </Link>
      </Button>

      <div className="flex gap-2">
        {hasEvent ? (
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
