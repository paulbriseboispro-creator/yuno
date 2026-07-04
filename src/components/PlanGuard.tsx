import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { FeatureKey, PLANS, requiredPlan, SUBSCRIPTIONS_ENABLED } from '@/lib/planFeatures';
import { useLanguage } from '@/contexts/LanguageContext';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { OwnerHeader } from '@/components/OwnerHeader';
import { ReactNode } from 'react';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';

interface PlanGuardProps {
  feature: FeatureKey;
  children: ReactNode;
}

export function PlanGuard({ feature, children }: PlanGuardProps) {
  const { hasFeature, loading } = useSubscriptionPlan();
  const { t } = useLanguage();

  // Abonnement coupé (lancement) : aucun module n'est verrouillé par plan.
  if (!SUBSCRIPTIONS_ENABLED) {
    return <>{children}</>;
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  const required = requiredPlan(feature);
  const planInfo = PLANS[required];

  return (
    <div className="min-h-screen bg-background">
      <OwnerHeader title={t('plan.lockedModule')} showBackButton backTo="/owner/dashboard" />
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">
          {t('plan.featureLocked')}
        </h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          {t('plan.availableWith')} <span className="font-semibold text-foreground">{planInfo.name}</span>
        </p>
        <p className="text-sm text-muted-foreground mb-8 max-w-sm">
          {t('plan.upgradeDescription')}
        </p>
        <Button asChild size="lg">
          <Link to="/owner/billing">
            {t('plan.upgradeTo')} {planInfo.name} — {planInfo.price}€/{t('plan.month')}
          </Link>
        </Button>
      </div>
    </div>
  );
}
