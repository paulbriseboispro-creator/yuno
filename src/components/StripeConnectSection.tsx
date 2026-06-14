import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CreditCard, Check, AlertCircle, ExternalLink, Loader2, Clock, Gift } from 'lucide-react';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { useLanguage } from '@/contexts/LanguageContext';

interface StripeConnectSectionProps {
  venueId: string | null;
}

export function StripeConnectSection({ venueId }: StripeConnectSectionProps) {
  const { t } = useLanguage();
  const { stripeStatus, subscription, loading, startOnboarding, openDashboard, startSubscription, refreshStatus, manageSubscription 
  } = useStripeConnect(venueId);

  if (loading) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const renderSubscriptionSection = () => {
    const { status, isTrial, daysRemaining, currentPeriodEnd } = subscription;

    // Trialing
    if (status === 'trialing' && isTrial) {
      return (
        <div className="flex flex-col gap-3 p-4 bg-green-500/10 rounded-lg border border-green-500/20">
          <div className="flex items-center gap-2 flex-wrap">
            <Gift className="h-5 w-5 text-green-500" />
            <span className="font-medium">{t('owner.yunoSubscription')}</span>
            <Badge variant="default" className="bg-green-500">{t('owner.trialBadge')}</Badge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{t('owner.trialDaysRemaining').replace('{days}', String(daysRemaining ?? 0))}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('owner.trialBillingIn').replace('{days}', String(daysRemaining ?? 0))}
          </p>
          <Button variant="outline" size="sm" onClick={manageSubscription} className="w-full sm:w-auto">
            <ExternalLink className="h-4 w-4 mr-2" />
            {t('owner.manageSubscription')}
          </Button>
        </div>
      );
    }

    // Active
    if (status === 'active') {
      return (
        <div className="flex flex-col gap-3 p-4 bg-green-500/10 rounded-lg border border-green-500/20">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-500" />
            <span className="font-medium">{t('owner.subscriptionActive')}</span>
            <Badge variant="default" className="bg-green-500">{t('owner.stripeActive')}</Badge>
          </div>
          {currentPeriodEnd && (
            <p className="text-sm text-muted-foreground">
              {t('owner.nextRenewal')}: {new Date(currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={manageSubscription} className="w-full sm:w-auto">
            <ExternalLink className="h-4 w-4 mr-2" />
            {t('owner.manageSubscription')}
          </Button>
        </div>
      );
    }

    // Past due
    if (status === 'past_due') {
      return (
        <div className="flex flex-col gap-3 p-4 bg-orange-500/10 rounded-lg border border-orange-500/20">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            <span className="font-medium">{t('owner.paymentFailed')}</span>
            <Badge variant="destructive">{t('owner.paymentFailed')}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t('owner.updatePaymentPrompt')}</p>
          <Button onClick={manageSubscription} className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600">
            <CreditCard className="h-4 w-4 mr-2" />
            {t('owner.updatePayment')}
          </Button>
        </div>
      );
    }

    // Inactive / canceled
    return (
      <div className="flex flex-col gap-3 p-4 bg-muted/50 rounded-lg">
        <p className="text-muted-foreground text-sm">
          {t('owner.subscribePrompt')}
        </p>
        <Button onClick={() => startSubscription()} className="w-full sm:w-auto">
          <Gift className="h-4 w-4 mr-2" />
          {t('owner.startFreeTrial')}
        </Button>
      </div>
    );
  };

  return (
    <Card className="mb-6 border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          {t('owner.stripeTitle')}
        </CardTitle>
        <CardDescription>{t('owner.stripeDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stripe Connect Status */}
        <div className="space-y-4">
          <h3 className="font-medium">{t('owner.stripeAccount')}</h3>
          {!stripeStatus.connected ? (
            <div className="flex flex-col gap-3 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-5 w-5" />
                <span>{t('owner.stripeConnectPrompt')}</span>
              </div>
              <Button onClick={() => startOnboarding()} className="w-full sm:w-auto">
                <CreditCard className="h-4 w-4 mr-2" />
                {t('owner.connectStripe')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-500" />
                <span className="font-medium">{t('owner.stripeConnected')}</span>
                {stripeStatus.chargesEnabled ? (
                  <Badge variant="default" className="bg-green-500">{t('owner.stripeActive')}</Badge>
                ) : (
                  <Badge variant="destructive">{t('owner.stripeConfigRequired')}</Badge>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={openDashboard}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('owner.stripeDashboard')}
                </Button>
                {!stripeStatus.chargesEnabled && (
                  <Button size="sm" onClick={() => startOnboarding()}>
                    {t('owner.finishConfig')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={refreshStatus}>
                  {t('owner.refresh')}
                </Button>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Subscription Status */}
        <div className="space-y-4">
          <h3 className="font-medium">{t('owner.yunoSubscription')}</h3>
          {renderSubscriptionSection()}
        </div>

        {/* Commission Info */}
        <div className="p-4 bg-muted/30 rounded-lg text-sm text-muted-foreground">
          <p className="font-medium mb-2">{t('owner.yunoCommissions')}</p>
          <ul className="list-disc list-inside space-y-1">
            <li>{t('owner.stripeCommissionDrinks')}</li>
            <li>{t('owner.stripeCommissionTickets')}</li>
            <li>{t('owner.stripeCommissionTables')}</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
