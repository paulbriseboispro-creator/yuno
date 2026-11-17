/**
 * Pilotage › Acquisition › page publique de Yuno CRM (crm.yunoapp.eu) : mesure
 * sans cookie (crm_admin_landing). Un visiteur est une empreinte par jour : un
 * même visiteur revenu deux jours compte deux fois, et la note du bas le dit.
 */
import { Card, Chart, DataTable, EmptyState, ErrorState, Grid, KeyValue, useAdminFilters, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct } from '@/lib/adminFormat';
import { useCrmLanding, type CrmLanding } from './data';
import { Fold } from '@/admin/ui';

/** L'ordre de lecture de la page (src/pages/crm.tsx du dépôt landing). */
const ORDER = ['hero', 'proof', 'problem', 'night', 'how', 'engine', 'mcp', 'compare', 'features', 'channels', 'pricing', 'faq', 'final'];

export default function AcquisitionLanding({ days }: { days: number }) {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useCrmLanding(days, includeDemo);
  const d = q.data;
  const n = (v: number) => fmtNum(v, lang);

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!d) return <div className="a-skel h-64" />;
  if (d.visits === 0) return <Card><EmptyState title={t('adm.crm.ln.none')} /></Card>;

  const pv = Math.max(1, d.page_views);
  const created = d.sources.reduce((s, x) => s + x.created, 0);
  const sec = (id: string) => { const k = `adm.crm.ln.s.${id}`; const v = t(k); return v === k ? id : v; };
  const sections = [...d.sections].sort((a, b) => (ORDER.indexOf(a.section) + 1 || 99) - (ORDER.indexOf(b.section) + 1 || 99))
    .map((s) => ({ ...s, rate: Math.min(100, (s.n / pv) * 100) }));
  const clickLabel = (target: string) => {
    const [k, v] = target.split(':');
    if (k === 'faq') return t('adm.crm.ln.faq', { n: v });
    if (k === 'contact') return t('adm.crm.ln.contact', { ch: v });
    return t('adm.crm.ln.cta', { id: v ?? target });
  };

  return (
    <div className="flex flex-col gap-4">
      <Grid cols={2}>
        <Card title={t('adm.crm.ln.series')}>
          <Chart kind="bar" data={d.series.map((s) => ({ d: s.t.slice(0, 10), visits: s.visits }))} x="d" unit="count" height={200}
            formatX={(v) => fmtAxisDay(v, lang)} series={[{ key: 'visits', label: t('adm.crm.ln.k.visits') }]} />
        </Card>
        <Card title={t('adm.pl.acq.landingKeys')} footer={t('adm.crm.ln.note')}>
          <KeyValue items={[
            { label: t('adm.crm.ln.k.visits'), value: `${n(d.visits)} · ${t('adm.crm.ln.k.visitsSub', { days: d.days })}` },
            { label: t('adm.crm.ln.k.visitors'), value: `${n(d.visitor_days)} · ${t('adm.crm.ln.k.visitorsSub')}` },
            { label: t('adm.crm.ln.k.starts'), value: `${n(d.signup_starts)} · ${t('adm.crm.ln.k.startsSub', { pct: fmtPct((d.signup_starts / Math.max(1, d.visitor_days)) * 100, 1) })}` },
            { label: t('adm.crm.ln.k.created'), value: `${n(created)} · ${t('adm.crm.ln.k.createdSub')}` },
          ]} />
        </Card>
      </Grid>

      <DataTable data={d.sources} getRowId={(s) => s.source} initialSort={[{ id: 'visits', desc: true }]} pageSize={10}
        columns={[
          { accessorKey: 'source', header: t('adm.crm.ln.h.source'), cell: (c) => (c.getValue<string>() === 'direct' ? t('adm.crm.ln.direct') : c.getValue<string>()) },
          { accessorKey: 'visits', header: t('adm.crm.ln.h.visits'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
          { accessorKey: 'visitors', header: t('adm.crm.ln.h.visitors'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
          { accessorKey: 'starts', header: t('adm.crm.ln.h.starts'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
          { accessorKey: 'signups', header: t('adm.crm.ln.h.signups'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
          { accessorKey: 'created', header: t('adm.crm.ln.h.created'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
        ] as ColumnDef<CrmLanding['sources'][number], unknown>[]} />

      <Fold title={t('adm.crm.ln.depth')} hint={t('adm.crm.ln.clicks')}>
        <p className="a-t3 text-[12.5px]">{t('adm.crm.ln.depthSub')}</p>
        <Grid cols={2}>
          <DataTable data={sections} getRowId={(s) => s.section} pageSize={15}
            columns={[
              { accessorKey: 'section', header: t('adm.crm.ln.depth'), enableSorting: false, cell: (c) => sec(c.getValue<string>()) },
              { accessorKey: 'rate', header: t('adm.pl.acq.reached'), meta: { align: 'right' }, enableSorting: false, cell: (c) => fmtPct(c.getValue<number>(), 0) },
            ] as ColumnDef<(typeof sections)[number], unknown>[]} />
          <DataTable data={d.clicks} getRowId={(c) => `${c.target}${c.section}`} pageSize={10} empty={{ title: t('adm.crm.ln.clicksNone') }}
            columns={[
              { accessorKey: 'target', header: t('adm.crm.ln.clicks'), cell: ({ row }) => (
                <span className="flex flex-col"><span className="a-t1 font-medium">{clickLabel(row.original.target)}</span>
                  {row.original.section && <span className="a-t3 text-[12px]">{sec(row.original.section)}</span>}</span>
              ) },
              { accessorKey: 'n', header: t('adm.pl.sig.clicks'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
            ] as ColumnDef<CrmLanding['clicks'][number], unknown>[]} />
        </Grid>
      </Fold>
    </div>
  );
}
