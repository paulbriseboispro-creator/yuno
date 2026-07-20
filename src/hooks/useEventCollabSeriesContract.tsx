import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';
import type { PartnershipSplitRules } from './useOrganizerPartnerships';
import { COLLAB_TERMS_VERSION } from '@/lib/collabContractTerms';

/**
 * Contrat-CADRE récurrent club ↔ organisateur (digital, signé une fois pour TOUTE
 * une série de co-soirées récurrentes). Miroir de useEventCollabContract mais clé sur
 * le template récurrent (owner_recurring_templates) au lieu d'un event.
 *
 * La double signature du cadre active TOUTES les occurrences en attente d'un coup et
 * fait naître les occurrences suivantes déjà actives (generate_recurring_events) → plus
 * de signature par-soirée. Résiliable pour l'avenir. L'argent est inchangé.
 */
export type SeriesContractStatus =
  | 'no_contract'
  | 'draft'
  | 'pending_signatures'
  | 'active'
  | 'terminated'
  | 'cancelled';

export interface EventCollabSeriesContractRow {
  id: string;
  template_id: string;
  venue_id: string;
  organizer_user_id: string;
  created_by: string;
  status: SeriesContractStatus;
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
  terminated_at: string | null;
  terminated_by: string | null;
  created_at: string;
}

// rpc not in generated types yet — call bound on `supabase` (never detach: see
// reference_supabase_rpc_unbound) with casted name/args.
const rpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never);

export function useEventCollabSeriesContract(templateId: string | undefined, side?: 'venue' | 'organizer') {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['event-collab-series-contract', templateId],
    enabled: !!templateId,
    queryFn: async () => {
      // The live contract (a terminated/cancelled one is historical → treated as "none").
      const { data, error } = await supabase
        .from('event_collab_series_contracts' as never)
        .select('*')
        .eq('template_id', templateId!)
        .in('status' as never, ['draft', 'pending_signatures', 'active'] as never)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as EventCollabSeriesContractRow) ?? null;
    },
  });

  const c = query.data;
  const status: SeriesContractStatus = c ? (c.status as SeriesContractStatus) : 'no_contract';
  const mySignedAt = side === 'venue' ? c?.venue_signed_at : side === 'organizer' ? c?.org_signed_at : null;
  const partnerSignedAt = side === 'venue' ? c?.org_signed_at : side === 'organizer' ? c?.venue_signed_at : null;
  const iSigned = !!mySignedAt;
  const partnerSigned = !!partnerSignedAt;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['event-collab-series-contract', templateId] });
  };

  // Crée + pré-signe le contrat-cadre (le proposeur). Le partenaire signe ensuite une fois.
  // Notifications gérées côté DB (trigger notify_collab_series_created).
  const create = useMutation({
    mutationFn: async (vars: { rules: PartnershipSplitRules; cancellationPolicy?: string }) => {
      if (!templateId) throw new Error('No template');
      const { error } = await rpc('create_event_collab_series_contract', {
        p_template_id: templateId,
        p_split_rules: vars.rules,
        p_cancellation_policy: vars.cancellationPolicy ?? 'pro_rata_refund',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Contrat-cadre proposé', description: 'Le partenaire signe une fois pour toutes les soirées de la série.' });
    },
    onError: (e: unknown) => toast({ title: 'Erreur', description: (e as { message?: string }).message, variant: 'destructive' }),
  });

  // Signe le cadre. À la double signature : toutes les occurrences en attente s'activent
  // et les suivantes naissent actives (côté DB). Notifs gérées par trigger.
  const sign = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error('No contract');
      const { error } = await rpc('sign_event_collab_series_contract', {
        p_contract_id: c.id,
        p_ip: null,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
        p_terms_version: COLLAB_TERMS_VERSION,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: 'Contrat-cadre signé' }); },
    onError: (e: unknown) => toast({ title: 'Erreur', description: (e as { message?: string }).message, variant: 'destructive' }),
  });

  // Résilie le cadre pour l'avenir (les occurrences déjà actives restent inchangées).
  const terminate = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error('No contract');
      const { error } = await rpc('terminate_event_collab_series_contract', { p_contract_id: c.id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: 'Contrat-cadre résilié', description: 'Les prochaines soirées ne sont plus auto-acceptées.' }); },
    onError: (e: unknown) => toast({ title: 'Erreur', description: (e as { message?: string }).message, variant: 'destructive' }),
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
    terminate,
    refetch: query.refetch,
  };
}
