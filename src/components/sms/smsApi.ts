import { supabase } from '@/integrations/supabase/client';
import type { SmsCampaignStatus, SmsScope, SmsSegmentType } from '@/lib/smsMarketing';

export interface SmsCampaignRow {
  id: string;
  name: string;
  body_template: string;
  body_i18n: Record<string, string> | null;
  sender_name: string | null;
  event_id: string | null;
  segment_filters: { type?: SmsSegmentType; event_id?: string; import_id?: string } | null;
  estimated_recipients: number;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  undelivered_count: number;
  credits_consumed: number;
  credits_refunded: number;
  segments_per_message: number;
  status: SmsCampaignStatus;
  paused_reason: string | null;
  error_message: string | null;
  quiet_hours: boolean;
  scheduled_at: string | null;
  send_started_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export const SMS_CAMPAIGN_COLUMNS =
  'id, name, body_template, body_i18n, sender_name, event_id, segment_filters, estimated_recipients, total_recipients, sent_count, delivered_count, failed_count, undelivered_count, credits_consumed, credits_refunded, segments_per_message, status, paused_reason, error_message, quiet_hours, scheduled_at, send_started_at, sent_at, created_at';

export interface EventLite { id: string; title: string; start_at: string }

export interface SmsImportLite { id: string; list_name: string | null; filename: string | null; created_at: string; contacts: number }

export function scopeFilter(scope: SmsScope): { column: 'venue_id' | 'organizer_id'; value: string } {
  return scope.kind === 'venue'
    ? { column: 'venue_id', value: scope.venueId }
    : { column: 'organizer_id', value: scope.organizerUserId };
}

export function scopeRpcArgs(scope: SmsScope): { p_venue_id: string | null; p_organizer_user_id: string | null } {
  return {
    p_venue_id: scope.kind === 'venue' ? scope.venueId : null,
    p_organizer_user_id: scope.kind === 'organizer' ? scope.organizerUserId : null,
  };
}

export async function fetchSmsBalance(scope: SmsScope): Promise<number> {
  const q = supabase.from('sms_credit_balances').select('balance');
  if (scope.kind === 'venue') q.eq('venue_id', scope.venueId).is('organizer_id', null);
  else q.eq('organizer_id', scope.organizerUserId).is('venue_id', null);
  const { data } = await q.maybeSingle();
  return Number(data?.balance ?? 0);
}

export async function fetchScopeEvents(scope: SmsScope): Promise<EventLite[]> {
  const q = supabase.from('events').select('id, title, start_at').order('start_at', { ascending: false }).limit(80);
  if (scope.kind === 'venue') q.or(`venue_id.eq.${scope.venueId},partner_venue_id.eq.${scope.venueId}`);
  else q.or(`organizer_user_id.eq.${scope.organizerUserId},partner_organizer_id.eq.${scope.organizerUserId}`);
  const { data } = await q;
  return (data ?? []) as EventLite[];
}

export interface SmsEdgeResult<T = Record<string, unknown>> { ok: boolean; status: number; data: T & { error?: string; message?: string } }

/**
 * Appel de send-sms-campaign avec le corps de la réponse même en erreur HTTP :
 * un 402 INSUFFICIENT_CREDITS porte le nombre de crédits manquants, un 400
 * NO_RECIPIENTS l'audience résolue — l'éditeur en a besoin pour réagir juste.
 */
export async function invokeSms<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<SmsEdgeResult<T>> {
  const { data, error } = await supabase.functions.invoke('send-sms-campaign', { body });
  if (!error) return { ok: true, status: 200, data: (data ?? {}) as SmsEdgeResult<T>['data'] };
  const ctx = (error as { context?: Response }).context;
  let payload: Record<string, unknown> | null = null;
  try { payload = ctx ? await ctx.clone().json() : null; } catch { payload = null; }
  return { ok: false, status: ctx?.status ?? 500, data: (payload ?? { error: error.message }) as SmsEdgeResult<T>['data'] };
}
