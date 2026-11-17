/**
 * Pilotage › Audience et acheteurs (v3) : « Qui vient sur Yuno, et qui achète ? »
 *   1. Héros : les visiteurs de la période, la phrase qui relie visiteurs et
 *      acheteurs, la courbe des sessions par jour contre la période précédente ;
 *      à droite les acheteurs (actifs, nouveaux, récurrents, depuis le lancement) ;
 *   2. le tunnel visite → soirée → paiement → achat, la plus grosse fuite marquée ;
 *   3. canaux et sites référents en barres triées ;
 *   4. visiteurs, sessions et pages vues en small multiples sur le même axe,
 *      les apps en une phrase (les RPC n'en donnent pas de série) ;
 *   5. pays, appareils et pages les plus vues, repliés.
 * Sources : get_platform_traffic (mesure maison sans cookie, visites consenties
 * sur le web), admin_buyers_stats, admin_cockpit (installations).
 */
import { useMemo } from 'react';
import { Block, ErrorState, Hero, HeroChart, HoverSync, Page, RankBars, SmallMultiples, StatStrip, useAdminFilters, useAdminT, type Multiple, FunnelSteps, Fold } from '@/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct } from '@/lib/adminFormat';
import { useBuyers, useInstalls, useTraffic } from './data';
import { shareOrNull } from './rules';
import { MadridVisitsNote } from './MadridVisitsNote';

const FUNNEL = ['sessions', 'event_views', 'checkouts', 'purchases'] as const;
const FUNNEL_LABEL: Record<(typeof FUNNEL)[number], string> = { sessions: 'sessions', event_views: 'event', checkouts: 'checkout', purchases: 'purchase' };

