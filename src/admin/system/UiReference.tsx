/**
 * Système › Référence du kit (`/admin/system/ui`, hors menu) : toutes les
 * primitives et toutes les formes de graphique, avec des données d'exemple.
 * C'est la page de cohérence : un écran nouveau se compare à elle, en clair et
 * en sombre (docs/designs/ADMIN_DESIGN_SYSTEM.md).
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import {
  Badge, Block, BulletBar, CalendarHeat, Card, Chart, CohortGrid, DataTable, Dialog, EmptyState, ErrorState, Funnel, FunnelSteps, Grid, Hero, HeroChart,
  HoverSync, KeyValue, Kpi, KpiRow, Page, RankBars, Section, SmallMultiples, StackedShare, StatStrip, Status, Tabs, Timeline, UptimeBars, Waterfall,
  useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtAxisDay, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';

const DAY = 86_400_000;
const days = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 18) + i * DAY).toISOString().slice(0, 10);
  const base = 40 + 18 * Math.sin(i / 3) + (i % 7 === 5 ? 30 : 0);
  return { d, cur: Math.round(base + i), prev: Math.round(base * 0.85 + 6), a: Math.round(base), b: Math.round(base * 0.4), c: Math.round(base * 0.2) };
});

interface Row { name: string; city: string; sales: number; revenue: number; state: 'ok' | 'todo' | 'late' }
const ROWS: Row[] = [
  { name: 'Le Sonore', city: 'Paris', sales: 412, revenue: 9840, state: 'ok' },
  { name: 'Amoris', city: 'Madrid', sales: 96, revenue: 2310, state: 'todo' },
  { name: '3 AM', city: 'Paris', sales: 0, revenue: 0, state: 'late' },
  { name: 'Asso Lumière', city: 'Lyon', sales: 12, revenue: 180, state: 'ok' },
];

export default function UiReference() {
  const { t, lang } = useAdminT();
  const [tab, setTab] = useState('a');
  const [dialog, setDialog] = useState(false);
  const stateLabel = (s: Row['state']) => t(`adm.sys.ui.state.${s}`);
  const cols: ColumnDef<Row>[] = [
    { accessorKey: 'name', header: t('adm.sys.ui.col.name') },
    { accessorKey: 'city', header: t('adm.sys.ui.col.city') },
    { accessorKey: 'sales', header: t('adm.sys.ui.col.sales'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'revenue', header: t('adm.sys.ui.col.revenue'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang, { cents: false }) },
    { accessorKey: 'state', header: t('adm.sys.ui.col.state'), cell: (c) => {
      const s = c.getValue<Row['state']>();
      return <Status tone={s === 'ok' ? 'positive' : s === 'todo' ? 'warning' : 'negative'}>{stateLabel(s)}</Status>;
    } },
  ];

  return (
    <Page title={t('adm.sys.ui.title')} subtitle={t('adm.sys.ui.sub')} period
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setDialog(true)}>{t('adm.sys.ui.primary')}</button>}>
      {/* ── v3 : la composition d'une page, puis chaque forme ── */}
      <HoverSync>
        <Hero kicker={t('adm.sys.ui.v3.kicker')} value={fmtEur(18420, lang, { cents: false })} current={18420} previous={16010}
          sentence={<>{t('adm.sys.ui.v3.sentence')}</>}
          chart={<HeroChart data={days.map((x) => ({ x: x.d, v: x.cur, prev: x.prev }))} formatX={(v) => fmtAxisDay(v, lang)} formatV={(v) => fmtEur(v, lang, { cents: false })}
            labels={{ cur: t('adm.sys.ui.s.cur'), prev: t('adm.sys.ui.s.prev'), peak: t('adm.sys.ui.v3.peak') }} onSelect={() => undefined} />}
          aside={(
            <>
              <Block title={t('adm.sys.ui.v3.share')}>
                <StackedShare emptyText="—" fmtShare={(r) => fmtPct(r * 100, 0, lang)} parts={[
                  { key: 'a', label: t('adm.sys.ui.s.a'), value: 1104, display: fmtEur(1104, lang, { cents: false }) },
                  { key: 'b', label: t('adm.sys.ui.s.b'), value: 192, display: fmtEur(192, lang, { cents: false }) },
                  { key: 'c', label: t('adm.sys.ui.s.c'), value: 40, display: fmtEur(40, lang, { cents: false }) }]} />
              </Block>
              <Block title={t('adm.sys.ui.v3.waterfall')}>
                <Waterfall steps={[
                  { key: 's', label: t('adm.sys.ui.k.sales'), value: 18420, display: fmtEur(18420, lang, { cents: false }), total: true },
                  { key: 'p', label: t('adm.sys.ui.v3.out'), value: -17316, display: `− ${fmtEur(17316, lang, { cents: false })}` },
                  { key: 'b', label: t('adm.sys.ui.s.b'), value: 232, display: `+ ${fmtEur(232, lang, { cents: false })}` },
                  { key: 'r', label: t('adm.sys.ui.k.fees'), value: 1336, display: fmtEur(1336, lang, { cents: false }), total: true }]} />
              </Block>
            </>
          )} />
        <StatStrip items={[
          { key: 'a', label: t('adm.sys.ui.k.sales'), value: fmtEur(18420, lang, { cents: false }), current: 18420, previous: 16010, spark: days.map((x) => x.cur) },
          { key: 'b', label: t('adm.sys.ui.k.fees'), value: fmtEur(1104, lang, { cents: false }), current: 1104, previous: 960 },
          { key: 'c', label: t('adm.sys.ui.k.refunds'), value: fmtEur(342, lang), current: 342, previous: 290, invert: true },
          { key: 'd', label: t('adm.sys.ui.k.buyers'), value: fmtNum(812, lang), current: 812, previous: 705, spark: days.map((x) => x.a), sparkKind: 'bar' },
        ]} />
        <SmallMultiples xLabels={days.map((x) => fmtAxisDay(x.d, lang))} items={[
          { key: 'a', label: t('adm.sys.ui.s.a'), total: fmtNum(1104, lang), series: days.map((x) => x.a), format: (v) => fmtNum(v, lang) },
          { key: 'b', label: t('adm.sys.ui.s.b'), total: fmtNum(412, lang), series: days.map((x) => x.b), format: (v) => fmtNum(v, lang), kind: 'bar' },
          { key: 'c', label: t('adm.sys.ui.s.c'), total: '0', series: days.map(() => 0), format: (v) => fmtNum(v, lang), emptyText: t('adm.sys.ui.empty') },
        ]} />
      </HoverSync>
      <Grid cols={3}>
        <Block title={t('adm.sys.ui.v3.rank')}>
          <RankBars emptyText="—" items={ROWS.map((r) => ({ key: r.name, label: r.name, sub: r.city, value: r.revenue, display: fmtEur(r.revenue, lang, { cents: false }) }))} />
        </Block>
        <Block title={t('adm.sys.ui.v3.bullet')}>
          <div className="flex flex-col gap-4">
            <BulletBar label={t('adm.sys.ui.v3.complaints')} display="0,06 %" value={0.06} target={0.1} zones={[0.1, 0.3]} max={0.4} targetLabel="0,1 %" />
            <BulletBar label={t('adm.sys.ui.v3.bounces')} display="2,1 %" value={2.1} target={3} zones={[3, 5]} max={6} targetLabel="3 %" />
          </div>
        </Block>
        <Block title={t('adm.sys.ui.v3.uptime')}>
          <div className="flex flex-col gap-4">
            <UptimeBars label="Stripe" summary="100 %" days={days.map((x) => ({ d: x.d, state: 'ok' as const }))} />
            <UptimeBars label="E-mail" summary="96,7 %" days={days.map((x, i) => ({ d: x.d, state: i === 12 ? 'down' as const : i === 20 ? 'warn' as const : 'ok' as const }))} />
          </div>
        </Block>
      </Grid>
      <Block title={t('adm.sys.ui.v3.funnel')}>
        <FunnelSteps fmtShare={(r) => fmtPct(r * 100, 0, lang)} lossLabel={(l, p) => `− ${l} (${p})`} steps={[
          { key: 'v', label: t('adm.sys.ui.f.v'), value: 1840, display: fmtNum(1840, lang) }, { key: 'o', label: t('adm.sys.ui.f.o'), value: 212, display: fmtNum(212, lang) },
          { key: 'c', label: t('adm.sys.ui.f.c'), value: 41, display: fmtNum(41, lang) }, { key: 'p', label: t('adm.sys.ui.f.p'), value: 9, display: fmtNum(9, lang) }]} />
      </Block>
      <Grid cols={2}>
        <Block title={t('adm.sys.ui.v3.cohort')}>
          <CohortGrid fmt={(v) => fmtPct(v * 100, 0, lang)} columns={['M0', 'M1', 'M2', 'M3']} rows={[
            { key: '1', label: 'août', size: '12', cells: [1, 0.75, 0.58, 0.5] }, { key: '2', label: 'sept.', size: '9', cells: [1, 0.66, 0.55, null] },
            { key: '3', label: 'oct.', size: '14', cells: [1, 0.71, null, null] }, { key: '4', label: 'nov.', size: '6', cells: [1, null, null, null] }]} />
        </Block>
        <Block title={t('adm.sys.ui.v3.calendar')}>
          <CalendarHeat weekdays={['L', 'M', 'M', 'J', 'V', 'S', 'D']} fmt={(d, v) => `${d} · ${v}`}
            days={Array.from({ length: 84 }, (_, i) => ({ d: new Date(Date.UTC(2026, 7, 24) + i * DAY).toISOString().slice(0, 10), v: i % 7 === 5 ? 30 + (i % 4) * 12 : i % 7 === 4 ? 12 : i % 3 }))} />
        </Block>
      </Grid>

      <KpiRow>
        <Kpi label={t('adm.sys.ui.k.sales')} value={fmtEur(18420, lang, { cents: false })} current={18420} previous={16010} to="/admin/money" />
        <Kpi label={t('adm.sys.ui.k.fees')} value={fmtEur(1104, lang, { cents: false })} current={1104} previous={960} />
        <Kpi label={t('adm.sys.ui.k.refunds')} value={fmtEur(342, lang)} current={342} previous={290} invert />
        <Kpi label={t('adm.sys.ui.k.down')} value={fmtNum(96, lang)} current={96} previous={120} />
        <Kpi label={t('adm.sys.ui.k.buyers')} value={fmtNum(812, lang)} current={812} previous={705} spark={days.map((d) => d.cur)} />
        <Kpi label={t('adm.sys.ui.k.none')} value="—" />
      </KpiRow>

      <Card title={t('adm.sys.ui.c.line')}>
        <Chart kind="line" data={days} x="d" formatX={(v) => fmtAxisDay(v, lang)} unit="eur"
          series={[{ key: 'cur', label: t('adm.sys.ui.s.cur') }]} previous={{ key: 'prev', label: t('adm.sys.ui.s.prev') }} />
      </Card>
      <Grid cols={2}>
        <Card title={t('adm.sys.ui.c.bar')}>
          <Chart kind="bar" height={200} data={days.slice(-14)} x="d" formatX={(v) => fmtAxisDay(v, lang)} unit="count"
            series={[{ key: 'a', label: t('adm.sys.ui.s.a') }]} />
        </Card>
        <Card title={t('adm.sys.ui.c.stacked')}>
          <Chart kind="stacked" height={200} data={days.slice(-14)} x="d" formatX={(v) => fmtAxisDay(v, lang)} unit="eur"
            series={[{ key: 'a', label: t('adm.sys.ui.s.a') }, { key: 'b', label: t('adm.sys.ui.s.b') }, { key: 'c', label: t('adm.sys.ui.s.c') }]} />
        </Card>
      </Grid>

      <Section title={t('adm.sys.ui.sec.states')} description={t('adm.sys.ui.sec.statesSub')}>
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{t('adm.sys.ui.b.neutral')}</Badge>
            <Badge tone="accent">{t('adm.sys.ui.b.accent')}</Badge>
            <Badge tone="positive"><CheckCircle2 className="h-3.5 w-3.5" />{t('adm.sys.ui.b.positive')}</Badge>
            <Badge tone="warning"><Clock className="h-3.5 w-3.5" />{t('adm.sys.ui.b.warning')}</Badge>
            <Badge tone="negative"><AlertTriangle className="h-3.5 w-3.5" />{t('adm.sys.ui.b.negative')}</Badge>
            <span className="mx-2 h-5 w-px" style={{ background: 'var(--a-border)' }} />
            <button type="button" className="a-btn a-btn--primary">{t('adm.sys.ui.primary')}</button>
            <button type="button" className="a-btn">{t('adm.sys.ui.secondary')}</button>
            <button type="button" className="a-btn a-btn--ghost">{t('adm.sys.ui.ghost')}</button>
            <button type="button" className="a-btn a-btn--danger">{t('adm.sys.ui.danger')}</button>
            <input className="a-input" style={{ width: 220 }} placeholder={t('adm.sys.ui.input')} />
          </div>
        </Card>
      </Section>

      <Section title={t('adm.sys.ui.sec.table')}>
        <Tabs items={[{ value: 'a', label: t('adm.sys.ui.tab.a'), count: 4 }, { value: 'b', label: t('adm.sys.ui.tab.b') }]} value={tab} onChange={setTab} />
        <DataTable data={ROWS} columns={cols} searchable getRowId={(r) => r.name} initialSort={[{ id: 'revenue', desc: true }]} />
      </Section>

      <Grid cols={3}>
        <Card title={t('adm.sys.ui.c.funnel')}>
          <Funnel steps={[{ key: 'v', label: t('adm.sys.ui.f.v'), value: 1840 }, { key: 'o', label: t('adm.sys.ui.f.o'), value: 212 }, { key: 'c', label: t('adm.sys.ui.f.c'), value: 41 }, { key: 'p', label: t('adm.sys.ui.f.p'), value: 9 }]} />
        </Card>
        <Card title={t('adm.sys.ui.c.kv')}>
          <KeyValue items={[{ label: t('adm.sys.ui.col.name'), value: 'Le Sonore' }, { label: t('adm.sys.ui.col.city'), value: 'Paris' }, { label: 'SIRET', value: '912 345 678 00012', mono: true }]} />
        </Card>
        <Card title={t('adm.sys.ui.c.timeline')}>
          <Timeline items={[
            { id: '1', at: new Date(Date.now() - 2 * 3600_000).toISOString(), title: t('adm.sys.ui.tl.a'), tone: 'accent', actor: 'Paul' },
            { id: '2', at: new Date(Date.now() - 30 * 3600_000).toISOString(), title: t('adm.sys.ui.tl.b'), tone: 'negative' },
          ]} />
        </Card>
      </Grid>

      <Grid cols={3}>
        <Card title={t('adm.sys.ui.c.loading')}><div className="flex flex-col gap-2"><div className="a-skel h-5 w-2/3" /><div className="a-skel h-5 w-1/2" /><div className="a-skel h-24 w-full" /></div></Card>
        <Card title={t('adm.sys.ui.c.empty')}><EmptyState title={t('adm.sys.ui.empty')} body={t('adm.sys.ui.emptyBody')} /></Card>
        <Card title={t('adm.sys.ui.c.error')}><ErrorState onRetry={() => undefined} /></Card>
      </Grid>

      <Dialog open={dialog} onOpenChange={setDialog} title={t('adm.sys.ui.dialog')} description={t('adm.sys.ui.dialogSub')} onConfirm={() => setDialog(false)} />
    </Page>
  );
}
