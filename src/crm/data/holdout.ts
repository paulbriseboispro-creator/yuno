/**
 * « 10 % non contactés, pour mesurer l'effet réel » : le réglage du compte et
 * la mesure des envois (migration 20261013120000). Rien n'est calculé ici.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { HoldoutSend } from '@/crm/lib/holdout';

export interface HoldoutSettings { pct: number; can_edit: boolean }
export interface HoldoutOverview { pct: number; sends: HoldoutSend[] }

export function useHoldoutSettings(enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'holdout-settings'],
    queryFn: () => rpc<HoldoutSettings>('crm_holdout_settings', args),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useSetHoldout() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pct: number) => rpc<{ ok: boolean; pct: number }>('crm_holdout_set', { ...args, p_pct: pct }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm', qk, 'holdout-settings'] });
      qc.invalidateQueries({ queryKey: ['crm', qk, 'holdout-overview'] });
    },
  });
}

export function useHoldoutOverview() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'holdout-overview'],
    queryFn: () => rpc<HoldoutOverview>('crm_holdout_overview', { ...args, p_days: 180 }),
    staleTime: 5 * 60_000,
  });
}
