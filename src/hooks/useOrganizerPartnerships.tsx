import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';

export type PartnershipStatus = 'pending' | 'active' | 'revoked' | 'declined';
export type PartnershipInitiator = 'venue' | 'organizer';

export interface PartnershipSplitRules {
  tickets: { organizer_pct: number; venue_pct: number };
  tables: { organizer_pct: number; venue_pct: number };
  drinks: { organizer_pct: number; venue_pct: number };
}

export interface VenueOrganizerPartnership {
  id: string;
  venue_id: string;
  organizer_user_id: string;
  status: PartnershipStatus;
  initiated_by: PartnershipInitiator;
  invitation_message: string | null;
  default_split_rules: PartnershipSplitRules;
  /** Pending split modification awaiting both-side approval. */
  split_proposal: PartnershipSplitRules | null;
  split_proposed_by: string | null;
  split_proposed_at: string | null;
  split_approved_by_venue: boolean;
  split_approved_by_organizer: boolean;
  requested_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined data (optional)
  venue?: { id: string; name: string; logo_url: string | null; city: string | null };
  organizer?: { id: string; first_name: string | null; last_name: string | null; organization_name: string | null; avatar_url: string | null };
}

export type PartnershipSplitProposalStatus =
  | 'no_proposal'
  | 'pending_venue'
  | 'pending_organizer'
  | 'ready_to_apply';

export function getPartnershipProposalStatus(p: VenueOrganizerPartnership): PartnershipSplitProposalStatus {
  if (!p.split_proposal) return 'no_proposal';
  if (!p.split_approved_by_venue) return 'pending_venue';
  if (!p.split_approved_by_organizer) return 'pending_organizer';
  return 'ready_to_apply';
}

const DEFAULT_SPLIT: PartnershipSplitRules = {
  tickets: { organizer_pct: 100, venue_pct: 0 },
  tables: { organizer_pct: 0, venue_pct: 100 },
  drinks: { organizer_pct: 0, venue_pct: 100 },
};

/**
 * Hook for organizer side: list partnerships where the current user is the organizer.
 */
export function useOrganizerPartnerships() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['organizer-partnerships', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_organizer_partnerships')
        .select(`
          *,
          venue:venues(id, name, logo_url, city)
        `)
        .eq('organizer_user_id', user!.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as VenueOrganizerPartnership[];
    },
  });

  const requestPartnership = useMutation({
    mutationFn: async (params: { venueId: string; message?: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .insert({
          venue_id: params.venueId,
          organizer_user_id: user.id,
          initiated_by: 'organizer' as const,
          invitation_message: params.message ?? null,
          default_split_rules: DEFAULT_SPLIT as any,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer-partnerships'] });
      toast({ title: 'Demande envoyée', description: 'Le club recevra ta demande.' });
    },
    onError: (err: any) => {
      toast({ title: 'Erreur', description: err.message ?? 'Impossible d’envoyer la demande', variant: 'destructive' });
    },
  });

  const respond = useMutation({
    mutationFn: async (params: { id: string; accept: boolean }) => {
      const update: any = params.accept
        ? { status: 'active', accepted_at: new Date().toISOString() }
        : { status: 'declined' };
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .update(update)
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['organizer-partnerships'] });
      toast({ title: vars.accept ? 'Partenariat accepté' : 'Demande refusée' });
    },
    onError: (err: any) => {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: user?.id })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer-partnerships'] });
      toast({ title: 'Partenariat révoqué' });
    },
  });

  const proposeSplitUpdate = useMutation({
    mutationFn: async (params: { id: string; rules: PartnershipSplitRules }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .update({
          split_proposal: params.rules as any,
          split_proposed_by: user.id,
          split_proposed_at: new Date().toISOString(),
          split_approved_by_organizer: true, // proposer auto-approves
          split_approved_by_venue: false,
        })
        .eq('id', params.id);
      if (error) throw error;
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'partnership', id: params.id, action: 'proposed', proposer_side: 'organizer', rules: params.rules },
        });
      } catch (e) { console.warn('[partnership] notify failed', e); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer-partnerships'] });
      toast({ title: 'Proposition envoyée', description: 'Le club a été notifié et doit accepter la nouvelle répartition.' });
    },
    onError: (err: any) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const respondToSplitProposal = useMutation({
    mutationFn: async (params: { partnership: VenueOrganizerPartnership; accept: boolean }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { partnership: p, accept } = params;
      if (!p.split_proposal) throw new Error('Aucune proposition en attente');
      if (accept) {
        const venueOk = p.split_approved_by_venue;
        const organizerOk = true; // organizer accepting
        const both = venueOk && organizerOk;
        const update: any = both
          ? {
              default_split_rules: p.split_proposal as any,
              split_proposal: null,
              split_proposed_by: null,
              split_proposed_at: null,
              split_approved_by_venue: false,
              split_approved_by_organizer: false,
            }
          : { split_approved_by_organizer: organizerOk };
        const { error } = await supabase
          .from('venue_organizer_partnerships')
          .update(update)
          .eq('id', p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('venue_organizer_partnerships')
          .update({
            split_proposal: null,
            split_proposed_by: null,
            split_proposed_at: null,
            split_approved_by_venue: false,
            split_approved_by_organizer: false,
          })
          .eq('id', p.id);
        if (error) throw error;
      }
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'partnership', id: p.id, action: accept ? 'accepted' : 'declined', proposer_side: 'organizer' },
        });
      } catch (e) { console.warn('[partnership] notify failed', e); }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['organizer-partnerships'] });
      toast({ title: vars.accept ? 'Proposition acceptée' : 'Proposition refusée' });
    },
    onError: (err: any) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  return {
    partnerships: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    requestPartnership,
    respond,
    revoke,
    proposeSplitUpdate,
    respondToSplitProposal,
  };
}

