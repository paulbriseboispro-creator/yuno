/**
 * Données de l'écran Connecteurs : la connexion Shotgun de la portée
 * (get_my_ticketing_connections, réservée au titulaire du compte), les actions
 * de l'edge affiliate-ticket-sync (connect, sync_now, disconnect, purge) et le
 * réglage « soirées co-organisées » (crm_ticketing_set_cohosted).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { CrmRpcError, rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export interface TicketingStats {
  events?: number; tickets?: number; valid_tickets?: number; buyers?: number; optin_buyers?: number;
  upcoming_events?: number; scanned_tickets?: number; with_email_pct?: number;
}

export interface TicketingConnection {
  id: string;
  provider: string;
  external_org_id: string;
  external_org_name: string | null;
  token_hint: string | null;
  has_token: boolean;
  status: 'active' | 'token_invalid' | 'error' | 'disconnected' | string;
  running: boolean;
  include_cohosted: boolean;
  initial_import_done_at: string | null;
  next_sync_at: string | null;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  stats: TicketingStats | null;
  created_at: string;
}

export type ConnState = 'on' | 'broken' | 'off';

export function connState(c: TicketingConnection | null | undefined): ConnState {
  if (!c) return 'off';
  if (c.status === 'token_invalid' || c.status === 'error') return 'broken';
  return c.status === 'active' ? 'on' : 'off';
}

/** La connexion Shotgun ; `forbidden` quand la personne n'est pas titulaire. */
export function useTicketingConnection() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'ticketing'],
    queryFn: async () => {
      try {
        const r = await rpc<{ connections: TicketingConnection[] }>('get_my_ticketing_connections', args);
        return { forbidden: false, conn: r.connections.find((c) => c.provider === 'shotgun') ?? null };
      } catch (e) {
        if (e instanceof CrmRpcError && (e.code === '42501' || /forbidden/i.test(e.message))) return { forbidden: true, conn: null };
        throw e;
      }
    },
    staleTime: 15_000,
  });
}

/** Relit tout ce qui dépend de la billetterie (coquille, soirées, accueil, clients). */
export function useInvalidateTicketing() {
  const qc = useQueryClient();
  const { qk } = useCrmScope();
  return () => {
    for (const k of ['ticketing', 'shell', 'nights', 'night', 'home', 'clients']) void qc.invalidateQueries({ queryKey: ['crm', qk, k] });
  };
}

/** Appelle une action `ticketing_*` ; rend le code d'erreur de l'edge, ou null. */
export async function ticketingAction(
  scope: { venueId: string | null; organizerUserId: string | null },
  action: 'ticketing_connect' | 'ticketing_sync_now' | 'ticketing_disconnect' | 'ticketing_purge',
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  const { data, error } = await invokeEdgeFunction<{ ok?: boolean; error?: string }>('affiliate-ticket-sync', {
    body: { action, provider: 'shotgun', scope, ...extra },
  });
  if (data?.ok) return null;
  return data?.error ?? (error as { message?: string } | null)?.message ?? 'generic';
}

export function setCohosted(args: Record<string, unknown>, on: boolean) {
  return rpc<{ ok?: boolean; error?: string }>('crm_ticketing_set_cohosted', { ...args, p_on: on });
}

/** Clé de message d'un code d'erreur de l'edge. */
export function ticketingErrorKey(code: string): string {
  const m: Record<string, string> = {
    invalid_token: 'yc.co.err.invalidToken', invalid_token_format: 'yc.co.err.invalidToken', token_invalid: 'yc.co.err.invalidToken',
    invalid_organizer_id: 'yc.co.err.invalidOrg', unknown_organizer: 'yc.co.err.invalidOrg',
    rate_limited: 'yc.co.err.busy', provider_unreachable: 'yc.co.err.unreachable',
    support_session_forbidden: 'yc.co.err.support', demo_account_locked: 'yc.co.err.demo', demo_read_only: 'yc.co.err.demo',
    forbidden: 'yc.co.err.forbidden', too_soon: 'yc.co.err.tooSoon',
  };
  const k = Object.keys(m).find((x) => code.includes(x));
  return k ? m[k] : 'yc.co.err.generic';
}
