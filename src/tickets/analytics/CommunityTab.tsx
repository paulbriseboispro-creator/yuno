/**
 * Analyses › Communauté — « Qui sont mes clients ? ». La base au fil du temps
 * (ou les acheteurs d'une soirée), les segments du cycle de vie, qui revient,
 * combien de fois, qui pèse dans les ventes, l'âge et le lieu, les meilleurs
 * clients et trois groupes à réveiller. Mêmes règles que la liste Clients
 * (habitué, à réactiver : Réglages).
 */
import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Segmented } from '@/tickets/analytics/kit';
import { useProgress } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixCaps } from '@/tickets/analytics/scope';
import { useTixRoutes } from '@/tickets/analytics/routes';
import type { AnaCommunity, AnaFilters, Life } from '@/tickets/analytics/data';
import {
  BrandArrowButton, CardHead, ChartSkeleton, Donut, Fill, Sk, Takeaway, Tile, TileSkeleton, TrendChart,
  bucketTitle, card, fadeIn, nightCard, useGo, xLabels, type TileSpec,
} from './anaUi';
import { jLabelFor } from './SalesTab';

type T = ReturnType<typeof useTixT>;

const LIFE: { k: Life; c: string }[] = [
  { k: 'hab', c: 'var(--ya-red-500)' }, { k: 'occ', c: 'var(--ya-tangerine-500)' }, { k: 'nou', c: 'var(--ya-red-200)' },
  { k: 'end', c: 'var(--ya-sand-300)' }, { k: 'none', c: 'var(--ya-sand-100)' },
];

export function communityCsv(d: AnaCommunity, T: T): { columns: string[]; rows: unknown[][] } {
  const jl = jLabelFor(T.t);
  return {
    columns: [T.t('ya.ana.csv.when'), T.t('ya.ana.csv.clients'), T.t('ya.ana.csv.newClients')],
    rows: d.series.map((s, i) => [bucketTitle(d.meta, i, T, jl), s.total, s.new]),
  };
}

