/**
 * Analyses › Trafic (27/10, TRAFFIC_TAB_PLAN.md lots C3-C4) — « Qui passe par
 * vos liens ? ». Le trafic qui passe PAR Yuno, compté en personnes : les clics
 * des liens /go/ (stories, bios, partenaires, SMS, bouton des pages /j/) et des
 * e-mails, les pages d'inscription, les heures, les écrans, les pays, la
 * plateforme d'achat que Shotgun rapporte. Lecture : crm_ana_clicks.
 *
 * Un seul pont vers l'argent (décision D1 de Paul) : le passage à l'achat (un
 * pourcentage et un nombre de commandes) et une phrase en euros en bas de page,
 * vers Ventes. Ce que la page Shotgun voit reste « Bientôt » (ShotgunSoonCard),
 * jamais estimé. « Personnes » = un visiteur, un jour, un lien (D2).
 */
import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented } from '@/crm/ui/kit';
import { EASE, useProgress } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { ShotgunSoonCard } from '@/crm/components/ShotgunSoon';
import { CLICK_FAMS, type AnaClickLink, type AnaClicks, type AnaFilters, type AnaTab, type ClickFam } from '@/crm/data/analytics';
import {
  BrandArrowButton, CardHead, ChartSkeleton, Fill, MultiLine, Sk, StackChart, StatePill, Tile, TileSkeleton,
  bucketTitle, card, fadeIn, nightCard, useGo, xLabels, type NightState, type TileSpec,
} from './anaUi';
import { deltaPct, jLabelFor } from './SalesTab';

type T = ReturnType<typeof useCrmT>;

/** Sous 10 personnes, aucun pourcentage (MIN_SAMPLE). */
const MIN = 10;
const DAYS_REF = [1, 2, 3, 4, 5, 6, 7].map((d) => new Date(2024, 0, d));

export const CLICK_COLOR: Record<ClickFam, string> = {
  ys: 'var(--red-600)', yb: 'var(--red-400)', yt: 'var(--red-900)', pa: '#3B5BDB', em: 'var(--tangerine-500)', sm: 'var(--amber-500)', yl: 'var(--red-200)',
};

/** Commandes ÷ personnes, en points ; null sous 10 personnes. */
export function clickConv(orders: number, people: number): number | null {
  return people >= MIN ? Math.min(100, (orders / people) * 100) : null;
}

function hourLabel(h: number, lang: string): string {
  if (lang !== 'en') return `${h} h`;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function clicksCsv(d: AnaClicks, T: T): { columns: string[]; rows: unknown[][] } {
  const { t } = T;
  const columns = [t('yc.tr.lk.col.link'), t('yc.ana.f.night'), t('yc.tr.lk.col.clicks'), t('yc.tr.lk.col.people'), t('yc.tr.lk.col.orders')];
  const rows = d.links.map((l) => [l.kind === 'e' && l.recipe ? t(`yc.au.r.${l.recipe}.name`) : l.label, l.event_title ?? '', l.clicks, l.people, l.orders]);
  return { columns, rows };
}

export interface CompareOption { id: string; title: string; start_at: string; state: NightState }

export function TrafficTab({ q, f, setF, goTab, nights }: {
  q: UseQueryResult<AnaClicks>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void; goTab: (k: AnaTab) => void; nights: CompareOption[];
}) {
  const d = q.data;
  if (!d) {
    return (
      <>
        <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={280} /><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)}</div>
      </>
    );
  }
  return d.meta.mode === 'event'
    ? <NightTraffic q={q} d={d} f={f} setF={setF} goTab={goTab} nights={nights} />
    : <PeriodTraffic q={q} d={d} f={f} setF={setF} goTab={goTab} />;
}

// ── Toutes les soirées ─────────────────────────────────────────────────────

