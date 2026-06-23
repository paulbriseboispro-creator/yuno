import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { PLANS, PlanCode, FeatureKey, requiredPlan } from '@/lib/planFeatures';
import { Lock, Check } from 'lucide-react';
import { Link } from 'react-router-dom';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: FeatureKey;
}

const PLAN_HIGHLIGHTS: Record<PlanCode, string[]> = {
  core: [],
  collab: [],
  essential: ['plan.highlight.unlimitedStaff', 'plan.highlight.promoEmail', 'plan.highlight.clientDatabase'],
  pro: ['plan.highlight.loyaltyCrm', 'plan.highlight.advancedAnalytics', 'plan.highlight.djsOrchestrate'],
  elite: ['plan.feature.multiVenue', 'plan.feature.api'],
};

export function UpgradeModal({ open, onOpenChange, feature }: UpgradeModalProps) {
  const { t } = useLanguage();
  const required = requiredPlan(feature);
  const planInfo = PLANS[required];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            {t('plan.upgradeRequired')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            {t('plan.moduleRequires')} <span className="font-semibold text-foreground">{planInfo.name}</span>.
          </p>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
            <p className="font-semibold text-sm">{planInfo.name} — {planInfo.price}€/{t('plan.month')}</p>
            <ul className="space-y-2">
              {(PLAN_HIGHLIGHTS[required] || []).map((key) => (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-primary shrink-0" />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>

          <Button asChild className="w-full" size="lg">
            <Link to="/owner/billing" onClick={() => onOpenChange(false)}>
              {t('plan.seePlans')}
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
