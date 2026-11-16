/**
 * Système › Référence du kit (`/admin/system/ui`, hors menu) : toutes les
 * primitives et toutes les formes de graphique, avec des données d'exemple.
 * C'est la page de cohérence : un écran nouveau se compare à elle, en clair et
 * en sombre (docs/designs/ADMIN_DESIGN_SYSTEM.md).
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import {
  Badge, Card, Chart, DataTable, Dialog, EmptyState, ErrorState, Funnel, Grid, KeyValue, Kpi, KpiRow,
  Page, Section, Status, Tabs, Timeline, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtAxisDay, fmtEur, fmtNum } from '@/lib/adminFormat';

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
