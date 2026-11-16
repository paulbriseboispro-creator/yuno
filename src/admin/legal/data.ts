/**
 * Données de la rubrique « Légal » : un hook par RPC (migration 20261218150000).
 * La démo vient de useAdminFilters ; la porte démo vit en SQL. Les versions en
 * vigueur des textes viennent de LEGAL_VERSIONS (src/lib/legal.ts), seule source.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { supabase } from '@/integrations/supabase/client';
import { LEGAL_VERSIONS } from '@/lib/legal';
import { useAdminFilters } from '../context/useAdminFilters';
import { REQUIRED_DOCS, type OverviewPayload, type SellerRow } from './rules';

export const LEGAL_QK = 'admin-legal';
const versions = () => ({ ...LEGAL_VERSIONS }) as Record<string, string>;

export function useLegalOverview() {
  const { includeDemo } = useAdminFilters();
  return useQuery({
    queryKey: [LEGAL_QK, 'overview', includeDemo],
    staleTime: 30_000,
    queryFn: () => rpc<OverviewPayload & { at: string }>('admin_legal_overview', { p_versions: versions(), p_required: REQUIRED_DOCS, p_include_demo: includeDemo }),
  });
}

// ── Demandes RGPD ──

export type RequestKind = 'access' | 'erasure' | 'objection' | 'rectification' | 'portability' | 'other';
export type RequestStatus = 'open' | 'in_progress' | 'done' | 'refused';
export type RequestSource = 'manual' | 'account_deleted' | 'meta' | 'ticketing_erasure' | 'crm_erasure';
export interface PrivacyRequest {
  id: string; source: RequestSource; auto: boolean; received_at: string; channel?: string; email: string | null;
  kind: RequestKind; identity_verified?: boolean; account_key?: string | null; account_name?: string | null;
  extension_months?: number; extension_reason?: string | null; deadline?: string | null; status: RequestStatus;
  response?: string | null; note?: string | null; handled_by?: string | null; closed: boolean; closed_at?: string | null;
  detail?: Record<string, unknown> | null;
}
export function usePrivacyRequests() {
  const { includeDemo } = useAdminFilters();
  return useQuery({
    queryKey: [LEGAL_QK, 'requests', includeDemo],
    staleTime: 15_000,
    queryFn: () => rpc<{ manual: PrivacyRequest[]; auto: PrivacyRequest[] }>('admin_privacy_requests', { p_include_demo: includeDemo }),
  });
}

/** Un geste qui écrit : motif obligatoire, journal par la RPC, puis tout le légal se relit. */
function useLegalWrite<A extends Record<string, unknown>>(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => rpc<string>(fn, args),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [LEGAL_QK] }); },
  });
}
export const usePrivacyRequestSave = () => useLegalWrite<{ p_id: string | null; p_patch: Record<string, unknown>; p_reason: string }>('admin_privacy_request_save');

// ── Consentements ──

export interface ProductConsents {
  subscribed: number; unsubscribed: number; with_proof: number; from_import: number; new_period: number; new_previous: number;
  sms_ok: number; sms_stop: number; imports: number; imports_support: number; imports_unattested: number;
}
export interface ImportRow {
  id: string; at: string; title: string | null; consent: string | null; attested_at: string | null; via_support: boolean;
  superseded: boolean; product: 'tickets' | 'crm' | 'platform'; key: string | null; name: string | null; rows: number | null; channel: 'contact' | 'email' | 'sms';
}
export interface ConsentProof {
  email: string;
  events: { at: string; action: string; channel: string; source: string | null; text: string | null; key: string | null; locale: string | null; phone: string | null; scope: string | null; name: string | null }[];
  subscriptions: { scope: string | null; name: string | null; product: string; opted_in: boolean; source: string | null; consent_source: string | null; recorded_at: string; opted_out_at: string | null; from_import: boolean }[];
  suppressed: { at: string; reason: string | null; source: string | null }[];
  opt_outs: { at: string; reason: string | null; name: string | null }[];
  terms: { at: string; version: string; context: string | null }[];
  legal: { at: string; doc: string; version: string }[];
}
export interface ConsentsPayload {
  products: Record<'tickets' | 'crm' | 'platform', ProductConsents>;
  events: { granted_period: number; granted_previous: number; withdrawn_period: number; withdrawn_previous: number };
  suppressions: { email_opt_outs: number; email_suppressions: number; by_reason: Record<string, number>; sms_stop: number };
  imports: ImportRow[];
  proof?: ConsentProof;
}
export function useLegalConsents(email: string) {
  const { includeDemo, range } = useAdminFilters();
  return useQuery({
    queryKey: [LEGAL_QK, 'consents', includeDemo, range.days, email],
    staleTime: 30_000,
    queryFn: () => rpc<ConsentsPayload>('admin_legal_consents', { p_include_demo: includeDemo, p_email: email || null, p_days: range.days }),
  });
}

