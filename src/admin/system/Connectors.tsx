/**
 * Système › Connecteurs : « Les billetteries connectées répondent-elles ? »
 * Shotgun (connexions, passes, quota partagé par minute, imports) et les
 * scénarios des comptes CRM. Le plan d'un prospect (`plan/:scope/:event`)
 * garde son écran, lu seul par le super admin avant l'appel.
 */
import { Link } from 'react-router-dom';
import { Badge, Card, Chart, DataTable, Grid, Kpi, KpiRow, Page, Status, Tabs, useAdminFilters, useAdminT, useTab, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtMs, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { useAdminAccounts, useAdminScenarios, type AdminScenarioAccount } from '@/crm/admin/data';
import { ADMIN_ROUTES } from '@/crm/admin/adminNav';
import type { AdminAccount } from '@/crm/lib/admin';
import { usePlatformSync } from './data';

/** Plafond du limiteur commun (consume_ticketing_rate) : requêtes par minute. */
const SHOTGUN_LIMIT = 45;

export default function Connectors() {
  const { t } = useAdminT();
  const tabs = [{ value: 'shotgun', label: 'Shotgun' }, { value: 'scenarios', label: t('adm.sys.cn.tab.scenarios') }];
  const [tab, setTab] = useTab(tabs);
  return (
    <Page title={t('adm.sys.cn.title')} subtitle={t('adm.sys.cn.sub')}>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'shotgun' ? <ShotgunTab /> : <ScenariosTab />}
    </Page>
  );
}

