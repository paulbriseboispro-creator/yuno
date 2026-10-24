/**
 * Yuno Tickets › Analyses › Partenaires — « Qui vend pour moi ? » (lot 3 du
 * plan combiné, migration 20261109330000). Dessiné comme les onglets du CRM :
 * un héros (ventes attribuées, courbe contre la période d'avant), quatre
 * tuiles (ventes, commissions, clic → vente, rendement), le classement des
 * promoteurs, les liens partenaires (une personne, un invité, une co-soirée)
 * et, pour une soirée partagée, « Qui fait vendre ? »
 * (get_collab_party_breakdown).
 *
 * Mots : une vente de promoteur est une « vente attribuée », jamais un CA ;
 * « Qui fait vendre ? » est une attribution, jamais un partage d'argent.
 */
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useProgress } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixCaps } from '@/tickets/analytics/scope';
import { useTixRoutes } from '@/tickets/analytics/routes';
import {
  useCollabBreakdown, type AnaFilters, type AnaPartners, type AnaPartnerLink, type CollabBreakdown, type CollabPartyRow,
} from '@/tickets/analytics/data';
import {
  CardHead, ChartSkeleton, Fill, Sk, Takeaway, Tile, TileSkeleton, TrendChart, bucketTitle, card, fadeIn, useGo, xLabels, type TileSpec,
} from './anaUi';
import { deltaPct, jLabelFor } from './SalesTab';

type T = ReturnType<typeof useTixT>;

/** Sous 10 clics, un taux de passage ne veut rien dire : l'écran montre les nombres. */
const MIN_CLICKS = 10;

export function partnersCsv(d: AnaPartners, T: T, money: boolean): { columns: string[]; rows: unknown[][] } {
  const cols = [
    T.t('ya.pa.csv.promoter'), T.t('ya.pa.csv.code'), T.t('ya.pa.csv.sales'), T.t('ya.ana.csv.tickets'), T.t('ya.pa.csv.tables'),
    T.t('ya.pa.csv.clicks'), T.t('ya.pa.csv.rate'), ...(money ? [T.t('ya.pa.csv.attributed'), T.t('ya.pa.csv.commission')] : []),
  ];
  const rows = d.promoters.map((p) => [
    p.name ?? p.code ?? '', p.code ?? '', p.sales, p.tickets, p.tables, p.clicks, p.rate ?? '',
    ...(money ? [p.revenue, p.commission.amount] : []),
  ]);
  return { columns: cols, rows };
}