function PeriodTraffic({ q, d, f, setF, goTab }: { q: UseQueryResult<AnaClicks>; d: AnaClicks; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void; goTab: (k: AnaTab) => void }) {
  const T = useCrmT();
  const { t, tp, n, pct } = T;
  const loading = q.isFetching && q.isPlaceholderData;
  const [unit, setUnit] = useState<'c' | 'p'>('c');
  const [hidden, setHidden] = useState<ClickFam[]>([]);
  const dataKey = `${f.period}:${q.dataUpdatedAt}`;
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${unit}:${hidden.join(',')}`, !loading);
  const prog = useProgress(1000, 0, `${dataKey}:${unit}`, !loading);
  const jl = jLabelFor(t);
  const m = d.meta;
  const tt = d.totals;

  const v = useMemo(() => {
    const used = CLICK_FAMS.filter((k) => (d.series ?? []).some((b) => b.c[k] > 0));
    const keys = used.length ? used : CLICK_FAMS;
    const series = keys.map((k) => ({ k, label: t(`yc.tr.fam.${k}`), c: CLICK_COLOR[k], v: (d.series ?? []).map((b) => Number(b[unit][k] ?? 0)) }));
    const perBucket = (d.series ?? []).map((b) => CLICK_FAMS.reduce((a, k) => a + Number(b.p[k] ?? 0), 0));
    return { series, perBucket };
  }, [d, unit, t]);

  const big = unit === 'c' ? tt.clicks : tt.people;
  const prevBig = unit === 'c' ? tt.prev_clicks : tt.prev_people;
  const dl = f.cmp ? deltaPct(big, prevBig, T) : null;
  const unitName = m.mode === 'hour' ? 'hour' : m.mode === 'month' ? 'month' : 'day';
  const marks = d.marks.filter((x) => x.i !== null && x.i >= 0 && x.i < m.n).map((x) => ({ i: x.i as number, title: `${t(`yc.tr.mark.${x.channel}`)} · ${x.name}` }));

  // Tuiles
  const peopleD = f.cmp ? deltaPct(tt.people, tt.prev_people, T) : null;
  const ig = tt.ig_known >= MIN ? (tt.ig_in / tt.ig_known) * 100 : null;
  const pig = tt.prev_ig_known >= MIN ? (tt.prev_ig_in / tt.prev_ig_known) * 100 : null;
  const sr = tt.visits >= MIN ? (tt.signups / tt.visits) * 100 : null;
  const psr = tt.prev_visits >= MIN ? (tt.prev_signups / tt.prev_visits) * 100 : null;
  const conv = clickConv(tt.orders, tt.people);
  const pconv = clickConv(tt.prev_orders, tt.prev_people);
  const pts = (a: number | null, b: number | null) => (f.cmp && a !== null && b !== null ? `${a - b >= 0 ? '▲' : '▼'} ${t('yc.ana.pts', { n: T.n1(Math.abs(a - b)) })} ${t('yc.ana.vsBefore')}` : undefined);
  const wait = !d.confirmed && tt.orders === 0;
  const tiles: TileSpec[] = [
    { kind: 'spark', label: t('yc.tr.t.people'), value: n(tt.people * prog), delta: peopleD ? `${peopleD.text} ${t('yc.ana.vsBefore')}` : undefined, dc: peopleD && !peopleD.up ? 'var(--red-600)' : undefined, cap: t('yc.tr.t.peopleCap'), values: v.perBucket },
    { kind: 'ring', label: t('yc.tr.t.inApp'), value: ig !== null ? pct(ig * prog) : '—', delta: ig !== null ? (pts(ig, pig) ?? t('yc.tr.t.inAppSub')) : undefined, dc: 'var(--sand-600)', cap: ig !== null ? t('yc.tr.t.inAppCap') : t('yc.tr.t.inAppFew'), ring: ig ?? 0 },
    { kind: 'ring', label: t('yc.tr.t.pages'), value: sr !== null ? pct(sr * prog) : '—', delta: pts(sr, psr), dc: sr !== null && psr !== null && sr < psr ? 'var(--red-600)' : undefined, cap: tt.visits > 0 ? t('yc.tr.t.pagesCap', { s: n(tt.signups), v: n(tt.visits) }) : t('yc.tr.t.pagesNone'), ring: sr ?? 0 },
    { kind: 'hb', label: t('yc.tr.t.conv'), value: wait || conv === null ? '—' : pct(conv * prog, 1), delta: wait ? undefined : pts(conv, pconv), dc: conv !== null && pconv !== null && conv < pconv ? 'var(--red-600)' : undefined, cap: wait ? t('yc.tr.t.convWait') : conv === null ? t('yc.tr.t.convFew') : t('yc.tr.t.convCap', { o: n(tt.orders), p: n(tt.people) }), hb: Math.min(100, (conv ?? 0) * 5), hbL: '' },
  ];

  return (
    <>
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <CardHead
          title={t('yc.tr.heroT')}
          sub={t('yc.tr.heroSub', { unit: t(`yc.ana.unit.${unitName}`) })}
          right={<Segmented value={unit} onChange={(x) => setUnit(x)} ariaLabel={t('yc.tr.heroT')} options={[{ value: 'c', label: t('yc.tr.clicks') }, { value: 'p', label: t('yc.tr.people') }]} />}
        />
        {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,104px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(big * prog)}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                <span style={{ fontSize: 15, color: 'var(--sand-600)' }}>{unit === 'c' ? t('yc.tr.big', { per: t(`yc.tr.per.${m.period}`), p: n(tt.people) }) : t('yc.tr.bigP', { per: t(`yc.tr.per.${m.period}`), c: n(tt.clicks) })}</span>
                {f.cmp && (dl
                  ? <span style={{ fontSize: 14, fontWeight: 600, color: dl.up ? 'var(--green-700)' : 'var(--red-600)' }}>{dl.text} {t(`yc.ana.per.vs.${m.period}`)}</span>
                  : <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sand-500)' }}>{t('yc.ana.noPrev')}</span>)}
              </span>
            </div>
            {tt.clicks === 0 ? <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-500)', maxWidth: 680 }}>{t('yc.tr.empty')}</p> : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {v.series.map((s) => {
                    const on = !hidden.includes(s.k);
                    return (
                      <Hv
                        key={s.k}
                        as="button"
                        type="button"
                        aria-pressed={on}
                        title={t('yc.ana.t.toggle')}
                        onClick={() => { if (on && v.series.length - hidden.length <= 1) return; setHidden((h) => (on ? [...h, s.k] : h.filter((x) => x !== s.k))); }}
                        style={{ height: 32, padding: '0 12px 0 10px', borderRadius: 99, border: '1px solid var(--sand-200)', background: on ? '#fff' : 'transparent', color: on ? 'var(--ink)' : 'var(--sand-400)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                        hover={{ borderColor: 'var(--sand-400)' }}
                      >
                        <i style={{ width: 10, height: 10, borderRadius: 3, background: on ? s.c : 'transparent', boxShadow: `inset 0 0 0 1.5px ${s.c}`, display: 'inline-block' }} />{s.label}
                      </Hv>
                    );
                  })}
                </div>
                <StackChart
                  series={v.series}
                  hidden={hidden}
                  focus={null}
                  marks={marks}
                  go={go}
                  fy={n}
                  tipTitle={(i) => bucketTitle(m, i, T, jl)}
                  tipValue={(x) => (unit === 'c' ? tp('yc.tr.nClicks', x, { n: n(x) }) : tp('yc.tr.nPeople', x, { n: n(x) }))}
                  xl={xLabels(m, T, jl)}
                />
              </>
            )}
          </div>
        )}
      </section>

      <Keep d={d} rv={rv} T={T} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      <LinksCard d={d} rv={rv} go={go} T={T} night={false} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <PagesCard d={d} rv={rv} go={go} T={T} />
        <MessagesCard d={d} rv={rv} T={T} />
      </div>

      <HeatCard d={d} rv={rv} go={go} T={T} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <DevicesCard d={d} rv={rv} go={go} T={T} />
        <PlatformCard d={d} rv={rv} go={go} T={T} />
      </div>

      <NightsCard d={d} rv={rv} go={go} T={T} onPick={(id) => setF({ event: id })} />

      <ShotgunSoonCard items={['visits', 'conv', 'carts', 'page']} style={fadeIn(rv, 200)} />

      <Bridge d={d} T={T} night={false} onGo={() => goTab('sales')} />
    </>
  );
}

// ── Une soirée ──────────────────────────────────────────────────────────────

function NightTraffic({ q, d, f, setF, goTab, nights }: {
  q: UseQueryResult<AnaClicks>; d: AnaClicks; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void; goTab: (k: AnaTab) => void; nights: CompareOption[];
}) {
  const T = useCrmT();
  const { t, n, pct, dShort } = T;
  const loading = q.isFetching && q.isPlaceholderData;
  const dataKey = `${f.event}:${f.compare ?? ''}:${q.dataUpdatedAt}`;
  const rv = useGo(dataKey, !loading);
  const go = useGo(dataKey, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);
  const jl = jLabelFor(t);
  const ev = d.meta.event!;
  const cmp = d.meta.prev_event;
  const tt = d.totals;
  const cv = d.curve!;
  const span = cv.span;
  const todayD = cv.today_d;
  const idx = (dd: number) => span - dd;
  const curAt = todayD !== null ? cv.cur[idx(todayD)] ?? tt.clicks : tt.clicks;
  const prevAt = cv.prev ? (todayD !== null ? cv.prev[idx(todayD)] : cv.prev[span]) : null;
  const dl = cmp && prevAt !== null ? deltaPct(Number(curAt ?? 0), Number(prevAt), T) : null;
  const jNow = todayD !== null ? jl(todayD) : null;
  const top = Math.max(10, ...cv.cur.map((x) => Number(x ?? 0)), ...(cv.prev ?? []).map(Number)) * 1.08;
  const xl = [0, 0.25, 0.5, 0.75, 1].map((r) => jl(Math.round(span - r * span)));
  const marks = d.marks.filter((x) => x.d !== null && x.d >= 0 && x.d <= span);
  const state: NightState = ev.upcoming ? 'presale' : 'past';

  const peopleD = cmp ? deltaPct(tt.people, tt.prev_people, T) : null;
  const sr = tt.visits >= MIN ? (tt.signups / tt.visits) * 100 : null;
  const conv = clickConv(tt.orders, tt.people);
  const pconv = clickConv(tt.prev_orders, tt.prev_people);
  const wait = !d.confirmed && tt.orders === 0;
  const vsT = cmp ? t('yc.tr.vsCmp', { title: dShort(cmp.start_at) }) : '';
  const tiles: TileSpec[] = [
    { kind: 'spark', label: t('yc.tr.t.people'), value: n(tt.people * prog), delta: peopleD ? `${peopleD.text} ${vsT}` : undefined, dc: peopleD && !peopleD.up ? 'var(--red-600)' : undefined, cap: t('yc.tr.t.peopleCap'), values: d.hours },
    { kind: 'ring', label: t('yc.tr.t.signups'), value: n(tt.signups * prog), delta: sr !== null ? t('yc.tr.t.signupsSub', { pct: pct(sr), v: n(tt.visits) }) : undefined, dc: 'var(--sand-600)', cap: d.pages.length ? t('yc.tr.t.signupsCap') : t('yc.tr.t.signupsNone'), ring: sr ?? 0 },
    { kind: 'hb', label: t('yc.tr.t.conv'), value: wait || conv === null ? '—' : pct(conv * prog, 1), delta: !wait && conv !== null && pconv !== null ? `${conv - pconv >= 0 ? '▲' : '▼'} ${t('yc.ana.pts', { n: T.n1(Math.abs(conv - pconv)) })} ${vsT}` : undefined, dc: conv !== null && pconv !== null && conv < pconv ? 'var(--red-600)' : undefined, cap: wait ? t('yc.tr.t.convWait') : conv === null ? t('yc.tr.t.convFew') : t('yc.tr.t.convCap', { o: n(tt.orders), p: n(tt.people) }), hb: Math.min(100, (conv ?? 0) * 5), hbL: '' },
    { kind: 'hb', label: t('yc.tr.t.cnb'), value: n(d.click_no_buy * prog), delta: t('yc.tr.t.cnbSub'), dc: 'var(--sand-600)', cap: t('yc.tr.t.cnbCap'), hb: tt.people > 0 ? Math.min(100, (d.click_no_buy / tt.people) * 100) : 0, hbL: '' },
  ];

  const lines = [
    ...(cv.prev ? [{ name: cmp ? `${cmp.title} · ${dShort(cmp.start_at)}` : '', c: 'var(--sand-400)', w: 2, dash: '6 6', vals: cv.prev.map(Number) as (number | null)[] }] : []),
    { name: `${ev.title} · ${dShort(ev.start_at)}`, c: 'var(--red-500)', w: 3, dash: '', vals: cv.cur },
  ];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <StatePill state={state} label={ev.upcoming ? t('yc.tr.ev.upcoming', { j: jl(ev.days_left ?? 0) }) : t('yc.tr.ev.past')} />
        <ComparePicker nights={nights} ev={ev.id} value={f.compare ?? null} auto={cmp} onChange={(id) => setF({ compare: id })} T={T} />
        <span style={{ flex: 1 }} />
        <Hv as="button" type="button" onClick={() => setF({ event: null })} style={{ height: 34, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--sand-700)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-400)' }}>
          {t('yc.tr.ev.all')}
        </Hv>
      </div>

      <section style={{ ...card, gap: 20, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <CardHead title={t('yc.tr.ev.heroT')} sub={t('yc.tr.ev.heroSub')} />
        {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,104px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(Number(curAt ?? 0) * prog)}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                <span style={{ fontSize: 15, color: 'var(--sand-600)' }}>{jNow ? t('yc.tr.ev.big', { j: jNow, p: n(tt.people) }) : t('yc.tr.ev.bigPast', { p: n(tt.people) })}</span>
                {cmp && dl ? (
                  <span style={{ fontSize: 14, fontWeight: 600, color: dl.up ? 'var(--green-700)' : 'var(--red-600)' }}>
                    {jNow ? t('yc.tr.ev.delta', { d: dl.text, title: `${cmp.title} · ${dShort(cmp.start_at)}`, j: jNow, n: n(Number(prevAt)) }) : t('yc.tr.ev.deltaPast', { d: dl.text, title: `${cmp.title} · ${dShort(cmp.start_at)}`, n: n(Number(prevAt)) })}
                  </span>
                ) : !cmp ? <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sand-500)' }}>{t('yc.tr.ev.noCmp')}</span> : null}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', fontSize: 13, color: 'var(--sand-700)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 18, height: 3, borderRadius: 2, background: 'var(--red-500)', display: 'inline-block' }} />{ev.title} · {dShort(ev.start_at)}</span>
              {cmp && cv.prev && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 18, height: 0, borderTop: '2px dashed var(--sand-400)', display: 'inline-block' }} />{cmp.title} · {dShort(cmp.start_at)}</span>}
            </div>
            <div style={{ position: 'relative', paddingTop: marks.length ? 78 : 0 }}>
              {marks.length > 0 && (
                <div style={{ position: 'absolute', left: 50, right: 0, top: 0, bottom: 34, pointerEvents: 'none' }}>
                  {marks.map((mk, k) => (
                    <div key={k} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((idx(mk.d as number) / span) * 100).toFixed(2)}%`, borderLeft: '1px dashed var(--sand-300)', opacity: go ? 1 : 0, transition: go ? `opacity 400ms ease ${700 + k * 80}ms` : 'none' }}>
                      <span title={mk.name} style={{ position: 'absolute', top: (k % 3) * 24, left: -1, transform: `translateX(${idx(mk.d as number) / span > 0.8 ? '-100%' : idx(mk.d as number) / span < 0.1 ? '0' : '-50%'})`, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <i style={{ flex: 'none', width: 6, height: 6, borderRadius: 99, background: mk.channel === 'email' ? 'var(--tangerine-500)' : mk.channel === 'sms' ? 'var(--amber-500)' : mk.channel === 'page' ? '#3B5BDB' : 'var(--red-500)' }} />{mk.channel === 'page' ? t('yc.tr.mark.page') : mk.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <MultiLine lines={lines} top={top} go={go} fy={n} height={260} xl={xl}
                tipTitle={(i) => jl(span - i)}
                tipValue={(x) => T.tp('yc.tr.nClicks', x, { n: n(x) })}
              />
            </div>
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      <LinksCard d={d} rv={rv} go={go} T={T} night />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <PresaleCard d={d} rv={rv} go={go} T={T} />
        <HoursCard d={d} rv={rv} go={go} T={T} />
      </div>

      <ShotgunSoonCard items={['visits', 'carts', 'conv']} style={fadeIn(rv, 200)} />

      <Bridge d={d} T={T} night onGo={() => goTab('sales')} />
    </>
  );
}

function ComparePicker({ nights, ev, value, auto, onChange, T }: {
  nights: CompareOption[]; ev: string; value: string | null; auto: AnaClicks['meta']['prev_event']; onChange: (id: string | null) => void; T: T;
}) {
  const { t, dShort } = T;
  const opts = nights.filter((x) => x.id !== ev);
  return (
    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px 0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)', maxWidth: 'min(460px, calc(100vw - 32px))' }}>
      <span style={{ flex: 'none' }}>{t('yc.tr.ev.cmp')} :</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>
        {auto ? `${auto.title} (${dShort(auto.start_at)})` : t('yc.tr.ev.cmpNone')}
      </span>
      <Icon name="chevronDown" size={14} stroke={2.4} color="var(--sand-400)" />
      <select
        aria-label={t('yc.tr.ev.cmp')}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
      >
        <option value="">{t('yc.tr.ev.cmpAuto')}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.title} · {dShort(o.start_at)}</option>)}
      </select>
    </label>
  );
}

