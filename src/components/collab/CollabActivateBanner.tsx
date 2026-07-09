import { useState } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan, SUBSCRIPTIONS_ENABLED } from '@/lib/planFeatures';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { ActivateClubDialog } from '@/components/collab/ActivateClubDialog';

/**
 * Bannière permanente des clubs en plan `collab` — période de lancement.
 *
 * Remplace l'ancien upsell « Activer Pro — 99€/mois » (CollabUpsellBanner) :
 * l'abonnement est coupé, la conversion visée n'est plus un paiement mais
 * l'ACTIVATION gratuite du compte club pour ses opérations quotidiennes.
 * Cadrage positif : le club voit déjà la valeur pendant la co-soirée ; un clic
 * la transforme en outil à lui, à 0€.
 */
export function CollabActivateBanner() {
  const { plan } = useSubscriptionPlan();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Réservée au monde sans abonnement : si la facturation revient, l'upsell
  // payant devra reprendre cette place.
  if (SUBSCRIPTIONS_ENABLED || !isCollabPlan(plan)) return null;

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
              {tt(
                'Votre club tourne déjà sur Yuno — gratuitement',
                'Your club already runs on Yuno — for free',
                'Tu club ya funciona en Yuno — gratis',
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tt(
                'Pendant cette soirée collab, vous découvrez les modules clés de Yuno : analytics avancées, soirée en direct, VIP service, clients & CRM. Tout ce que vous voyez peut devenir votre outil du quotidien.',
                'During this collab night, you are seeing Yuno\'s key modules: advanced analytics, live night, VIP service, customers & CRM. Everything you see can become your daily tool.',
                'Durante esta noche collab descubres los módulos clave de Yuno: analytics avanzadas, noche en directo, servicio VIP, clientes y CRM. Todo lo que ves puede convertirse en tu herramienta diaria.',
              )}
            </p>
          </div>
        </div>
        <div className="rounded-lg bg-background/40 border border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">
            {tt('100% gratuit :', '100% free:', '100% gratis:')}
          </span>{' '}
          {tt(
            "activez votre compte club pour créer vos propres soirées, votre carte et votre staff. Sans abonnement, sans carte bancaire — Yuno se rémunère uniquement sur les frais de service des ventes.",
            'activate your club account to create your own nights, menu and staff. No subscription, no credit card — Yuno only earns through service fees on sales.',
            'activa tu cuenta de club para crear tus propias noches, tu carta y tu staff. Sin suscripción, sin tarjeta — Yuno solo gana con las comisiones de servicio sobre las ventas.',
          )}
        </div>
        <Button size="sm" className="w-full sm:w-auto" onClick={() => setDialogOpen(true)}>
          {tt('Activer mon club gratuitement', 'Activate my club for free', 'Activar mi club gratis')}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      <ActivateClubDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