export default function AudiencePage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo, period } = useAdminFilters();
  const tq = useTraffic(range);
  const bq = useBuyers(range, includeDemo);
  const iq = useInstalls(includeDemo);
  const cur = tq.data?.cur;
  const prev = tq.data?.prev;
  const b = bq.data;
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);
  const per = t(`adm.pil.v3.per.${period}`);
  const chLabel = (c: string) => { const k = `adm.pil.aud.ch.${c}`; const l = t(k); return l === k ? c : l; };

  const points = useMemo(() => (cur?.series ?? []).map((r, i) => ({ x: r.t.slice(0, 10), v: r.sessions, prev: prev?.series[i]?.sessions ?? null })), [cur, prev]);
  const xLabels = useMemo(() => (cur?.series ?? []).map((r) => fmtAxisDay(r.t.slice(0, 10), lang)), [cur, lang]);

  if (tq.error && !cur) return <Page title={t('adm.pil.aud.title')} period><ErrorState onRetry={() => void tq.refetch()} /></Page>;

  const conv = cur ? shareOrNull(cur.funnel.purchases, cur.funnel.sessions) : null;
  const sentence = !cur ? null : cur.totals.visitors === 0 ? t('adm.pil.v3u.none', { period: per }) : (
    <>
      {t('adm.pil.v3u.came', { period: per })} <b>{n(cur.totals.sessions)}</b> {t('adm.pil.v3u.sessions')}
      {b ? (b.active.cur > 0 ? <>{t('adm.pil.v3u.bought')} <b>{n(b.active.cur)}</b> {t(b.active.cur === 1 ? 'adm.pil.v3u.buyerOne' : 'adm.pil.v3u.buyers')}{b.new.cur > 0 ? <>{t('adm.pil.v3u.firstTime', { n: n(b.new.cur) })}</> : null}</> : <> {t('adm.pil.v3u.noBuyer')}</>) : null}.
    </>
  );

  const steps = cur ? FUNNEL.map((k) => ({ key: k, label: t(`adm.pil.aud.f.${FUNNEL_LABEL[k]}`), value: cur.funnel[k], display: n(cur.funnel[k]) })) : [];
  const multiples: Multiple[] = cur && prev ? [
    { key: 'visitors', label: t('adm.pil.aud.visitors'), total: n(cur.totals.visitors), current: cur.totals.visitors, previous: prev.totals.visitors, series: cur.series.map((s) => s.visitors), format: (v) => n(v), kind: 'bar' },
    { key: 'sessions', label: t('adm.pil.aud.sessions'), total: n(cur.totals.sessions), current: cur.totals.sessions, previous: prev.totals.sessions, series: cur.series.map((s) => s.sessions), format: (v) => n(v), kind: 'bar' },
    { key: 'pageviews', label: t('adm.pil.v3u.pageviews'), total: n(cur.totals.pageviews), current: cur.totals.pageviews, previous: prev.totals.pageviews, series: cur.series.map((s) => s.pageviews), format: (v) => n(v), kind: 'bar' },
  ] : [];
  const inst = iq.data?.since_launch;

  return (
    <Page title={t('adm.pil.aud.title')} period>
      <HoverSync>
        <Hero
          kicker={t('adm.pil.v3u.kicker', { period: per })}
          loading={!cur}
          value={n(cur?.totals.visitors)}
          current={cur?.totals.visitors}
          previous={prev?.totals.visitors}
          sentence={sentence}
          chart={!cur ? <div className="a-skel h-[200px] w-full" /> : points.length === 0 ? null : (
            <HeroChart data={points} height={200} formatX={(x) => fmtAxisDay(x, lang)} formatV={(v) => n(v)} formatTick={(v) => n(v)}
              labels={{ cur: t('adm.pil.aud.sessions'), prev: t('adm.pil.ov.prevPeriod'), peak: t('adm.pil.v3.peak') }} />
          )}
          note={t('adm.pil.aud.consentNote')}
          aside={(
            <Block title={t('adm.pil.v3u.buyersTitle')}>
              {!b ? <div className="a-skel h-40 w-full" /> : (
                <dl className="flex flex-col">
                  {([
                    ['active', t('adm.pil.kpi.buyers'), b.active.cur, b.active.prev],
                    ['new', t('adm.pil.aud.newBuyers'), b.new.cur, b.new.prev],
                    ['returning', t('adm.pil.aud.returning'), b.returning.cur, b.returning.prev],
                  ] as const).map(([k, label, c, p]) => (
                    <div key={k} className="flex items-baseline gap-3 border-b py-2">
                      <dt className="a-t2 flex-1 text-[13px]">{label}</dt>
                      <dd className="a-num a-t1 text-[15px] font-semibold">{n(c)}</dd>
                      <dd className="a-mono a-t3 w-16 text-right text-[11px]">{t('adm.pil.v3u.was', { n: n(p) })}</dd>
                    </div>
                  ))}
                  <div className="flex items-baseline gap-3 py-2">
                    <dt className="a-t2 flex-1 text-[13px]">{t('adm.pil.aud.everBuyers')}</dt>
                    <dd className="a-num a-t1 text-[15px] font-semibold">{n(b.ever)}</dd>
                    <dd className="w-16" />
                  </div>
                </dl>
              )}
            </Block>
          )}
        />
        <MadridVisitsNote />
      </HoverSync>

      <Block title={t('adm.pil.aud.funnel')} meta={conv == null ? t('adm.pil.aud.funnelNote') : t('adm.pil.v3u.convMeta', { pct: fmtPct(conv * 100, 1, lang) })}>
        {!cur ? <div className="a-skel h-40 w-full" /> : cur.funnel.sessions === 0 ? <p className="a-t2 text-[13px]">{t('adm.pil.v3u.noFunnel')}</p> : (
          <FunnelSteps steps={steps} worstLabel={t('adm.pil.v3u.leak')} offScaleLabel={t('adm.pil.v3a.offScale')}
            lostText={(i, lost) => t(`adm.pil.v3u.lost.${FUNNEL_LABEL[FUNNEL[i]]}${lost === 1 ? 'One' : ''}`, { n: n(lost) })} />
        )}
      </Block>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Block title={t('adm.pil.aud.channel')} meta={t('adm.pil.aud.sessions')}>
          {!cur ? <div className="a-skel h-32 w-full" /> : (
            <RankBars emptyText={t('adm.pil.v3u.noTraffic')}
              items={[...cur.channels].sort((a, b) => b.sessions - a.sessions).map((c) => ({
                key: c.channel, label: chLabel(c.channel), value: c.sessions, display: n(c.sessions), sub: t('adm.pil.v3u.visitorsN', { n: n(c.visitors) }),
              }))} />
          )}
        </Block>
        <Block title={t('adm.pil.aud.referrer')} meta={t('adm.pil.aud.sessions')}>
          {!cur ? <div className="a-skel h-32 w-full" /> : (
            <RankBars emptyText={t('adm.pil.v3u.noReferrer')}
              items={[...cur.referrers].sort((a, b) => b.sessions - a.sessions).slice(0, 10).map((r) => ({ key: r.host, label: r.host, value: r.sessions, display: n(r.sessions) }))} />
          )}
        </Block>
      </div>

      <Block title={t('adm.pil.v3u.dailyTitle')} meta={t('adm.pil.v3u.dailyMeta')}>
        {!cur ? <div className="a-skel h-24 w-full" /> : (
          <HoverSync><SmallMultiples items={multiples} xLabels={xLabels} columns={3} height={44} /></HoverSync>
        )}
        <p className="a-t2 text-[13px]">
          {inst ? t('adm.pil.v3u.apps', { c: n(inst.installs_client), p: n(inst.installs_pro), s: n(inst.push_subscriptions) }) : null}
          {cur ? <> {t('adm.pil.v3u.native', { n: n(cur.totals.native_sessions) })}</> : null}
        </p>
      </Block>

      <Fold title={t('adm.pil.v3u.whereTitle')} hint={cur ? t('adm.pil.v3u.whereHint', { c: n(cur.countries.length), d: n(cur.devices.length) }) : undefined}>
        {cur && (
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
            <section className="flex flex-col gap-2"><span className="a-kicker">{t('adm.pil.aud.country')}</span>
              <RankBars emptyText={t('adm.pil.v3u.noTraffic')} items={cur.countries.slice(0, 8).map((c) => ({ key: c.k, label: c.k || t('adm.product.unknownValue'), value: c.n, display: n(c.n) }))} /></section>
            <section className="flex flex-col gap-2"><span className="a-kicker">{t('adm.pil.v3u.devices')}</span>
              <RankBars emptyText={t('adm.pil.v3u.noTraffic')} items={cur.devices.slice(0, 8).map((c) => ({ key: c.k, label: c.k || t('adm.product.unknownValue'), value: c.n, display: n(c.n) }))} /></section>
            <section className="flex flex-col gap-2"><span className="a-kicker">{t('adm.pil.v3u.pages')}</span>
              <RankBars emptyText={t('adm.pil.v3u.noTraffic')} items={cur.pages.slice(0, 8).map((p) => ({ key: p.path, label: <code className="text-[12px]">{p.path}</code>, value: p.views, display: n(p.views) }))} /></section>
          </div>
        )}
        <p className="a-t3 mt-3 text-[12px]">{t('adm.pil.v3u.langNote')}</p>
      </Fold>
    </Page>
  );
}