// ── Blocs ──────────────────────────────────────────────────────────────────

function Keep({ d, rv, T }: { d: AnaClicks; rv: boolean; T: T }) {
  const { t, n, pct, lang, locale } = T;
  if (!d.keep.length) return null;
  const colorOf = (k: string) => (k === 'partner' ? '#3B5BDB' : k === 'emailConv' ? 'var(--tangerine-500)' : k === 'peak' ? 'var(--amber-500)' : 'var(--red-600)');
  const text = (x: AnaClicks['keep'][number]): [string, string] => {
    if (x.k === 'top') return [t('yc.tr.tk.top.t', { fam: t(`yc.tr.fam.${x.fam}`), pct: pct(x.pct) }), t('yc.tr.tk.top.s', { n: n(d.totals.clicks) })];
    if (x.k === 'emailConv') {
      const r = x.links > 0 ? x.em / x.links : 1;
      return [r >= 1.15 ? t('yc.tr.tk.emailConv.t', { x: T.n1(r) }) : t('yc.tr.tk.emailConv.tSame'), t('yc.tr.tk.emailConv.s', { em: pct(x.em, 1), links: pct(x.links, 1) })];
    }
    if (x.k === 'partner') return [t('yc.tr.tk.partner.t', { name: x.name, p: n(x.people) }), t('yc.tr.tk.partner.s', { o: n(x.orders) })];
    if (x.k === 'inApp') return [t('yc.tr.tk.inApp.t', { pct: pct(x.pct) }), t('yc.tr.tk.inApp.s')];
    return [t('yc.tr.tk.peak.t', { day: DAYS_REF[x.dow].toLocaleDateString(locale, { weekday: 'long' }), hour: hourLabel(x.hour, lang) }), t('yc.tr.tk.peak.s')];
  };
  return (
    <section aria-label={t('yc.tr.keepT')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 12, ...fadeIn(rv, 100) }}>
      {d.keep.map((x, i) => {
        const [a, b] = text(x);
        return (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 18, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
            <span style={{ flex: 'none', width: 4, borderRadius: 99, background: colorOf(x.k) }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <b style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, textWrap: 'pretty' }}>{a}</b>
              <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-600)' }}>{b}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function linkKind(l: AnaClickLink, t: T['t']): string {
  if (l.kind === 'e') return l.recipe ? t('yc.tr.kind.recipe') : t('yc.tr.kind.em');
  if (l.placement === 'page') return t('yc.tr.kind.page');
  return t(`yc.tr.kind.${l.fam}`);
}

function LinksCard({ d, rv, go, T, night }: { d: AnaClicks; rv: boolean; go: boolean; T: T; night: boolean }) {
  const { t, n, pct, dShort, locale, lang } = T;
  const rows = d.links;
  const max = Math.max(1, ...rows.map((l) => l.clicks));
  const grid = night
    ? 'minmax(220px,1.8fr) minmax(130px,1fr) 90px 96px 104px 110px'
    : 'minmax(220px,1.8fr) minmax(130px,1fr) 90px 118px 116px 104px 110px';
  const mono = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'var(--sand-500)' };
  const initials = (l: AnaClickLink) => (l.kind === 'e' ? 'EM' : l.fam === 'sm' ? 'SM' : l.placement === 'page' ? 'PG' : (l.label || l.code || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'YU');
  return (
    <section style={{ ...card, gap: 16 }}>
      <CardHead title={t(night ? 'yc.tr.lk.tEv' : 'yc.tr.lk.t')} sub={t(night ? 'yc.tr.lk.sEv' : 'yc.tr.lk.s')} />
      {rows.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-500)' }}>{t(night ? 'yc.tr.lk.emptyEv' : 'yc.tr.lk.empty')}</p> : (
        <div className="yc-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 140) }}>
          <div style={{ minWidth: night ? 780 : 900, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '0 8px 8px', ...mono }}>
              <span>{t('yc.tr.lk.col.link')}</span><span>{t('yc.tr.lk.col.clicks')}</span><span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.people')}</span>
              {night ? <span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.created')}</span> : <><span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.ig')}</span><span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.peak')}</span></>}
              <span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.orders')}</span><span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.conv')}</span>
            </div>
            {rows.map((l, i) => {
              const pend = l.kind === 'l' && !d.confirmed && l.orders === 0;
              // Un e-mail n'a de commandes rattachées que s'il porte sa source
              // `yuno-m-<campagne>` ; sans, « — » (son CA attribué est dans Ventes).
              const unk = l.kind === 'e' && l.orders === 0;
              const cv = pend || unk ? null : clickConv(l.orders, l.people);
              const ig = l.kind === 'l' && (l.fam === 'ys' || l.fam === 'yb' || l.fam === 'pa' || l.fam === 'yl') && l.ua_known >= MIN ? (l.ig / l.ua_known) * 100 : null;
              const peak = l.peak_dow !== null && l.peak_hour !== null ? `${new Date(2024, 0, 1 + l.peak_dow).toLocaleDateString(locale, { weekday: 'short' })} ${hourLabel(l.peak_hour, lang)}` : '—';
              const color = l.kind === 'e' ? CLICK_COLOR.em : l.placement === 'page' ? 'var(--red-900)' : CLICK_COLOR[l.fam];
              const label = l.kind === 'e' && l.recipe ? t(`yc.au.r.${l.recipe}.name`) : l.fam === 'sm' && /^sms$/i.test(l.label) ? t('yc.tr.fam.sm') : l.placement === 'page' ? t('yc.tr.mark.page') : l.label;
              return (
                <div key={`${l.kind}:${l.id}`} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '11px 8px', borderTop: '1px solid var(--sand-100)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 10, background: color, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: '#fff' }}>{initials(l)}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</b>
                      <span style={{ fontSize: 12, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{night ? linkKind(l, t) : `${l.event_title ?? t('yc.tr.allNights')} · ${linkKind(l, t)}`}</span>
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><b style={{ width: 44 }}>{n(l.clicks)}</b><span style={{ flex: 1 }}><Fill pct={(l.clicks / max) * 100} go={go} delay={i * 50} h={8} bg={color} dur={800} /></span></span>
                  <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{n(l.people)}</span>
                  {night
                    ? <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{l.created_at ? dShort(l.created_at) : '—'}</span>
                    : <><span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{ig !== null ? pct(ig) : '—'}</span><span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{peak}</span></>}
                  <span style={{ textAlign: 'right', color: pend || unk ? 'var(--sand-500)' : 'var(--sand-700)' }}>{pend ? t('yc.tr.lk.pending') : unk ? '—' : n(l.orders)}</span>
                  <b style={{ textAlign: 'right', color: cv !== null && cv >= 8 ? 'var(--green-700)' : 'var(--ink)' }}>{cv !== null ? pct(cv, 1) : '—'}</b>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!night && d.links_total > rows.length && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.tr.lk.more', { n: n(d.links_total - rows.length) })}</span>}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--sand-500)' }}>{t('yc.tr.lk.foot')}</span>
    </section>
  );
}

function PagesCard({ d, rv, go, T }: { d: AnaClicks; rv: boolean; go: boolean; T: T }) {
  const { t, n, pct } = T;
  const pages = d.pages.filter((p) => p.visits > 0 || p.signups > 0).slice(0, 4);
  const srcs = d.page_srcs.slice(0, 6);
  const sMax = Math.max(1, ...srcs.map((s) => s.visits));
  const rate = (s: number, v: number) => (v >= MIN ? pct((s / v) * 100) : '—');
  const srcLabel = (s: string) => {
    const k = `yc.tr.psrc.${s}`;
    const l = t(k);
    return l === k ? t('yc.tr.psrc.other') : l;
  };
  return (
    <section style={{ ...card, flex: '1 1 460px', gap: 16 }}>
      <CardHead title={t('yc.tr.pg.t')} sub={t('yc.tr.pg.s')} />
      {pages.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.tr.pg.empty')}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, ...fadeIn(rv, 160) }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pages.map((p) => {
              const r = p.visits >= MIN ? (p.signups / p.visits) * 100 : null;
              return (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px,1.5fr) 72px 72px minmax(100px,1fr)', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 16, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</b>
                    <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t(`yc.tr.pg.kind.${p.kind}`)} · {t(`yc.tr.pg.status.${p.status}`)}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}><b>{n(p.visits)}</b><span style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{t('yc.tr.pg.visits')}</span></span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}><b>{n(p.signups)}</b><span style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{t('yc.tr.pg.signups')}</span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ flex: 1 }}><Fill pct={Math.min(100, (r ?? 0) * 2.5)} go={go} h={8} dur={800} /></span><b style={{ width: 40, textAlign: 'right' }}>{r !== null ? pct(r) : '—'}</b></span>
                </div>
              );
            })}
          </div>
          {srcs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.tr.pg.bySrc')}</span>
              {srcs.map((s, i) => (
                <div key={s.src} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,140px) minmax(0,1fr) 48px 44px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{srcLabel(s.src)}</span>
                  <Fill pct={(s.visits / sMax) * 100} go={go} delay={i * 60} h={8} bg="var(--red-300)" dur={800} />
                  <b style={{ textAlign: 'right' }}>{n(s.visits)}</b>
                  <span style={{ textAlign: 'right', color: 'var(--sand-500)', fontSize: 13 }}>{rate(s.signups, s.visits)}</span>
                </div>
              ))}
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.tr.pg.foot')}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MessagesCard({ d, rv, T }: { d: AnaClicks; rv: boolean; T: T }) {
  const { t, tp, n, pct, dShort } = T;
  const msg = d.messages;
  const ofSent = (c: number, s: number) => (s >= MIN ? t('yc.tr.msg.of', { pct: pct((c / s) * 100, 1), n: n(s) }) : t('yc.tr.msg.ofNone', { n: n(s) }));
  const rows = msg.rows.slice(0, 5);
  const box = { display: 'flex', flexDirection: 'column' as const, gap: 4, padding: '14px 16px', borderRadius: 18, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', minWidth: 0 };
  return (
    <section style={{ ...card, flex: '1 1 420px', gap: 16 }}>
      <CardHead title={t('yc.tr.msg.t')} sub={t('yc.tr.msg.s')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, ...fadeIn(rv, 160) }}>
        <div style={box}><span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t('yc.tr.msg.email')}</span><b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 32, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(msg.email.clickers)}</b><span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{ofSent(msg.email.clickers, msg.email.sent)}</span></div>
        <div style={box}><span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t('yc.tr.msg.sms')}</span><b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 32, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(msg.sms.clickers)}</b><span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{ofSent(msg.sms.clickers, msg.sms.sent)}</span></div>
      </div>
      {rows.length === 0 ? <p style={{ margin: 0, fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.tr.msg.empty')}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r, i) => {
            const sub = r.kind === 'recipe' ? tp('yc.tr.msg.recipe', Number(r.nights ?? 0), { n: n(Number(r.nights ?? 0)) })
              : r.kind === 'sms' ? t('yc.tr.msg.smsRow', { date: r.at ? dShort(r.at) : '—', n: n(r.sent) })
                : t('yc.tr.msg.camp', { date: r.at ? dShort(r.at) : '—', n: n(r.sent) });
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 72px 60px', gap: 12, alignItems: 'center', padding: '10px 2px', borderTop: '1px solid var(--sand-100)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.kind === 'recipe' ? t(`yc.au.r.${r.name}.name`) : r.name}</b>
                  <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{sub}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}><b>{n(r.clickers)}</b><span style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{t('yc.tr.msg.clickers')}</span></span>
                <b style={{ textAlign: 'right' }}>{r.sent >= MIN ? pct((r.clickers / r.sent) * 100, 1) : '—'}</b>
              </div>
            );
          })}
        </div>
      )}
      {d.click_no_buy > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-100)', marginTop: 'auto' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 220px' }}>
            <b style={{ fontSize: 14.5 }}>{tp('yc.tr.cnb.t', d.click_no_buy, { n: n(d.click_no_buy) })}</b>
            <span style={{ fontSize: 12.5, color: 'var(--sand-600)', lineHeight: 1.4 }}>{t('yc.tr.cnb.s')}</span>
          </span>
          <Hv as={Link} to={CRM_ROUTES.automations} style={{ flex: 'none', height: 34, padding: '0 14px', borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-400)', textDecoration: 'none' }}>
            {t('yc.tr.cnb.cta')}
          </Hv>
        </div>
      )}
      {msg.sms.clickers > 0 && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.tr.msg.smsFoot')}</span>}
    </section>
  );
}

