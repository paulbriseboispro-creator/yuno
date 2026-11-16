/**
 * Pilotage › Acquisition des pros : « D'où viennent nos pros, et jusqu'où
 * vont-ils ? ». UN entonnoir Billetterie + CRM (admin_pro_acquisition, qui lit
 * admin_pro_signups : personnes, sans robots, règles inchangées), ses sources et
 * le délai jusqu'à la première vente. La liste des personnes à rappeler vit
 * dans Pros › Prospects (lien).
 */
import { Suspense, useMemo } from 'react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CrmFrame } from '../shell/frames';
import { Link } from 'react-router-dom';
import {
  Card, Chart, DataTable, ErrorState, Funnel, Grid, Kpi, KpiRow, Page, Section, useAdminFilters, useAdminT,
  type ColumnDef, type FunnelStep,
} from '@/admin/ui';
import { fmtAxisDay, fmtNum } from '@/lib/adminFormat';
import { sourceRows } from '@/lib/proSignupPeople';
import { useAcquisition, type ProductSteps } from './data';

// Détail de la page publique de Yuno CRM (mesure sans cookie), écran hérité de l'ex-Admin CRM.
const LandingTab = lazyWithRetry(() => import('@/crm/admin/pages/LandingTab'));

const STEPS = ['visits', 'opened', 'created', 'configured', 'first', 'paying'] as const;

export default function AcquisitionPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const q = useAcquisition(range, includeDemo);
  const d = q.data;

  const steps = useMemo<FunnelStep[] | null>(() => d ? STEPS.map((s) => ({
    key: s,
    label: (
      <span className="flex flex-col">
        <span>{t(`adm.pil.acq.step.${s}`)}</span>
        <span className="a-t3 text-[11.5px]">{t(`adm.pil.acq.src.${s}`)}</span>
      </span>
    ),
    value: d[s],
  })) : null, [d, t]);

  const sources = useMemo(() => (d ? sourceRows(d.sources, t) : null), [d, t]);
  const sourceCols = useMemo<ColumnDef<{ label: string; started: number; created: number }, unknown>[]>(() => [
    { accessorKey: 'label', header: t('adm.pil.acq.source') },
    { accessorKey: 'started', header: t('adm.pil.acq.started'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'created', header: t('adm.pil.acq.step.created'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ], [t, lang]);

  const products = useMemo(() => (d ? (['tickets', 'crm'] as const).map((p) => ({ p, s: d.by_product[p] ?? { created: 0, configured: 0, first: 0, paying: 0 } })) : []), [d]);

  if (q.error && !d) return <Page title={t('adm.pil.acq.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  return (
    <Page title={t('adm.pil.acq.title')} subtitle={t('adm.pil.acq.sub')} period
      actions={<Link to="/admin/pros/prospects" className="a-btn a-btn--sm">{t('adm.pil.acq.toProspects')}</Link>}>
      <KpiRow>
        <Kpi label={t('adm.pil.acq.step.opened')} loading={!d} value={fmtNum(d?.opened, lang)} to="/admin/pros/prospects" />
        <Kpi label={t('adm.pil.acq.step.created')} loading={!d} value={fmtNum(d?.created, lang)} to="/admin/pros" />
        <Kpi label={t('adm.pil.acq.step.first')} loading={!d} value={fmtNum(d?.first, lang)} to="/admin/pros?status=selling" />
        <Kpi label={t('adm.pil.acq.median')} hint={t('adm.pil.acq.median.hint')} loading={!d}
          value={d?.median_days_to_first_sale == null ? '—' : t('adm.pil.acq.days', { n: fmtNum(d.median_days_to_first_sale, lang, 1) })} />
        <Kpi label={t('adm.pil.acq.toContact')} loading={!d} value={fmtNum(d?.to_contact, lang)} to="/admin/pros/prospects" />
      </KpiRow>
      <p className="a-t3 -mt-3 text-[12px]">{t('adm.pil.acq.kpiNote')}</p>

      <Grid cols={2}>
        <Card title={t('adm.pil.acq.funnel')} footer={d ? t('adm.pil.acq.robots', { n: fmtNum(d.robots, lang) }) : undefined}>
          <Funnel steps={steps} loading={!d} />
          <p className="a-t3 mt-3 text-[12px]">{t('adm.pil.acq.funnelNote')}</p>
        </Card>
        <Card title={t('adm.pil.acq.byProduct')} padded={false}>
          <table className="a-table">
            <thead>
              <tr>
                <th>{t('adm.pil.acq.product')}</th>
                {(['created', 'configured', 'first', 'paying'] as (keyof ProductSteps)[]).map((s) => <th key={s} style={{ textAlign: 'right' }}>{t(`adm.pil.acq.step.${s}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {products.map(({ p, s }) => (
                <tr key={p}>
                  <td>{t(`adm.pil.acq.product.${p}`)}</td>
                  <td className="a-num" style={{ textAlign: 'right' }}>{fmtNum(s.created, lang)}</td>
                  <td className="a-num" style={{ textAlign: 'right' }}>{fmtNum(s.configured, lang)}</td>
                  <td className="a-num" style={{ textAlign: 'right' }}>{fmtNum(s.first, lang)}</td>
                  <td className="a-num" style={{ textAlign: 'right' }}>{p === 'crm' ? fmtNum(s.paying, lang) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="a-t3 px-4 py-3 text-[12px]">{t('adm.pil.acq.productNote')}</p>
        </Card>
      </Grid>

      <Card title={t('adm.pil.acq.perDay')}>
        <Chart kind="bar" data={d?.by_day} x="d" unit="count" loading={!d} formatX={(v) => fmtAxisDay(v, lang)}
          series={[
            { key: 'started', label: t('adm.pil.acq.started') },
            { key: 'created', label: t('adm.pil.acq.step.created') },
          ]} />
      </Card>

      <Section title={t('adm.pil.acq.sources')} description={t('adm.pil.acq.sourcesSub')}>
        <DataTable data={sources} columns={sourceCols} loading={!d} error={q.error} onRetry={() => void q.refetch()}
          initialSort={[{ id: 'started', desc: true }]} empty={{ title: t('adm.pil.acq.noSources') }} />
      </Section>

      <Section title={t('adm.pil.acq.landing')} description={t('adm.pil.acq.landingSub')}>
        <CrmFrame>
          <Suspense fallback={<div className="a-skel h-64" />}>
            <LandingTab days={range.days} />
          </Suspense>
        </CrmFrame>
      </Section>
    </Page>
  );
}
