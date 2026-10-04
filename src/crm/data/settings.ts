/**
 * Données de l'écran Réglages (migration 20261004235500) : réglages et
 * identité de l'espace (get_crm_settings), aperçu de toutes les valeurs des
 * règles (crm_rules_preview), enregistrements et demande de suppression.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type BusinessType = 'club' | 'organizer';

export interface CrmSettings {
  regular_min_nights: number;
  regular_window_months: 6 | 12 | 24;
  lapse_months: number;
  night_end_hour: number;
  /** Mois sans activité avant effacement ; null = jamais. */
  retention_months: 24 | 36 | 60 | null;
  business_type: BusinessType;
  identity: {
    name: string;
    city: string | null;
    logo_url: string | null;
    name_changed_at: string | null;
    /** Date avant laquelle le nom ne peut pas changer (30 jours entre deux). */
    rename_locked_until: string | null;
    holder: boolean;
  } | null;
  deletion_requested_at: string | null;
  retention_last: { at: string; erased: number } | null;
  can: { edit: boolean; identity: boolean; retention: boolean; delete: boolean };
}

export interface RulesPreview {
  total: number;
  came: number;
  /** hab[fenêtre][mois à réactiver] = effectifs pour 1…6 soirées. */
  hab: Record<string, Record<string, number[]>>;
  /** lapsed[mois] = clients venus, pas revenus depuis ce nombre de mois. */
  lapsed: Record<string, number>;
  /** erase[mois] = clients sans aucune activité depuis ce nombre de mois. */
  erase: Record<string, number>;
  at: string;
}

export function useCrmSettings() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'settings'],
    queryFn: () => rpc<CrmSettings>('get_crm_settings', args),
    staleTime: 60_000,
  });
}

export function useRulesPreview() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'settings', 'preview'],
    queryFn: () => rpc<RulesPreview>('crm_rules_preview', args),
    staleTime: 5 * 60_000,
  });
}

export type SettingsPatch = Partial<Pick<CrmSettings, 'regular_min_nights' | 'regular_window_months' | 'lapse_months' | 'night_end_hour' | 'retention_months' | 'business_type'>>;
export interface IdentityPatch { name: string; city: string | null; logo_url: string | null }

/**
 * Enregistre ce qui a changé : l'identité d'abord (elle peut être refusée par
 * le délai de renommage), puis les règles. Relit ensuite tout ce qui dépend
 * des règles (clients, segments, accueil) et l'espace (nom et logo du menu).
 */
export function useSaveSettings() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ identity, settings }: { identity: IdentityPatch | null; settings: SettingsPatch | null }) => {
      let out: CrmSettings | null = null;
      if (identity) out = await rpc<CrmSettings>('save_crm_identity', { ...args, p_name: identity.name, p_city: identity.city, p_logo_url: identity.logo_url });
      if (settings && Object.keys(settings).length) out = await rpc<CrmSettings>('save_crm_settings', { ...args, p_settings: settings });
      return out;
    },
    onSuccess: (d, v) => {
      if (d) qc.setQueryData(['crm', qk, 'settings'], d);
      if (v.identity) void qc.invalidateQueries({ queryKey: ['crm-spaces'] });
      if (v.settings) {
        for (const k of ['clients-overview', 'clients-list', 'client', 'segments', 'segments-brief', 'home', 'audience-count', 'audience-counts', 'emails']) void qc.invalidateQueries({ queryKey: ['crm', qk, k] });
        void qc.invalidateQueries({ queryKey: ['crm', qk, 'settings', 'preview'] });
      }
    },
  });
}

export function useRequestDeletion() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirm: string) => rpc<CrmSettings>('request_crm_space_deletion', { ...args, p_confirm: confirm }),
    onSuccess: (d) => { qc.setQueryData(['crm', qk, 'settings'], d); },
  });
}
