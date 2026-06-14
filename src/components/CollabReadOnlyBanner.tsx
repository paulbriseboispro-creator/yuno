import { Link } from 'react-router-dom';
import { Eye, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';

interface CollabReadOnlyBannerProps {
  /** What the user is trying to do, e.g. "créer un événement" */
  action?: string;
}

/**
 * Inline banner shown at the top of owner pages when the venue is in
 * Collab demo mode. Reframes the restriction positively: the org handles
 * creation, the club gets a free Pro demo.
 */
export function CollabReadOnlyBanner({ action }: CollabReadOnlyBannerProps) {
  const { isReadOnly } = useCollabReadOnly();
  if (!isReadOnly) return null;

  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20">
          <Eye className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Mode démo Yuno Collab — lecture seule
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {action
              ? `${action} est géré par l'organisation partenaire. `
              : `La création est gérée par l'organisation partenaire. `}
            Passez à Pro pour piloter votre club au quotidien.
          </p>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link to="/owner/billing">
          Activer Pro
          <ArrowRight className="h-4 w-4 ml-1" />
        </Link>
      </Button>
    </div>
  );
}