export function PartnersTab({ q, f, setF }: { q: UseQueryResult<AnaPartners>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void }) {
  const T = useTixT();
  const { t, tp, n, eur, eur2, pct, dShort } = T;
  const caps = useTixCaps();
  const R = useTixRoutes();
  const navigate = useNavigate();
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const money = caps.money && !!d && d.totals.revenue !== null;
  const dataKey = `${f.period}:${f.event}:${q.dataUpdatedAt}`;
  const rv = useGo(dataKey, !loading);
  const go = useGo(dataKey, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);
  const jl = jLabelFor(t);
  const shared = d?.meta.mode === 'event' ? d.shared.find((s) => s.id === f.event) ?? null : null;

  const v = useMemo(() => {
    if (!d) return null;
    const cur = d.series.map((b) => Number((money ? b.revenue : b.sales) ?? 0));
    const prev = d.series.map((b) => Number((money ? b.prev_revenue : b.prev_sales) ?? 0));
    const tot = money ? Number(d.totals.revenue ?? 0) : d.totals.sales;
    const ptot = money ? Number(d.totals.prev_revenue ?? 0) : d.totals.prev_sales;
    const valOf = (p: AnaPartners['promoters'][number]) => (money ? Number(p.revenue ?? 0) : p.sales);
    const best = d.promoters.find((p) => valOf(p) > 0) ?? null;
    return { cur, prev, tot, ptot, valOf, best };
  }, [d, money]);

  if (!d || !v) {
    return (
      <>
        <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={280} /><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)}</div>
      </>
    );
  }

  const m = d.meta;
  const ev = m.mode === 'event';
  const tt = d.totals;
  const unit = m.mode === 'hour' ? 'hour' : m.mode === 'month' ? 'month' : 'day';
  const fmt = (x: number) => (money ? eur(x) : n(x));
  const fmtVal = (x: number) => (money ? eur(x) : tp('ya.pa.salesN', x, { n: n(x) }));
  const totD = f.cmp ? deltaPct(v.tot, v.ptot, T) : null;
  const salesD = f.cmp ? deltaPct(tt.sales, tt.prev_sales, T) : null;
  const rateOk = tt.clicks >= MIN_CLICKS && tt.rate !== null;
  const prevRateOk = tt.prev_clicks >= MIN_CLICKS && tt.prev_rate !== null;
  const commission = Number(tt.commission.amount ?? 0);
  const commD = f.cmp && money ? deltaPct(commission, Number(tt.commission.prev.amount ?? 0), T) : null;
  const yieldV = tt.yield.revenue;

  const tiles: TileSpec[] = [
    {
      kind: 'spark', label: t('ya.pa.tile.sales'), value: n(tt.sales * prog),
      delta: salesD ? `${salesD.text} ${t('ya.ana.vsBefore')}` : undefined, dc: salesD && !salesD.up ? 'var(--ya-red-600)' : undefined,
      cap: t('ya.pa.tile.salesCap', { tickets: tp('ya.pa.placesN', tt.tickets, { n: n(tt.tickets) }), tables: tp('ya.pa.tablesN', tt.tables, { n: n(tt.tables) }) }),
      values: d.series.map((b) => b.sales),
    },
    money
      ? {
        kind: 'spark', label: t('ya.pa.tile.commission'), value: eur(commission * prog),
        delta: commD ? `${commD.text} ${t('ya.ana.vsBefore')}` : undefined, dc: 'var(--ya-sand-600)',
        cap: t('ya.pa.tile.commissionCap'), values: d.series.map((b) => Number(b.commission.amount ?? 0)),
      }
      : {
        kind: 'spark', label: t('ya.pa.tile.clicks'), value: n(tt.clicks * prog),
        cap: t('ya.pa.tile.clicksCap'), values: d.series.map((b) => b.clicks),
      },
    {
      kind: 'ring', label: t('ya.pa.tile.rate'), value: rateOk ? pct(Number(tt.rate) * prog, 1) : '—',
      delta: f.cmp && rateOk && prevRateOk ? `${Number(tt.rate) - Number(tt.prev_rate) >= 0 ? '▲' : '▼'} ${t('ya.ana.pts', { n: T.n1(Math.abs(Number(tt.rate) - Number(tt.prev_rate))) })} ${t('ya.ana.vsBefore')}` : undefined,
      dc: f.cmp && rateOk && prevRateOk && Number(tt.rate) < Number(tt.prev_rate) ? 'var(--ya-red-600)' : undefined,
      cap: rateOk ? tp('ya.pa.tile.rateCap', tt.clicks, { n: n(tt.clicks), paid: n(tt.paid) }) : tp('ya.pa.tile.rateFew', tt.clicks, { n: n(tt.clicks) }),
      ring: rateOk ? Number(tt.rate) : 0,
    },
    money
      ? {
        kind: 'txt', label: t('ya.pa.tile.yield'), value: yieldV !== null ? eur2(yieldV) : '—',
        cap: yieldV !== null ? t('ya.pa.tile.yieldCap') : t('ya.pa.tile.yieldNone'), color: yieldV !== null ? 'var(--ya-gradient-brand)' : 'var(--ya-sand-100)',
      }
      : {
        kind: 'txt', label: t('ya.pa.tile.sellers'), value: `${n(tt.sellers)} / ${n(tt.promoters)}`,
        cap: t('ya.pa.tile.sellersCap'), color: 'var(--ya-sand-100)',
      },
  ];

  const insight = !m.has_promoters
    ? t('ya.pa.ins.noPromoters')
    : tt.sales === 0
      ? t(ev ? 'ya.pa.ins.noneEv' : 'ya.pa.ins.none')
      : v.best && v.tot > 0
        ? t('ya.pa.ins.best', { name: v.best.name ?? v.best.code ?? '—', pct: pct((v.valOf(v.best) / v.tot) * 100), n: n(tt.sellers) })
        : '';

  return (
    <>
      {/* Héros : ce que vos promoteurs ont vendu */}
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)' }}>
        <CardHead title={t('ya.pa.heroT')} sub={t(money ? 'ya.pa.heroSub' : 'ya.pa.heroSubN', { unit: t(`ya.ana.unit.${ev ? 'day' : unit}`) })} />
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{fmt(v.tot * prog)}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t(money ? 'ya.pa.bigSub' : 'ya.pa.bigSubN')}</span>
                {totD && <span style={{ fontSize: 14, fontWeight: 600, color: totD.up ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{`${totD.text} ${ev ? t('ya.pa.vsNight') : t('ya.ana.vsBefore')}`}</span>}
              </span>
            </div>
            <TrendChart
              kind="bars"
              cur={v.cur}
              prev={v.prev}
              showPrev={f.cmp}
              marks={[]}
              go={go}
              fy={fmt}
              tipTitle={(i) => bucketTitle(m, i, T, jl)}
              tipValue={fmtVal}
              tipPrev={(x) => `${ev ? t('ya.ana.prevNight') : t('ya.ana.prevPeriod')} : ${fmtVal(x)}`}
              xl={xLabels(m, T, jl)}
            />
            {insight && (!m.has_promoters
              ? <Takeaway cta={t('ya.pa.ins.promotersCta')} onCta={() => navigate(R.promoters)}>{insight}</Takeaway>
              : <Takeaway>{insight}</Takeaway>)}
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      <PromoterRanking d={d} money={money} cmp={f.cmp} loading={loading} rv={rv} go={go} prog={prog} />

      {ev && shared && <WhoSells eventId={shared.id} rv={rv} go={go} />}

      <PartnerLinks links={d.links} ev={ev} money={money} loading={loading} rv={rv} go={go} />

      {!ev && d.shared.length > 0 && (
        <section style={{ ...card, gap: 16, ...fadeIn(rv, 220) }}>
          <CardHead title={t('ya.pa.shared.t')} sub={t('ya.pa.shared.sub')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {d.shared.map((s) => (
              <Hv
                key={s.id}
                as="button"
                type="button"
                onClick={() => setF({ event: s.id })}
                style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto 28px', gap: 14, alignItems: 'center', padding: '12px 10px', border: 0, borderRadius: 14, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--ya-ink)', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}
                hover={{ background: 'var(--ya-sand-50)' }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{dShort(s.start_at)}{s.upcoming ? ` · ${t('ya.pa.shared.upcoming')}` : ''}</span>
                </span>
                <span style={{ fontSize: 13.5, color: 'var(--ya-sand-600)', whiteSpace: 'nowrap' }}>
                  {tp('ya.pa.shared.parties', s.parties, { n: n(s.parties) })}{s.guests > 0 ? ` · ${tp('ya.pa.shared.guests', s.guests, { n: n(s.guests) })}` : ''}
                </span>
                <b style={{ whiteSpace: 'nowrap' }}>{tp('ya.pa.salesN', s.sales, { n: n(s.sales) })}</b>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: 'var(--ya-sand-100)', color: 'var(--ya-sand-600)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={14} stroke={2.4} /></span>
              </Hv>
            ))}
          </div>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.pa.shared.foot')}</span>
        </section>
      )}
    </>
  );
}

// ── Classement des promoteurs ─────────────────────────────────────────────

function PromoterRanking({ d, money, cmp, loading, rv, go, prog }: { d: AnaPartners; money: boolean; cmp: boolean; loading: boolean; rv: boolean; go: boolean; prog: number }) {
  const T = useTixT();
  const { t, tp, n, eur, pct } = T;
  const R = useTixRoutes();
  const val = (p: AnaPartners['promoters'][number]) => (money ? Number(p.revenue ?? 0) : p.sales);
  const top = Math.max(1, ...d.promoters.map(val));
  const grid = money
    ? 'minmax(180px,1.5fr) 84px 76px 96px 104px minmax(160px,1.4fr)'
    : 'minmax(180px,1.5fr) 84px 76px 96px minmax(160px,1.4fr)';
  return (
    <section style={{ ...card, gap: 16 }}>
      <CardHead
        title={t('ya.pa.rank.t')}
        sub={t(money ? 'ya.pa.rank.sub' : 'ya.pa.rank.subN')}
        right={d.meta.has_promoters ? (
          <Hv as={Link} to={R.promoters} style={{ flex: 'none', height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', color: 'var(--ya-ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }} hover={{ borderColor: 'var(--ya-sand-400)', color: 'var(--ya-ink)', textDecoration: 'none' }}>
            {t('ya.pa.rank.manage')}<Icon name="arrowRight" size={14} stroke={2.4} />
          </Hv>
        ) : undefined}
      />
      {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3].map((i) => <Sk key={i} h={52} r={14} />)}</div> : d.promoters.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t(d.meta.has_promoters ? 'ya.pa.rank.empty' : 'ya.pa.rank.noPromoters')}</p>
      ) : (
        <div className="ya-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 160) }}>
          <div style={{ minWidth: money ? 760 : 640, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
              <span>{t('ya.pa.col.promoter')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.col.sales')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.col.clicks')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.col.rate')}</span>
              {money && <span style={{ textAlign: 'right' }}>{t('ya.pa.col.commission')}</span>}
              <span>{t(money ? 'ya.pa.col.attributed' : 'ya.pa.col.share')}</span>
            </div>
            {d.promoters.map((p, i) => {
              const x = val(p);
              const pd = cmp ? deltaPct(x, money ? Number(p.prev_revenue ?? 0) : p.prev_sales, T) : null;
              const label = p.name ?? p.code ?? '—';
              return (
                <Hv
                  key={p.id}
                  as={Link}
                  to={R.promoter(p.id)}
                  style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, color: 'var(--ya-ink)', textDecoration: 'none', fontSize: 14.5, fontVariantNumeric: 'tabular-nums', opacity: p.active ? 1 : 0.6, transition: 'background 140ms' }}
                  hover={{ background: 'var(--ya-sand-50)', color: 'var(--ya-ink)', textDecoration: 'none' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ flex: 'none', width: 22, fontFamily: 'var(--ya-font-mono)', fontSize: 12, color: 'var(--ya-sand-500)', textAlign: 'right' }}>{i + 1}</span>
                    <Avatar url={p.avatar_url} name={label} />
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</b>
                      <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[p.code, !p.active ? t('ya.pa.rank.inactive') : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <b>{n(p.sales * prog)}</b>
                    <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', whiteSpace: 'nowrap' }}>{[tp('ya.pa.placesN', p.tickets, { n: n(p.tickets) }), p.tables > 0 ? tp('ya.pa.tablesN', p.tables, { n: n(p.tables) }) : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(p.clicks)}</span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{p.clicks >= MIN_CLICKS && p.rate !== null ? pct(p.rate, 1) : '—'}</span>
                  {money && <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{eur(Number(p.commission.amount ?? 0))}</span>}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <b>{money ? eur(x) : pct((x / Math.max(1, d.totals.sales)) * 100)}</b>
                      {pd && <span style={{ fontSize: 12.5, fontWeight: 600, color: pd.up ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{pd.text}</span>}
                    </span>
                    <Fill pct={(x / top) * 100} go={go} delay={i * 70} h={5} bg={i === 0 ? 'var(--ya-gradient-brand)' : 'var(--ya-ink)'} dur={800} />
                  </span>
                </Hv>
              );
            })}
          </div>
        </div>
      )}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.pa.rank.foot')}</span>
    </section>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';
  return url ? (
    <img src={url} alt="" loading="lazy" style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, objectFit: 'cover', background: 'var(--ya-sand-100)' }} />
  ) : (
    <span aria-hidden style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'var(--ya-red-50)', color: 'var(--ya-red-700)', fontSize: 13, fontWeight: 700 }}>{initials}</span>
  );
}