export function CommunityTab({ q, f, setF }: { q: UseQueryResult<AnaCommunity>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void }) {
  const T = useTixT();
  const { t, tp, n, n1, eur, pct, dShort } = T;
  const caps = useTixCaps();
  const R = useTixRoutes();
  const navigate = useNavigate();
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const money = caps.money && !!d && d.stats.spent !== null;
  const [cm, setCm] = useState<'base' | 'new'>('base');
  const [dh, setDh] = useState<string | null>(null);
  const [coh, setCoh] = useState<string | null>(null);
  const [rowH, setRowH] = useState<number | null>(null);
  const dataKey = `${f.period}:${f.event}:${f.seg}:${q.dataUpdatedAt}`;
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${cm}:${f.cmp}`, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);
  const jl = jLabelFor(t);

  const v = useMemo(() => {
    if (!d) return null;
    const ev = d.meta.mode === 'event';
    const cur = d.series.map((s) => (cm === 'new' ? s.new : s.total));
    const prev = d.series.map((s) => (cm === 'new' ? s.prev_new : (s.prev_total ?? 0)));
    const added = d.series.reduce((a, s) => a + s.new, 0);
    const padded = d.series.reduce((a, s) => a + s.prev_new, 0);
    return { ev, cur, prev, added, padded };
  }, [d, cm]);

  if (!d || !v) {
    return (
      <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          <section style={{ ...card, flex: '1.7 1 560px', padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={260} /><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></section>
          <section style={{ ...card, flex: '1 1 340px', alignItems: 'center' }}><Sk h={176} w={176} r={99} /><Sk h={14} /><Sk h={14} /><Sk h={14} /></section>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)}</div>
      </>
    );
  }
  const m = d.meta;
  const unit = m.mode === 'hour' ? 'hour' : m.mode === 'month' ? 'month' : 'day';
  const showPrev = f.cmp && (cm === 'new' || v.ev);
  const lc = d.lifecycle;
  const lcItems = LIFE.filter((x) => x.k !== 'none' || lc.none > 0).map((x) => ({ k: x.k, c: x.c, v: Number(lc[x.k]) }));
  const lcTot = lcItems.reduce((a, x) => a + x.v, 0) || 1;
  const act = dh ?? (f.seg !== 'all' ? f.seg : null);
  const ag = act ? lcItems.find((x) => x.k === act) : null;
  const ruleTxt = (k: Life) => t(`ya.ana.c2.life.${k}D`, { n: d.rules.min_nights, m: d.rules.window_months, l: d.rules.lapse_months });
  const nouShare = lcTot ? (Number(lc.nou) / lcTot) * 100 : 0;
  const habShare = lcTot ? (Number(lc.hab) / lcTot) * 100 : 0;

  // Tuiles
  const r = d.reach;
  const reachTot = r.total || 1;
  const reachable = r.email_sms + r.email + r.sms;
  const sp = d.spark;
  const last = sp[sp.length - 1];
  const prevM = sp[sp.length - 2];
  const retPct = d.stats.came > 0 ? (d.stats.returning / d.stats.came) * 100 : null;
  const tiles: TileSpec[] = [
    { kind: 'stack', label: t('ya.ana.c2.t.reach'), value: pct(((reachable / reachTot) * 100) * prog), delta: t('ya.ana.c2.t.reachOf', { a: n(reachable), b: n(r.total) }), dc: 'var(--ya-sand-600)', cap: t('ya.ana.c2.t.reachCap'), parts: [{ w: (r.email_sms / reachTot) * 100, c: 'var(--ya-red-500)' }, { w: (r.email / reachTot) * 100, c: 'var(--ya-red-300)' }, { w: (r.sms / reachTot) * 100, c: 'var(--ya-red-100)' }, { w: (r.none / reachTot) * 100, c: 'var(--ya-sand-200)' }], legL: t('ya.ana.c2.t.reachL', { pct: pct(((r.email_sms + r.email) / reachTot) * 100) }), legR: t('ya.ana.c2.t.reachR', { pct: pct((r.none / reachTot) * 100) }) },
    { kind: 'ring', label: t('ya.ana.c2.t.ret'), value: retPct !== null ? pct(retPct * prog) : '—', delta: last?.returning_pct !== null && prevM?.returning_pct !== null && last && prevM ? `${Number(last.returning_pct) - Number(prevM.returning_pct) >= 0 ? '▲' : '▼'} ${t('ya.ana.pts', { n: n1(Math.abs(Number(last.returning_pct) - Number(prevM.returning_pct))) })} ${t('ya.ana.vsMonth')}` : undefined, cap: t('ya.ana.c2.t.retCap'), ring: retPct ?? 0 },
    { kind: 'spark', label: t('ya.ana.c2.t.nights'), value: d.stats.avg_nights !== null ? n1(Number(d.stats.avg_nights) * prog) : '—', delta: last?.avg_nights !== null && prevM?.avg_nights !== null && last && prevM ? `${Number(last.avg_nights) - Number(prevM.avg_nights) >= 0 ? '▲' : '▼'} ${n1(Math.abs(Number(last.avg_nights) - Number(prevM.avg_nights)))} ${t('ya.ana.vsMonth')}` : undefined, cap: t('ya.ana.c2.t.nightsCap'), values: sp.map((x) => Number(x.avg_nights ?? 0)) },
    money
      ? { kind: 'spark', label: t('ya.ana.c2.t.spend'), value: eur(Number(d.stats.spent) * prog), delta: last?.spent !== null && prevM?.spent !== null && last && prevM ? `${Number(last.spent) - Number(prevM.spent) >= 0 ? '▲' : '▼'} ${eur(Math.abs(Number(last.spent) - Number(prevM.spent)))} ${t('ya.ana.vsMonth')}` : undefined, cap: t('ya.ana.c2.t.spendCap'), values: sp.map((x) => Number(x.spent ?? 0)) }
      : { kind: 'spark', label: t('ya.ana.c2.t.came'), value: n(d.stats.came * prog), cap: t('ya.ana.c2.t.cameCap'), values: d.series.map((s) => s.total) },
  ];

  // Qui revient : la soirée qui fidélise le mieux (+1).
  const bestCoh = d.cohort.filter((c) => c.back[0] !== null && c.buyers >= 10).sort((a, b) => Number(b.back[0]) - Number(a.back[0]))[0];
  const hist = [
    { k: 'n1', l: t('ya.ana.c2.h.1') }, { k: 'n2', l: '2' }, { k: 'n3', l: t('ya.ana.c2.h.3') }, { k: 'n5', l: t('ya.ana.c2.h.5') }, { k: 'n10', l: t('ya.ana.c2.h.10') },
  ] as const;
  const histTot = hist.reduce((a, h) => a + Number(d.hist[h.k]), 0) || 1;
  const histMax = Math.max(1, ...hist.map((h) => Number(d.hist[h.k])));

  // Qui vient (acheteurs de la fenêtre)
  const aud = (['nou', 'occ', 'hab'] as const).map((k) => ({ k, ...d.audience.groups[k] }));
  const audBuyers = aud.reduce((a, x) => a + Number(x.buyers), 0) || 1;
  const audRev = aud.reduce((a, x) => a + Number(x.revenue ?? 0), 0) || 1;
  const AUDS: Record<'nou' | 'occ' | 'hab', { bg: string; fg: string; bd: string }> = {
    nou: { bg: 'var(--ya-sand-100)', fg: 'var(--ya-sand-700)', bd: 'var(--ya-sand-300)' },
    occ: { bg: 'var(--ya-red-200)', fg: 'var(--ya-red-800)', bd: 'var(--ya-red-300)' },
    hab: { bg: 'var(--ya-gradient-brand)', fg: '#fff', bd: 'var(--ya-red-500)' },
  };
  const hab = aud.find((x) => x.k === 'hab')!;
  const nou = aud.find((x) => x.k === 'nou')!;
  const habBasket = Number(hab.buyers) > 0 && hab.revenue !== null ? Number(hab.revenue) / Number(hab.buyers) : null;
  const nouBasket = Number(nou.buyers) > 0 && nou.revenue !== null ? Number(nou.revenue) / Number(nou.buyers) : null;

  const ageL = [t('ya.ana.c2.age.a'), t('ya.ana.c2.age.b'), t('ya.ana.c2.age.c'), t('ya.ana.c2.age.d'), t('ya.ana.c2.age.e')];
  const ageTot = d.age.b.reduce((a, x) => a + Number(x), 0) || 1;
  const ageMax = Math.max(1, ...d.age.b.map(Number));
  const cityTot = d.city.known || 1;
  const cityRows = [...d.city.top.map((c) => ({ l: c.city, v: Number(c.n) }))];
  const cityOthers = d.city.known - cityRows.reduce((a, c) => a + c.v, 0);
  if (cityOthers > 0) cityRows.push({ l: t('ya.ana.c2.others'), v: cityOthers });
  const cityMax = Math.max(1, ...cityRows.map((c) => c.v));

  const wake = [
    { big: d.wake.end.n, t: t('ya.ana.c2.w.end'), s: t('ya.ana.c2.w.endS', { m: d.rules.lapse_months, r: n(d.wake.end.reachable) }), cta: t('ya.ana.c2.w.endCta'), to: R.campaignNew },
    { big: d.wake.once.n, t: t('ya.ana.c2.w.once'), s: t('ya.ana.c2.w.onceS', { r: n(d.wake.once.reachable) }), cta: t('ya.ana.c2.w.onceCta'), to: R.campaignNew },
    d.wake.hab_no_ticket
      ? { big: d.wake.hab_no_ticket.n, t: t('ya.ana.c2.w.hab'), s: t('ya.ana.c2.w.habS', { title: d.wake.hab_no_ticket.title }), cta: t('ya.ana.c2.w.habCta'), to: R.campaignNewForEvent(d.wake.hab_no_ticket.event_id) }
      : { big: Number(lc.hab), t: t('ya.ana.c2.w.habAll'), s: t('ya.ana.c2.w.habAllS'), cta: t('ya.ana.c2.w.habAllCta'), to: R.clients },
  ];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        {/* Héros : la base */}
        <section style={{ ...card, flex: '1.7 1 560px', gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)' }}>
          <CardHead
            title={v.ev ? t('ya.ana.c2.heroEv') : t('ya.ana.c2.hero')}
            sub={`${t(cm === 'new' ? 'ya.ana.c2.subNew' : 'ya.ana.c2.subTotal')}${v.ev ? ` ${t('ya.ana.c2.subEv')}` : ` · ${t('ya.ana.s.per', { unit: t(`ya.ana.unit.${unit}`) }).toLowerCase()}`} · ${t('ya.ana.c2.subUnique')}`}
            right={<Segmented value={cm} onChange={(x) => setCm(x)} ariaLabel={t('ya.ana.c2.hero')} options={[{ value: 'base', label: v.ev ? t('ya.ana.c2.buyers') : t('ya.ana.c2.total') }, { value: 'new', label: t('ya.ana.c2.new') }]} />}
          />
          {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
                <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>
                  {n((cm === 'new' ? v.added : d.base) * prog)}
                  <span style={{ marginLeft: 12, fontSize: 'clamp(20px,2.4vw,28px)', letterSpacing: '-.02em', color: 'var(--ya-sand-500)' }}>{cm === 'new' ? t('ya.ana.c2.newUnit') : v.ev ? t('ya.ana.c2.buyersUnit') : t('ya.ana.c2.clientsUnit')}</span>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                  {cm === 'base' && <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--ya-green-700)' }}>{tp('ya.ana.c2.added', v.added, { n: n(v.added) })}</span>}
                  {f.cmp && (() => {
                    const dd = v.padded > 0 ? (v.added - v.padded) / v.padded : null;
                    return dd !== null ? <span style={{ fontSize: 14, color: dd >= 0 ? 'var(--ya-green-700)' : 'var(--ya-red-600)', fontWeight: cm === 'new' ? 600 : 400 }}>{`${dd >= 0 ? '▲' : '▼'} ${pct(Math.abs(dd) * 100)} ${t('ya.ana.c2.newVs', { vs: v.ev ? t('ya.ana.vsPrevNight') : t(`ya.ana.per.vs.${m.period}`) })}`}</span> : null;
                  })()}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 13, color: 'var(--ya-sand-600)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 14, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg,var(--ya-tangerine-500),var(--ya-red-500))', display: 'inline-block' }} />{cm === 'new' ? t('ya.ana.c2.legNew') : t('ya.ana.c2.legTotal')}</span>
                {showPrev && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 18, height: 0, borderTop: '2px solid var(--ya-ink)', display: 'inline-block' }} />{v.ev ? t('ya.ana.prevNight') : t('ya.ana.prevPeriod')}</span>}
              </div>
              <TrendChart
                kind={cm === 'new' ? 'bars' : 'area'}
                cur={v.cur}
                prev={v.prev}
                showPrev={showPrev}
                marks={[]}
                go={go}
                lo={cm === 'base' && !v.ev ? Math.floor((Math.min(...v.cur) * 0.99) / 10) * 10 : 0}
                fy={(x) => n(x)}
                tipTitle={(i) => bucketTitle(m, i, T, jl)}
                tipValue={(x) => t(cm === 'new' ? 'ya.ana.c2.tipNew' : v.ev ? 'ya.ana.c2.tipBuyers' : 'ya.ana.c2.tipClients', { n: n(x) })}
                tipPrev={(x) => `${v.ev ? t('ya.ana.prevNight') : t('ya.ana.prevPeriod')} : ${n(x)}`}
                xl={xLabels(m, T, jl)}
              />
              <Takeaway cta={t('ya.ana.c2.insCta')} onCta={() => navigate(R.automations)}>{t('ya.ana.c2.ins')}</Takeaway>
            </div>
          )}
        </section>

        {/* Qui sont-ils ? */}
        <section style={{ ...card, flex: '1 1 340px' }}>
          <CardHead title={t('ya.ana.c2.whoT')} sub={t('ya.ana.c2.whoSub')} />
          {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}><Sk h={176} w={176} r={99} /><Sk h={14} /><Sk h={14} /><Sk h={14} /></div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv, 120) }}>
              <Donut items={lcItems} active={act} go={go} onEnter={setDh} onLeave={() => setDh(null)} big={n((ag ? ag.v : lcTot) * prog)} small={ag ? t(`ya.ana.c2.life.${ag.k}`) : v.ev ? t('ya.ana.c2.buyersUnit') : t('ya.ana.c2.clientsUnit')} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {lcItems.map((x) => (
                  <Hv
                    key={x.k}
                    as="button"
                    type="button"
                    onClick={() => { if (x.k !== 'none') setF({ seg: f.seg === x.k ? 'all' : (x.k as AnaFilters['seg']) }); }}
                    onMouseEnter={() => setDh(x.k)}
                    onMouseLeave={() => setDh(null)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', margin: '0 -10px', border: 0, borderRadius: 12, background: act === x.k ? 'var(--ya-sand-50)' : 'transparent', cursor: x.k === 'none' ? 'default' : 'pointer', textAlign: 'left', fontSize: 14.5, color: 'var(--ya-ink)', transition: 'background 140ms' }}
                  >
                    <i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: x.c, boxShadow: x.k === 'none' ? 'inset 0 0 0 1px var(--ya-sand-300)' : undefined }} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 600 }}>{t(`ya.ana.c2.life.${x.k}`)}</span><span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{ruleTxt(x.k)}</span></span>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>{n(x.v)}</b>
                    <span style={{ width: 42, textAlign: 'right', color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{pct((x.v / lcTot) * 100)}</span>
                  </Hv>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--ya-sand-700)', textWrap: 'pretty' }}>
                {habShare >= nouShare ? t('ya.ana.c2.segTxtHab', { pct: pct(habShare) }) : t('ya.ana.c2.segTxtNou', { pct: pct(nouShare) })}
              </p>
            </div>
          )}
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        {/* Qui revient ? */}
        <section style={{ ...card, flex: '1.4 1 520px', gap: 16 }}>
          <CardHead title={t('ya.ana.c2.cohT')} sub={t('ya.ana.c2.cohSub')} />
          {loading ? <Sk h={300} r={16} /> : d.cohort.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.c2.cohEmpty')}</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...fadeIn(rv, 100) }}>
              <div className="ya-thin-scroll" style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 480, display: 'grid', gridTemplateColumns: 'minmax(150px,1.6fr) 60px repeat(4,minmax(0,1fr))', gap: 4, fontSize: 13, alignItems: 'center' }}>
                  {[t('ya.ana.c2.cohFirst'), t('ya.ana.c2.cohClients'), '+1', '+2', '+3', '+4'].map((h, i) => <span key={i} style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ya-sand-500)', paddingBottom: 6 }}>{h}</span>)}
                  {d.cohort.map((c, i) => [
                    <span key={`l${i}`} style={{ display: 'flex', flexDirection: 'column', fontWeight: bestCoh?.id === c.id ? 600 : 500, minWidth: 0 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span><span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ya-sand-500)' }}>{dShort(c.night)}</span></span>,
                    <span key={`c${i}`} style={{ color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{n(c.buyers)}</span>,
                    ...c.back.map((x, k) => {
                      if (x === null) return <span key={`${i}-${k}`} style={{ height: 44, borderRadius: 9, background: 'repeating-linear-gradient(135deg,var(--ya-card) 0 5px,var(--ya-sand-50) 5px 10px)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }} />;
                      const al = Math.max(0, Math.min(1, (Number(x) - 5) / 40));
                      const key = `${i}-${k}`;
                      return (
                        <span key={key} onMouseEnter={() => setCoh(key)} style={{ height: 44, borderRadius: 9, display: 'grid', placeItems: 'center', fontWeight: 600, fontVariantNumeric: 'tabular-nums', background: `rgba(232,25,44,${(0.08 + al * 0.85).toFixed(2)})`, color: al > 0.5 ? '#fff' : 'var(--ya-red-800)', transform: `scale(${go ? 1 : 0.85})`, opacity: go ? 1 : 0, transition: go ? `transform 500ms ease-out ${(i + k) * 70}ms,opacity 500ms ${(i + k) * 70}ms,box-shadow 120ms` : 'none', boxShadow: coh === key ? '0 0 0 2px var(--ya-ink)' : 'none', cursor: 'crosshair' }}>
                          {pct(Number(x))}
                        </span>
                      );
                    }),
                  ])}
                </div>
              </div>
              <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--ya-sand-50)', fontSize: 14, lineHeight: 1.45, color: 'var(--ya-sand-700)', textWrap: 'pretty' }}>
                {(() => {
                  if (!coh) return t('ya.ana.c2.cohHover');
                  const [i, k] = coh.split('-').map(Number);
                  const c = d.cohort[i]; const x = c?.back[k];
                  if (!c || x === null || x === undefined) return t('ya.ana.c2.cohHover');
                  return t(k === 0 ? 'ya.ana.c2.cohInfo1' : 'ya.ana.c2.cohInfoN', { n: n(c.buyers), title: c.title, date: dShort(c.night), pct: pct(Number(x)), k: n(Math.round((c.buyers * Number(x)) / 100)), s: k + 1 });
                })()}
              </div>
              {bestCoh && <Takeaway>{t('ya.ana.c2.cohBest', { title: bestCoh.title, pct: pct(Number(bestCoh.back[0])) })}</Takeaway>}
            </div>
          )}
        </section>

        {/* Combien de fois ? */}
        <section style={{ ...card, flex: '1 1 360px', gap: 16 }}>
          <CardHead title={t('ya.ana.c2.histT')} sub={t('ya.ana.c2.histSub')} />
          {loading ? <Sk h={260} r={16} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, ...fadeIn(rv, 180) }}>
              <div style={{ height: 220, display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                {hist.map((h, i) => {
                  const val = Number(d.hist[h.k]);
                  return (
                    <div key={h.k} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6, textAlign: 'center' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{pct((val / histTot) * 100)}</span>
                      <Hv style={{ width: '100%', height: go ? `${Math.max(3, (val / histMax) * 100)}%` : '0%', maxHeight: 170, borderRadius: '8px 8px 3px 3px', background: i >= 2 ? 'var(--ya-red-300)' : 'var(--ya-red-200)', transition: go ? `height 800ms cubic-bezier(.22,1,.36,1) ${i * 90}ms,background 140ms` : 'none' }} hover={{ background: 'var(--ya-red-500)' }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {hist.map((h) => (
                  <div key={h.k} style={{ flex: 1, minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ya-sand-700)', fontWeight: 500 }}>{h.l}</span>
                    <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{n(Number(d.hist[h.k]))}</span>
                  </div>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ya-sand-500)', textWrap: 'pretty' }}>{t('ya.ana.c2.histFoot', { n: d.rules.min_nights, m: d.rules.window_months })}</p>
            </div>
          )}
        </section>
      </div>

      {/* Qui vient à vos soirées */}
      <section style={{ ...card }}>
        <CardHead title={t('ya.ana.c2.audT')} sub={`${tp('ya.ana.c2.audBuyers', d.audience.buyers, { n: n(d.audience.buyers) })} · ${v.ev && m.event ? m.event.title : t(`ya.ana.per.full.${m.period}`)} · ${t('ya.ana.c2.audSub')}`} />
        {loading ? <Sk h={200} r={16} /> : audBuyers <= 0 || d.audience.buyers === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.c2.audEmpty')}</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv, 100) }}>
            <div style={{ clipPath: `inset(0 ${go ? '0%' : '101%'} 0 0)`, transition: go ? 'clip-path 1200ms cubic-bezier(.22,1,.36,1)' : 'none' }}>
              <div style={{ display: 'flex', gap: 4, height: 44 }}>
                {aud.filter((x) => Number(x.buyers) > 0).map((x) => (
                  <div key={x.k} style={{ flex: Number(x.buyers), minWidth: 0, borderRadius: 10, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', background: AUDS[x.k].bg, color: AUDS[x.k].fg, overflow: 'hidden', whiteSpace: 'nowrap' }}>{pct((Number(x.buyers) / audBuyers) * 100)}</div>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 16 }}>
              {aud.map((x) => {
                const bk = Number(x.buyers) > 0 && x.revenue !== null ? Number(x.revenue) / Number(x.buyers) : null;
                return (
                  <div key={x.k} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 12, borderTop: `2px solid ${AUDS[x.k].bd}` }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ya-sand-700)' }}>{t(`ya.ana.c2.life.${x.k}`)}</span>
                    <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 32, lineHeight: 1.05, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(Number(x.buyers) * prog)}</b>
                    <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{ruleTxt(x.k)}</span>
                    {money && bk !== null && (
                      <span style={{ marginTop: 6, fontSize: 13.5, color: 'var(--ya-sand-700)' }}>
                        {t('ya.ana.c2.basket')} <b style={{ color: 'var(--ya-ink)' }}>{eur(bk)}</b> · <b style={{ color: 'var(--ya-ink)' }}>{pct((Number(x.revenue) / audRev) * 100)}</b> {t('ya.ana.c2.ofSales')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <Takeaway>
              {money && habBasket !== null && nouBasket !== null && nouBasket > 0
                ? t('ya.ana.c2.audIns', { a: pct((Number(hab.buyers) / audBuyers) * 100), b: pct((Number(hab.revenue) / audRev) * 100), x: n1(habBasket / nouBasket) })
                : t('ya.ana.c2.audInsTk', { a: pct((Number(hab.buyers) / audBuyers) * 100) })}
            </Takeaway>
          </div>
        )}
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ ...card, flex: '1 1 420px', gap: 16 }}>
          <CardHead title={t('ya.ana.c2.geoT')} sub={t('ya.ana.c2.geoSub', { a: pct(d.age.total ? (d.age.known / d.age.total) * 100 : 0), b: pct(d.city.total ? (d.city.known / d.city.total) * 100 : 0) })} />
          {loading ? <Sk h={300} r={16} /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 24, ...fadeIn(rv, 100) }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.ana.c2.age')}</span>
                {d.age.known === 0 ? <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t('ya.ana.c2.unknown')}</span> : d.age.b.map((x, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{ageL[i]}</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{pct((Number(x) / ageTot) * 100)}</b></span>
                    <Fill pct={(Number(x) / ageMax) * 100} go={go} delay={i * 70} dur={800} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.ana.c2.place')}</span>
                {d.city.known === 0 ? <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t('ya.ana.c2.unknown')}</span> : cityRows.map((c, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{c.l}</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{pct((c.v / cityTot) * 100)}</b></span>
                    <Fill pct={(c.v / cityMax) * 100} go={go} delay={i * 70} bg="var(--ya-ink)" dur={800} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        <section style={{ ...card, flex: '1 1 420px', gap: 16 }}>
          <CardHead title={t('ya.ana.c2.topT')} sub={t(money ? 'ya.ana.c2.topSub' : 'ya.ana.c2.topSubTk')} />
          {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Sk key={i} h={52} r={14} />)}</div> : d.top.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.c2.topEmpty')}</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, ...fadeIn(rv, 180) }}>
              {d.top.map((c, i) => {
                const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
                const ini = ((c.first_name?.[0] ?? '') + (c.last_name?.[0] ?? '')).toUpperCase() || c.email[0]?.toUpperCase() || '?';
                return (
                  <Hv
                    key={c.email}
                    as="button"
                    type="button"
                    onClick={() => navigate(R.clients)}
                    onMouseEnter={() => setRowH(i)}
                    onMouseLeave={() => setRowH(null)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, margin: '0 -10px', border: 0, borderRadius: 14, background: rowH === i ? 'var(--ya-sand-50)' : 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--ya-ink)', transition: 'background 140ms' }}
                  >
                    <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 99, background: 'var(--ya-sand-100)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ya-sand-700)' }}>{ini}</span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{tp('ya.ana.c2.topNights', c.nights, { n: n(c.nights) })}{c.last_night ? ` · ${t('ya.ana.c2.topLast', { date: dShort(c.last_night) })}` : ''}</span>
                    </span>
                    {money && c.spent !== null && <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{eur(Number(c.spent))}</b>}
                  </Hv>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* À réveiller */}
      <section style={{ ...nightCard, display: 'flex', flexDirection: 'column', gap: 20, padding: 28, ...fadeIn(rv, 120) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-text-on-night-2)' }}>{t('ya.ana.c2.wakeK')}</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t('ya.ana.c2.wakeT')}</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 14 }}>
          {wake.map((w, i) => (
            <Hv key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 20, borderRadius: 20, background: 'rgba(255,255,255,.06)', boxShadow: 'inset 0 0 0 1px var(--ya-border-night)', transition: 'background 160ms,transform 200ms cubic-bezier(.22,1,.36,1)' }} hover={{ background: 'rgba(255,255,255,.1)', transform: 'translateY(-2px)' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 48, lineHeight: 1, letterSpacing: '-.045em', fontVariantNumeric: 'tabular-nums' }}>{n(w.big * prog)}</span>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{w.t}</span>
              <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ya-text-on-night-2)', textWrap: 'pretty' }}>{w.s}</span>
              <div style={{ alignSelf: 'flex-start', marginTop: 'auto', paddingTop: 8 }}><BrandArrowButton label={w.cta} onClick={() => navigate(w.to)} h={40} /></div>
            </Hv>
          ))}
        </div>
      </section>
    </>
  );
}
