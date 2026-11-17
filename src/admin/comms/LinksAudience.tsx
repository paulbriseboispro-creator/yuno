/**
 * Page bio › Audience : visiteurs et clics (une échelle, des personnes et des
 * clics), puis les clics par lien et la provenance en tableaux. Le détail
 * (pays, langues, appareils, campagnes, villes) reste replié.
 */
import { Card, Chart, DataTable, Grid, Kpi, KpiRow, useAdminFilters, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct } from '@/lib/adminFormat';
import { useLinksAnalytics } from './data';

const TARGETS = new Set(['app_store', 'web_app', 'instagram', 'tiktok', 'whatsapp', 'share', 'featured_all', 'pro_signup', 'event']);
interface KV { k: string; n: number }

function KvTable({ rows, label, count, empty }: { rows: KV[]; label: (k: string) => string; count: string; empty: string }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<KV, unknown>[] = [
    { id: 'k', header: label('') || t('adm.comms.ln.a.value'), accessorFn: (r) => label(r.k), cell: (c) => <span className="a-t1">{c.getValue<string>()}</span> },
    { accessorKey: 'n', header: count, meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ];
  return <DataTable data={rows} columns={cols} pageSize={8} getRowId={(r) => r.k} initialSort={[{ id: 'n', desc: true }]} empty={{ title: empty }} />;
}

export default function LinksAudience() {
  const { t, lang } = useAdminT();
  const { range } = useAdminFilters();
  const cur = useLinksAnalytics(range.from.toISOString(), range.to.toISOString());
  const prev = useLinksAnalytics(range.prevFrom.toISOString(), range.prevTo.toISOString());
  const s = cur.data;
  const p = prev.data;
  const tt = s?.totals;
  const hourly = s?.granularity === 'hour';
  const ctr = tt && tt.visitors > 0 ? (tt.click_visitors / tt.visitors) * 100 : 0;
  const pctr = p?.totals && p.totals.visitors > 0 ? (p.totals.click_visitors / p.totals.visitors) * 100 : null;
  const series = (s?.series ?? []).map((x) => ({ t: x.t, visitors: x.visitors, clicks: x.clicks }));
  const fmtX = (v: string) => (hourly ? new Date(v).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : fmtAxisDay(v.slice(0, 10), lang));

  const targetLabel = (k: string) => (k === '' ? t('adminLinks.targetsTitle') : TARGETS.has(k) ? t(`adminLinks.target.${k}`) : k);
  const refLabel = (k: string) => (k === '' ? t('adminLinks.referrersTitle') : k === 'direct' ? t('adminTraffic.ch_direct') : k);
  const plain = (title: string) => (k: string) => (k === '' ? title : k);
  const upper = (title: string) => (k: string) => (k === '' ? title : k.toUpperCase());
  const device = (k: string) => (k === '' ? t('adminLinks.devicesTitle') : k === 'mobile' || k === 'tablet' || k === 'desktop' ? t(`adminTraffic.dev_${k}`) : t('adminTraffic.dev_unknown'));
  const leadType = (k: string) => (k === '' ? t('adminLinks.leadTypesTitle') : ['club', 'organizer', 'promoter', 'agency', 'other'].includes(k) ? t(`adminLinks.type.${k}`) : k);

  const targetCols: ColumnDef<NonNullable<typeof s>['targets'][number], unknown>[] = [
    { id: 'target', header: t('adm.comms.ln.a.link'), accessorFn: (r) => targetLabel(r.target), cell: (c) => <span className="a-t1 font-medium">{c.getValue<string>()}</span> },
    { accessorKey: 'clicks', header: t('adminLinks.kClicks'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'visitors', header: t('adminLinks.kVisitors'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ];
  const eventCols: ColumnDef<NonNullable<typeof s>['events'][number], unknown>[] = [
    { id: 'title', header: t('adminLinks.eventsTitle'), accessorFn: (r) => r.title || r.event_id, cell: (c) => <span className="a-t1 font-medium">{c.getValue<string>()}</span> },
    { accessorKey: 'clicks', header: t('adminLinks.kClicks'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ];

  const empty = !!tt && tt.views === 0 && tt.clicks === 0 && tt.waitlist === 0 && tt.pro_leads === 0;
  const count = t('adm.comms.ln.a.count');

  return (
    <>
      <KpiRow>
        <Kpi label={t('adminLinks.kVisitors')} value={fmtNum(tt?.visitors ?? 0, lang)} current={tt?.visitors} previous={p?.totals.visitors} loading={cur.isLoading} />
        <Kpi label={t('adminLinks.kClicks')} value={fmtNum(tt?.clicks ?? 0, lang)} current={tt?.clicks} previous={p?.totals.clicks} loading={cur.isLoading} />
        <Kpi label={t('adminLinks.kCtr')} value={fmtPct(ctr)} current={ctr} previous={pctr} hint={t('adminLinks.kCtrSub')} loading={cur.isLoading} />
        <Kpi label={t('adminLinks.kWaitlist')} value={fmtNum(tt?.waitlist ?? 0, lang)} current={tt?.waitlist} previous={p?.totals.waitlist} loading={cur.isLoading} />
        <Kpi label={t('adminLinks.kLeads')} value={fmtNum(tt?.pro_leads ?? 0, lang)} current={tt?.pro_leads} previous={p?.totals.pro_leads} to="/admin/pros/prospects" loading={cur.isLoading} />
      </KpiRow>
      <Card title={t('adm.comms.ln.a.chart')}>
        <Chart kind="line" data={series} x="t" formatX={fmtX} unit="count" height={240}
          series={[{ key: 'visitors', label: t('adminLinks.kVisitors') }, { key: 'clicks', label: t('adminLinks.kClicks') }]}
          loading={cur.isLoading} error={cur.error} onRetry={() => void cur.refetch()} empty={empty ? t('adminLinks.emptyBody') : undefined} />
      </Card>
      <Grid cols={2}>
        <Card padded={false} title={t('adminLinks.targetsTitle')}>
          <DataTable data={s?.targets} columns={targetCols} loading={cur.isLoading} pageSize={10} getRowId={(r) => r.target} initialSort={[{ id: 'clicks', desc: true }]} empty={{ title: t('adminLinks.noClicks') }} />
        </Card>
        <Card padded={false} title={t('adminLinks.referrersTitle')}>
          <KvTable rows={s?.referrers ?? []} label={refLabel} count={count} empty={t('adminLinks.noClicks')} />
        </Card>
      </Grid>
      <Card padded={false} title={t('adminLinks.eventsTitle')}>
        <DataTable data={s?.events} columns={eventCols} loading={cur.isLoading} pageSize={8} getRowId={(r) => r.event_id} initialSort={[{ id: 'clicks', desc: true }]} empty={{ title: t('adminLinks.noClicks') }} />
      </Card>
      <details className="a-card group">
        <summary className="a-t1 flex min-h-[44px] cursor-pointer items-center px-4 text-[14px] font-semibold">{t('adm.comms.ln.a.more')}</summary>
        <div className="grid grid-cols-1 gap-4 border-t p-4 md:grid-cols-2 xl:grid-cols-3">
          {([
            [t('adminLinks.countriesTitle'), s?.countries, plain(t('adminLinks.countriesTitle'))],
            [t('adminLinks.langsTitle'), s?.langs, upper(t('adminLinks.langsTitle'))],
            [t('adminLinks.devicesTitle'), s?.devices, device],
            [t('adminLinks.utmTitle'), s?.utm, plain(t('adminLinks.utmTitle'))],
            [t('adminLinks.wlCitiesTitle'), s?.waitlist_cities, plain(t('adminLinks.wlCitiesTitle'))],
            [t('adminLinks.leadTypesTitle'), s?.lead_types, leadType],
          ] as [string, KV[] | undefined, (k: string) => string][]).map(([title, rows, label]) => (
            <div key={title} className="flex min-w-0 flex-col gap-2">
              <h3 className="a-t1 text-[13px] font-semibold">{title}</h3>
              <div className="a-card"><KvTable rows={rows ?? []} label={label} count={count} empty={t('adm.ui.chart.empty')} /></div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
