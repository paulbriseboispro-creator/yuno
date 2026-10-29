/**
 * Admin CRM › « Vos clients » (exception clients, plan
 * docs/designs/CRM_CUSTOMER_BASIS_PLAN.md § 8.6) :
 *   • `CustomerBasisTab` (Réglages › Vos clients) : l'ouverture pour tous
 *     (après l'avis de l'avocat), « envoi prêt » (compte Resend et domaine à
 *     part branchés), la version du texte et les seuils ; puis les comptes qui
 *     ont une base (signataire, version, montée, suspension).
 *   • `CustomerBasisAdminCard` (tiroir d'un compte) : bêta, suspendre, rouvrir.
 * Chaque geste demande un motif et s'écrit au journal (admin_audit_log). Le
 * super admin ne signe JAMAIS à la place du titulaire : la base le refuse.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { rpc } from '@/crm/lib/rpc';
import { Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useAdminGesture } from '../data';
import { EmptyNote, RowLine, Section } from '../ui';

interface BasisSettings {
  enabled: boolean; sending_ready: boolean; declaration_version: string;
  eligibility_months: number; validity_months: number; ramp_start: number;
  complaint_pause_pct: number; bounce_pause_pct: number; max_per_30d: number;
}
interface BasisAccount {
  scope_key: string; venue_id: string | null; organizer_user_id: string | null; name: string | null;
  status: 'off' | 'active' | 'suspended'; beta_allowed: boolean; open: boolean;
  declared_at: string | null; declaration_version: string | null; signatory_name: string | null; signatory_role: string | null;
  expires_at: string | null; suspended_at: string | null; suspended_reason: string | null;
  ramp_day: number; ramp_cap: number | null; eligible: number; objected: number;
}
interface BasisOverview { settings: BasisSettings; accounts: BasisAccount[] }
type Action = 'beta_on' | 'beta_off' | 'suspend' | 'resume';

const inputCss = { flex: '1 1 220px', height: 40, borderRadius: 10, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 12px', font: 'inherit', fontSize: 14, outline: 'none' } as const;
const btn = { height: 36, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' } as const;
const NUMS = ['eligibility_months', 'validity_months', 'ramp_start', 'complaint_pause_pct', 'bounce_pause_pct', 'max_per_30d'] as const;

function useBasisOverview() {
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

function statusLine(t: (k: string, v?: Record<string, string | number>) => string, a: BasisAccount | undefined): string {
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

/** Réglages › Vos clients : la porte globale, puis les comptes qui ont une base. */
export function CustomerBasisTab() {
  const { t, n, dShort } = useCrmT();
  const toast = useCrmToast();
  const q = useBasisOverview();
  const save = useAdminGesture<{ p_patch: Record<string, unknown>; p_reason: string }>('crm_admin_customer_basis_settings_set');
  const [draft, setDraft] = useState<BasisSettings | null>(null);
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (q.data) setDraft(q.data.settings); }, [q.data]);
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  if (!q.data || !draft) return <Skel h={360} r={28} />;
  const cur = q.data.settings;
  const patch = Object.fromEntries(Object.entries(draft).filter(([k, v]) => cur[k as keyof BasisSettings] !== v));
  const dirty = Object.keys(patch).length > 0;
  const versionChange = 'declaration_version' in patch;
  const sw = (k: 'enabled' | 'sending_ready') => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontSize: 14.5, fontWeight: 500 }}>
      <button type="button" role="switch" aria-checked={draft[k]} onClick={() => setDraft({ ...draft, [k]: !draft[k] })} style={{ position: 'relative', width: 48, height: 28, padding: 0, border: 0, borderRadius: 99, background: draft[k] ? 'var(--green-500)' : 'var(--sand-300)', cursor: 'pointer', flex: 'none' }}>
        <span style={{ position: 'absolute', top: 3, left: draft[k] ? 23 : 3, width: 22, height: 22, borderRadius: 99, background: '#fff', transition: 'left 200ms' }} />
      </button>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        {t(`adm.crm.cb.g.${k}`)}
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)', fontWeight: 400 }}>{t(`adm.crm.cb.g.${k}S`)}</span>
      </span>
    </label>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Section title={t('adm.crm.cb.gT')} sub={t('adm.crm.cb.gS')} pad={24} gap={14}>
        {sw('enabled')}
        {sw('sending_ready')}
        <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500 }}>
          <span style={{ minWidth: 220 }}>{t('adm.crm.cb.g.declaration_version')}</span>
          <input value={draft.declaration_version} onChange={(e) => setDraft({ ...draft, declaration_version: e.target.value })} style={{ ...inputCss, flex: '0 1 180px' }} />
        </label>
        {NUMS.map((k) => (
          <label key={k} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500 }}>
            <span style={{ minWidth: 220 }}>{t(`adm.crm.cb.g.${k}`)}</span>
            <input type="number" value={draft[k]} step={k.endsWith('pct') ? 0.01 : 1} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} style={{ ...inputCss, flex: '0 1 120px', textAlign: 'right' }} />
          </label>
        ))}
        {versionChange && <span style={{ fontSize: 13, color: 'var(--amber-700)' }}>{t('adm.crm.cb.g.versionWarn')}</span>}
        {dirty && (ask
          ? <ReasonBox busy={save.isPending} onCancel={() => setAsk(false)} onConfirm={(reason) => save.mutate({ p_patch: patch, p_reason: reason }, {
            onSuccess: () => { toast(t('adm.crm.cb.saved')); setAsk(false); },
            onError: (e) => toast(t('adm.crm.cb.err', { e: (e as Error).message })),
          })} />
          : <div><Hv as="button" type="button" onClick={() => setAsk(true)} style={{ ...btn, height: 40, background: 'var(--ink)', color: '#fff' }}>{t('adm.crm.cb.save')}</Hv></div>)}
      </Section>

      <Section title={t('adm.crm.cb.accT')} sub={t('adm.crm.cb.accS')} pad={24} gap={4}>
        {q.data.accounts.length === 0 ? <EmptyNote>{t('adm.crm.cb.none')}</EmptyNote> : q.data.accounts.map((a, i) => (
          <RowLine key={a.scope_key} first={i === 0}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontSize: 14.5 }}>{a.name ?? a.scope_key}</b>
              <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>
                {statusLine(t, a)}
                {a.declared_at ? ` · ${t('adm.crm.cb.signed', { name: a.signatory_name ?? '—', role: a.signatory_role ?? '—', date: dShort(a.declared_at), v: a.declaration_version ?? '—' })}` : ''}
              </span>
            </span>
            <span style={{ fontSize: 13, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
              {t('adm.crm.cb.people', { e: n(a.eligible), o: n(a.objected) })}
              {a.ramp_cap ? <><br />{t('adm.crm.cb.ramp', { cap: n(a.ramp_cap) })}</> : null}
            </span>
          </RowLine>
        ))}
      </Section>
    </div>
  );
}