// ── Liens partenaires ─────────────────────────────────────────────────────

function PartnerLinks({ links, ev, money, loading, rv, go }: { links: AnaPartnerLink[]; ev: boolean; money: boolean; loading: boolean; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, tp, n, eur, dShort } = T;
  const val = (l: AnaPartnerLink) => (money ? Number(l.revenue ?? 0) : l.sales);
  const top = Math.max(1, ...links.map(val));
  const kindLabel = (l: AnaPartnerLink) => (l.kind === 'partner'
    ? t(`ya.pa.links.role.${l.role && ['promoter', 'dj', 'artist', 'ambassador', 'venue'].includes(l.role) ? l.role : 'other'}`)
    : t(`ya.pa.links.kind.${l.kind}`));
  const grid = 'minmax(200px,1.6fr) 76px 100px minmax(150px,1.3fr)';
  return (
    <section style={{ ...card, gap: 16 }}>
      <CardHead title={t('ya.pa.links.t')} sub={t(ev ? 'ya.pa.links.subEv' : 'ya.pa.links.sub')} />
      {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2].map((i) => <Sk key={i} h={52} r={14} />)}</div> : links.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.pa.links.empty')}</p>
      ) : (
        <div className="ya-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 200) }}>
          <div style={{ minWidth: 620, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
              <span>{t('ya.pa.col.link')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.col.clicks')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.col.sales')}</span>
              <span>{t(money ? 'ya.pa.col.salesValue' : 'ya.pa.col.places')}</span>
            </div>
            {links.map((l, i) => {
              const x = val(l);
              const name = l.name ?? t('ya.pa.links.direct');
              return (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, fontSize: 14.5, fontVariantNumeric: 'tabular-nums', opacity: l.archived ? 0.55 : 1 }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</b>
                      <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: l.kind === 'partner' ? 'var(--ya-red-50)' : 'var(--ya-sand-100)', color: l.kind === 'partner' ? 'var(--ya-red-700)' : 'var(--ya-sand-600)', whiteSpace: 'nowrap' }}>{kindLabel(l)}</span>
                    </span>
                    {!ev && <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.event_title} · {dShort(l.event_start)}</span>}
                  </span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(l.clicks)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <b>{n(l.sales)}</b>
                    <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', whiteSpace: 'nowrap' }}>
                      {[l.tickets > 0 ? tp('ya.pa.placesN', l.tickets, { n: n(l.tickets) }) : null, l.tables > 0 ? tp('ya.pa.tablesN', l.tables, { n: n(l.tables) }) : null, l.guests > 0 ? tp('ya.pa.guestsN', l.guests, { n: n(l.guests) }) : null].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <b>{money ? eur(x) : tp('ya.pa.placesN', l.tickets, { n: n(l.tickets) })}</b>
                    <Fill pct={(x / top) * 100} go={go} delay={i * 60} h={5} bg="var(--ya-ink)" dur={800} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.pa.links.foot')}</span>
    </section>
  );
}

// ── « Qui fait vendre ? » d'une soirée partagée ───────────────────────────

function WhoSells({ eventId, rv, go }: { eventId: string; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, n, eur } = T;
  const q = useCollabBreakdown(eventId);
  const b: CollabBreakdown | undefined = q.data;
  const money = !!b?.money;

  const rows = useMemo(() => {
    if (!b?.ok) return [];
    const out: { k: string; name: string; tag: string | null; mine: boolean; r: CollabPartyRow }[] = [];
    for (const p of b.parties ?? []) out.push({ k: p.party, name: p.name, tag: p.mine ? t('ya.pa.who.you') : t(`ya.pa.who.kind.${p.kind === 'venue' ? 'venue' : 'org'}`), mine: p.mine, r: p });
    for (const g of b.guests ?? []) out.push({ k: `guest:${g.id}`, name: g.name, tag: t('ya.pa.who.guest'), mine: false, r: g });
    if (b.yuno) out.push({ k: 'yuno', name: t('ya.pa.who.yuno'), tag: null, mine: false, r: b.yuno });
    if (b.direct) out.push({ k: 'direct', name: t('ya.pa.who.direct'), tag: null, mine: false, r: b.direct });
    const un = b.unattributed;
    if (un && (un.tickets + un.tables + un.guests) > 0) out.push({ k: 'other', name: t('ya.pa.who.other'), tag: null, mine: false, r: un });
    return out.filter((x) => x.r.tickets + x.r.tables + x.r.guests + x.r.clicks > 0 || b.parties?.some((p) => p.party === x.k));
  }, [b, t]);

  const val = (r: CollabPartyRow) => (money ? Number(r.revenue ?? 0) : r.tickets + r.table_guests + r.guests);
  const top = Math.max(1, ...rows.map((x) => val(x.r)));
  const grid = 'minmax(180px,1.5fr) 70px 80px 72px 84px 80px minmax(140px,1.2fr)';

  return (
    <section style={{ ...card, gap: 16, ...fadeIn(rv, 140) }}>
      <CardHead title={t('ya.pa.who.t')} sub={t('ya.pa.who.sub')} />
      {q.isLoading ? <Sk h={180} r={16} /> : !b?.ok ? (
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.pa.who.unavailable')}</p>
      ) : (
        <div className="ya-thin-scroll" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 760, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '0 10px 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
              <span>{t('ya.pa.who.col.party')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.col.clicks')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.who.col.tickets')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.who.col.tables')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.who.col.guests')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.pa.who.col.entered')}</span>
              <span>{t(money ? 'ya.pa.col.salesValue' : 'ya.pa.who.col.people')}</span>
            </div>
            {rows.map((x, i) => {
              const v = val(x.r);
              return (
                <div key={x.k} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '12px 10px', borderRadius: 14, background: x.mine ? 'var(--ya-red-50)' : 'transparent', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</b>
                    {x.tag && <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: x.mine ? 'var(--ya-card)' : 'var(--ya-sand-100)', color: x.mine ? 'var(--ya-red-700)' : 'var(--ya-sand-600)', whiteSpace: 'nowrap' }}>{x.tag}</span>}
                  </span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(x.r.clicks)}</span>
                  <span style={{ textAlign: 'right' }}>{n(x.r.tickets)}</span>
                  <span style={{ textAlign: 'right' }}>{n(x.r.tables)}</span>
                  <span style={{ textAlign: 'right' }}>{n(x.r.guests)}</span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(x.r.entered)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <b>{money ? eur(v) : n(v)}</b>
                    <Fill pct={(v / top) * 100} go={go} delay={i * 60} h={5} bg={x.mine ? 'var(--ya-gradient-brand)' : 'var(--ya-ink)'} dur={800} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.pa.who.foot')}</span>
    </section>
  );
}
