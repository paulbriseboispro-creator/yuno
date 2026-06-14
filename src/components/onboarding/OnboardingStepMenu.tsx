import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Check, UtensilsCrossed } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  venueId: string;
  onComplete: () => void;
}

export function OnboardingStepMenu({ venueId, onComplete }: Props) {
  const { t } = useLanguage();
  const [drinkCount, setDrinkCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const { count } = await supabase
        .from('drinks')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId);
      setDrinkCount(count || 0);
      setLoading(false);
    };
    check();
  }, [venueId]);

  const hasMenu = drinkCount > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step6Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step6Desc')}</p>
      </div>

      {loading ? (
        <div className="h-12 flex items-center"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : hasMenu ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
          <Check className="w-5 h-5 text-green-500" />
          <span className="text-sm font-medium text-green-500">
            {drinkCount} {t('onboarding.drinksConfigured')}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-muted border border-border">
          <UtensilsCrossed className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t('onboarding.noMenuYet')}</span>
        </div>
      )}

      <Button variant="outline" asChild className="w-full gap-2">
        <Link to="/owner/menu">
          <UtensilsCrossed className="w-4 h-4" />
          {t('onboarding.goToMenuPage')}
        </Link>
      </Button>

      {hasMenu && (
        <Button onClick={onComplete} className="w-full">
          {t('onboarding.continue')}
        </Button>
      )}
    </div>
  );
}
