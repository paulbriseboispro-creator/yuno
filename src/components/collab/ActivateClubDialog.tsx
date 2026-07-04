import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Loader2, Rocket, PartyPopper, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { isDemoEmail, setDemoPlan } from '@/lib/demoPlan';
import { isPreviewActive } from '@/contexts/PreviewModeContext';

interface ActivateClubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueName?: string;
  organizerName?: string;
}

/**
 * Activation gratuite du compte club — période de lancement (abonnement coupé).
 *
 * Close de conversion des clubs en plan `collab` : au lieu d'un upsell payant,
 * un clic transforme la démo partenaire en vrai compte club autonome, à 0€.
 * Appelle `club-subscription` action `activate_free` (le serveur résout le venue
 * via venues.owner_id et vérifie la propriété), puis refreshPlan() débloque
 * l'interface en direct — les bandeaux lecture seule disparaissent sous les yeux
 * du club, et l'état de succès enchaîne sur la première action utile.
 */
export function ActivateClubDialog({ open, onOpenChange, venueName, organizerName }: ActivateClubDialogProps) {
  const { user } = useAuth();
  const { refreshPlan } = useSubscriptionPlan();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const unlocks = [
    tt('Vos propres soirées, billets et tables VIP', 'Your own nights, tickets and VIP tables', 'Tus propias noches, entradas y mesas VIP'),
    tt('Votre carte boissons, commandée depuis le téléphone', 'Your drinks menu, ordered from the phone', 'Tu carta de bebidas, pedida desde el móvil'),
    tt('Votre staff avec PIN (barman, videur, hôte VIP…)', 'Your staff with PINs (bartender, bouncer, VIP host…)', 'Tu staff con PIN (barman, portero, anfitrión VIP…)'),
    tt('Campagnes email, CRM clients et fidélité', 'Email campaigns, customer CRM and loyalty', 'Campañas de email, CRM de clientes y fidelidad'),
    tt('Analytics complètes + exports CSV / PDF', 'Full analytics + CSV / PDF exports', 'Analytics completas + exportes CSV / PDF'),
  ];

  const handleActivate = async () => {
    // Aperçu lecture seule : aucune écriture, même l'activation.
    if (isPreviewActive()) { toast.error('Aperçu en lecture seule'); return; }
    // Comptes démo @womber.fr : bascule localStorage, sans edge function
    // (CORS-lock yunoapp.eu) — le hook relit l'override et débloque en direct.
    if (isDemoEmail(user?.email)) {
      setDemoPlan('pro');
      setActivated(true);
      refreshPlan();
      return;
    }
    setActivating(true);
    try {
      const { data, error } = await supabase.functions.invoke('club-subscription', {
        body: { action: 'activate_free' },
      });
      if (error) throw error;
      if (data?.code === 'not_owner') {
        toast.error(tt(
          'Seul le propriétaire du club peut activer le compte.',
          'Only the venue owner can activate the club.',
          'Solo el propietario del club puede activar la cuenta.',
        ));
        return;
      }
      if (!data?.activated) throw new Error(data?.error || 'activation failed');
      setActivated(true);
      refreshPlan();
    } catch {
      toast.error(tt(
        "L'activation a échoué. Réessayez dans un instant.",
        'Activation failed. Please try again in a moment.',
        'La activación falló. Inténtalo de nuevo en un momento.',
      ));
    } finally {
      setActivating(false);
    }
  };

  const handleClose = (next: boolean) => {
    onOpenChange(next);
    // Ré-ouvrir plus tard repart de l'écran d'accueil, pas du succès.
    if (!next) setTimeout(() => setActivated(false), 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        {activated ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PartyPopper className="h-5 w-5 text-primary" />
                {tt('Votre club est actif !', 'Your club is live!', '¡Tu club está activo!')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {tt(
                  'Tout est débloqué. Créez votre première soirée, ajoutez votre carte, invitez votre staff — vous pilotez.',
                  'Everything is unlocked. Create your first night, add your menu, invite your staff — you are in charge.',
                  'Todo está desbloqueado. Crea tu primera noche, añade tu carta, invita a tu staff — tú mandas.',
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button className="flex-1" size="lg" onClick={() => { handleClose(false); navigate('/owner/events'); }}>
                  {tt('Créer ma première soirée', 'Create my first night', 'Crear mi primera noche')}
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
                <Button variant="outline" size="lg" onClick={() => handleClose(false)}>
                  {tt('Plus tard', 'Later', 'Más tarde')}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Rocket className="h-5 w-5 text-primary" />
                {tt('Activez votre club — 100% gratuit', 'Activate your club — 100% free', 'Activa tu club — 100% gratis')}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {venueName
                  ? tt(
                      `${venueName} est déjà configuré sur Yuno grâce à votre co-soirée. Un clic, et il devient votre outil du quotidien.`,
                      `${venueName} is already set up on Yuno thanks to your co-hosted night. One click makes it your daily tool.`,
                      `${venueName} ya está configurado en Yuno gracias a tu noche conjunta. Un clic y se convierte en tu herramienta diaria.`,
                    )
                  : tt(
                      'Votre club est déjà configuré sur Yuno grâce à votre co-soirée. Un clic, et il devient votre outil du quotidien.',
                      'Your club is already set up on Yuno thanks to your co-hosted night. One click makes it your daily tool.',
                      'Tu club ya está configurado en Yuno gracias a tu noche conjunta. Un clic y se convierte en tu herramienta diaria.',
                    )}
              </p>

              <ul className="space-y-2">
                {unlocks.map((label, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-sm">
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary/15">
                      <Check className="h-3 w-3 text-primary" />
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {tt('0€ — sans abonnement, sans carte bancaire.', '€0 — no subscription, no credit card.', '0€ — sin suscripción, sin tarjeta.')}
                </span>{' '}
                {tt(
                  'Yuno se rémunère uniquement via les frais de service sur les ventes.',
                  'Yuno only earns through service fees on sales.',
                  'Yuno solo gana con las comisiones de servicio sobre las ventas.',
                )}
              </div>

              <p className="text-[11px] text-muted-foreground">
                {organizerName
                  ? tt(
                      `Votre co-soirée avec ${organizerName} continue exactement pareil, et vous gardez tout votre historique.`,
                      `Your co-hosted night with ${organizerName} continues exactly as is, and you keep all your history.`,
                      `Tu noche conjunta con ${organizerName} sigue exactamente igual, y conservas todo tu historial.`,
                    )
                  : tt(
                      'Vos co-soirées avec vos organisateurs partenaires continuent exactement pareil, et vous gardez tout votre historique.',
                      'Your co-hosted nights with partner organizers continue exactly as is, and you keep all your history.',
                      'Tus noches conjuntas con organizadores siguen exactamente igual, y conservas todo tu historial.',
                    )}
              </p>

              <Button className="w-full" size="lg" onClick={handleActivate} disabled={activating}>
                {activating
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : tt('Activer mon club gratuitement', 'Activate my club for free', 'Activar mi club gratis')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