function ShotgunTab() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const p = usePlatformSync(includeDemo);
  const acc = useAdminAccounts();
  const s = p.data?.shotgun;
  const connected = (acc.data?.accounts ?? []).filter((a) => a.sync !== 'none');
  const bad = connected.filter((a) => a.sync === 'error');
  const okRate = s && s.runs24 ? ((s.runs24 - s.errors24) / s.runs24) * 100 : null;
  const peak = s ? Math.max(0, ...s.hours.map((h) => h.req)) / 60 : 0;
  const imports = Object.entries(p.data?.imports ?? {}).map(([status, n]) => ({ status, n }));

  const cols: ColumnDef<AdminAccount, unknown>[] = [
    { accessorKey: 'name', header: t('adm.sys.cn.account'), cell: ({ row }) => <Link to={ADMIN_ROUTES.account(row.original.id)} className="a-t1 font-medium underline-offset-2 hover:underline">{row.original.name}</Link> },
    { id: 'state', header: t('adm.sys.cn.state'), accessorFn: (a) => (a.sync === 'error' ? 1 : 0), cell: ({ row }) => <Status tone={row.original.sync === 'ok' ? 'positive' : 'negative'}>{row.original.sync === 'ok' ? t('adm.sys.cn.ok') : t('adm.sys.cn.error')}</Status> },
    { id: 'at', header: t('adm.sys.cn.lastSync'), accessorFn: (a) => a.sync_at ?? '', cell: ({ row }) => (row.original.sync_at ? fmtRelative(row.original.sync_at, lang) : '—') },
    { id: 'err', header: t('adm.sys.cn.errorMsg'), enableSorting: false, cell: ({ row }) => <span className="a-t3 text-[12.5px]">{row.original.sync === 'error' ? row.original.sync_error ?? '' : ''}</span> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <Kpi label={t('adm.sys.cn.k.conns')} value={fmtNum(connected.length, lang)} loading={acc.isLoading} />
        <Kpi label={t('adm.sys.cn.k.bad')} value={fmtNum(bad.length, lang)} invert loading={acc.isLoading} />
        <Kpi label={t('adm.sys.cn.k.runs')} value={fmtNum(s?.runs24 ?? 0, lang)} hint={t('adm.sys.cn.k.runsHint', { n: fmtNum(s?.errors24 ?? 0, lang) })} loading={p.isLoading} />
        <Kpi label={t('adm.sys.cn.k.rate')} value={okRate == null ? '—' : fmtPct(okRate, 1)} loading={p.isLoading} />
        <Kpi label={t('adm.sys.cn.k.dur')} value={s?.duration.p50 == null ? '—' : fmtMs(s.duration.p50 * 1000, lang)} hint={s?.duration.p95 != null ? t('adm.sys.cn.k.durHint', { p: fmtMs(s.duration.p95 * 1000, lang) }) : undefined} loading={p.isLoading} />
      </KpiRow>
      <Card title={t('adm.sys.cn.quota')} footer={t('adm.sys.cn.quotaNote', { peak: Math.round(peak * 10) / 10, limit: SHOTGUN_LIMIT })}>
        <Chart kind="bar" data={s?.hours.map((h) => ({ h: h.h, req: h.req })) ?? null} x="h" formatX={(v) => fmtDate(v, lang, 'time')} height={220}
          unit={{ label: 'req', format: (v) => fmtNum(v, lang) }} series={[{ key: 'req', label: t('adm.sys.cn.requests') }]} loading={p.isLoading} error={p.error} onRetry={() => void p.refetch()} />
      </Card>
      <Grid cols={2}>
        <Card title={t('adm.sys.cn.connections')} padded={false}>
          <DataTable data={connected} columns={cols} loading={acc.isLoading} error={acc.error} onRetry={() => void acc.refetch()} searchable initialSort={[{ id: 'state', desc: true }]}
            getRowId={(a) => a.id} empty={{ title: t('adm.sys.cn.noConns') }} />
        </Card>
        <Card title={t('adm.sys.cn.imports')} padded={false}>
          <DataTable data={imports} loading={p.isLoading} getRowId={(r) => r.status} empty={{ title: t('adm.sys.cn.noImports') }}
            columns={[
              { accessorKey: 'status', header: t('adm.sys.cn.state'), cell: (c) => <Badge>{c.getValue<string>()}</Badge> },
              { accessorKey: 'n', header: t('adm.sys.cn.count'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
            ] as ColumnDef<{ status: string; n: number }, unknown>[]} />
        </Card>
      </Grid>
    </div>
  );
}

function ScenariosTab() {
  const { t, lang } = useAdminT();
  const q = useAdminScenarios();
  const d = q.data;
  const k = d?.totals;
  const held = Object.entries(d?.held ?? {}).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
  const cols: ColumnDef<AdminScenarioAccount, unknown>[] = [
    { accessorKey: 'name', header: t('adm.sys.cn.account'), cell: ({ row }) => <Link to={ADMIN_ROUTES.account(row.original.id)} className="a-t1 font-medium underline-offset-2 hover:underline">{row.original.name}</Link> },
    { id: 'state', header: t('adm.sys.cn.state'), accessorFn: (a) => a.state, cell: ({ row }) => <Status tone={row.original.state === 'ok' ? 'positive' : row.original.state === 'frozen' ? 'negative' : 'warning'}>{t(`adm.sys.cn.sc.${row.original.state}`)}</Status> },
    { accessorKey: 'active', header: t('adm.sys.cn.sc.active'), meta: { align: 'right' } },
    { accessorKey: 'on_their_way', header: t('adm.sys.cn.sc.way'), meta: { align: 'right' } },
    { accessorKey: 'sent7', header: t('adm.sys.cn.sc.sent'), meta: { align: 'right' } },
    { accessorKey: 'held_now', header: t('adm.sys.cn.sc.held'), meta: { align: 'right' } },
    { accessorKey: 'broken', header: t('adm.sys.cn.sc.broken'), meta: { align: 'right' }, cell: (c) => <span style={c.getValue<number>() > 0 ? { color: 'var(--a-neg)', fontWeight: 600 } : undefined}>{c.getValue<number>()}</span> },
  ];
  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <Kpi label={t('adm.sys.cn.sc.active')} value={fmtNum(k?.active ?? 0, lang)} hint={t('adm.sys.cn.sc.activeHint', { p: fmtNum(k?.paused ?? 0, lang), d: fmtNum(k?.drafts ?? 0, lang) })} loading={q.isLoading} />
        <Kpi label={t('adm.sys.cn.sc.way')} value={fmtNum(k?.on_their_way ?? 0, lang)} loading={q.isLoading} />
        <Kpi label={t('adm.sys.cn.sc.sent')} value={fmtNum(k?.sent7 ?? 0, lang)} hint={t('adm.sys.cn.sc.sentHint')} loading={q.isLoading} />
        <Kpi label={t('adm.sys.cn.sc.held')} value={fmtNum(k?.held_now ?? 0, lang)} invert loading={q.isLoading} />
        <Kpi label={t('adm.sys.cn.sc.broken')} value={fmtNum(k?.broken ?? 0, lang)} invert hint={t('adm.sys.cn.sc.brokenHint')} loading={q.isLoading} />
      </KpiRow>
      <Card title={t('adm.sys.cn.sc.accounts')} padded={false}>
        <DataTable data={d?.accounts} columns={cols} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable getRowId={(a) => a.id}
          initialSort={[{ id: 'broken', desc: true }]} empty={{ title: t('adm.sys.cn.sc.none') }} />
      </Card>
      <Card title={t('adm.sys.cn.sc.heldBy')} padded={false} footer={t('adm.sys.cn.sc.privacy')}>
        <DataTable data={held} loading={q.isLoading} getRowId={(r) => r.reason} empty={{ title: t('adm.sys.cn.sc.heldNone') }}
          columns={[
            { accessorKey: 'reason', header: t('adm.sys.cn.sc.reason'), cell: (c) => { const k2 = `yc.scn.why.${c.getValue<string>()}`; return <Badge>{c.getValue<string>() || k2}</Badge>; } },
            { accessorKey: 'n', header: t('adm.sys.cn.count'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
          ] as ColumnDef<{ reason: string; n: number }, unknown>[]} />
      </Card>
    </div>
  );
}
