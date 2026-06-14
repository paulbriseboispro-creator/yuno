import { useEventSplitContract } from '@/hooks/useEventSplitContract';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Lock } from 'lucide-react';

interface Props {
  eventId: string;
}

/**
 * Bilateral split-contract banner shown on event detail/edit pages.
 * Displays current contract state and lets the recipient party accept or decline a pending proposal.
 */
export function SplitContractBanner({ eventId }: Props) {
  const { contract, status, userSide, respond } = useEventSplitContract(eventId);

  if (!contract) return null;

  // Solo events have no split contract — nothing to show.
  const isCoEvent =
    !!(contract.venue_id && contract.partner_organizer_id) ||
    !!(contract.organizer_user_id && contract.partner_venue_id);
  if (!isCoEvent) return null;

  if (status === 'locked') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/40 p-4">
        <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-foreground">Contrat de partage figé</p>
          <p className="text-muted-foreground">Une vente a été enregistrée — le contrat ne peut plus être modifié pour les ventes en cours.</p>
        </div>
      </div>
    );
  }

  if (status === 'active') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-foreground">Contrat de partage actif</p>
          <p className="text-muted-foreground">Le club et l’organisateur ont validé la répartition des revenus pour cette soirée.</p>
        </div>
      </div>
    );
  }

  if (status === 'pending_venue' || status === 'pending_organizer') {
    const waitingFor = status === 'pending_venue' ? 'le club' : 'l’organisateur';
    const isMyTurn =
      (status === 'pending_venue' && userSide === 'venue') ||
      (status === 'pending_organizer' && userSide === 'organizer');

    return (
      <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-foreground">Proposition de contrat de partage en attente</p>
            <p className="text-muted-foreground">
              {isMyTurn
                ? 'Vous devez accepter ou refuser la proposition pour ouvrir les ventes.'
                : `En attente de la validation de ${waitingFor}. Les ventes restent fermées tant qu’il n’y a pas double accord.`}
            </p>
            {contract.revenue_split_proposal && (
              <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                <li>Billets : {contract.revenue_split_proposal.tickets.organizer_pct}% orga / {contract.revenue_split_proposal.tickets.venue_pct}% club</li>
                <li>Tables : {contract.revenue_split_proposal.tables.organizer_pct}% orga / {contract.revenue_split_proposal.tables.venue_pct}% club</li>
                <li>Boissons : 100% club (politique Yuno)</li>
              </ul>
            )}
          </div>
        </div>
        {isMyTurn && (
          <div className="flex gap-2 pl-8">
            <Button size="sm" onClick={() => respond.mutate({ accept: true })} disabled={respond.isPending}>
              Accepter
            </Button>
            <Button size="sm" variant="outline" onClick={() => respond.mutate({ accept: false })} disabled={respond.isPending}>
              Refuser
            </Button>
          </div>
        )}
      </div>
    );
  }

  return null;
}
