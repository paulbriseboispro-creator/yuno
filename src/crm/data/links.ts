/**
 * Liens de partage d'une soirée (story, bio, post…) : lecture
 * `crm_night_links`, écriture `crm_link_create` / `crm_link_update`.
 * Règles : src/crm/lib/links.ts, migration 20261006200000_crm_night_links.sql.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { LinkPlacement, LinkPlatform, NightLink, SourceRow } from '@/crm/lib/links';

export interface NightLinksData {
  error?: 'not_found';
  event: { id: string; title: string; start_at: string; upcoming: boolean; url: string; tz: string };
  can_write: boolean;
  sees_money: boolean;
  links: NightLink[];
  sources: SourceRow[];
  totals: { tickets: number; with_source: number; link_tickets: number; link_revenue: number | null; clicks: number; visitors: number };
  series: { d: string; clicks: number; tickets: number }[];
  /** Shotgun a déjà renvoyé au moins une vente portant la source d'un lien Yuno. */
  confirmed: boolean;
  synced_at: string | null;
}

export function useNightLinks(eventId: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'night-links', eventId],
    queryFn: () => rpc<NightLinksData>('crm_night_links', { ...args, p_event_id: eventId }),
    enabled: !!eventId,
    staleTime: 20_000,
    // Les clics arrivent en direct : on relit toutes les 30 s tant que l'écran est ouvert.
    refetchInterval: 30_000,
  });
}

export interface CreatedLink { id: string; code: string; label: string; platform: LinkPlatform; placement: LinkPlacement; created_at: string; image_url?: string | null }

export function useLinkMutations(eventId: string | null) {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['crm', qk, 'night-links', eventId] }), [qc, qk, eventId]);
  const create = useCallback(async (platform: LinkPlatform, placement: LinkPlacement, label: string, imageUrl: string | null = null) => {
    const r = await rpc<CreatedLink>('crm_link_create', { ...args, p_event_id: eventId, p_platform: platform, p_placement: placement, p_label: label, p_image_url: imageUrl });
    void refresh();
    return r;
  }, [args, eventId, refresh]);
  const update = useCallback(async (linkId: string, patch: { label?: string; archived?: boolean }) => {
    await rpc('crm_link_update', { ...args, p_link_id: linkId, p_label: patch.label ?? null, p_archived: patch.archived ?? null });
    void refresh();
  }, [args, refresh]);
  return { create, update, refresh };
}
