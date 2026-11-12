/**
 * La clientèle par provenance (migration 20261212100000) : comment une personne
 * arrive, commande après commande (`tix_client_sources`), et la base rangée par
 * canal principal (`tix_clients_source_mix`). Les canaux et leurs mots vivent
 * dans `src/lib/saleSource.ts`.
 */
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useTixScope } from '@/tickets/clients/scope';
import { toSaleChannel, type SaleChannel } from '@/lib/saleSource';

export interface SourceName { label: string; n: number }

export interface ClientSources {
  total: number;
  known: number;
  first: { channel: SaleChannel; label: string | null; at: string } | null;
  channels: { channel: SaleChannel; n: number; last_at: string; names: SourceName[] }[];
}

export interface SourceMixChannel {
  channel: SaleChannel;
  /** Clients dont c'est le canal principal. */
  clients: number;
  /** Commandes arrivées par ce canal. */
  orders: number;
  /** Clients qui ont au moins une commande par ce canal. */
  reached: number;
  top: { label: string; orders: number; clients: number }[];
}

export interface SourceMix {
  clients: number;
  orders: number;
  known_clients: number;
  multi_channel: number;
  days: number | null;
  channels: SourceMixChannel[];
}

function normClient(raw: ClientSources | null): ClientSources | null {
  if (!raw) return null;
  return {
    ...raw,
    first: raw.first ? { ...raw.first, channel: toSaleChannel(raw.first.channel) } : null,
    channels: (raw.channels ?? []).map((c) => ({ ...c, channel: toSaleChannel(c.channel), names: c.names ?? [] })),
  };
}

export function useClientSources(email: string | null) {
  const { rpc: args, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-cli', qk, 'sources', email],
    queryFn: async () => normClient(await rpc<ClientSources | null>('tix_client_sources', { ...args, p_email: email })),
    enabled: ready && !!email,
    staleTime: 60_000,
  });
}

export function useClientsSourceMix(days: number | null) {
  const { rpc: args, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-cli', qk, 'source-mix', days],
    queryFn: async () => {
      const raw = await rpc<SourceMix>('tix_clients_source_mix', { ...args, p_days: days });
      return { ...raw, channels: (raw.channels ?? []).map((c) => ({ ...c, channel: toSaleChannel(c.channel), top: c.top ?? [] })) };
    },
    enabled: ready,
    staleTime: 60_000,
  });
}
