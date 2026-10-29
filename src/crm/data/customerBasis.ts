/**
 * « Vos clients » (exception clients, article L34-5 alinéa 2) : l'état de la
 * base d'un espace, la déclaration du titulaire, les oppositions transmises et
 * ce qu'une campagne viserait. Tout est décidé par la base
 * (`crm_customer_basis_*`, migrations 20261114100000 → 120000) : l'écran ne
 * fait que montrer et demander.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import { sha256Hex } from '@/lib/legal';
import type { CrmAudience } from './emails';

export type CustomerBasisStatus = 'off' | 'active' | 'suspended';
export type CustomerSuspendReason = 'complaints' | 'bounces' | 'admin' | 'version' | 'expired';

export interface CustomerBasisCounts {
  consent: number;
  extra: number;
  excluded: { provider_withdrawn: number; unsubscribe: number; suppressed: number; reported: number };
}

export interface CustomerBasis {
  status: CustomerBasisStatus;
  /** Ouverture générale OU compte en bêta : le titulaire peut signer. */
  can_declare: boolean;
  is_owner: boolean;
  /** Compte Resend et domaine à part prêts : sinon, rien ne part même signé. */
  sending_ready: boolean;
  /** La base peut partir aujourd'hui (signée, à jour, envoi prêt). */
  open: boolean;
  version: string;
  declaration_version: string | null;
  needs_renewal: boolean | null;
  declared_at: string | null;
  expires_at: string | null;
  signatory_name: string | null;
  signatory_role: string | null;
  suspended_at: string | null;
  suspended_reason: CustomerSuspendReason | null;
  eligibility_months: number;
  counts: CustomerBasisCounts;
}

/** Les cinq engagements de la fenêtre, dans l'ordre : clés attendues par la base. */
export const CUSTOMER_CHECKS = ['seller', 'own_nights_only', 'informed', 'forward_objections', 'terms_read'] as const;
export type CustomerCheckKey = (typeof CUSTOMER_CHECKS)[number];

const key = (qk: string) => ['crm', qk, 'customerBasis'];

export function useCustomerBasis(enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: key(qk),
    queryFn: () => rpc<CustomerBasis>('crm_customer_basis_get', args),
    staleTime: 60_000,
    enabled,
  });
}

export function useDeclareCustomerBasis() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    /** `text` = le texte EXACT de la fenêtre (cases comprises) : son empreinte est la preuve. */
    mutationFn: async (x: { version: string; text: string; name: string; role: string; lang: string; shown: CustomerBasisCounts }) => {
      const hash = await sha256Hex(x.text);
      if (!hash) throw new Error('customer_basis_hash');
      return rpc<CustomerBasis>('crm_customer_basis_declare', {
        ...args,
        p_version: x.version, p_doc_hash: hash, p_signatory_name: x.name, p_signatory_role: x.role,
        p_checks: Object.fromEntries(CUSTOMER_CHECKS.map((k) => [k, true])),
        p_lang: x.lang, p_shown: { consent: x.shown.consent, extra: x.shown.extra, excluded: x.shown.excluded },
      });
    },
    onSuccess: (d) => { qc.setQueryData(key(qk), d); },
  });
}

export function useCloseCustomerBasis() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rpc<CustomerBasis>('crm_customer_basis_off', args),
    onSuccess: (d) => { qc.setQueryData(key(qk), d); void qc.invalidateQueries({ queryKey: ['crm', qk, 'emails'] }); },
  });
}

export function useReportCustomerObjections() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (emails: string[]) => rpc<{ objected: number }>('crm_customer_report_objection', { ...args, p_emails: emails }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key(qk) }); },
  });
}

export interface CustomerAudiencePreview {
  customer_basis: boolean;
  open?: boolean;
  consent?: number;
  customer?: number;
  total?: number;
  ramp_cap?: number;
  today_room?: number;
}

/**
 * Ce que viserait une campagne « Vos clients » : lu sur la campagne ENREGISTRÉE
 * (la base applique le même filtre que l'envoi), d'où `flush` avant la lecture.
 */
export function useCustomerAudiencePreview(
  campaignId: string | null, on: boolean, deps: { audiences: CrmAudience[]; recentDays: number; excludeBuyers: boolean; eventId: string | null },
  flush: () => Promise<boolean>,
) {
  const { qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'customerPreview', campaignId, JSON.stringify(deps)],
    queryFn: async () => {
      await flush();
      return rpc<CustomerAudiencePreview>('crm_customer_audience_preview', { p_campaign_id: campaignId });
    },
    enabled: on && !!campaignId,
    staleTime: 30_000,
  });
}

export interface CustomerEmailCheck { customer: boolean; open?: boolean; ok: boolean; issues: { code: string; block?: string; type?: string; url?: string; field?: string }[] }

/** « Ne parle que de vos soirées » : la règle de la garde, lue avant l'envoi. */
export function useCustomerEmailCheck(campaignId: string | null, on: boolean) {
  const { qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'customerCheck', campaignId],
    queryFn: () => rpc<CustomerEmailCheck>('crm_customer_email_check', { p_campaign_id: campaignId }),
    enabled: on && !!campaignId,
    staleTime: 15_000,
  });
}

/** Le code d'un refus « Vos clients » (send-campaign, garde SQL) → clé de texte. */
export function customerRefusalKey(txt: string): string | null {
  if (txt.includes('crm_customer_infra')) return 'yc.cb.err.infra';
  if (txt.includes('crm_customer_basis_closed')) return 'yc.cb.err.closed';
  if (txt.includes('crm_customer_content')) return 'yc.cb.err.content';
  if (txt.includes('crm_customer_basis_feature')) return 'yc.cb.err.feature';
  if (txt.includes('crm_customer_basis_scope')) return 'yc.cb.err.scope';
  return null;
}

/** Un motif du contrôle de contenu → clé de texte. */
export function customerIssueKey(code: string): string {
  return ['not_own_event', 'link_not_own_event', 'link_ticketing', 'link_foreign_page'].includes(code)
    ? `yc.cb.issue.${code}` : 'yc.cb.issue.other';
}
