/**
 * Page bio › Audience (v3) : « Que fait la page de la bio ? »
 * Le héros dit le passage visiteurs → clics en une phrase, avec sa courbe
 * contre la période d'avant ; les inscriptions en bande ; les clics par lien,
 * la provenance et les soirées en barres triées. Le détail (pays, langues,
 * appareils, campagnes, villes) reste replié.
 */
import { Block, Hero, HeroChart, RankBars, StatStrip, useAdminFilters, useAdminT, type Rank, type Stat } from '@/admin/ui';
import { fmtAxisDay, fmtCompact, fmtNum, fmtPct } from '@/lib/adminFormat';
import { useLinksAnalytics } from './data';
import { Cutoff, Disclosure } from '../legal/parts';

const TARGETS = new Set(['app_store', 'web_app', 'instagram', 'tiktok', 'whatsapp', 'share', 'featured_all', 'pro_signup', 'event']);
interface KV { k: string; n: number }

export default function LinksAudience() {
  const { t, lang } = useAdminT();
  const { range } = useAdminFilters();
  const cur = useLinksAnalytics(range.from.toISOString(), range.to.toISOString());
  const prev = useLinksAnalytics(range.prevFrom.toISOString(), range.prevTo.toISOString());
  const s = cur.data;
  const p = prev.data;
  const tt = s?.totals;
  const hourly = s?.granularity === 'hour';
  const ctr = tt && tt.visitors > 0 ? (tt.click_visitors / tt.visitors) * 100 : null;
  const pctr = p?.totals && p.totals.visitors > 0 ? (p.totals.click_visitors / p.totals.visitors) * 100 : null;
  const points = (s?.series ?? []).map((x, i) => ({ x: x.t, v: x.visitors, prev: p?.series?.[i]?.visitors ?? null }));
  const fmtX = (v: string) => (hourly ? new Date(v).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : fmtAxisDay(v.slice(0, 10), lang));
  const empty = !!tt && tt.views === 0 && tt.clicks === 0 && tt.waitlist === 0 && tt.pro_leads === 0;

  const targetLabel = (k: string) => (TARGETS.has(k) ? t(`adminLinks.target.${k}`) : k);
  const refLabel = (k: string) => (k === 'direct' ? t('adminTraffic.ch_direct') : k);
  const device = (k: string) => (k === 'mobile' || k === 'tablet' || k === 'desktop' ? t(`adminTraffic.dev_${k}`) : t('adminTraffic.dev_unknown'));
  const leadType = (k: string) => (['club', 'organizer', 'promoter', 'agency', 'other'].includes(k) ? t(`adminLinks.type.${k}`) : k);
  const ranks = (rows: KV[] | undefined, label: (k: string) => string, max = 8): Rank[] =>
    [...(rows ?? [])].sort((a, b) => b.n - a.n).slice(0, max).map((r) => ({ key: r.k, label: label(r.k) || '—', value: r.n, display: fmtNum(r.n, lang) }));

  const stats: Stat[] = tt ? [
    { key: 'clicks', label: t('adminLinks.kClicks'), value: fmtNum(tt.clicks, lang), current: tt.clicks, previous: p?.totals.clicks },
    { key: 'ctr', label: t('adminLinks.kCtr'), value: ctr == null ? '—' : fmtPct(ctr, 0, lang), current: ctr, previous: pctr, hint: t('adminLinks.kCtrSub') },
    { key: 'wl', label: t('adminLinks.kWaitlist'), value: fmtNum(tt.waitlist, lang), current: tt.waitlist, previous: p?.totals.waitlist },
    { key: 'leads', label: t('adminLinks.kLeads'), value: fmtNum(tt.pro_leads, lang), current: tt.pro_leads, previous: p?.totals.pro_leads, to: '/admin/pros/prospects' },
  ] : [];

  const sentence = !tt ? null : tt.visitors === 0
    ? t('adm.comms.ln3.none')
    : t('adm.comms.ln3.sentence', { v: fmtNum(tt.visitors, lang), c: fmtNum(tt.click_visitors, lang), pct: ctr == null ? '—' : fmtPct(ctr, 0, lang) });

  return (
    <>
      <Hero kicker={t('adm.comms.ln3.kicker')} loading={cur.isLoading} value={fmtNum(tt?.visitors ?? 0, lang)} current={tt?.visitors} previous={p?.totals.visitors}
        sentence={sentence}
        chart={cur.isLoading ? <div className="a-skel h-[200px] w-full" /> : empty ? <Cutoff>{t('adminLinks.emptyBody')}</Cutoff> : (
          <HeroChart data={points} height={200} formatX={fmtX} formatV={(v) => fmtNum(v, lang)} formatTick={(v) => fmtCompact(v, lang)}
            labels={{ cur: t('adminLinks.kVisitors'), prev: t('adm.comms.cp3.prev'), peak: t('adm.comms.cp3.peak') }} />
        )} />
      {tt && <StatStrip items={stats} />}

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-2">
        <Block title={t('adminLinks.targetsTitle')} meta={t('adm.comms.ln3.byClicks')}>
          <RankBars emptyText={t('adminLinks.noClicks')} items={[...(s?.targets ?? [])].sort((a, b) => b.clicks - a.clicks).slice(0, 8).map((r) => ({ key: r.target, label: targetLabel(r.target), value: r.clicks, display: fmtNum(r.clicks, lang), sub: t('adm.comms.ln3.visitors', { n: fmtNum(r.visitors, lang) }) }))} />
        </Block>
        <Block title={t('adminLinks.referrersTitle')} meta={t('adm.comms.ln3.byVisits')}>
          <RankBars emptyText={t('adminLinks.noClicks')} items={ranks(s?.referrers, refLabel)} />
        </Block>
      </div>
      <Block title={t('adminLinks.eventsTitle')} meta={t('adm.comms.ln3.byClicks')}>
        <RankBars emptyText={t('adminLinks.noClicks')} items={[...(s?.events ?? [])].sort((a, b) => b.clicks - a.clicks).slice(0, 8).map((r) => ({ key: r.event_id, label: r.title || r.event_id, value: r.clicks, display: fmtNum(r.clicks, lang) }))} />
      </Block>

      <Disclosure title={t('adm.comms.ln.a.more')}>
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
          {([
            [t('adminLinks.countriesTitle'), s?.countries, (k: string) => k],
            [t('adminLinks.langsTitle'), s?.langs, (k: string) => k.toUpperCase()],
            [t('adminLinks.devicesTitle'), s?.devices, device],
            [t('adminLinks.utmTitle'), s?.utm, (k: string) => k],
            [t('adminLinks.wlCitiesTitle'), s?.waitlist_cities, (k: string) => k],
            [t('adminLinks.leadTypesTitle'), s?.lead_types, leadType],
          ] as [string, KV[] | undefined, (k: string) => string][]).map(([title, rows, label]) => (
            <div key={title} className="flex min-w-0 flex-col gap-2">
              <span className="a-kicker">{title}</span>
              <RankBars emptyText={t('adm.ui.chart.empty')} items={ranks(rows, label, 6)} />
            </div>
          ))}
        </div>
      </Disclosure>
    </>
  );
}
