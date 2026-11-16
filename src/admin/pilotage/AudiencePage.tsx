/**
 * Pilotage › Audience et acheteurs : « Qui vient sur Yuno, et qui achète ? ».
 * Réécriture de l'ancienne page Croissance, UNE période pour toute la page :
 * visiteurs, sessions, tunnel visite → achat, canaux (get_platform_traffic,
 * mesure maison sans cookie, visites consenties seulement), acheteurs actifs et
 * récurrents (admin_buyers_stats), installations d'app depuis le lancement.
 */
import { useMemo } from 'react';
import {
  Card, Chart, DataTable, ErrorState, Funnel, Grid, Kpi, KpiRow, Page, Section, useAdminFilters, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct } from '@/lib/adminFormat';
import { useBuyers, useInstalls, useTraffic, type Traffic } from './data';

export default function AudiencePage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const tq = useTraffic(range);
  const bq = useBuyers(range, includeDemo);
  const iq = useInstalls(includeDemo);
  const cur = tq.data?.cur;
  const prev = tq.data?.prev;
  const b = bq.data;

  const conv = (x?: Traffic) => (x && x.funnel.sessions > 0 ? x.funnel.purchases / x.funnel.sessions : null);
  const cConv = conv(cur);
  const pConv = conv(prev);

  const series = useMemo(() => cur?.series.map((r, i) => ({
    d: r.t.slice(0, 10), sessions: r.sessions, prev: prev?.series[i]?.sessions ?? null,
  })) ?? null, [cur, prev]);

  const chanCols = useMemo<ColumnDef<Traffic['channels'][number], unknown>[]>(() => [
    { accessorKey: 'channel', header: t('adm.pil.aud.channel'), cell: (c) => {
      const k = `adm.pil.aud.ch.${c.getValue<string>()}`; const l = t(k); return l === k ? c.getValue<string>() : l;
    } },
    { accessorKey: 'sessions', header: t('adm.pil.aud.sessions'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'visitors', header: t('adm.pil.aud.visitors'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ], [t, lang]);
  const refCols = useMemo<ColumnDef<Traffic['referrers'][number], unknown>[]>(() => [
    { accessorKey: 'host', header: t('adm.pil.aud.referrer') },
    { accessorKey: 'sessions', header: t('adm.pil.aud.sessions'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ], [t, lang]);
  const countryCols = useMemo<ColumnDef<Traffic['countries'][number], unknown>[]>(() => [
    { accessorKey: 'k', header: t('adm.pil.aud.country') },
    { accessorKey: 'n', header: t('adm.pil.aud.sessions'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ], [t, lang]);

  if (tq.error && !cur) return <Page title={t('adm.pil.aud.title')}><ErrorState onRetry={() => void tq.refetch()} /></Page>;

  return (
    <Page title={t('adm.pil.aud.title')} subtitle={t('adm.pil.aud.sub')} period>
      <KpiRow>
        <Kpi label={t('adm.pil.aud.visitors')} hint={t('adm.pil.aud.visitors.hint')} loading={!cur}
          value={fmtNum(cur?.totals.visitors, lang)} current={cur?.totals.visitors} previous={prev?.totals.visitors} to="#channels" />
        <Kpi label={t('adm.pil.aud.sessions')} loading={!cur}
          value={fmtNum(cur?.totals.sessions, lang)} current={cur?.totals.sessions} previous={prev?.totals.sessions} to="#channels" />
        <Kpi label={t('adm.pil.aud.conv')} hint={t('adm.pil.aud.conv.hint')} loading={!cur}
          value={cConv == null ? '—' : fmtPct(cConv * 100, 1)} current={cConv} previous={pConv} to="#funnel" />
        <Kpi label={t('adm.pil.kpi.buyers')} hint={t('adm.pil.kpi.buyers.hint')} loading={!b}
          value={fmtNum(b?.active.cur, lang)} current={b?.active.cur} previous={b?.active.prev} to="/admin/clients" />
        <Kpi label={t('adm.pil.aud.returning')} hint={t('adm.pil.aud.returning.hint')} loading={!b}
          value={fmtNum(b?.returning.cur, lang)} current={b?.returning.cur} previous={b?.returning.prev} to="/admin/clients" />
        <Kpi label={t('adm.pil.aud.installs')} hint={t('adm.pil.aud.installs.hint')} loading={!iq.data}
          value={fmtNum((iq.data?.since_launch.installs_client ?? 0) + (iq.data?.since_launch.installs_pro ?? 0), lang)} />
      </KpiRow>

      <Card title={t('adm.pil.aud.perDay')}>
        <Chart kind="line" data={series} x="d" unit="count" loading={!cur} formatX={(v) => fmtAxisDay(v, lang)}
          series={[{ key: 'sessions', label: t('adm.pil.aud.sessions') }]}
          previous={{ key: 'prev', label: t('adm.pil.ov.prevPeriod') }} />
      </Card>

      <Grid cols={2}>
        <div id="funnel">
          <Card title={t('adm.pil.aud.funnel')} footer={t('adm.pil.aud.funnelNote')}>
            <Funnel loading={!cur} steps={cur ? [
              { key: 'sessions', label: t('adm.pil.aud.f.sessions'), value: cur.funnel.sessions },
              { key: 'event_views', label: t('adm.pil.aud.f.event'), value: cur.funnel.event_views },
              { key: 'checkouts', label: t('adm.pil.aud.f.checkout'), value: cur.funnel.checkouts },
              { key: 'purchases', label: t('adm.pil.aud.f.purchase'), value: cur.funnel.purchases },
            ] : null} />
          </Card>
        </div>
        <Card title={t('adm.pil.aud.buyersTitle')}>
          {!b ? <div className="a-skel h-24" /> : (
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <dt className="a-t2">{t('adm.pil.aud.newBuyers')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(b.new.cur, lang)}</dd>
              <dt className="a-t2">{t('adm.pil.aud.returning')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(b.returning.cur, lang)}</dd>
              <dt className="a-t2">{t('adm.pil.aud.everBuyers')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(b.ever, lang)}</dd>
              <dt className="a-t2">{t('adm.pil.aud.installsClient')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(iq.data?.since_launch.installs_client, lang)}</dd>
              <dt className="a-t2">{t('adm.pil.aud.installsPro')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(iq.data?.since_launch.installs_pro, lang)}</dd>
            </dl>
          )}
        </Card>
      </Grid>

      <Section title={t('adm.pil.aud.channels')}>
        <div id="channels" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <DataTable data={cur?.channels} columns={chanCols} loading={!cur} pageSize={10} />
          <DataTable data={cur?.referrers} columns={refCols} loading={!cur} pageSize={10} />
          <DataTable data={cur?.countries} columns={countryCols} loading={!cur} pageSize={10} />
        </div>
      </Section>
      <p className="a-t3 text-[12px]">{t('adm.pil.aud.consentNote')}</p>
    </Page>
  );
}