function HeatCard({ d, rv, go, T }: { d: AnaClicks; rv: boolean; go: boolean; T: T }) {
  const { t, n, locale, lang } = T;
  const [hov, setHov] = useState<[number, number] | null>(null);
  const cells = d.heat;
  const max = Math.max(1, ...cells.flat());
  let best: [number, number] = [0, 0];
  cells.forEach((row, r) => row.forEach((v, h) => { if (v > cells[best[0]][best[1]]) best = [r, h]; }));
  const any = cells.flat().some((x) => x > 0);
  const day = (r: number, len: 'long' | 'short') => DAYS_REF[r].toLocaleDateString(locale, { weekday: len });
  const sel = hov ?? best;
  return (
    <section style={{ ...card, gap: 16 }}>
      <CardHead title={t('yc.tr.heat.t')} sub={`${t('yc.tr.heat.s')}${any ? ` ${t('yc.tr.heat.peak', { day: day(best[0], 'long'), hour: hourLabel(best[1], lang) })}` : ''}`} />
      <div className="yc-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 160) }}>
        <div onMouseLeave={() => setHov(null)} style={{ minWidth: 720, display: 'grid', gridTemplateColumns: '44px repeat(24,minmax(0,1fr))', gap: 3, alignItems: 'center' }}>
          {cells.map((row, r) => [
            <span key={`l${r}`} style={{ fontSize: 12, color: 'var(--sand-600)', textTransform: 'capitalize' }}>{day(r, 'short')}</span>,
            ...row.map((v, h) => {
              const a = v / max;
              const on = sel[0] === r && sel[1] === h;
              return <div key={`${r}-${h}`} onMouseEnter={() => setHov([r, h])} title={t('yc.tr.heat.cell', { day: day(r, 'long'), hour: hourLabel(h, lang), n: n(v) })} style={{ height: 26, borderRadius: 6, background: `color-mix(in oklab, #E3141B ${Math.round(5 + a * 90)}%, #FFF2F1)`, opacity: go ? 1 : 0, transition: go ? `opacity 500ms ${EASE} ${(r + h) * 12}ms` : 'none', boxShadow: on && any ? '0 0 0 2px var(--ink)' : 'none', cursor: 'crosshair' }} />;
            }),
          ])}
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textAlign: 'center', color: 'var(--sand-500)' }}>{h % 3 === 0 ? hourLabel(h, lang) : ''}</span>)}
        </div>
      </div>
      {any && (
        <div style={{ padding: '10px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {t('yc.tr.heat.cell', { day: day(sel[0], 'long'), hour: hourLabel(sel[1], lang), n: T.tp('yc.tr.nClicks', cells[sel[0]][sel[1]], { n: n(cells[sel[0]][sel[1]]) }) })}
        </div>
      )}
    </section>
  );
}