/**
 * Hook for venue (club) side: list partnerships for a given venue.
 */
export function useVenuePartnerships(venueId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['venue-partnerships', venueId],
    enabled: !!venueId && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_organizer_partnerships')
        .select(`*`)
        .eq('venue_id', venueId!)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data || []) as unknown as VenueOrganizerPartnership[];
      // Fetch organizer profiles
      const orgIds = Array.from(new Set(rows.map((r) => r.organizer_user_id)));
      if (orgIds.length === 0) return rows;

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, organization_name, avatar_url')
        .in('id', orgIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      return rows.map((r) => ({ ...r, organizer: profileMap.get(r.organizer_user_id) as any }));
    },
  });

  const inviteOrganizer = useMutation({
    mutationFn: async (params: { organizerUserId: string; message?: string; splitRules?: PartnershipSplitRules }) => {
      if (!venueId) throw new Error('No venue');
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .insert({
          venue_id: venueId,
          organizer_user_id: params.organizerUserId,
          initiated_by: 'venue' as const,
          invitation_message: params.message ?? null,
          default_split_rules: (params.splitRules ?? DEFAULT_SPLIT) as any,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-partnerships', venueId] });
      toast({ title: 'Invitation envoyée', description: 'L’organisateur recevra ton invitation.' });
    },
    onError: (err: any) => {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    },
  });

  const respond = useMutation({
    mutationFn: async (params: { id: string; accept: boolean }) => {
      const update: any = params.accept
        ? { status: 'active', accepted_at: new Date().toISOString() }
        : { status: 'declined' };
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .update(update)
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['venue-partnerships', venueId] });
      toast({ title: vars.accept ? 'Partenariat accepté' : 'Demande refusée' });
    },
  });

  const updateSplit = useMutation({
    mutationFn: async (params: { id: string; splitRules: PartnershipSplitRules }) => {
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .update({ default_split_rules: params.splitRules as any })
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-partnerships', venueId] });
      toast({ title: 'Règles de partage mises à jour' });
    },
  });

  const proposeSplitUpdate = useMutation({
    mutationFn: async (params: { id: string; rules: PartnershipSplitRules }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .update({
          split_proposal: params.rules as any,
          split_proposed_by: user.id,
          split_proposed_at: new Date().toISOString(),
          split_approved_by_venue: true, // proposer auto-approves
          split_approved_by_organizer: false,
        })
        .eq('id', params.id);
      if (error) throw error;
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'partnership', id: params.id, action: 'proposed', proposer_side: 'venue', rules: params.rules },
        });
      } catch (e) { console.warn('[partnership] notify failed', e); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-partnerships', venueId] });
      toast({ title: 'Proposition envoyée', description: 'L’organisateur a été notifié et doit accepter la nouvelle répartition.' });
    },
    onError: (err: any) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const respondToSplitProposal = useMutation({
    mutationFn: async (params: { partnership: VenueOrganizerPartnership; accept: boolean }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { partnership: p, accept } = params;
      if (!p.split_proposal) throw new Error('Aucune proposition en attente');
      if (accept) {
        const venueOk = true;
        const organizerOk = p.split_approved_by_organizer;
        const both = venueOk && organizerOk;
        const update: any = both
          ? {
              default_split_rules: p.split_proposal as any,
              split_proposal: null,
              split_proposed_by: null,
              split_proposed_at: null,
              split_approved_by_venue: false,
              split_approved_by_organizer: false,
            }
          : { split_approved_by_venue: venueOk };
        const { error } = await supabase
          .from('venue_organizer_partnerships')
          .update(update)
          .eq('id', p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('venue_organizer_partnerships')
          .update({
            split_proposal: null,
            split_proposed_by: null,
            split_proposed_at: null,
            split_approved_by_venue: false,
            split_approved_by_organizer: false,
          })
          .eq('id', p.id);
        if (error) throw error;
      }
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'partnership', id: p.id, action: accept ? 'accepted' : 'declined', proposer_side: 'venue' },
        });
      } catch (e) { console.warn('[partnership] notify failed', e); }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['venue-partnerships', venueId] });
      toast({ title: vars.accept ? 'Proposition acceptée' : 'Proposition refusée' });
    },
    onError: (err: any) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('venue_organizer_partnerships')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: user?.id })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-partnerships', venueId] });
      toast({ title: 'Partenariat révoqué' });
    },
  });

  return {
    partnerships: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    inviteOrganizer,
    respond,
    updateSplit,
    proposeSplitUpdate,
    respondToSplitProposal,
    revoke,
  };
}

export const DEFAULT_PARTNERSHIP_SPLIT = DEFAULT_SPLIT;
