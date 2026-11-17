/**
 * Admin CRM › « Vos clients » (exception clients, plan
 * docs/designs/CRM_CUSTOMER_BASIS_PLAN.md § 8.6), côté tiroir d'un compte :
 * `CustomerBasisAdminCard` (bêta, suspendre, rouvrir). La porte globale et la
 * liste des comptes vivent dans Système › Offre et tarifs › Vos clients
 * (src/admin/system/PricingCustomers.tsx), qui relit ce module pour son hook et
 * ses types. Chaque geste demande un motif et s'écrit au journal
 * (admin_audit_log). Le super admin ne signe JAMAIS à la place du titulaire.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { rpc } from '@/crm/lib/rpc';
import { Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { useAdminGesture } from '../data';

export interface BasisSettings {
  enabled: boolean; sending_ready: boolean; declaration_version: string;
  eligibility_months: number; validity_months: number; ramp_start: number;
  complaint_pause_pct: number; bounce_pause_pct: number; max_per_30d: number;
}
export interface BasisAccount {
  scope_key: string; venue_id: string | null; organizer_user_id: string | null; name: string | null;
  status: 'off' | 'active' | 'suspended'; beta_allowed: boolean; open: boolean;
  declared_at: string | null; declaration_version: string | null; signatory_name: string | null; signatory_role: string | null;
  expires_at: string | null; suspended_at: string | null; suspended_reason: string | null;
  ramp_day: number; ramp_cap: number | null; eligible: number; objected: number;
}
export interface BasisOverview { settings: BasisSettings; accounts: BasisAccount[] }
type Action = 'beta_on' | 'beta_off' | 'suspend' | 'resume';

const inputCss = { flex: '1 1 220px', height: 40, borderRadius: 10, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 12px', font: 'inherit', fontSize: 14, outline: 'none' } as const;
const btn = { height: 36, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' } as const;

export function useBasisOverview() {
  return useQuery({ queryKey: ['crm-admin', 'customer-basis'], staleTime: 30_000, queryFn: () => rpc<BasisOverview>('crm_admin_customer_basis', { p_include_demo: true }) });
}

/** `venue:<id>` / `org:<uuid>` (crm_scope_key) → les deux paramètres de portée. */
function scopeArgs(key: string): { p_venue_id: string | null; p_organizer_user_id: string | null } {
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  return kind.startsWith('v') ? { p_venue_id: id, p_organizer_user_id: null } : { p_venue_id: null, p_organizer_user_id: id };
}

function ReasonBox({ onConfirm, onCancel, busy }: { onConfirm: (reason: string) => void; onCancel: () => void; busy: boolean }) {
  const { t } = useCrmT();
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= 3 && !busy;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('adm.crm.cb.reason')} aria-label={t('adm.crm.cb.reason')} style={inputCss} />
      <Hv as="button" type="button" disabled={!ok} onClick={() => onConfirm(reason.trim())} style={{ ...btn, height: 40, background: ok ? 'var(--ink)' : 'var(--sand-100)', color: ok ? '#fff' : 'var(--sand-400)' }}>{t('adm.crm.cb.confirm')}</Hv>
      <Hv as="button" type="button" onClick={onCancel} style={{ ...btn, height: 40 }}>{t('adm.crm.cb.cancel')}</Hv>
    </div>
  );
}

export function statusLine(t: (k: string, v?: Record<string, string | number>) => string, a: BasisAccount | undefined): string {
  if (!a || (a.status === 'off' && !a.declared_at)) return a?.beta_allowed ? t('adm.crm.cb.st.beta') : t('adm.crm.cb.st.none');
  if (a.status === 'suspended') return t('adm.crm.cb.st.suspended', { r: t(`adm.crm.cb.r.${a.suspended_reason ?? 'admin'}`) });
  if (a.status === 'off') return t('adm.crm.cb.st.closed');
  return a.open ? t('adm.crm.cb.st.open') : t('adm.crm.cb.st.signed');
}

/** Tiroir d'un compte : où en est sa base, et les trois gestes. */
export function CustomerBasisAdminCard({ scopeKey }: { scopeKey: string }) {
  const { t, n, dShort } = useCrmT();
  const toast = useCrmToast();
  const q = useBasisOverview();
  const set = useAdminGesture<{ p_venue_id: string | null; p_organizer_user_id: string | null; p_action: Action; p_reason: string }>('crm_admin_customer_basis_set');
  const [ask, setAsk] = useState<Action | null>(null);
  if (!q.data) return <Skel h={90} r={18} />;
  const a = q.data.accounts.find((x) => x.scope_key === scopeKey);
  const actions: Action[] = [a?.beta_allowed ? 'beta_off' : 'beta_on', ...(a?.status === 'active' ? ['suspend' as const] : []), ...(a?.status === 'suspended' ? ['resume' as const] : [])];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 18, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{t('adm.crm.cb.title')} <span style={{ color: 'var(--sand-500)', fontWeight: 500 }}>· {statusLine(t, a)}</span></span>
      {a?.declared_at && (
        <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>
          {t('adm.crm.cb.signed', { name: a.signatory_name ?? '—', role: a.signatory_role ?? '—', date: dShort(a.declared_at), v: a.declaration_version ?? '—' })}
          {' · '}{t('adm.crm.cb.people', { e: n(a.eligible), o: n(a.objected) })}
        </span>
      )}
      {ask ? (
        <ReasonBox busy={set.isPending} onCancel={() => setAsk(null)} onConfirm={(reason) => set.mutate({ ...scopeArgs(scopeKey), p_action: ask, p_reason: reason }, {
          onSuccess: () => { toast(t('adm.crm.cb.saved')); setAsk(null); },
          onError: (e) => toast(t('adm.crm.cb.err', { e: (e as Error).message })),
        })} />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {actions.map((x) => <Hv key={x} as="button" type="button" onClick={() => setAsk(x)} style={btn} hover={{ background: 'var(--sand-200)' }}>{t(`adm.crm.cb.a.${x}`)}</Hv>)}
        </div>
      )}
    </div>
  );
}
