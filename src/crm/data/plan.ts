/**
 * Plan de soirée (agents, lot A1, migration 20261016155000) et connexions IA
 * du pro (bouton « Préparer avec mon IA »). Le plan est calculé par le
 * serveur : aucun chiffre n'est recalculé ici.
 */
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { NightTargetAudience, NightTargets } from '@/crm/data/analysis';
import type { McpConnection } from '@/lib/mcp';

export interface NightPlanAudience extends NightTargetAudience {
  /** Personnes comptées ici pour la première fois dans l'ordre conseillé. */
  first_n: number; first_email: number; first_sms: number;
  /** Audience d'un brouillon d'e-mail préparé par l'IA (MCP). */
  audience_id: string;
}

export interface NightPlanStep {
  moment: 'now' | 'week' | 'eve';
  send_at: string;
  people: number; email: number; sms: number;
  channel: 'email' | 'sms';
  cost_email: number; cost_sms: number;
  audiences: NightPlanAudience[];
}

export interface NightPlanMessage { id: string; name: string | null; status: string; at: string | null; recipients: number | null }

export interface NightPlan {
  ok: boolean;
  error?: 'event_not_found' | 'not_upcoming' | 'no_upcoming';
  event?: NightTargets['event'];
  days_left?: number;
  computed?: boolean;
  has_ticket?: number;
  score?: NightTargets['score'];
  union?: NightTargets['union'];
  steps?: NightPlanStep[];
  totals?: { people: number; email: number; sms: number; cost: number; balance: number; enough: boolean };
  pace?: { sold: number; prev?: { id: string; title: string; start_at: string; same_series: boolean; sold_same: number; total: number } };
  planned?: { emails: NightPlanMessage[]; sms: NightPlanMessage[] };
  holdout_pct?: number;
  families?: string[];
  rates?: { email: number; sms: number };
  sms_ready?: boolean;
}

export function useNightPlan(eventId: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'night-plan', eventId],
    queryFn: () => rpc<NightPlan>('crm_night_plan', { ...args, p_event_id: eventId }),
    enabled: !!eventId,
    staleTime: 2 * 60_000,
  });
}

/** Les connexions IA (MCP) de la personne : les siennes et celles de son équipe sur ses espaces. */
export function useAiConnections() {
  return useQuery({
    queryKey: ['crm', 'ai-connections'],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await rpc<{ ok: boolean; connections?: McpConnection[] }>('mcp_my_connections');
      return r?.connections ?? [];
    },
  });
}
