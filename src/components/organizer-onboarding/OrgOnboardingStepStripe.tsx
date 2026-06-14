import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { Button } from '@/components/ui/button';
import { CreditCard, ShieldCheck, Zap, ExternalLink, CheckCircle2 } from 'lucide-react';

interface Props {
  userId: string;
  onComplete: () => void;
  onSkip?: () => void;
}

export function OrgOnboardingStepStripe({ userId, onComplete, onSkip }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { canSell, status, loading, startOnboarding, openDashboard } = useOrganizerStripe(userId);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" />
          {tt('Activer les paiements', 'Activate payments')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {tt(
            "Connectez votre compte Stripe pour vendre des billets. Les revenus arrivent directement sur votre compte bancaire.",
            'Connect your Stripe account to sell tickets. Revenue lands directly in your bank account.'
          )}
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <Benefit icon={Zap} title={tt('Paiements instantanés', 'Instant payouts')} desc={tt('Reçus en J+2 sur votre IBAN.', 'Settled in 2 days to your IBAN.')} />
          <Benefit icon={ShieldCheck} title={tt('Sécurisé Stripe', 'Stripe-secured')} desc={tt('Conformité PCI & 3DS automatique.', 'PCI & 3DS handled.')} />
          <Benefit icon={CreditCard} title={tt('Apple Pay & Cartes', 'Apple Pay & cards')} desc={tt('Tous les moyens de paiement.', 'All payment methods.')} />
        </div>

        <div className="rounded-lg bg-primary/5 border border-primary/10 p-4 text-xs text-muted-foreground">
          {tt(
            'Frais Yuno : max(0,99 € ; 4 %) par billet vendu. Frais Stripe : 1,5 % + 0,25 €. Tout est transparent et déduit avant versement.',
            'Yuno fee: max(€0.99; 4%) per ticket sold. Stripe fee: 1.5% + €0.25. Fully transparent, deducted before payout.'
          )}
        </div>

        {canSell ? (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-sm">{tt('Stripe connecté ✓', 'Stripe connected ✓')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tt('Vous pouvez vendre dès maintenant.', 'You can start selling right now.')}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={openDashboard}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              {tt('Dashboard', 'Dashboard')}
            </Button>
          </div>
        ) : status === 'pending' ? (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 text-sm">
            <p className="font-medium">{tt('Onboarding incomplet', 'Onboarding incomplete')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tt(
                'Reprenez votre configuration Stripe pour pouvoir vendre.',
                'Resume your Stripe setup to start selling.'
              )}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        {!canSell ? (
          <>
            <Button onClick={startOnboarding} disabled={loading} className="w-full" size="lg">
              <CreditCard className="h-4 w-4 mr-2" />
              {status === 'pending' ? tt('Reprendre Stripe', 'Resume Stripe') : tt('Connecter Stripe', 'Connect Stripe')}
            </Button>
            {onSkip && (
              <Button onClick={onSkip} variant="ghost" className="w-full" size="lg">
                {tt('Configurer plus tard', 'Set up later')}
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground text-center">
              {tt(
                'Vous pourrez activer les paiements à tout moment depuis Réglages. La vente de billets ne sera possible qu’une fois Stripe connecté.',
                'You can activate payments anytime from Settings. Ticket sales only become possible once Stripe is connected.'
              )}
            </p>
          </>
        ) : (
          <Button onClick={onComplete} className="w-full" size="lg">
            {tt('Continuer', 'Continue')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Benefit({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
      <Icon className="h-4 w-4 text-primary mb-1.5" />
      <div className="text-xs font-medium">{title}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
    </div>
  );
}