// ── Conditions ──

export interface TermsPayload {
  docs: { doc: string; version: string; people: number; n: number; last: string }[];
  pros: { key: string; kind: string; name: string; email: string | null; is_demo: boolean; products: string[]; docs: Record<string, { v: string; at: string }>; missing: string[] }[];
  buyers: { total: number; period: number; previous: number; by: { context: string; version: string; n: number; last: string }[] };
}
export function useLegalTerms() {
  const { includeDemo, range } = useAdminFilters();
  return useQuery({
    queryKey: [LEGAL_QK, 'terms', includeDemo, range.days],
    staleTime: 30_000,
    queryFn: () => rpc<TermsPayload>('admin_legal_terms', { p_versions: versions(), p_required: REQUIRED_DOCS, p_include_demo: includeDemo, p_days: range.days }),
  });
}

// ── Vendeurs ──

export function useLegalSellers(year: number) {
  const { includeDemo } = useAdminFilters();
  return useQuery({
    queryKey: [LEGAL_QK, 'sellers', includeDemo, year],
    staleTime: 60_000,
    queryFn: () => rpc<{ year: number; sellers: SellerRow[] }>('admin_legal_sellers', { p_year: year, p_include_demo: includeDemo }),
  });
}

// ── Incidents ──

export interface Incident {
  id: string; product: 'tickets' | 'crm' | 'both'; declared_at: string; discovered_at: string; nature: string;
  accounts: { key: string; name: string | null }[]; persons_estimate: number | null; measures: string | null;
  cnil_notified_at: string | null; cnil_reference: string | null; pros_notified_at: string | null; closed_at: string | null;
  deadline: string; audit: { at: string; action: string; reason: string | null }[];
}
export function useLegalIncidents() {
  return useQuery({
    queryKey: [LEGAL_QK, 'incidents'],
    staleTime: 15_000,
    queryFn: () => rpc<{ incidents: Incident[] }>('admin_legal_incidents'),
  });
}
export const useIncidentSave = () => useLegalWrite<{ p_id: string | null; p_patch: Record<string, unknown>; p_reason: string }>('admin_legal_incident_save');
export async function prepareIncidentPros(id: string) {
  return rpc<{ key: string; name: string; email: string | null; is_demo: boolean }[]>('admin_legal_incident_pros', { p_id: id });
}

/** Comptes à choisir pour un incident : tous les pros (clubs, organisateurs), démo comprise. */
export function useLegalAccounts(enabled: boolean) {
  return useQuery({
    queryKey: [LEGAL_QK, 'accounts'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => (await rpc<TermsPayload>('admin_legal_terms', { p_versions: versions(), p_required: REQUIRED_DOCS, p_include_demo: true, p_days: 30 })).pros,
  });
}

// ── Signalements ──

export interface ContentReport {
  id: string; received_at: string; reporter_name: string | null; reporter_email: string | null;
  object_kind: 'event' | 'pro' | 'content' | 'other'; object_ref: string | null; object_label: string | null; reason: string;
  decision: 'pending' | 'removed' | 'restricted' | 'no_action'; decided_at: string | null; statement: string | null;
  statement_sent_at: string | null; note: string | null; handled_by: string | null;
}
export function useContentReports() {
  return useQuery({
    queryKey: [LEGAL_QK, 'reports'],
    staleTime: 15_000,
    queryFn: () => rpc<{ reports: ContentReport[] }>('admin_content_reports'),
  });
}
export const useContentReportSave = () => useLegalWrite<{ p_id: string | null; p_patch: Record<string, unknown>; p_reason: string }>('admin_content_report_save');

// ── Journal ──

export type AuditSource = 'all' | 'admin' | 'support' | 'agent';
export interface AuditEntry {
  id: string; at: string; source: 'admin' | 'support' | 'agent'; actor: string | null; action: string;
  entity_type: string | null; entity_id: string | null; target: string | null; reason: string | null; detail: Record<string, unknown> | null;
}
export function useLegalAudit(source: AuditSource, account: string, q: string) {
  const { range } = useAdminFilters();
  return useQuery({
    queryKey: [LEGAL_QK, 'audit', range.days, source, account, q],
    staleTime: 15_000,
    queryFn: () => rpc<{ rows: AuditEntry[] }>('admin_legal_audit', {
      p_days: range.days, p_source: source, p_account: account || null, p_q: q || null, p_limit: 500,
    }),
  });
}
