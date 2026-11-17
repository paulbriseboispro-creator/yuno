/**
 * Système › Offre et tarifs › Vos clients : l'exception « vos clients » de
 * Yuno CRM (plan docs/designs/CRM_CUSTOMER_BASIS_PLAN.md § 8.6). La porte
 * globale (ouverture pour tous après l'avis de l'avocat, « envoi prêt » quand
 * le compte Resend et le domaine à part sont branchés, version du texte,
 * seuils), puis les comptes qui ont une base (signataire, version, montée,
 * suspension). Chaque enregistrement demande un motif (journal d'audit) ; le
 * super admin ne signe JAMAIS à la place du titulaire : la base le refuse.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Card, DataTable, ErrorState, ReasonDialog, Section, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { statusLine, useBasisOverview, type BasisAccount, type BasisSettings } from '@/crm/admin/pages/CustomerBasisAdmin';
import { rpc } from './data';
import { NumberInput } from '@/admin/ui';
import { Switch } from '@/admin/ui';

const NUMS = ['eligibility_months', 'validity_months', 'ramp_start', 'complaint_pause_pct', 'bounce_pause_pct', 'max_per_30d'] as const;

export default function PricingCustomers() {
  const { t, lang } = useAdminT();
  const q = useBasisOverview();
  const [draft, setDraft] = useState<BasisSettings | null>(null);
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (q.data) setDraft(q.data.settings); }, [q.data]);

  const cur = q.data?.settings;
  const patch = useMemo(() => (cur && draft ? Object.fromEntries(Object.entries(draft).filter(([k, v]) => cur[k as keyof BasisSettings] !== v)) : {}), [cur, draft]);
  const dirty = Object.keys(patch).length > 0;

  const cols = useMemo<ColumnDef<BasisAccount, unknown>[]>(() => [
    { accessorKey: 'name', header: t('adm.sys.pr.lc.account'), cell: ({ row }) => (
      <span className="flex flex-col"><span className="a-t1 font-medium">{row.original.name ?? row.original.scope_key}</span>
        <span className="a-t3 whitespace-normal text-[12px]">{row.original.declared_at ? t('adm.crm.cb.signed', { name: row.original.signatory_name ?? '—', role: row.original.signatory_role ?? '—', date: fmtDate(row.original.declared_at, lang, 'day'), v: row.original.declaration_version ?? '—' }) : ''}</span></span>
    ) },
    { id: 'status', header: t('adm.sys.col.status'), accessorFn: (a) => a.status, cell: ({ row }) => (
      <Badge tone={row.original.status === 'suspended' ? 'negative' : row.original.open ? 'positive' : 'neutral'}>{statusLine(t, row.original)}</Badge>
    ) },
    { accessorKey: 'eligible', header: t('adm.sys.pr.cb.eligible'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'objected', header: t('adm.sys.pr.cb.objected'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'ramp_cap', header: t('adm.sys.pr.cb.ramp'), meta: { align: 'right' }, cell: (c) => (c.getValue<number | null>() ? fmtNum(c.getValue<number>(), lang) : '—') },
  ], [t, lang]);

  if (q.error && !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data || !draft) return <div className="a-skel h-64" />;

  const sw = (k: 'enabled' | 'sending_ready') => (
    <div className="flex items-start gap-3">
      <Switch checked={draft[k]} label={t(`adm.crm.cb.g.${k}`)} onChange={(v) => setDraft({ ...draft, [k]: v })} />
      <span className="flex flex-col"><span className="a-t1 text-[13.5px] font-medium">{t(`adm.crm.cb.g.${k}`)}</span><span className="a-t3 text-[12.5px]">{t(`adm.crm.cb.g.${k}S`)}</span></span>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('adm.crm.cb.gT')}>
        <div className="flex max-w-[720px] flex-col gap-4">
          <p className="a-t2 text-[13px] leading-relaxed">{t('adm.crm.cb.gS')}</p>
          {sw('enabled')}
          {sw('sending_ready')}
          <label className="flex flex-wrap items-center justify-between gap-3 text-[13.5px]">
            <span className="a-t1">{t('adm.crm.cb.g.declaration_version')}</span>
            <input className="a-input" style={{ width: 180 }} value={draft.declaration_version} onChange={(e) => setDraft({ ...draft, declaration_version: e.target.value })} />
          </label>
          {NUMS.map((k) => (
            <label key={k} className="flex flex-wrap items-center justify-between gap-3 text-[13.5px]">
              <span className="a-t1">{t(`adm.crm.cb.g.${k}`)}</span>
              <NumberInput label={t(`adm.crm.cb.g.${k}`)} value={draft[k]} step={k.endsWith('pct') ? 0.01 : 1} width={120} onChange={(v) => setDraft({ ...draft, [k]: v })} />
            </label>
          ))}
          {'declaration_version' in patch && <p className="text-[12.5px]" style={{ color: 'var(--a-warn)' }}>{t('adm.crm.cb.g.versionWarn')}</p>}
          <div className="flex gap-2">
            <button type="button" className="a-btn a-btn--primary" disabled={!dirty} onClick={() => setAsk(true)}>{t('adm.crm.cb.save')}</button>
            {dirty && <button type="button" className="a-btn" onClick={() => setDraft(q.data?.settings ?? null)}>{t('adm.crm.se.reset')}</button>}
          </div>
        </div>
      </Card>

      <Section title={t('adm.crm.cb.accT')} description={t('adm.crm.cb.accS')}>
        <DataTable data={q.data.accounts} columns={cols} getRowId={(a) => a.scope_key} pageSize={10} searchable empty={{ title: t('adm.crm.cb.none') }} />
      </Section>

      <ReasonDialog open={ask} onOpenChange={setAsk} title={t('adm.crm.cb.save')} confirmLabel={t('adm.crm.cb.confirm')}
        description={'declaration_version' in patch ? t('adm.crm.cb.g.versionWarn') : undefined}
        onConfirm={async (reason) => {
          try { await rpc('crm_admin_customer_basis_settings_set', { p_patch: patch, p_reason: reason }); }
          catch (e) { throw new Error(t('adm.crm.cb.err', { e: (e as Error).message })); }
          toast.success(t('adm.crm.cb.saved'));
          await q.refetch();
        }} />
    </div>
  );
}
