import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan, PLANS } from '@/lib/planFeatures';

/**
 * Permanent banner shown to clubs on the auto-granted "collab" plan.
 * Positive framing: this is a FREE Pro demo — the club has access to
 * everything (analytics, CRM, VIP, hype…). The only limit is creation
 * (handled by the partner org). Goal: convert into a paying Pro customer.
 */
export function CollabUpsellBanner() {
  const { plan } = useSubscriptionPlan();
  if (!isCollabPlan(plan)) return null;

  const target = PLANS.pro;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-4 sm:p-5 mb-4">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Démo Yuno gratuite via votre orga partenaire
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pendant cette soirée collab, vous découvrez les modules clés de Yuno : <span className="font-medium text-foreground">analytics, soirée en direct, hype, fidélité & CRM, clients</span>. De quoi mesurer la vraie valeur de Yuno pour votre club.
            </p>
          </div>
        </div>
        <div className="rounded-lg bg-background/40 border border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Limites de la démo :</span> la création (événements, tickets, tables, menu) est gérée par l'orga, et certains outils avancés (Story Builder, rareté, VIP service, offres, promoteurs…) restent réservés aux abonnements payants. Passez à Yuno {target.name} pour tout débloquer.
        </div>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <Link to="/owner/billing">
            Activer {target.name} — {target.price}€/mois
            <ArrowRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
