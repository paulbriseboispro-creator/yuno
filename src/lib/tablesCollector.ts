// Qui encaisse les tables d'une soirée (D9, vague C3a) : lecture de `get_event_tables_collector` (contrat C1).
// Même décision que `resolvePaymentSplit` côté serveur : soirée solo, co-soirée sous contrat, club partenaire.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CollectorParty = 'venue' | 'organizer';
export type CollectorBlock = 'no_contract' | 'pillar_disabled' | 'stripe_split_unavailable';

export interface TablesCollectorInfo {
  collector: CollectorParty | 'both' | null;
  mode: string | null;
  agreement: 'yuno' | 'external' | null;
  blocked: CollectorBlock | null;
  /** L'encaisseur (les deux, si « both ») peut encaisser ET aucun blocage. */
  ready: boolean;
  /** La partie dont le Stripe n'est PAS prêt (null = tout est prêt). */
  readyParty: CollectorParty | null;
  venueName: string | null;
  organizerName: string | null;
}

export function parseTablesCollector(raw: unknown): TablesCollectorInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const c = o.collector;
  const collector = c === 'venue' || c === 'organizer' || c === 'both' ? c : null;
  const b = o.blocked;
  const blocked = b === 'no_contract' || b === 'pillar_disabled' || b === 'stripe_split_unavailable' ? b : null;
  const rp = o.ready_party;
  return {
    collector,
    mode: typeof o.mode === 'string' ? o.mode : null,
    agreement: o.agreement === 'yuno' || o.agreement === 'external' ? o.agreement : null,
    blocked,
    ready: o.ready === true,
    readyParty: rp === 'venue' || rp === 'organizer' ? rp : null,
    venueName: typeof o.venue_name === 'string' && o.venue_name ? o.venue_name : null,
    organizerName: typeof o.organizer_name === 'string' && o.organizer_name ? o.organizer_name : null,
  };
}

export type CollectorBannerKind =
  | 'blocked'
  | 'on_site_only'
  | 'ready'
  | 'viewer_connect'
  | 'viewer_ask_owner'
  | 'other_connect';

export interface CollectorBannerView {
  kind: CollectorBannerKind;
  /** Partie nommée dans le titre : celle qui encaisse (prête) ou dont le Stripe manque. */
  party: CollectorParty | 'both' | null;
  block: CollectorBlock | null;
}

/** Décide du bandeau « paiements prêts » à partir du contrat serveur. Jamais bloquant pour une formule sur place. */
export function collectorBannerView(opts: {
  info: TablesCollectorInfo;
  /** Console d'où l'on regarde : le club ('venue') ou l'organisateur. */
  viewer: CollectorParty;
  hasOnlinePacks: boolean;
  canManageStripe: boolean;
}): CollectorBannerView {
  const { info, viewer, hasOnlinePacks, canManageStripe } = opts;
  if (info.blocked) return { kind: 'blocked', party: info.collector, block: info.blocked };
  if (!hasOnlinePacks) return { kind: 'on_site_only', party: info.collector, block: null };
  if (info.ready) return { kind: 'ready', party: info.collector, block: null };
  const missing = info.readyParty ?? (info.collector === 'both' || info.collector === null ? null : info.collector);
  if (!missing) return { kind: 'other_connect', party: info.collector, block: null };
  if (missing !== viewer) return { kind: 'other_connect', party: missing, block: null };
  return { kind: canManageStripe ? 'viewer_connect' : 'viewer_ask_owner', party: missing, block: null };
}

/** Nom à afficher pour une partie (jamais vide : repli générique géré par l'appelant). */
export function collectorPartyName(info: TablesCollectorInfo, party: CollectorParty | 'both' | null): string | null {
  if (party === 'venue') return info.venueName;
  if (party === 'organizer') return info.organizerName;
  if (party === 'both') return [info.venueName, info.organizerName].filter(Boolean).join(' + ') || null;
  return null;
}

/** null tant que la réponse n'arrive pas, et si la RPC refuse (droits, ancienne base) : le bandeau retombe sur l'ancienne règle. */
export function useEventTablesCollector(eventId: string | null | undefined): TablesCollectorInfo | null {
  const q = useQuery({
    queryKey: ['event-tables-collector', eventId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_event_tables_collector', { p_event_id: eventId as string });
      if (error) return null;
      return parseTablesCollector(data);
    },
    enabled: !!eventId,
    staleTime: 60 * 1000,
  });
  return q.data ?? null;
}
