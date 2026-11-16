/**
 * Légal › Conditions acceptées (`/admin/legal/terms`).
 *
 * `legal_acceptances` par document et version, pour les deux produits : quels
 * comptes pros ouverts n'ont PAS accepté la version en vigueur (LEGAL_VERSIONS),
 * et, en compteur, les preuves d'acceptation des CGV par les acheteurs
 * (`terms_acceptances`, écrites par recordTermsAcceptance).
 */
import { useMemo } from 'react';
import { Badge, DataTable, Kpi, KpiRow, Page, Section, Tabs, useAdminT, useTab, type ColumnDef } from '@/admin/ui';
import { LEGAL_VERSIONS } from '@/lib/legal';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { useLegalTerms, type TermsPayload } from './data';
import { proHref } from './rules';
import { SourceNote } from './ui';
import { tOr } from './format';

type ProRow = TermsPayload['pros'][number];
type DocRow = TermsPayload['docs'][number];

export default function TermsPage() {
  const { t, lang } = useAdminT();
  const q = useLegalTerms();
  const d = q.data;
  const pros = useMemo(() => d?.pros ?? [], [d]);
  const missing = pros.filter((p) => p.missing.length > 0);
  const versions = LEGAL_VERSIONS as Record<string, string>;

  const tabs = [
    { value: 'missing', label: t('adm.lg2.tm.tab.missing'), count: missing.length },
    { value: 'all', label: t('adm.lg2.tm.tab.all'), count: pros.length },
  ];
  const [tab, setTab] = useTab(tabs);

  const pcols: ColumnDef<ProRow, unknown>[] = [
    { accessorKey: 'name', header: t('adm.lg2.col.account'),
      cell: (c) => { const r = c.row.original; return <div className="flex min-w-0 flex-col py-1.5"><span className="a-t1 truncate font-medium">{r.name}{r.is_demo && <span className="a-t3"> · {t('adm.lg2.demo')}</span>}</span><span className="a-t3 truncate text-[12px]">{r.email ?? '—'}</span></div>; } },
    { accessorKey: 'kind', header: t('adm.lg2.col.type'), cell: (c) => t(`adm.lg2.kind.${c.getValue<string>()}`) },
    { id: 'products', accessorFn: (r) => r.products.join(','), header: t('adm.lg2.col.products'),
      cell: (c) => <span className="flex gap-1">{c.row.original.products.map((p) => <Badge key={p}>{t(`adm.lg2.product.${p === 'suite' ? 'tickets' : p}`)}</Badge>)}</span> },
    { id: 'missing', accessorFn: (r) => r.missing.length, header: t('adm.lg2.tm.col.missing'),
      cell: (c) => { const r = c.row.original;
        return r.missing.length === 0 ? <Badge tone="positive">{t('adm.lg2.tm.upToDate')}</Badge> : (
          <span className="flex flex-wrap gap-1">{r.missing.map((m) => (
            <Badge key={m} tone={r.docs[m] ? 'warning' : 'negative'}>{t(`adm.lg2.doc.${m}`)}{r.docs[m] ? ` v${r.docs[m].v}` : ''}</Badge>))}</span>); } },
  ];
  const dcols: ColumnDef<DocRow, unknown>[] = [
    { accessorKey: 'doc', header: t('adm.lg2.tm.col.doc'), cell: (c) => t(`adm.lg2.doc.${c.getValue<string>()}`) },
    { accessorKey: 'version', header: t('adm.lg2.tm.col.version'),
      cell: (c) => <span className="flex items-center gap-2"><span className="a-mono">{c.getValue<string>()}</span>{versions[c.row.original.doc] === c.getValue<string>() && <Badge tone="positive">{t('adm.lg2.tm.current')}</Badge>}</span> },
    { accessorKey: 'people', header: t('adm.lg2.tm.col.people'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'n', header: t('adm.lg2.tm.col.n'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'last', header: t('adm.lg2.tm.col.last'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'short') },
  ];
  type BuyerRow = TermsPayload['buyers']['by'][number];
  const bcols: ColumnDef<BuyerRow, unknown>[] = [
    { accessorKey: 'context', header: t('adm.lg2.tm.col.context'), cell: (c) => tOr(t, `adm.lg2.tm.ctx.${c.getValue<string>()}`, c.getValue<string>()) },
    { accessorKey: 'version', header: t('adm.lg2.tm.col.version'), cell: (c) => <span className="a-mono">{c.getValue<string>()}</span> },
    { accessorKey: 'n', header: t('adm.lg2.tm.col.n'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'last', header: t('adm.lg2.tm.col.last'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'short') },
  ];

  return (
    <Page title={t('adm.lg2.tm.title')} subtitle={t('adm.lg2.tm.sub')} period>
      <KpiRow>
        <Kpi label={t('adm.lg2.tm.k.pros')} loading={!d} value={fmtNum(pros.length, lang)} />
        <Kpi label={t('adm.lg2.tm.k.missing')} loading={!d} value={fmtNum(missing.length, lang)} to="/admin/legal/terms" />
        <Kpi label={t('adm.lg2.tm.k.buyers')} loading={!d} value={fmtNum(d?.buyers.period, lang)} current={d?.buyers.period} previous={d?.buyers.previous} hint={t('adm.lg2.tm.k.buyersHint')} />
        <Kpi label={t('adm.lg2.tm.k.buyersTotal')} loading={!d} value={fmtNum(d?.buyers.total, lang)} />
      </KpiRow>
      <Section title={t('adm.lg2.tm.pros')} description={t('adm.lg2.tm.prosSub')}>
        <Tabs items={tabs} value={tab} onChange={setTab} />
        <DataTable data={tab === 'missing' ? missing : pros} columns={pcols} loading={q.isLoading} error={q.isError ? q.error : undefined}
          onRetry={() => void q.refetch()} searchable getRowId={(r) => r.key} rowHref={(r) => proHref(r.key)}
          empty={{ title: tab === 'missing' ? t('adm.lg2.tm.allUpToDate') : t('adm.lg2.empty') }} />
      </Section>
      <Section title={t('adm.lg2.tm.docs')} description={t('adm.lg2.tm.docsSub')}>
        <DataTable data={d?.docs} columns={dcols} loading={q.isLoading} getRowId={(r) => `${r.doc}:${r.version}`} pageSize={20} />
      </Section>
      <Section title={t('adm.lg2.tm.buyers')} description={t('adm.lg2.tm.buyersSub')}>
        <DataTable data={d?.buyers.by} columns={bcols} loading={q.isLoading} getRowId={(r) => `${r.context}:${r.version}`} />
      </Section>
      <SourceNote>{t('adm.lg2.tm.note')}</SourceNote>
    </Page>
  );
}
