import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import type { PartnershipSplitRules } from './useOrganizerPartnerships';

/**
 * Per-event revenue split contract: propose / approve / decline.
 * Both venue owner AND organizer must approve before sales can open.
 * Once the first sale lands, the contract is locked (split_locked_at set by DB trigger).
 */
export interface EventSplitContractRow {
  id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  partner_venue_id: string | null;
  partner_organizer_id: string | null;
  revenue_split_rules: PartnershipSplitRules | null;
  revenue_split_proposal: PartnershipSplitRules | null;
  split_proposed_by: string | null;
  split_proposed_at: string | null;
  split_approved_by_venue: boolean;
  split_approved_by_organizer: boolean;
  split_locked_at: string | null;
}

export type SplitContractStatus =
  | 'no_contract'        // co-event without any split saved (uses partnership defaults)
  | 'pending_venue'      // proposal awaits venue approval
  | 'pending_organizer'  // proposal awaits organizer approval
  | 'active'             // both parties approved → revenue_split_rules in effect
  | 'locked';            // first sale recorded, contract frozen

export function getSplitContractStatus(row: EventSplitContractRow | null | undefined): SplitContractStatus {
  if (!row) return 'no_contract';
  if (row.split_locked_at) return 'locked';
  if (row.revenue_split_proposal) {
    if (!row.split_approved_by_venue) return 'pending_venue';
    if (!row.split_approved_by_organizer) return 'pending_organizer';
  }
  if (row.revenue_split_rules) return 'active';
  return 'no_contract';
}

export function useEventSplitContract(eventId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['event-split-contract', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, venue_id, organizer_user_id, partner_venue_id, partner_organizer_id, revenue_split_rules, revenue_split_proposal, split_proposed_by, split_proposed_at, split_approved_by_venue, split_approved_by_organizer, split_locked_at')
        .eq('id', eventId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as EventSplitContractRow;
    },
  });

  /** Determine whether the current user acts as venue owner or organizer for this event. */
  const userSide = (): 'venue' | 'organizer' | null => {
    const row = query.data;
    if (!row || !user?.id) return null;
    if (row.organizer_user_id === user.id || row.partner_organizer_id === user.id) return 'organizer';
    // Venue side check requires owner lookup; we infer if the user is NOT the organizer and event has a venue.
    // The actual ownership is enforced by RLS, so this is just for UI hints.
    if (row.venue_id || row.partner_venue_id) return 'venue';
    return null;
  };

  const propose = useMutation({
    mutationFn: async (rules: PartnershipSplitRules) => {
      if (!eventId || !user?.id) throw new Error('Not authenticated');
      const side = userSide();
      if (!side) throw new Error('Vous n’êtes ni le club ni l’organisateur de cette soirée.');
      // Drinks are always 100% venue per Yuno policy — enforce here too.
      const safeRules: PartnershipSplitRules = {
        ...rules,
        drinks: { organizer_pct: 0, venue_pct: 100 },
      };
      const { error } = await supabase
        .from('events')
        .update({
          revenue_split_proposal: safeRules as any,
          split_proposed_by: user.id,
          split_proposed_at: new Date().toISOString(),
          split_approved_by_venue: side === 'venue',
          split_approved_by_organizer: side === 'organizer',
        })
        .eq('id', eventId);
      if (error) throw error;
      // Best-effort partner notification (email + push). Never blocks UI on failure.
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: eventId, action: 'proposed', proposer_side: side, rules: safeRules },
        });
      } catch (e) {
        console.warn('[split-contract] notify failed', e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-split-contract', eventId] });
      toast({ title: 'Proposition envoyée', description: 'Le partenaire a été notifié par e-mail et notification. Les ventes restent fermées tant qu’il n’a pas validé.' });
    },
    onError: (err: any) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const respond = useMutation({
    mutationFn: async ({ accept }: { accept: boolean }) => {
      if (!eventId || !user?.id) throw new Error('Not authenticated');
      const row = query.data;
      if (!row?.revenue_split_proposal) throw new Error('Aucune proposition en attente');
      const side = userSide();
      if (!side) throw new Error('Action non autorisée');

      if (accept) {
        // Mark this side as approved. If both sides agree, lock the proposal in.
        const venueOk = side === 'venue' ? true : row.split_approved_by_venue;
        const organizerOk = side === 'organizer' ? true : row.split_approved_by_organizer;
        const bothApproved = venueOk && organizerOk;
        const { error } = await supabase
          .from('events')
          .update(bothApproved
            ? {
                revenue_split_rules: row.revenue_split_proposal as any,
                revenue_split_proposal: null,
                split_proposed_by: null,
                split_proposed_at: null,
                split_approved_by_venue: false,
                split_approved_by_organizer: false,
              }
            : {
                split_approved_by_venue: venueOk,
                split_approved_by_organizer: organizerOk,
              })
          .eq('id', eventId);
        if (error) throw error;
      } else {
        // Decline: purge proposal, keep prior rules untouched.
        const { error } = await supabase
          .from('events')
          .update({
            revenue_split_proposal: null,
            split_proposed_by: null,
            split_proposed_at: null,
            split_approved_by_venue: false,
            split_approved_by_organizer: false,
          })
          .eq('id', eventId);
        if (error) throw error;
      }
      // Notify the partner of the response (best-effort).
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: {
            kind: 'event',
            id: eventId,
            action: accept ? 'accepted' : 'declined',
            proposer_side: side,
          },
        });
      } catch (e) {
        console.warn('[split-contract] notify failed', e);
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['event-split-contract', eventId] });
      toast({ title: vars.accept ? 'Contrat accepté' : 'Proposition refusée' });
    },
    onError: (err: any) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  return {
    contract: query.data,
    isLoading: query.isLoading,
    status: getSplitContractStatus(query.data),
    userSide: userSide(),
    propose,
    respond,
    refetch: query.refetch,
  };
}
