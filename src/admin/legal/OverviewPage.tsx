/**
 * Légal › Vue d'ensemble (`/admin/legal`) : « Sommes-nous en règle ? ».
 * Une ligne par obligation suivie, son état (en règle / à traiter / en retard),
 * son compteur, sa prochaine échéance, et la page qui la traite. Les états se
 * décident dans `rules.ts` (testé), les compteurs dans `admin_legal_overview`.
 */
import { useMemo } from 'react';
import { DataTable, ErrorState, Kpi, KpiRow, Page, Section, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { useLegalOverview } from './data';
import { obligations, type Obligation } from './rules';
import { SourceNote, StateBadge } from './ui';

export default function OverviewPage() {
  const { t, lang } = useAdminT();
  const q = useLegalOverview();
  const o = q.data;
  const rows = useMemo(() => (o ? obligations(o) : []), [o]);
  const late = rows.filter((r) => r.state === 'late').length;
  const todo = rows.filter((r) => r.state === 'todo').length;

  const columns: ColumnDef<Obligation, unknown>[] = [
    { accessorKey: 'state', header: t('adm.lg2.col.state'), cell: (c) => <StateBadge state={c.row.original.state} />,
      sortingFn: (a, b) => ['ok', 'todo', 'late'].indexOf(a.original.state) - ['ok', 'todo', 'late'].indexOf(b.original.state), meta: { width: '130px' } },
    { id: 'name', accessorFn: (r) => t(`adm.lg2.ob.${r.id}`), header: t('adm.lg2.col.obligation'),
      cell: (c) => (
        <div className="flex flex-col py-1.5">
          <span className="a-t1 font-medium">{t(`adm.lg2.ob.${c.row.original.id}`)}</span>
          <span className="a-t3 text-[12px]">{t(`adm.lg2.ob.${c.row.original.id}.src`)}</span>
        </div>
      ) },
    { accessorKey: 'count', header: t('adm.lg2.col.count'), meta: { align: 'right', width: '110px' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'next', header: t('adm.lg2.col.next'), meta: { width: '150px' },
      cell: (c) => (c.getValue<string | null>() ? fmtDate(c.getValue<string>(), lang, 'short') : <span className="a-t3">—</span>) },
  ];

  return (
    <Page title={t('adm.lg2.ov.title')} subtitle={late ? t('adm.lg2.ov.subLate', { n: late }) : todo ? t('adm.lg2.ov.subTodo', { n: todo }) : o ? t('adm.lg2.ov.subOk') : t('adm.lg2.ov.sub')}>
      {q.isError && !o ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <KpiRow>
          <Kpi label={t('adm.lg2.ov.kl.requests')} loading={!o} value={fmtNum(o?.requests.open, lang)} to="/admin/legal/requests" hint={t('adm.lg2.ov.k.requests')} />
          <Kpi label={t('adm.lg2.ov.kl.incidents')} loading={!o} value={fmtNum(o?.incidents.open, lang)} to="/admin/legal/incidents" hint={t('adm.lg2.ov.k.incidents')} />
          <Kpi label={t('adm.lg2.ov.kl.terms')} loading={!o} value={fmtNum(o?.terms.missing, lang)} to="/admin/legal/terms" hint={t('adm.lg2.ov.k.terms', { n: o?.terms.pros ?? 0 })} />
          <Kpi label={t('adm.lg2.ov.kl.sellers')} loading={!o} value={fmtNum(o?.sellers.incomplete, lang)} to="/admin/legal/sellers" hint={t('adm.lg2.ov.k.sellers', { n: o?.sellers.with_stripe ?? 0 })} />
          <Kpi label={t('adm.lg2.ov.kl.deadlines')} loading={!o} value={fmtNum((o?.deadlines.overdue ?? 0) + (o?.deadlines.soon ?? 0) + (o?.deadlines.undated ?? 0), lang)} to="/admin/legal/deadlines" hint={t('adm.lg2.ov.k.deadlines')} />
          <Kpi label={t('adm.lg2.ov.kl.support')} loading={!o} value={fmtNum((o?.support.grants ?? 0) + (o?.support.sessions ?? 0), lang)} to="/admin/pros/support" hint={t('adm.lg2.ov.k.support')} />
        </KpiRow>
      )}
      <Section title={t('adm.lg2.ov.list')} description={t('adm.lg2.ov.listSub')}>
        <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          rowHref={(r) => r.path} getRowId={(r) => r.id} initialSort={[{ id: 'state', desc: true }]} pageSize={20} />
      </Section>
      <SourceNote jurist>{t('adm.lg2.ov.note')}</SourceNote>
    </Page>
  );
}
