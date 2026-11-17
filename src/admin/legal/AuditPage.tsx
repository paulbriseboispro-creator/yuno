/**
 * Légal › Journal (`/admin/legal/audit`) : UN journal des gestes sur la
 * plateforme, `admin_legal_audit` = admin_audit_log (gestes du super admin,
 * Suite comme ex-Admin CRM) ∪ admin_support_audit (accès assisté, agent
 * compris). Filtres : période (`?p=`), source, compte (`?account=venue:…`),
 * texte. Lecture seule.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, DataTable, Drawer, KeyValue, Kpi, KpiRow, Page, Section, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { useLegalAudit, type AuditEntry, type AuditSource } from './data';
import { proHref } from './rules';
import { Segmented } from '@/admin/ui';
import { tOr } from './format';

const SOURCE_TONE = { admin: 'neutral', support: 'warning', agent: 'accent' } as const;

export default function AuditPage() {
  const { t, lang } = useAdminT();
  const [sp, setSp] = useSearchParams();
  const source = (['admin', 'support', 'agent'].includes(sp.get('source') ?? '') ? sp.get('source') : 'all') as AuditSource;
  const account = sp.get('account') ?? '';
  const [draft, setDraft] = useState(account);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const r = useLegalAudit(source, account, q);
  const rows = r.data?.rows ?? [];
  const set = (k: string, v: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v && v !== 'all') n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const label = (a: string) => tOr(t, `adm.audit.a.${a}`, tOr(t, `adm.lg2.au.a.${a}`, a));
  const columns: ColumnDef<AuditEntry, unknown>[] = [
    { accessorKey: 'at', header: t('adm.lg2.au.col.at'), meta: { width: '160px' }, cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
    { accessorKey: 'source', header: t('adm.lg2.au.col.source'), cell: (c) => <Badge tone={SOURCE_TONE[c.row.original.source]}>{t(`adm.lg2.au.src.${c.getValue<string>()}`)}</Badge> },
    { accessorKey: 'actor', header: t('adm.lg2.au.col.actor'), cell: (c) => <span className="a-t2 block max-w-[200px] truncate">{c.getValue<string | null>() ?? '—'}</span> },
    { accessorKey: 'action', header: t('adm.lg2.au.col.action'), cell: (c) => <span className="a-t1">{label(c.getValue<string>())}</span> },
    { id: 'target', accessorFn: (e) => `${e.entity_type ?? ''} ${e.entity_id ?? ''} ${e.target ?? ''}`, header: t('adm.lg2.au.col.target'),
      cell: (c) => { const e = c.row.original; return <span className="a-t2 block max-w-[240px] truncate">{e.target ?? ([e.entity_type, e.entity_id?.slice(0, 40)].filter(Boolean).join(' · ') || '—')}</span>; } },
    { accessorKey: 'reason', header: t('adm.lg2.au.col.reason'), cell: (c) => <span className="a-t2 block max-w-[280px] truncate">{c.getValue<string | null>() ?? '—'}</span> },
  ];

  return (
    <Page title={t('adm.lg2.au.title')} subtitle={t('adm.lg2.au.sub')} period
      actions={<Segmented value={source} onChange={(v) => set('source', v)} label={t('adm.lg2.au.col.source')}
        options={(['all', 'admin', 'support', 'agent'] as const).map((s) => ({ value: s, label: t(`adm.lg2.au.src.${s}`) }))} />}>
      <KpiRow>
        <Kpi label={t('adm.lg2.au.k.total')} loading={r.isLoading} value={fmtNum(rows.length, lang)} />
        <Kpi label={t('adm.lg2.au.k.admin')} loading={r.isLoading} value={fmtNum(rows.filter((x) => x.source === 'admin').length, lang)} />
        <Kpi label={t('adm.lg2.au.k.support')} loading={r.isLoading} value={fmtNum(rows.filter((x) => x.source === 'support').length, lang)} />
        <Kpi label={t('adm.lg2.au.k.agent')} loading={r.isLoading} value={fmtNum(rows.filter((x) => x.source === 'agent').length, lang)} />
      </KpiRow>
      <Section>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); set('account', draft.trim()); }}>
          <input className="a-input a-mono max-w-[300px]" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('adm.lg2.au.account')} aria-label={t('adm.lg2.au.account')} />
          <input className="a-input max-w-[260px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('adm.lg2.au.search')} aria-label={t('adm.lg2.au.search')} />
          <button type="submit" className="a-btn">{t('adm.lg2.au.filter')}</button>
          {(account || q) && <button type="button" className="a-btn a-btn--ghost" onClick={() => { setDraft(''); setQ(''); set('account', ''); }}>{t('adm.lg2.clear')}</button>}
        </form>
        <DataTable data={rows} columns={columns} loading={r.isLoading} error={r.isError ? r.error : undefined} onRetry={() => void r.refetch()}
          getRowId={(e) => `${e.source}:${e.id}`} onRowClick={(e) => setOpen(e)} pageSize={50} empty={{ title: t('adm.lg2.au.none') }} />
      </Section>
      {open && (
        <Drawer open onOpenChange={(v) => { if (!v) setOpen(null); }} title={label(open.action)} description={fmtDate(open.at, lang, 'datetime')}>
          <KeyValue items={[
            { label: t('adm.lg2.au.col.source'), value: t(`adm.lg2.au.src.${open.source}`) },
            { label: t('adm.lg2.au.col.actor'), value: open.actor ?? '—' },
            { label: t('adm.lg2.au.col.target'), value: open.target ?? [open.entity_type, open.entity_id].filter(Boolean).join(' · ') ?? '—', mono: true },
            { label: t('adm.lg2.au.col.reason'), value: open.reason ?? '—' },
            { label: t('adm.lg2.au.code'), value: open.action, mono: true },
          ]} />
          {proHref(open.entity_id) && <Link className="a-btn a-btn--sm mt-3" to={proHref(open.entity_id) as string}>{t('adm.lg2.openPro')}</Link>}
          {open.detail && <pre className="a-subtle a-mono a-t2 mt-4 overflow-x-auto rounded-lg p-3 text-[11.5px]">{JSON.stringify(open.detail, null, 2)}</pre>}
        </Drawer>
      )}
    </Page>
  );
}
