/**
 * Argent › Ventes et commissions (v3) : « Qu'a-t-on vendu, et qu'a gagné Yuno ? »
 *   1. Héros : les ventes de la plateforme, la phrase qui dit ce que Yuno en
 *      garde, la courbe par jour avec billets et tables étiquetés au bout de
 *      leur ligne et les remboursements en ligne de repère ; à droite la cascade
 *      ventes → reversé aux pros → frais de service, le taux de commission en bullet ;
 *   2. les volumes en bande (billets, tables, commandes, panier, remboursements,
 *      guest list en nombre, jamais en euros) ;
 *   3. les classements (clubs, organisateurs, soirées, villes) en barres triées
 *      qui ouvrent leur fiche.
 * Source unique : admin_platform_analytics (la période et la précédente). La
 * démo n'y entre jamais (règle de cette RPC). La courbe est en CA club (billets
 * et tables hors frais) : la RPC ne rend pas les ventes TTC jour par jour.
 */
import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { Block, BulletBar, ErrorState, Hero, HoverSync, Page, RankBars, StatStrip, Waterfall, useAdminFilters, useAdminT, type Step, LinesChart } from '@/admin/ui';
import { fmtAxisDay, fmtCompact, fmtDate, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { moneyHintKey, moneyLabelKey, takeRate } from './terms';
import { useGuestlistCount, usePlatformAnalytics } from './data';
import { proHref } from '../pilotage/format';
import { isFlatZero } from '../pilotage/rules';
import { toCsv, downloadCsv } from './csv';

export default function SalesPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo, period } = useAdminFilters();
  const q = usePlatformAnalytics(range);
  const gl = useGuestlistCount(includeDemo);
  const cur = q.data?.cur;
  const prev = q.data?.prev;
  const c = cur?.totals;
  const p = prev?.totals;
  const per = t(`adm.pil.v3.per.${period}`);
  const eur = (v: number | null | undefined) => fmtEur(v ?? 0, lang);
  const eur0 = (v: number | null | undefined) => fmtEur(v ?? 0, lang, { cents: false });
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);

  const rate = c ? takeRate(c.yuno_revenue, c.gmv) : null;
  const prate = p ? takeRate(p.yuno_revenue, p.gmv) : null;

  const days = useMemo(() => cur?.by_day ?? [], [cur]);
  const series = useMemo(() => [
    { key: 'tickets', label: t('adm.mon.sales.tickets'), values: days.map((d) => d.tickets), role: 'main' as const },
    { key: 'tables', label: t('adm.mon.sales.tables'), values: days.map((d) => d.tables), role: 'ink' as const },
    ...(isFlatZero(days.map((d) => d.refunds)) ? [] : [{ key: 'refunds', label: t(moneyLabelKey('refunds')), values: days.map((d) => d.refunds), role: 'ref' as const }]),
  ], [days, t]);

  const steps: Step[] = c ? [
    { key: 'sales', label: t(moneyLabelKey('sales')), value: c.gmv, display: eur0(c.gmv), total: true },
    { key: 'pros', label: t('adm.pil.v3.toPros'), value: -(c.gmv - c.yuno_revenue), display: `− ${eur0(c.gmv - c.yuno_revenue)}` },
    { key: 'fees', label: t(moneyLabelKey('fees')), value: c.yuno_revenue, display: eur(c.yuno_revenue), total: true },
  ] : [];

  const exportCsv = () => {
    if (!cur) return;
    const rows = cur.by_day.map((d) => [d.d, d.tickets, d.tables, d.ticket_n, d.table_n, d.yuno, d.refunds]);
    downloadCsv(`yuno-ventes-${range.period}.csv`, toCsv([
      ['date', 'billets_ca_club', 'tables_ca_club', 'billets_n', 'tables_n', 'frais_de_service', 'remboursements'], ...rows,
    ]));
  };

  if (q.error && !cur) return <Page title={t('adm.mon.sales.title')} period><ErrorState onRetry={() => void q.refetch()} /></Page>;

  const sentence = !c ? null : c.gmv === 0 ? t('adm.mon.v3s.none', { period: per }) : (
    <>
      {t('adm.mon.v3s.sold', { period: per })} <b>{n(c.tx_count)}</b> {t(c.tx_count === 1 ? 'adm.mon.v3s.orderOne' : 'adm.mon.v3s.orders')}
      {t('adm.mon.v3s.kept')} <b>{eur(c.yuno_revenue)}</b>
      {rate != null ? <> ({fmtPct(rate * 100, 1, lang)})</> : null}
      {c.refunds_count > 0 ? <>{t('adm.mon.v3s.refunded', { n: n(c.refunds_count), eur: eur0(c.refunds_total) })}</> : null}.
    </>
  );

  const rateMax = Math.max(0.12, (rate ?? 0) * 1.4, (prate ?? 0) * 1.4);

  return (
    <Page title={t('adm.mon.sales.title')} period
      actions={<button type="button" className="a-btn a-btn--sm a-btn--ghost" onClick={exportCsv} disabled={!cur}><Download className="h-3.5 w-3.5" />{t('adm.mon.export')}</button>}>
      <HoverSync>
        <Hero
          kicker={t('adm.mon.v3s.kicker', { period: per })}
          loading={!c}
          value={eur0(c?.gmv)}
          current={c?.gmv}
          previous={p?.gmv}
          sentence={sentence}
          chart={!cur ? <div className="a-skel h-[220px] w-full" /> : days.length === 0 ? null : (
            <LinesChart xs={days.map((d) => d.d)} series={series} formatX={(x) => fmtAxisDay(x, lang)} formatV={eur}
              formatTick={(v) => (v >= 1000 ? `${fmtCompact(v, lang)} €` : `${fmtNum(v, lang)} €`)} />
          )}
          note={t('adm.mon.v3s.note')}
          aside={c && (
            <>
              <Block title={t('adm.mon.v3s.waterTitle')}>
                <Waterfall steps={steps} />
              </Block>
              <Block title={t('adm.mon.sales.rate')}>
                {rate == null ? <p className="a-t2 text-[13px]">{t('adm.mon.v3s.noRate')}</p> : (
                  <div className="flex flex-col gap-1.5">
                    <BulletBar value={rate} max={rateMax} target={prate ?? undefined} targetLabel={t('adm.pil.ov.prevPeriod')}
                      label={t(moneyLabelKey('fees'))} display={fmtPct(rate * 100, 1, lang)} />
                    <span className="a-t3 text-[12px]">{prate == null ? t('adm.mon.sales.rate.hint') : t('adm.mon.v3s.rateVs', { pct: fmtPct(prate * 100, 1, lang) })}</span>
                  </div>
                )}
              </Block>
            </>
          )}
        />
      </HoverSync>

      <StatStrip items={[
        { key: 'tk', label: t('adm.mon.sales.ticketsSold'), value: n(c?.tickets_qty), loading: !c, to: '/admin/money/orders' },
        { key: 'tb', label: t('adm.mon.sales.tablesBooked'), value: n(c?.tables_booked), loading: !c, to: '/admin/money/orders?tab=tables' },
        { key: 'tx', label: t('adm.mon.sales.tx'), value: n(c?.tx_count), current: c?.tx_count, previous: p?.tx_count, loading: !c },
        { key: 'basket', label: t('adm.mon.sales.basket'), value: eur(c?.avg_order), current: c?.avg_order, previous: p?.avg_order, hint: t('adm.mon.sales.basket.hint'), loading: !c },
        { key: 'ref', label: t(moneyLabelKey('refunds')), value: eur0(c?.refunds_total), current: c?.refunds_total, previous: p?.refunds_total, invert: true, hint: t(moneyHintKey('refunds')), loading: !c, to: '/admin/money/orders?status=refunded' },
        { key: 'gl', label: t('adm.mon.sales.guestlist'), value: n(gl.data?.signups ?? gl.data?.total), hint: t('adm.mon.sales.guestlistNote'), loading: !gl.data, to: '/admin/money/orders?tab=guestlist' },
      ]} />

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-2">
        <Block title={t('adm.mon.v3s.topClubs')} meta={t('adm.mon.sales.clubRevenue')}>
          {!cur ? <div className="a-skel h-40 w-full" /> : (
            <RankBars emptyText={t('adm.pil.v3.concEmpty')}
              items={[...cur.top_venues].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((v) => ({
                key: v.id, label: v.name, value: v.revenue, display: eur0(v.revenue), to: proHref(`venue:${v.id}`),
                sub: [v.city, t('adm.mon.v3s.txN', { n: n(v.tx) })].filter(Boolean).join(' · '),
              }))} />
          )}
        </Block>
        <Block title={t('adm.mon.v3s.topOrgs')} meta={t('adm.mon.sales.clubRevenue')}>
          {!cur ? <div className="a-skel h-40 w-full" /> : (
            <RankBars emptyText={t('adm.pil.v3.concEmpty')}
              items={[...cur.top_organizers].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((o) => ({
                key: o.user_id, label: o.name, value: o.revenue, display: eur0(o.revenue), to: proHref(`org:${o.user_id}`),
                sub: t('adm.mon.v3s.eventsN', { n: n(o.events_count) }),
              }))} />
          )}
        </Block>
        <Block title={t('adm.mon.v3s.topEvents')} meta={t('adm.mon.sales.clubRevenue')}>
          {!cur ? <div className="a-skel h-40 w-full" /> : (
            <RankBars emptyText={t('adm.pil.v3.concEmpty')}
              items={[...cur.top_events].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((e) => ({
                key: e.id, label: e.title, value: e.revenue, display: eur0(e.revenue), to: `/admin/clients/events?q=${encodeURIComponent(e.id)}`,
                sub: [e.venue_name, e.start_at ? fmtDate(e.start_at, lang) : null, t('adm.mon.v3s.evMix', { t: n(e.tickets), b: n(e.tables) })].filter(Boolean).join(' · '),
              }))} />
          )}
        </Block>
        <Block title={t('adm.mon.v3s.topCities')} meta={t('adm.mon.sales.clubRevenue')}>
          {!cur ? <div className="a-skel h-40 w-full" /> : (
            <RankBars emptyText={t('adm.pil.v3.concEmpty')}
              items={[...cur.venue_cities].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((x) => ({
                key: x.city, label: x.city, value: x.revenue, display: eur0(x.revenue), sub: t('adm.mon.v3s.txN', { n: n(x.tx) }),
              }))} />
          )}
        </Block>
      </div>
      <p className="a-t3 text-[12px]">{t('adm.mon.sales.demoNote')}</p>
    </Page>
  );
}