function useCountryName(locale: string) {
  return useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try { dn = new Intl.DisplayNames([locale], { type: 'region' }); } catch { dn = null; }
    return (cc: string) => { try { return dn?.of(cc.toUpperCase()) ?? cc; } catch { return cc; } };
  }, [locale]);
}

function DevicesCard({ d, rv, go, T }: { d: AnaClicks; rv: boolean; go: boolean; T: T }) {
  const { t, pct, locale } = T;
  const cname = useCountryName(locale);
  const dv = d.devices;
  const known = Number(dv.known);
  const parts = ([['mobile', 'var(--red-500)'], ['desktop', 'var(--ink)'], ['tablet', 'var(--sand-300)']] as const).map(([k, c]) => ({ k, c, v: Number(dv[k]) }));
  const cTot = d.countries.reduce((a, c) => a + Number(c.n), 0);
  const top = d.countries.slice(0, 3);
  const rest = cTot - top.reduce((a, c) => a + Number(c.n), 0);
  const cRows = [...top.map((c) => ({ l: cname(c.cc), v: Number(c.n) })), ...(rest > 0 ? [{ l: t('yc.tr.dev.others'), v: rest }] : [])];
  return (
    <section style={{ ...card, flex: '1 1 420px', gap: 16 }}>
      <CardHead title={t('yc.tr.dev.t')} sub={t('yc.tr.dev.s')} />
      {known < MIN ? <p style={{ margin: 0, fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.tr.dev.few')}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, ...fadeIn(rv, 160) }}>
          <div style={{ display: 'flex', height: 14, gap: 2, borderRadius: 99, overflow: 'hidden', clipPath: `inset(0 ${go ? '0%' : '101%'} 0 0)`, transition: go ? `clip-path 1000ms ${EASE}` : 'none' }}>
            {parts.filter((p) => p.v > 0).map((p) => <div key={p.k} style={{ width: `${(p.v / known) * 100}%`, background: p.c }} />)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13.5, color: 'var(--sand-700)' }}>
            {parts.filter((p) => p.v > 0).map((p) => <span key={p.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: p.c }} />{t(`yc.tr.dev.${p.k}`)} <b>{pct((p.v / known) * 100)}</b></span>)}
          </div>
          {cTot >= MIN && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 12, borderTop: '1px solid var(--sand-100)' }}>
              {cRows.map((c, i) => (
                <div key={c.l} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,130px) minmax(0,1fr) 48px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.l}</span>
                  <Fill pct={(c.v / cTot) * 100} go={go} delay={i * 60} h={8} bg="var(--red-300)" dur={800} />
                  <b style={{ textAlign: 'right' }}>{pct((c.v / cTot) * 100)}</b>
                </div>
              ))}
            </div>
          )}
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.tr.dev.foot')}</span>
        </div>
      )}
    </section>
  );
}

