import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { SUBSCRIPTIONS_ENABLED } from '@/lib/planFeatures';
import { ActivateClubDialog } from '@/components/collab/ActivateClubDialog';

interface CollabReadOnlyBannerProps {
  /** What the user is trying to do, already translated (e.g. t('collab.action.createEvent')) */
  action?: string;
}

/**
 * Inline banner shown at the top of owner pages when the venue is in
 * Collab demo mode. Reframes the restriction positively: the org handles
 * creation, the club gets a free Pro demo.
 */
export function CollabReadOnlyBanner({ action }: CollabReadOnlyBannerProps) {
  const { isReadOnly } = useCollabReadOnly();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [dialogOpen, setDialogOpen] = useState(false);
  if (!isReadOnly) return null;

  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20">
          <Eye className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t('collab.demoTitle')}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {action
              ? t('collab.demoWithAction').replace('{action}', action)
              : t('collab.demoDefault')}
            {' '}
            {SUBSCRIPTIONS_ENABLED
              ? t('collab.upgradeHint')
              : tt(
                  'Activez votre propre compte club — gratuit — pour le piloter au quotidien.',
                  'Activate your own club account — free — to run it day to day.',
                  'Activa tu propia cuenta de club — gratis — para gestionarlo a diario.',
                )}
          </p>
        </div>
      </div>
      {/* Abonnement coupé (lancement) : le CTA déclenche l'activation GRATUITE
          du compte club au lieu de l'upsell Pro payant. */}
      {SUBSCRIPTIONS_ENABLED ? (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to="/owner/billing">
            {t('collab.activatePro')}
            <ArrowRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setDialogOpen(true)}>
          {tt('Activer mon club — gratuit', 'Activate my club — free', 'Activar mi club — gratis')}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      )}
      <ActivateClubDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
