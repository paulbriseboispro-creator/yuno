/**
 * Lectures de la rubrique « Système » (et de quelques chiffres que
 * « Communication » partage). Une RPC par bloc, aucun calcul nouveau :
 *   - admin_release_health : apps et OTA, crons, base, sécurité, e-mail, push, IA ;
 *   - crm_admin_platform   : synchros Shotgun, quota partagé, suppressions, gels ;
 *   - app_settings         : maintenance et paiements (lecture directe, publique en RLS) ;
 *   - admin_audit_log      : les dernières modifications d'interrupteurs.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AdminPlatform } from '@/crm/admin/data';

export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface HealthApp {
  app_id: string; name: string;
  channels: { channel: string; version: string; native_version: string | null; published_at: string; size_mb: number | null; notes: string | null }[];
  devices: number; active_7d: number; active_30d: number; new_7d: number;
  by_version: { version: string; n: number; active_7d: number }[];
  events_7d: { action: string; n: number }[];
  crashes_7d: number; download_fail_7d: number;
}
export interface HealthCron {
  name: string; schedule: string; active: boolean; target: string | null; kind: string;
  last_status: string | null; last_start: string | null; last_ms: number | null; last_message: string | null;
  runs_24h: number; fails_7d: number;
}
export interface Health {
  generated_at: string;
  apps: HealthApp[];
  recent_bundles: { app_id: string; channel: string; version: string; native_version: string | null; active: boolean; at: string; size_mb: number | null; notes: string | null }[];
  crash_log: { at: string; app_id: string; action: string; version: string | null; platform: string | null; detail: string }[];
  crons: HealthCron[];
  cron_failures: { name: string; at: string; status: string; message: string | null }[];
  security: { failures_24h: number; mfa_enabled_users: number; suspended_users: number; active_support_sessions: number };
  database: { size_mb: number; migrations: number; latest_migration: string; tables: number; largest: { table: string; rows: number; mb: number }[]; dead_tuples_top: { table: string; dead: number }[] };
  settings: { maintenance_mode: boolean; maintenance_message: string | null; payments_disabled: boolean; settings_updated_at: string | null; push_keys_disabled: number; push_keys_total: number; demo_live: boolean };
  email: { quota: { used: number; free: number; credits: number; remaining: number; resets_on: string; day_used: number; day_cap: number; pool_used: number; pool_cap: number; platform_sent?: number; platform_ceiling?: number } | null; sender: { trust_level: string; lifetime_sent: number; daily_cap: number | null; restricted_reason: string | null } | null; transactional_month: number; suppressions_30d: number };
  push: { subscriptions: number; auto_failed_7d: number; auto_sent_7d: number; queue_pending: number };
  ai: { events_24h: number; errors_24h: number; cost_30d_usd: number; p95_latency_ms_7d: number };
}

export const HEALTH_KEY = ['admin', 'system', 'health'] as const;

/** admin_release_health : une lecture lourde (crons, taille de la base), 60 s de cache. */
export function useReleaseHealth() {
  return useQuery({ queryKey: HEALTH_KEY, staleTime: 60_000, queryFn: () => rpc<Health>('admin_release_health') });
}

export function usePlatformSync(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'system', 'platform', includeDemo], staleTime: 30_000,
    queryFn: () => rpc<AdminPlatform>('crm_admin_platform', { p_include_demo: includeDemo }),
  });
}

export interface AppSettingsRow { maintenance_mode: boolean; maintenance_message: string | null; payments_disabled: boolean; updated_at: string | null }
export const SWITCH_KEY = ['admin', 'system', 'switches'] as const;

export function useAppSettings() {
  return useQuery({
    queryKey: [...SWITCH_KEY, 'settings'],
    queryFn: async (): Promise<AppSettingsRow> => {
      const { data, error } = await supabase.from('app_settings')
        .select('maintenance_mode, maintenance_message, payments_disabled, updated_at').eq('id', 'global').maybeSingle();
      if (error) throw error;
      return (data as unknown as AppSettingsRow | null) ?? { maintenance_mode: false, maintenance_message: null, payments_disabled: false, updated_at: null };
    },
  });
}

export interface SwitchLogRow { id: string; created_at: string; entity_id: string | null; metadata: { reason?: string; enabled?: boolean } | null }
export function useSwitchLog() {
  return useQuery({
    queryKey: [...SWITCH_KEY, 'log'],
    queryFn: async (): Promise<SwitchLogRow[]> => {
      const { data, error } = await supabase.from('admin_audit_log')
        .select('id, created_at, entity_id, metadata').eq('entity_type', 'platform_switch')
        .order('created_at', { ascending: false }).limit(8);
      if (error) throw error;
      return (data as unknown as SwitchLogRow[]) ?? [];
    },
  });
}