function PlatformCard({ d, rv, go, T }: { d: AnaClicks; rv: boolean; go: boolean; T: T }) {
  const { t, pct } = T;
  const a = d.platform.all;
  const tot = Number(a.app) + Number(a.website) + Number(a.other);
  const y = d.platform.yuno;
  const ytot = Number(y.app) + Number(y.website);
  const parts = ([['app', 'var(--ink)'], ['website', 'var(--red-500)'], ['other', 'var(--sand-300)']] as const).map(([k, c]) => ({ k, c, v: Number(a[k]) }));
  return (
    <section style={{ ...card, flex: '1 1 420px', gap: 16 }}>
      <CardHead title={t('yc.tr.pl.t')} sub={t('yc.tr.pl.s')} />
      {tot < MIN ? <p style={{ margin: 0, fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.tr.pl.empty')}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...fadeIn(rv, 180) }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 52, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{pct((Number(a.app) / tot) * 100)}</span>
            <span style={{ fontSize: 14, color: 'var(--sand-500)', paddingBottom: 6 }}>{t('yc.tr.pl.big')}</span>
          </div>
          <div style={{ display: 'flex', height: 14, gap: 2, borderRadius: 99, overflow: 'hidden', clipPath: `inset(0 ${go ? '0%' : '101%'} 0 0)`, transition: go ? `clip-path 1000ms ${EASE}` : 'none' }}>
            {parts.filter((p) => p.v > 0).map((p) => <div key={p.k} style={{ width: `${(p.v / tot) * 100}%`, background: p.c }} />)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            {parts.filter((p) => p.v > 0).map((p) => (
              <span key={p.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--sand-700)' }}><i style={{ width: 10, height: 10, borderRadius: 3, background: p.c }} />{t(`yc.tr.pl.${p.k}`)}</span><b>{pct((p.v / tot) * 100)}</b></span>
            ))}
          </div>
          {ytot >= MIN && (
            <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-700)' }}>
              {t('yc.tr.pl.yuno', { app: pct((Number(y.app) / ytot) * 100), web: pct((Number(y.website) / ytot) * 100) })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function NightsCard({ d, rv, go, T, onPick }: { d: AnaClicks; rv: boolean; go: boolean; T: T; onPick: (id: string) => void }) {
  const { t, n, pct, dShort } = T;
  const rows = d.nights;
  const max = Math.max(1, ...rows.map((e) => e.clicks));
  const grid = 'minmax(220px,1.6fr) minmax(150px,1.2fr) 90px 90px 110px 100px';
  return (
    <section style={{ ...card, gap: 16 }}>
      <CardHead title={t('yc.tr.ev.t')} sub={t('yc.tr.ev.s')} />
      {rows.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.tr.ev.empty')}</p> : (
        <div className="yc-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 160) }}>
          <div style={{ minWidth: 800, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '0 10px 8px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
              <span>{t('yc.ana.col.night')}</span><span>{t('yc.tr.lk.col.clicks')}</span><span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.people')}</span><span style={{ textAlign: 'right' }}>{t('yc.tr.ev.col.links')}</span><span style={{ textAlign: 'right' }}>{t('yc.tr.ev.col.signups')}</span><span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.conv')}</span>
            </div>
            {rows.map((e, i) => {
              const cv = clickConv(e.orders, e.people);
              return (
                <Hv
                  key={e.id}
                  as="button"
                  type="button"
                  onClick={() => onPick(e.id)}
                  style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '11px 10px', border: 0, borderTop: '1px solid var(--sand-100)', background: 'transparent', textAlign: 'left', fontSize: 14, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', cursor: 'pointer', borderRadius: 12 }}
                  hover={{ background: 'var(--sand-50)' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</b><span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{dShort(e.start_at)}</span></span>
                    <StatePill state={e.state} label={t(`yc.ana.state.${e.state}`)} />
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><b style={{ width: 48 }}>{n(e.clicks)}</b><span style={{ flex: 1 }}><Fill pct={(e.clicks / max) * 100} go={go} delay={i * 60} h={8} dur={800} /></span></span>
                  <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{n(e.people)}</span>
                  <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{n(e.links)}</span>
                  <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{e.signups > 0 ? n(e.signups) : '—'}</span>
                  <b style={{ textAlign: 'right' }}>{!d.confirmed && e.orders === 0 ? '—' : cv !== null ? pct(cv, 1) : '—'}</b>
                </Hv>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function PresaleCard({ d, rv, go, T }: { d: AnaClicks; rv: boolean; go: boolean; T: T }) {
  const { t, n, pct } = T;
  const evId = d.meta.event?.id;
  const ps = d.pages.filter((p) => p.event_id === evId);
  const sum = (k: 'visits' | 'signups' | 'confirmed' | 'took') => ps.reduce((a, p) => a + Number(p[k]), 0);
  const steps: [string, number][] = [['saw', sum('visits')], ['signed', sum('signups')], ['confirmed', sum('confirmed')], ['took', sum('took')]];
  const base = steps[0][1];
  return (
    <section style={{ ...card, flex: '1 1 440px', gap: 16 }}>
      <CardHead title={t('yc.tr.pre.t')} sub={t('yc.tr.pre.s')} />
      {ps.length === 0 ? <p style={{ margin: 0, fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.tr.t.signupsNone')}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...fadeIn(rv, 160) }}>
          {steps.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: 'var(--sand-700)' }}>{t(`yc.tr.pre.${k}`)}</span>
                <span><b>{n(v)}</b>{base >= MIN && <span style={{ color: 'var(--sand-500)' }}> · {pct((v / base) * 100)}</span>}</span>
              </div>
              <Fill pct={base > 0 ? Math.max(2, (v / base) * 100) : 0} go={go} delay={i * 90} h={12} bg={i === steps.length - 1 ? 'var(--gradient-brand)' : 'rgba(227,20,27,.35)'} dur={900} />
            </div>
          ))}
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.tr.pre.foot')}</span>
        </div>
      )}
    </section>
  );
}

function HoursCard({ d, rv, go, T }: { d: AnaClicks; rv: boolean; go: boolean; T: T }) {
  const { t, pct, lang, locale } = T;
  const cname = useCountryName(locale);
  const hrs = d.hours.map(Number);
  const max = Math.max(1, ...hrs);
  // Le pic : la fenêtre de deux heures la plus chargée.
  let bh = 0;
  hrs.forEach((_, h) => { if (hrs[h] + hrs[(h + 1) % 24] > hrs[bh] + hrs[(bh + 1) % 24]) bh = h; });
  const any = hrs.some((x) => x > 0);
  const dv = d.devices;
  const known = Number(dv.known);
  const cTot = d.countries.reduce((a, c) => a + Number(c.n), 0);
  const line = [
    known >= MIN ? `${t('yc.tr.dev.mobile')} ${pct((Number(dv.mobile) / known) * 100)}` : null,
    ...(cTot >= MIN ? d.countries.slice(0, 2).map((c) => `${cname(c.cc)} ${pct((Number(c.n) / cTot) * 100)}`) : []),
  ].filter(Boolean).join(' · ');
  return (
    <section style={{ ...card, flex: '1 1 400px', gap: 16 }}>
      <CardHead title={t('yc.tr.hours.t')} sub={`${t('yc.tr.hours.s')}${any ? ` ${t('yc.tr.hours.peak', { a: hourLabel(bh, lang), b: hourLabel((bh + 2) % 24, lang) })}` : ''}`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...fadeIn(rv, 180) }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150 }}>
          {hrs.map((v, h) => {
            const a = v / max;
            const hot = h === bh || h === (bh + 1) % 24;
            return <div key={h} title={`${hourLabel(h, lang)} · ${T.n(v)}`} style={{ flex: 1, height: `${Math.max(2, a * 100)}%`, borderRadius: '5px 5px 2px 2px', background: hot && any ? 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))' : `rgba(227,20,27,${(0.18 + a * 0.45).toFixed(2)})`, transform: `scaleY(${go ? 1 : 0})`, transformOrigin: 'bottom', transition: go ? `transform 600ms ${EASE} ${h * 18}ms` : 'none' }} />;
          })}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>{hrs.map((_, h) => <span key={h} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'visible' }}>{h % 3 === 0 ? hourLabel(h, lang) : ''}</span>)}</div>
      </div>
      {line && <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, color: 'var(--sand-700)' }}>{line}.</div>}
    </section>
  );
}

function Bridge({ d, T, night, onGo }: { d: AnaClicks; T: T; night: boolean; onGo: () => void }) {
  const { t, n, eur } = T;
  const caps = useCrmCaps();
  const tt = d.totals;
  const money = caps.money && tt.revenue !== null;
  const title = !d.confirmed && tt.orders === 0 ? t('yc.tr.br.tWait')
    : money ? t('yc.tr.br.t', { n: n(tt.orders), v: eur(Number(tt.revenue ?? 0)) }) : t('yc.tr.br.tNoMoney', { n: n(tt.orders) });
  return (
    <section style={{ ...nightCard, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px 24px', padding: '24px 28px' }}>
      <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', textWrap: 'pretty' }}>{title}</b>
        <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--text-on-night-2)' }}>{t(night ? 'yc.tr.br.sEv' : 'yc.tr.br.s')}</span>
      </div>
      <BrandArrowButton label={t(night ? 'yc.tr.br.ctaEv' : 'yc.tr.br.cta')} onClick={onGo} h={46} />
    </section>
  );
}
