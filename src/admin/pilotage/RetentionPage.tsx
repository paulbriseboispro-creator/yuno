/**
 * Pilotage › Rétention des pros : « Les pros qui vendent continuent-ils ? ».
 * Cohortes mensuelles par mois de PREMIÈRE vente Yuno (part encore active de
 * M+1 à M+6, en comptes et en ventes), pros à risque (lien vers la liste Pros
 * filtrée), départs Yuno CRM. Source : admin_pro_retention.
 * Aucun pourcentage sous 10 comptes : les nombres bruts, et l'écran le dit.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, DataTable, EmptyState, ErrorState, Kpi, KpiRow, Page, Section, Tabs, useAdminFilters, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { MIN_SAMPLE } from '@/lib/metrics';
import { cohortCell, fmtMonth, proHref, type CohortMode } from './format';
import { useRetention, type Retention } from './data';
import { TextLink } from './links';

export default function RetentionPage() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useRetention(includeDemo);
  const d = q.data;
  const [mode, setMode] = useState<CohortMode>('accounts');
  const small = !!d && d.cohorts.every((c) => c.size < MIN_SAMPLE);

  const departCols = useMemo<ColumnDef<Retention['crm_departures'][number], unknown>[]>(() => [
    { accessorKey: 'name', header: t('adm.pil.ret.account'), cell: (c) => <TextLink to={proHref(c.row.original.key)}>{c.row.original.name ?? c.row.original.key}</TextLink> },
    { accessorKey: 'at', header: t('adm.pil.ret.leftAt'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
    { accessorKey: 'price', header: t('adm.pil.ret.mrrLost'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
  ], [t, lang]);

  if (q.error && !d) return <Page title={t('adm.pil.ret.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  const crmPaused = d ? (d.crm_states.paused ?? 0) + (d.crm_states.churned ?? 0) : undefined;

  return (
    <Page title={t('adm.pil.ret.title')} subtitle={t('adm.pil.ret.sub')}>
      <KpiRow>
        <Kpi label={t('adm.pil.ret.prosEver')} hint={t('adm.pil.ret.prosEver.hint')} loading={!d} value={fmtNum(d?.pros_ever, lang)} to="/admin/pros?status=selling" />
        <Kpi label={t('adm.pil.ret.crmDepartures')} loading={!d} value={fmtNum(d?.crm_departures.length, lang)} to="#departures" />
        <Kpi label={t('adm.pil.ret.crmPaused')} loading={!d} value={fmtNum(crmPaused, lang)} to="/admin/pros?status=paused" />
      </KpiRow>

      <Section title={t('adm.pil.ret.cohorts')} description={t('adm.pil.ret.cohortsSub')}
        actions={<Tabs items={[{ value: 'accounts', label: t('adm.pil.ret.byAccounts') }, { value: 'sales', label: t('adm.pil.ret.bySales') }]} value={mode} onChange={(v) => setMode(v as CohortMode)} />}>
        <Card padded={false}>
          {!d ? <div className="a-skel m-4 h-40" /> : d.cohorts.length === 0 ? <EmptyState title={t('adm.pil.ret.none')} /> : (
            <div className="overflow-x-auto">
              <table className="a-table">
                <thead>
                  <tr>
                    <th>{t('adm.pil.ret.cohort')}</th>
                    <th style={{ textAlign: 'right' }}>{t('adm.pil.ret.size')}</th>
                    {[0, 1, 2, 3, 4, 5, 6].map((k) => <th key={k} style={{ textAlign: 'right' }}>{k === 0 ? 'M0' : `M+${k}`}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.cohorts.map((c) => (
                    <tr key={c.m}>
                      <td>{fmtMonth(c.m, lang)}</td>
                      <td className="a-num" style={{ textAlign: 'right' }}>{fmtNum(c.size, lang)}</td>
                      {[0, 1, 2, 3, 4, 5, 6].map((k) => {
                        const v = cohortCell(c, k, mode);
                        if (!v) return <td key={k} className="a-t3" style={{ textAlign: 'right' }}>·</td>;
                        const label = mode === 'sales' ? fmtEur(v.raw, lang, { cents: false }) : fmtNum(v.raw, lang);
                        return (
                          <td key={k} className="a-num" style={{ textAlign: 'right', background: v.pct != null ? `color-mix(in srgb, var(--a-accent) ${Math.round(v.pct * 28)}%, transparent)` : undefined }}
                            title={v.pct != null ? fmtPct(v.pct * 100) : undefined}>
                            {v.pct != null && k > 0 ? fmtPct(v.pct * 100) : label}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {small && <p className="a-t3 border-t px-4 py-3 text-[12px]">{t('adm.pil.smallSample')}</p>}
        </Card>
      </Section>

      <Section title={t('adm.pil.ret.departures')} description={t('adm.pil.ret.departuresSub')}>
        <div id="departures">
          <DataTable data={d?.crm_departures} columns={departCols} loading={!d} error={q.error} onRetry={() => void q.refetch()}
            empty={{ title: t('adm.pil.ret.noDepartures') }} />
        </div>
        {d && d.crm_paused.length > 0 && (
          <Card title={t('adm.pil.ret.pausedList')}>
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {d.crm_paused.map((p) => <li key={p.key}><TextLink to={proHref(p.key)}>{p.name ?? p.key}</TextLink> <span className="a-t3">· {t(`adm.pil.ret.state.${p.state}`)}</span></li>)}
            </ul>
          </Card>
        )}
        <p className="a-t3 text-[12px]"><Link to="/admin/pros?status=at_risk" className="underline">{t('adm.pil.ret.toAtRisk')}</Link></p>
      </Section>
    </Page>
  );
}
