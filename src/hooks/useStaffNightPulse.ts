/**
 * Le pouls de la nuit — état partagé des écrans staff et du hub équipe owner.
 *
 * Une seule RPC (get_staff_night_pulse) rend tout : l'événement du soir, les
 * attendus, le direct, l'équipe en poste et la consigne. Le staff
 * ne peut PAS lire ces tables en direct (RLS par domaine), c'est la RPC
 * SECURITY DEFINER qui agrège — donc pas de Realtime table par table ici :
 * un poll de 25 s + un canal sur staff_briefs (la consigne peut tomber en
 * plein service et doit apparaître sans attendre le poll).
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';

export interface PulseTeamMember {
  user_id: string;
  name: string;
  title: string | null;
  avatar_url: string | null;
  role: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface PulseBriefReader {
  user_id: string;
  name: string;
  read_at: string;
}

export interface NightPulse {
  venue_id: string;
  night_date: string;
  night_start: string;
  event: { id: string; title: string; start_at: string; end_at: string } | null;
  expected: {
    tickets_sold: number;
    guest_list: number;
    vip_tables: number;
    capacity: number | null;
  };
  live: {
    entries: number;
    entries_last10: number;
    gl_scanned: number;
    vip_arrived: number;
    bar_backlog: number;
    bar_oldest_min: number | null;
    bar_ready: number;
    bar_served_tonight: number;
    out_of_stock: string[];
    cloak_active: number;
    cloak_retrieved: number;
    incidents: number;
  };
  team: PulseTeamMember[];
  brief: {
    id: string;
    body: string;
    updated_at: string;
    read_by_me: boolean;
    readers: PulseBriefReader[];
  } | null;
}

const pulseKey = (venueId: string | null) => ['staff-night-pulse', venueId ?? 'none'] as const;

export function useStaffNightPulse(venueId: string | null) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: pulseKey(venueId),
    queryFn: async (): Promise<NightPulse | null> => {
      const { data: pulse, error } = await supabase.rpc('get_staff_night_pulse', {
        p_venue_id: venueId,
      });
      if (error) throw error;
      return pulse as unknown as NightPulse;
    },
    enabled: !!venueId,
    // Les tuiles vivent au rythme du service : 25 s suffit (le centre de
    // commandement owner poll à 10-30 s), et c'est UNE requête, pas huit.
    refetchInterval: 25_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: 1,
  });

  // La consigne du soir doit apparaître sans attendre le prochain poll.
  useEffect(() => {
    if (!venueId) return;
    const channel = supabase
      .channel(uniqueChannel(`staff-briefs-${venueId}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_briefs', filter: `venue_id=eq.${venueId}` },
        () => queryClient.invalidateQueries({ queryKey: pulseKey(venueId) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId, queryClient]);

  return { pulse: data ?? null, loading: isLoading, refetch };
}

/**
 * Accusé de lecture de la consigne. Idempotent (PK composite côté DB) :
 * un doublon d'appel est un no-op, pas une erreur à montrer.
 */
export async function markBriefRead(briefId: string): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;
    await supabase
      .from('staff_brief_reads')
      .upsert({ brief_id: briefId, user_id: userId }, { onConflict: 'brief_id,user_id', ignoreDuplicates: true });
  } catch {
    // Best-effort : l'accusé de lecture ne bloque jamais l'écran.
  }
}
