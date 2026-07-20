import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import type { PartnershipSplitRules } from './useOrganizerPartnerships';
import { COLLAB_TERMS_VERSION } from '@/lib/collabContractTerms';

/**
 * Club ↔ organizer collaboration CONTRACT (digital, signed, locked).
 * Wraps the lightweight event split-approval: the RPCs drive the same events.* columns
 * the deployed CONTRACT GUARD reads, AND maintain a signed contract row (event_collab_contracts).
 * Money is unchanged: the co-event charge runs on_behalf_of=club and is split per these %.
 */
export type CollabContractStatus =
  | 'no_contract'
  | 'draft'
  | 'pending_signatures'
  | 'active'
  | 'locked'
  | 'closed'
  | 'cancelled';

export interface EventCollabContractRow {
  id: string;
  event_id: string;
  venue_id: string;
  organizer_user_id: string;
  created_by: string;
  status: CollabContractStatus;
  split_rules: PartnershipSplitRules;
  cancellation_policy: 'pro_rata_refund' | 'no_refund_after_event';
  terms_snapshot: Record<string, unknown> | null;
  /** Répartition des responsabilités signée (domaine → 'venue' | 'organizer' | 'both'). */
  responsibilities: Record<string, string> | null;
  contract_pdf_url: string | null;
  venue_signed_at: string | null;
  venue_signed_by: string | null;
  venue_signed_ip: string | null;
  org_signed_at: string | null;
  org_signed_by: string | null;
  org_signed_ip: string | null;
  created_at: string;
}

// rpc not in generated types yet — call bound on `supabase` (never detach: see
// reference_supabase_rpc_unbound) with casted name/args.
const rpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never);

export function useEventCollabContract(eventId: string | undefined, side?: 'venue' | 'organizer') {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['event-collab-contract', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_collab_contracts' as never)
        .select('*')
        .eq('event_id', eventId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as EventCollabContractRow) ?? null;
    },
  });

  const c = query.data;
  const status: CollabContractStatus = c ? (c.status as CollabContractStatus) : 'no_contract';
  const mySignedAt = side === 'venue' ? c?.venue_signed_at : side === 'organizer' ? c?.org_signed_at : null;
  const partnerSignedAt = side === 'venue' ? c?.org_signed_at : side === 'organizer' ? c?.venue_signed_at : null;
  const iSigned = !!mySignedAt;
  const partnerSigned = !!partnerSignedAt;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['event-collab-contract', eventId] });
    queryClient.invalidateQueries({ queryKey: ['event-split-contract', eventId] });
  };

  const create = useMutation({
    mutationFn: async (vars: { rules: PartnershipSplitRules; cancellationPolicy?: string }) => {
      if (!eventId) throw new Error('No event');
      // Drinks are no longer force-zeroed client-side: the create_event_collab_contract
      // RPC is the authoritative gate — it keeps the proposed drinks split only if the
      // organizer attested their alcohol licence, else forces 100% club.
      const { error } = await rpc('create_event_collab_contract', {
        p_event_id: eventId,
        p_split_rules: vars.rules,
        p_cancellation_policy: vars.cancellationPolicy ?? 'pro_rata_refund',
      });
      if (error) throw error;
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: eventId, action: 'proposed', proposer_side: side, rules: vars.rules },
        });
      } catch (e) { console.warn('[collab-contract] notify failed', e); }
    },
    onSuccess: () => { invalidate(); toast({ title: 'Contrat proposé', description: 'Le partenaire doit signer pour ouvrir les ventes.' }); },
    onError: (e: any) => toast({ title: 'Erreur', description: e.message, variant: 'destructive' }),
  });

  const sign = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error('No contract');
      const { error } = await rpc('sign_event_collab_contract', {
        p_contract_id: c.id,
        p_ip: null,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
        // Freeze the legal-terms version in force at signature → terms_snapshot.terms_version.
        p_terms_version: COLLAB_TERMS_VERSION,
      });
      if (error) throw error;
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: c.event_id, action: 'accepted', proposer_side: side },
        });
      } catch (e) { console.warn('[collab-contract] notify failed', e); }
    },
    onSuccess: () => { invalidate(); toast({ title: 'Contrat signé' }); },
    onError: (e: any) => toast({ title: 'Erreur', description: e.message, variant: 'destructive' }),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error('No contract');
      const { error } = await rpc('cancel_event_collab_contract', { p_contract_id: c.id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: 'Contrat annulé' }); },
    onError: (e: any) => toast({ title: 'Erreur', description: e.message, variant: 'destructive' }),
  });

  // Amend the split before any sale locks it → contract drops back to
  // pending_signatures, the amender has signed their version, the OTHER party
  // must re-sign. Sales re-block until the new double signature.
  const amend = useMutation({
    mutationFn: async (vars: { rules: PartnershipSplitRules; cancellationPolicy?: string }) => {
      if (!c) throw new Error('No contract');
      const { error } = await rpc('amend_event_collab_contract', {
        p_contract_id: c.id,
        p_split_rules: vars.rules,
        p_cancellation_policy: vars.cancellationPolicy ?? null,
      });
      if (error) throw error;
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: c.event_id, action: 'proposed', proposer_side: side, rules: vars.rules },
        });
      } catch (e) { console.warn('[collab-contract] notify failed', e); }
    },
    onSuccess: () => { invalidate(); toast({ title: 'Contrat modifié', description: 'Le partenaire doit re-signer pour ouvrir les ventes.' }); },
    onError: (e: any) => toast({ title: 'Erreur', description: e.message, variant: 'destructive' }),
  });

  return {
    contract: c,
    isLoading: query.isLoading,
    status,
    iSigned,
    partnerSigned,
    isMyTurn: status === 'pending_signatures' && !iSigned,
    create,
    sign,
    cancel,
    amend,
    refetch: query.refetch,
  };
}
