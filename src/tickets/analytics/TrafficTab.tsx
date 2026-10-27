/**
 * Yuno Tickets › Analyses › Trafic — « Qui regarde vos soirées ? » (plan
 * docs/designs/TRAFFIC_TAB_PLAN.md, lots T2 / T3, décision de Paul du 27/10).
 *
 * Trafic se compte en PERSONNES, Ventes en euros : visites, visiteurs, temps
 * passé (médianes), défilement, quand, d'où, et le passage à l'achat. Un seul
 * pont vers l'argent : le passage à l'achat (un pourcentage, un nombre de
 * commandes) dans les tableaux, et la phrase du bas qui renvoie à Ventes.
 * Lecture unique : `tix_ana_visits` (migration 20261110100000). Une soirée
 * choisie (`?e=`) a sa propre page, comparée à une autre (`?ce=`) :
 * TrafficNight.tsx.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useProgress } from '@/crm/ui/motion';
import { Segmented } from '@/tickets/analytics/kit';
import { useTixT } from '@/tickets/analytics/i18n';
import { VISIT_FAMS, type AnaFilters, type AnaTab, type AnaVisits, type VisitFam, type VisitKid, type VisitLink } from '@/tickets/analytics/data';
import { PageCard } from './TrafficDetail';
import { TrafficNight } from './TrafficNight';
import {
  BrandArrowButton, CardHead, ChartSkeleton, Fill, Sk, StackChart, StatePill, Tile, TileSkeleton, bucketTitle, card, fadeIn, nightCard, useGo, xLabels, type TileSpec,
} from './anaUi';
import { deltaPct, jLabelFor } from './SalesTab';

type T = ReturnType<typeof useTixT>;

/** Sous 10, un pourcentage ne veut rien dire : l'écran montre les nombres. */
export const MIN_SAMPLE = 10;

export const FAM_COLOR: Record<VisitFam, string> = {
  so: '#B05BE0', lk: 'var(--ya-red-500)', di: 'var(--ya-sand-300)', yu: 'var(--ya-tangerine-500)',
  se: '#38BDF8', ms: 'var(--ya-amber-500)', ot: '#22C55E',
};

export const mono: CSSProperties = { fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' };

/** Durée lisible : « 48 s », « 2 min 29 », « 1 h 05 ». */
export function fmtDur(T: T, s: number | null | undefined): string {
  if (s === null || s === undefined) return '—';
  const v = Math.max(0, Math.round(s));
  if (v < 60) return T.t('ya.tv.dur.s', { s: v });
  if (v < 3600) return T.t('ya.tv.dur.m', { m: Math.floor(v / 60), s: String(v % 60).padStart(2, '0') });
  return T.t('ya.tv.dur.h', { h: Math.floor(v / 3600), m: String(Math.floor((v % 3600) / 60)).padStart(2, '0') });
}

/** Part en %, à une décimale ; null sous 10 (l'écran montre alors les nombres). */
export function rate(k: number, of: number): number | null {
  return of >= MIN_SAMPLE ? (k / of) * 100 : null;
}

/** Écart en points de pourcentage, « ▲ 0,4 pt ». */
function deltaPts(cur: number | null, prev: number | null, T: T): { text: string; up: boolean } | null {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  return { text: `${d >= 0 ? '▲' : '▼'} ${T.t('ya.tv.pts', { n: T.n1(Math.abs(d)) })}`, up: d >= 0 };
}

export function visitsCsv(d: AnaVisits, T: T): { columns: string[]; rows: unknown[][] } {
  const cols = [T.t('ya.tv.csv.source'), T.t('ya.tv.csv.detail'), T.t('ya.tv.csv.visits'), T.t('ya.tv.csv.visitors'), T.t('ya.tv.csv.median'), T.t('ya.tv.csv.scroll'), T.t('ya.tv.csv.orders')];
  const rows: unknown[][] = [];
  for (const s of d.sources) {
    rows.push([T.t(`ya.tv.fam.${s.k}`), '', s.visits, s.visitors, s.median_s, s.median_scroll, s.orders]);
    for (const k of s.kids) rows.push([T.t(`ya.tv.fam.${s.k}`), kidName(k, T), k.visits, k.visitors, k.median_s, k.median_scroll, k.orders]);
  }
  return { columns: cols, rows };
}

const NETS = ['instagram', 'tiktok', 'whatsapp', 'newsletter', 'facebook', 'sms', 'email'];

/** Nom lisible d'un lien suivi : son nom, sinon son réseau et son emplacement. */
export function linkLabel(l: { label: string | null; net: string | null; med: string | null }, t: T['t']): string {
  if (l.med === 'party_link') return l.label ?? t('ya.tr.link.party');
  const net = l.net ? (NETS.includes(l.net) ? t(`ya.tr.net.${l.net}`) : l.net) : t('ya.tr.link.link');
  if (l.label && l.label.toLowerCase() !== (l.net ?? '').toLowerCase()) return l.label;
  return l.med && !['partner_link', 'party_link', 'event_link'].includes(l.med) ? `${net} · ${l.med.replace(/_/g, ' ')}` : net;
}

function kidName(k: VisitKid, T: T): string {
  if (k.link) return linkLabel({ label: k.label, net: k.net, med: k.med }, T.t);
  return k.label ?? '—';
}

function kidSub(k: VisitKid, t: T['t']): string {
  if (k.link) {
    if (k.med === 'partner_link') return t('ya.tv.kid.partner');
    if (k.med === 'party_link') return t('ya.tv.kid.party');
    return k.net && NETS.includes(k.net) ? t(`ya.tr.net.${k.net}`) : t('ya.tv.kid.link');
  }
  if (k.key.startsWith('d:')) return t('ya.tv.kid.site');
  if (k.key.startsWith('c:')) return t('ya.tv.kid.campaign');
  return t('ya.tv.kid.utm');
}

export function TrafficTab({ q, f, setF, goTab }: { q: UseQueryResult<AnaVisits>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void; goTab: (k: AnaTab, hash?: string) => void }) {
  if (f.event) return <TrafficNight q={q} f={f} setF={setF} goTab={goTab} />;
  return <TrafficPeriod q={q} f={f} setF={setF} goTab={goTab} />;
}

function TrafficPeriod({ q, f, setF, goTab }: { q: UseQueryResult<AnaVisits>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void; goTab: (k: AnaTab, hash?: string) => void }) {
  const T = useTixT();
  const { t, tp, n, pct } = T;
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData) || d.meta.mode === 'event';
  const dataKey = `${f.period}:${q.dataUpdatedAt}`;
  const [metric, setMetric] = useState<'v' | 'u'>('v');
  const [hidden, setHidden] = useState<VisitFam[]>([]);
  const [focus, setFocus] = useState<VisitFam | null>(null);
  const [open, setOpen] = useState<VisitFam | null>(null);
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${hidden.join(',')}:${metric}`, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);
  const jl = jLabelFor(t);

  const v = useMemo(() => {
    if (!d || !d.series) return null;
    const used = VISIT_FAMS.filter((k) => d.sources.some((s) => s.k === k && s.visits > 0));
    const keys = used.length ? used : (['di'] as VisitFam[]);
    const series = keys.map((k) => ({ k, label: t(`ya.tv.fam.${k}`), c: FAM_COLOR[k], v: (d.series ?? []).map((b) => Number(b[metric][k] ?? 0)) }));
    const rows = [...d.sources].sort((a, b) => b.visits - a.visits);
    return { series, rows };
  }, [d, metric, t]);

  if (!d || !v || d.meta.mode === 'event') {
    return (
      <>
        <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={280} /><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)}</div>
      </>
    );
  }
  const m = d.meta;
  const tt = d.totals;
  const unit = m.mode === 'hour' ? 'hour' : m.mode === 'month' ? 'month' : 'day';
  const per = t(`ya.tv.per.${f.period}`);
  const big = metric === 'v' ? tt.visits : tt.visitors;
  const bigD = f.cmp ? deltaPct(big, metric === 'v' ? tt.prev_visits : tt.prev_visitors, T) : null;
  const marks = (d.sends ?? []).map((s) => ({ i: s.i, title: `${s.channel === 'sms' ? 'SMS' : s.channel === 'push' ? t('ya.ana.push') : t('ya.ana.email')} · ${s.name}` }));
  const newPct = rate(tt.new_visitors, tt.visitors);
  const pNewPct = rate(tt.prev_new, tt.prev_visitors);
  const conv = rate(tt.orders, tt.visits);
  const pConv = rate(tt.prev_orders, tt.prev_visits);
  const vD = f.cmp ? deltaPct(tt.visitors, tt.prev_visitors, T) : null;
  const nD = f.cmp ? deltaPts(newPct, pNewPct, T) : null;
  const cD = f.cmp ? deltaPts(conv, pConv, T) : null;
  const durD = f.cmp && tt.median_s !== null && tt.prev_median_s !== null && tt.measured >= MIN_SAMPLE && tt.prev_measured >= MIN_SAMPLE
    ? { text: tt.median_s === tt.prev_median_s ? t('ya.tv.same') : `${tt.median_s > tt.prev_median_s ? '▲' : '▼'} ${fmtDur(T, Math.abs(tt.median_s - tt.prev_median_s))}`, up: tt.median_s >= tt.prev_median_s }
    : null;
  const vsB = t('ya.ana.vsBefore');
  const e = d.engagement;
  const longer = rate(e.dur[2] + e.dur[3] + e.dur[4], e.measured);
  const tiles: TileSpec[] = [
    { kind: 'spark', label: t('ya.tv.t.visitors'), value: n(tt.visitors * prog), delta: vD ? `${vD.text} ${vsB}` : undefined, dc: vD && !vD.up ? 'var(--ya-red-600)' : undefined, cap: t('ya.tv.t.visitorsCap'), values: (d.series ?? []).map((b) => b.visitors) },
    { kind: 'ring', label: t('ya.tv.t.new'), value: newPct !== null ? pct(newPct * prog) : n(tt.new_visitors), delta: nD ? `${nD.text} ${vsB}` : undefined, dc: 'var(--ya-sand-600)', cap: newPct !== null ? t('ya.tv.t.newCap', { pct: pct(100 - newPct) }) : t('ya.tv.t.newCapN'), ring: newPct ?? 0 },
    { kind: 'hb', label: t('ya.tv.t.time'), value: fmtDur(T, tt.median_s), delta: durD ? `${durD.text} ${vsB}` : undefined, dc: durD && !durD.up ? 'var(--ya-red-600)' : undefined, cap: tt.pages !== null ? t('ya.tv.t.timeCap', { p: T.n1(Number(tt.pages)) }) : t('ya.tv.t.timeCapNo'), hb: longer ?? 0, hbL: longer !== null ? t('ya.tv.t.timeBar', { pct: pct(longer) }) : '' },
    { kind: 'txt', label: t('ya.tv.t.conv'), value: conv !== null ? pct(conv * prog, 1) : n(tt.orders), delta: cD ? `${cD.text} ${vsB}` : undefined, dc: cD && !cD.up ? 'var(--ya-red-600)' : undefined, cap: tp('ya.tv.t.convCap', tt.orders, { o: n(tt.orders), v: n(tt.visits) }), color: 'var(--ya-gradient-brand)' },
  ];
  const totV = Math.max(1, tt.visits);
  const rowMax = Math.max(1, ...v.rows.map((s) => s.visits));
  const grid = 'minmax(200px,1.7fr) minmax(130px,1.1fr) 64px 96px 96px 92px minmax(120px,.9fr)';

  return (
    <>
      {/* Héros : combien de monde regarde */}
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)' }}>
        <CardHead
          title={t('ya.tv.heroT')}
          sub={t('ya.tv.heroSub', { unit: t(`ya.ana.unit.${unit}`) })}
          right={<Segmented value={metric} onChange={(x) => setMetric(x)} ariaLabel={t('ya.tv.heroT')} options={[{ value: 'v', label: t('ya.tv.m.visits') }, { value: 'u', label: t('ya.tv.m.visitors') }]} />}
        />
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(big * prog)}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{metric === 'v' ? t('ya.tv.bigV', { per, n: n(tt.visitors) }) : t('ya.tv.bigU', { per, n: n(tt.visits) })}</span>
                {f.cmp && (bigD
                  ? <span style={{ fontSize: 15, fontWeight: 600, color: bigD.up ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{t('ya.tv.vsPer', { d: bigD.text, per: t(`ya.tv.prev.${f.period}`) })}</span>
                  : <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ya-sand-500)' }}>{t('ya.ana.noPrev')}</span>)}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {v.series.map((s) => {
                const on = !hidden.includes(s.k);
                return (
                  <Hv
                    key={s.k}
                    as="button"
                    type="button"
                    aria-pressed={on}
                    title={t('ya.ana.t.toggle')}
                    onClick={() => {
                      if (on && v.series.length - hidden.length <= 1) return;
                      setHidden((h) => (on ? [...h, s.k] : h.filter((x) => x !== s.k)));
                    }}
                    style={{ height: 34, padding: '0 12px 0 10px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: on ? 'var(--ya-card)' : 'transparent', color: on ? 'var(--ya-ink)' : 'var(--ya-sand-400)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms' }}
                    hover={{ borderColor: 'var(--ya-sand-400)' }}
                  >
                    <i style={{ width: 10, height: 10, borderRadius: 3, background: on ? s.c : 'transparent', boxShadow: `inset 0 0 0 1.5px ${s.c}`, display: 'inline-block' }} />{s.label}
                  </Hv>
                );
              })}
            </div>
            <StackChart
              series={v.series}
              hidden={hidden}
              focus={focus}
              marks={marks}
              go={go}
              fy={(x) => n(x)}
              tipTitle={(i) => bucketTitle(m, i, T, jl)}
              tipValue={(x) => (metric === 'v' ? tp('ya.tv.nVisits', x, { n: n(x) }) : tp('ya.tv.nVisitors', x, { n: n(x) }))}
              xl={xLabels(m, T, jl)}
            />
            {metric === 'u' && <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.uNote')}</span>}
          </div>
        )}
      </section>

      {d.keep.length > 0 && <KeepCard d={d} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      {/* D'où arrivent-ils ? */}
      <section style={{ ...card, gap: 16 }}>
        <CardHead title={t('ya.tv.srcT')} sub={t('ya.tv.srcSub')} />
        {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Sk key={i} h={52} r={14} />)}</div> : v.rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.none')}</p>
        ) : (
          <div className="ya-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 120) }}>
            <div style={{ minWidth: 820, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', ...mono }}>
                <span>{t('ya.tv.col.source')}</span><span>{t('ya.tv.col.visits')}</span><span style={{ textAlign: 'right' }}>{t('ya.tv.col.share')}</span>
                <span style={{ textAlign: 'right' }}>{t('ya.tv.col.visitors')}</span><span style={{ textAlign: 'right' }}>{t('ya.tv.col.time')}</span>
                <span style={{ textAlign: 'right' }}>{t('ya.tv.col.scroll')}</span><span style={{ textAlign: 'right' }}>{t('ya.tv.col.conv')}</span>
              </div>
              {v.rows.map((s, i) => {
                const kids = s.kids;
                const cv = rate(s.orders, s.visits);
                const isOpen = open === s.k;
                return (
                  <div key={s.k}>
                    <div
                      onMouseEnter={() => setFocus(s.k)}
                      onMouseLeave={() => setFocus(null)}
                      onClick={kids.length ? () => setOpen((o) => (o === s.k ? null : s.k)) : undefined}
                      role={kids.length ? 'button' : undefined}
                      aria-expanded={kids.length ? isOpen : undefined}
                      style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, background: focus === s.k || isOpen ? 'var(--ya-sand-50)' : 'transparent', opacity: hidden.includes(s.k) ? 0.4 : 1, transition: 'background 140ms,opacity 160ms', fontSize: 14.5, fontVariantNumeric: 'tabular-nums', cursor: kids.length ? 'pointer' : 'default' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: FAM_COLOR[s.k], boxShadow: 'inset 0 0 0 1px rgb(var(--ink) / .12)' }} />
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`ya.tv.fam.${s.k}`)}</b>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ya-sand-500)', minWidth: 0 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`ya.tv.fam.${s.k}.d`)}</span>
                            {kids.length > 0 && <Icon name="chevronDown" size={13} stroke={2.4} style={{ flex: 'none', transform: `rotate(${isOpen ? 180 : 0}deg)`, transition: 'transform 200ms' }} />}
                          </span>
                        </span>
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <b>{n(s.visits * prog)}</b>
                        <Fill pct={(s.visits / rowMax) * 100} go={go} delay={i * 70} h={5} bg={FAM_COLOR[s.k]} dur={800} />
                      </span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-600)' }}>{pct((s.visits / totV) * 100)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(s.visitors)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{s.measured >= MIN_SAMPLE ? fmtDur(T, s.median_s) : '—'}</span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{s.measured >= MIN_SAMPLE && s.median_scroll != null ? pct(s.median_scroll) : '—'}</span>
                      <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                        <b style={{ color: cv !== null && conv !== null && cv >= conv * 1.3 ? 'var(--ya-green-700)' : 'var(--ya-ink)' }}>{cv !== null ? pct(cv, 1) : '—'}</b>
                        <span style={{ fontSize: 12, color: 'var(--ya-sand-500)' }}>{tp('ya.tv.nBuys', s.orders, { n: n(s.orders) })}</span>
                      </span>
                    </div>
                    {isOpen && kids.length > 0 && (
                      <div style={{ margin: '2px 10px 10px 30px', padding: '4px 0', borderLeft: '2px solid var(--ya-sand-100)', display: 'flex', flexDirection: 'column' }}>
                        {kids.map((k) => {
                          const kc = rate(k.orders, k.visits);
                          return (
                            <div key={k.key} style={{ display: 'grid', gridTemplateColumns: `minmax(170px,1.7fr) minmax(130px,1.1fr) 64px 96px 96px 92px minmax(120px,.9fr)`, gap: 14, alignItems: 'center', padding: '8px 0 8px 16px', fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>
                              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kidName(k, T)}</b>
                                <span style={{ fontSize: 12, color: 'var(--ya-sand-500)' }}>{kidSub(k, t)}</span>
                              </span>
                              <span>{n(k.visits)}</span>
                              <span style={{ textAlign: 'right', color: 'var(--ya-sand-600)' }}>{pct((k.visits / totV) * 100)}</span>
                              <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(k.visitors)}</span>
                              <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{k.measured >= MIN_SAMPLE ? fmtDur(T, k.median_s) : '—'}</span>
                              <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{k.measured >= MIN_SAMPLE && k.median_scroll != null ? pct(k.median_scroll) : '—'}</span>
                              <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{kc !== null ? pct(kc, 1) : tp('ya.tv.nBuys', k.orders, { n: n(k.orders) })}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.srcFoot')}</span>
      </section>

      <EngagementCard d={d} rv={rv} go={go} />
      <FunnelCard d={d} rv={rv} go={go} prog={prog} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <HeatCard heat={d.heat} rv={rv} go={go} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <ScreenCard d={d} rv={rv} go={go} />
        <CitiesCard d={d} rv={rv} go={go} />
      </div>

      <NightsCard d={d} f={f} setF={setF} rv={rv} go={go} />

      {d.page && <PageCard p={d.page} meta={m} cmp={f.cmp} rv={rv} go={go} prog={prog} />}

      <LinksCard links={d.links} rv={rv} go={go} />

      <BridgeBand d={d} ev={false} onGo={() => goTab('sales', 'ya-made')} rv={rv} />
    </>
  );
}

// ── À retenir ─────────────────────────────────────────────────────────────

function KeepCard({ d }: { d: AnaVisits }) {
  const T = useTixT();
  const { t, pct, n1, n } = T;
  const items = d.keep.map((k) => {
    if (k.k === 'top' && k.fam) return { c: FAM_COLOR[k.fam], title: t('ya.tv.tk.top', { src: t(`ya.tv.fam.${k.fam}`), pct: pct(k.pct ?? 0) }), sub: '' };
    if (k.k === 'best_conv' && k.fam && k.top) {
      return { c: FAM_COLOR[k.fam], title: t('ya.tv.tk.best', { src: t(`ya.tv.fam.${k.fam}`), ratio: n1(k.ratio ?? 0) }), sub: t('ya.tv.tk.bestS', { src: t(`ya.tv.fam.${k.fam}`), pct: pct(k.pct ?? 0), conv: pct(k.conv ?? 0, 1), top: t(`ya.tv.fam.${k.top}`).toLowerCase(), tconv: pct(k.top_conv ?? 0, 1) }) };
    }
    if (k.k === 'short') return { c: '#38BDF8', title: t('ya.tv.tk.short', { pct: pct(k.pct ?? 0) }), sub: k.fams && k.fams.length ? t('ya.tv.tk.shortS', { src: k.fams.map((x) => t(`ya.tv.fam.${x}`).toLowerCase()).join(T.lang === 'en' ? ' and ' : T.lang === 'es' ? ' y ' : ' et ') }) : '' };
    if (k.k === 'after_full') return { c: 'var(--ya-red-500)', title: t('ya.tv.tk.after', { n: n(k.n ?? 0) }), sub: k.title ? t('ya.tv.tk.afterS', { title: k.title }) : '' };
    return null;
  }).filter((x): x is { c: string; title: string; sub: string } => !!x);
  if (!items.length) return null;
  return (
    <section style={{ ...card, gap: 12 }}>
      <span style={mono}>{t('ya.tv.keepT')}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 12 }}>
        {items.map((x, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 16, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }}>
            <span style={{ flex: 'none', width: 9, height: 9, marginTop: 7, borderRadius: 99, background: x.c }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <b style={{ fontSize: 15, lineHeight: 1.4, fontWeight: 600, textWrap: 'pretty' }}>{x.title}</b>
              {x.sub && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--ya-sand-600)', textWrap: 'pretty' }}>{x.sub}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Que font-ils sur la page ? ────────────────────────────────────────────

export function EngagementCard({ d, rv, go }: { d: AnaVisits; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, n, pct } = T;
  const e = d.engagement;
  const enough = e.measured >= MIN_SAMPLE;
  const durMax = Math.max(1, ...e.dur);
  const durC = ['var(--ya-sand-300)', 'var(--ya-red-200)', 'var(--ya-red-500)', 'var(--ya-red-500)', 'var(--ya-tangerine-500)'];
  const scrollL = ['top', 'q1', 'half', 'q3', 'end'];
  const op = e.opened;
  return (
    <section style={{ ...card, gap: 18, ...fadeIn(rv, 120) }}>
      <CardHead title={t('ya.tv.engT')} sub={t('ya.tv.engSub')} />
      {!enough ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.engNone')}</p> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>{t('ya.tv.engDur')}</span>
            {e.dur.map((x, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,130px) minmax(0,1fr) 52px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: 'var(--ya-sand-700)' }}>{t(`ya.tv.band.${i}`)}</span>
                <Fill pct={(x / durMax) * 100} go={go} delay={i * 70} h={12} bg={durC[i]} dur={800} />
                <b style={{ textAlign: 'right' }}>{pct((x / e.measured) * 100)}</b>
              </div>
            ))}
          </div>
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>{t('ya.tv.engScroll')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 10, alignItems: 'end', height: 150 }}>
              {e.scroll.map((x, i) => {
                const p = (x / e.measured) * 100;
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%' }}>
                    <b style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>{pct(p)}</b>
                    <div style={{ width: '100%', height: `${Math.max(2, p) * 0.9}%`, borderRadius: '8px 8px 4px 4px', background: i === 0 ? 'var(--ya-sand-200)' : `color-mix(in oklab, var(--ya-red-500) ${35 + i * 15}%, transparent)`, transform: `scaleY(${go ? 1 : 0})`, transformOrigin: 'bottom', transition: go ? `transform 700ms cubic-bezier(.22,1,.36,1) ${i * 80}ms` : 'none' }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 10, fontSize: 12, color: 'var(--ya-sand-500)', textAlign: 'center' }}>
              {scrollL.map((k) => <span key={k}>{t(`ya.tv.sc.${k}`)}</span>)}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 10 }}>
        <Chip label={t('ya.tv.chip.artists')} value={n(e.artist_clicks)} sub={t('ya.tv.chip.artistsS')} />
        <Chip label={t('ya.tv.chip.shares')} value={n(e.shares)} sub={t('ya.tv.chip.sharesS')} />
        {op && op.measured > 0 && <Chip label={t('ya.tv.chip.opened')} value={`${n(op.lineup)} · ${n(op.plan)} · ${n(op.video)}`} sub={t('ya.tv.chip.openedS')} />}
      </div>
    </section>
  );
}

export function Chip({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px', borderRadius: 16, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }}>
      <span style={{ fontSize: 13, color: 'var(--ya-sand-600)' }}>{label}</span>
      <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
      {sub && <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{sub}</span>}
    </div>
  );
}

// ── Du coup d'œil à l'achat ───────────────────────────────────────────────

export function FunnelCard({ d, rv, go, prog, ev = false }: { d: AnaVisits; rv: boolean; go: boolean; prog: number; ev?: boolean }) {
  const T = useTixT();
  const { t, tp, n, pct } = T;
  const fn = d.funnel;
  const top = Math.max(1, fn.viewed);
  const steps = [
    { k: 'viewed', v: fn.viewed },
    { k: 'selected', v: fn.selected },
    { k: 'checkout', v: fn.checkout, drop: fn.selected - fn.checkout > 0 ? tp('ya.tv.fn.dropSel', fn.selected - fn.checkout, { n: n(fn.selected - fn.checkout) }) : '' },
    { k: 'details', v: fn.details },
    { k: 'purchased', v: fn.purchased, drop: fn.details - fn.purchased > 0 ? tp('ya.tv.fn.dropPay', fn.details - fn.purchased, { n: n(fn.details - fn.purchased), f: n(fn.failed_open) }) : '' },
  ];
  const conv = rate(fn.purchased, fn.viewed);
  return (
    <section style={{ ...card, gap: 18, ...fadeIn(rv, 140) }}>
      <CardHead title={t('ya.tv.fnT')} sub={t(ev ? 'ya.tv.fnSubEv' : 'ya.tv.fnSub')} />
      {fn.viewed === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.fnNone')}</p> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
          <div style={{ flex: '0 1 220px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{conv !== null ? pct(conv * prog, 1) : n(fn.purchased)}</span>
            <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{conv !== null ? t('ya.tv.fnBig') : t('ya.tv.fnBigN')}</span>
          </div>
          <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {steps.map((s, i) => (
              <div key={s.k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--ya-sand-700)' }}>{t(`ya.tv.fn.${s.k}`)}</span>
                  <span><b>{n(s.v)}</b><span style={{ color: 'var(--ya-sand-500)' }}>{fn.viewed >= MIN_SAMPLE ? ` · ${i === 0 ? pct(100) : pct((s.v / fn.viewed) * 100, 1)}` : ''}</span></span>
                </div>
                <Fill pct={Math.max(1.5, (s.v / top) * 100)} go={go} delay={i * 90} h={14} bg={i === steps.length - 1 ? 'var(--ya-gradient-brand)' : 'var(--ya-red-200)'} dur={900} />
                {s.drop && <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{s.drop}</span>}
              </div>
            ))}
          </div>
          {fn.failed > 0 && (
            <div style={{ flex: '0 1 220px', alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 16, background: 'var(--ya-red-50)' }}>
              <b style={{ fontSize: 14.5 }}>{tp('ya.tv.fn.failed', fn.failed, { n: n(fn.failed) })}</b>
              {fn.reasons.map((r) => (
                <span key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5, color: 'var(--ya-sand-700)' }}>
                  <span>{t(`ya.tv.fail.${['network', 'validation', 'server', 'sold_out'].includes(r.reason) ? r.reason : 'other'}`)}</span><b>{n(r.n)}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {ev && fn.unpaid && fn.unpaid.name && (
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-700)', textWrap: 'pretty' }}>
          {tp('ya.tv.fn.unpaid', fn.unpaid.n, { name: fn.unpaid.name, n: n(fn.unpaid.n) })}
        </p>
      )}
    </section>
  );
}

// ── Quand regardent-ils ? ─────────────────────────────────────────────────

const DAYS_REF = [5, 6, 7, 8, 9, 10, 11].map((d) => new Date(2026, 9, d)); // lundi 5 oct. 2026 → dimanche

function hourLabel(h: number, lang: string): string {
  if (lang !== 'en') return `${h} h`;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/** Le créneau de deux heures où l'on regarde le plus (toute la semaine). */
export function peakHours(by: number[]): [number, number] | null {
  let best = -1; let at = 0;
  for (let h = 0; h < 24; h++) {
    const v = (by[h] ?? 0) + (by[(h + 1) % 24] ?? 0) + (by[(h + 2) % 24] ?? 0);
    if (v > best) { best = v; at = h; }
  }
  return best > 0 ? [at, (at + 3) % 24] : null;
}

function HeatCard({ heat, rv, go }: { heat: number[][]; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, n } = T;
  const [hov, setHov] = useState<[number, number] | null>(null);
  const max = Math.max(1, ...heat.flat());
  const total = heat.flat().reduce((a, b) => a + b, 0);
  const byDay = heat.map((r) => r.reduce((a, b) => a + b, 0));
  const byHour = Array.from({ length: 24 }, (_, h) => heat.reduce((a, r) => a + (r[h] ?? 0), 0));
  const days = [...byDay.keys()].sort((a, b) => byDay[b] - byDay[a]).slice(0, 2).sort((a, b) => a - b);
  const pk = peakHours(byHour);
  const day = (r: number, len: 'long' | 'short') => DAYS_REF[r].toLocaleDateString(T.locale, { weekday: len });
  const peak = total >= MIN_SAMPLE && pk ? t('ya.tv.heatPeak', { d1: day(days[0], 'long'), d2: day(days[1] ?? days[0], 'long'), h1: hourLabel(pk[0], T.lang), h2: hourLabel(pk[1], T.lang) }) : '';
  const cell = hov ? heat[hov[0]]?.[hov[1]] : null;
  return (
    <section style={{ ...card, flex: '1 1 600px', gap: 16, ...fadeIn(rv, 160) }}>
      <CardHead title={t('ya.tv.heatT')} sub={`${t('ya.tv.heatSub')}${peak ? ` ${peak}` : ''}`} />
      {total === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.none')}</p> : (
        <div className="ya-thin-scroll" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 620, display: 'grid', gridTemplateColumns: '40px repeat(24,minmax(0,1fr))', gap: 3, alignItems: 'center' }} onMouseLeave={() => setHov(null)}>
            <span />
            {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 9.5, textAlign: 'center', color: 'var(--ya-sand-500)' }}>{h % 3 === 0 ? hourLabel(h, T.lang) : ''}</span>)}
            {heat.map((row, r) => [
              <span key={`l${r}`} style={{ fontSize: 12, color: 'var(--ya-sand-600)', textTransform: 'capitalize' }}>{day(r, 'short')}</span>,
              ...row.map((x, h) => (
                <div
                  key={`${r}-${h}`}
                  onMouseEnter={() => setHov([r, h])}
                  style={{ height: 22, borderRadius: 5, background: `color-mix(in oklab, #E8192C ${Math.round(6 + (x / max) * 94)}%, var(--ya-red-50))`, opacity: go ? 1 : 0, transition: go ? `opacity 400ms ${(r * 24 + h) * 3}ms` : 'none', boxShadow: hov && hov[0] === r && hov[1] === h ? '0 0 0 2px var(--ya-ink)' : 'none', cursor: 'crosshair' }}
                />
              )),
            ])}
          </div>
        </div>
      )}
      <div style={{ minHeight: 20, fontSize: 13.5, fontWeight: 600, color: 'var(--ya-sand-700)', fontVariantNumeric: 'tabular-nums' }}>
        {hov && cell !== null && cell !== undefined ? `${day(hov[0], 'long')}, ${hourLabel(hov[1], T.lang)} : ${T.tp('ya.tv.nVisits', cell, { n: n(cell) })}` : ''}
      </div>
    </section>
  );
}

// ── Sur quel écran ? ──────────────────────────────────────────────────────

function ScreenCard({ d, rv, go }: { d: AnaVisits; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, pct, n } = T;
  const dv = d.devices;
  const tot = dv.mobile + dv.desktop + dv.tablet;
  const ia = d.in_app;
  const iaPct = rate(ia.visits, ia.visits + ia.other_visits);
  const iaIn = rate(ia.orders, ia.visits);
  const iaOut = rate(ia.other_orders, ia.other_visits);
  const newPct = rate(d.totals.new_visitors, d.totals.visitors);
  const langTot = d.langs.known;
  const langs = d.langs.top;
  const other = langTot - langs.reduce((a, x) => a + x.n, 0);
  const langName = (l: string) => {
    try { return new Intl.DisplayNames([T.locale], { type: 'language' }).of(l) ?? l; } catch { return l; }
  };
  return (
    <section style={{ ...card, flex: '1 1 400px', gap: 16, ...fadeIn(rv, 160) }}>
      <CardHead title={t('ya.tv.scrT')} sub={t('ya.tv.scrSub')} />
      {tot < MIN_SAMPLE ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.none')}</p> : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(['mobile', 'desktop', 'tablet'] as const).map((k, i) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 52px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: 'var(--ya-sand-700)' }}>{t(`ya.tv.dev.${k}`)}</span>
                <Fill pct={(dv[k] / tot) * 100} go={go} delay={i * 80} h={10} bg={i === 0 ? 'var(--ya-gradient-brand)' : 'var(--ya-sand-400)'} dur={800} />
                <b style={{ textAlign: 'right' }}>{pct((dv[k] / tot) * 100)}</b>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 10 }}>
            <Chip label={t('ya.tv.scr.ig')} value={iaPct !== null ? pct(iaPct) : n(ia.visits)} sub={iaIn !== null && iaOut !== null ? t('ya.tv.scr.igS', { a: pct(iaIn, 1), b: pct(iaOut, 1) }) : t('ya.tv.scr.igN')} />
            <Chip label={t('ya.tv.scr.back')} value={newPct !== null ? pct(100 - newPct) : n(d.totals.visitors - d.totals.new_visitors)} sub={t('ya.tv.scr.backS')} />
          </div>
          {langTot >= MIN_SAMPLE && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={mono}>{t('ya.tv.scr.lang')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[...langs.map((x) => ({ l: langName(x.l), v: x.n })), ...(other > 0 ? [{ l: t('ya.tv.scr.langOther'), v: other }] : [])].map((x) => (
                  <span key={x.l} style={{ height: 30, padding: '0 12px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)', fontSize: 13.5 }}>
                    <span style={{ textTransform: 'capitalize' }}>{x.l}</span><b>{pct((x.v / langTot) * 100)}</b>
                  </span>
                ))}
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.scr.langCov', { n: n(langTot), of: n(d.totals.visits) })}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── D'où regardent-ils ? ──────────────────────────────────────────────────

export function countryName(cc: string, locale: string): string {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(cc) ?? cc; } catch { return cc; }
}

function CitiesCard({ d, rv, go }: { d: AnaVisits; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, n, pct } = T;
  const c = d.cities;
  const fr = c.france;
  const topSum = c.top.reduce((a, x) => a + x.n, 0);
  const rows = [...c.top.map((x) => ({ l: x.city, v: x.n, other: false })), ...(fr - topSum > 0 ? [{ l: t('ya.tv.city.otherFr'), v: fr - topSum, other: true }] : [])];
  const max = Math.max(1, ...rows.map((x) => x.v));
  const abroad = c.known - fr;
  return (
    <section style={{ ...card, flex: '1 1 400px', gap: 16, ...fadeIn(rv, 180) }}>
      <CardHead title={t('ya.tv.cityT')} sub={c.known >= MIN_SAMPLE ? t('ya.tv.citySub', { fr: pct((fr / c.known) * 100), ab: pct((abroad / c.known) * 100) }) : t('ya.tv.citySub0')} />
      {c.known < MIN_SAMPLE ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.none')}</p> : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {rows.map((x, i) => (
              <div key={x.l} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,170px) minmax(0,1fr) 64px 48px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: x.other ? 'var(--ya-sand-500)' : 'var(--ya-sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.l}</span>
                <Fill pct={(x.v / max) * 100} go={go} delay={i * 70} h={10} bg={i === 0 ? 'var(--ya-gradient-brand)' : x.other ? 'var(--ya-sand-300)' : 'var(--ya-sand-400)'} dur={800} />
                <span style={{ textAlign: 'right', color: 'var(--ya-sand-600)' }}>{n(x.v)}</span>
                <b style={{ textAlign: 'right' }}>{pct((x.v / c.known) * 100)}</b>
              </div>
            ))}
          </div>
          {c.abroad.length > 0 && (
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ya-sand-600)', textWrap: 'pretty' }}>
              {t('ya.tv.city.abroad', { list: c.abroad.slice(0, 4).map((x) => `${countryName(x.cc, T.locale)} ${pct((x.n / c.known) * 100, (x.n / c.known) * 100 < 1 ? 1 : 0)}`).join(', ') })}
            </span>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.city.foot')}</span>
        </>
      )}
    </section>
  );
}

// ── Quelles soirées attirent le plus de regards ? ─────────────────────────

function NightsCard({ d, f, setF, rv, go }: { d: AnaVisits; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, n, pct, dShort } = T;
  const nights = (d.nights ?? []).slice(0, 8);
  const max = Math.max(1, ...nights.map((x) => x.visits));
  const withFull = nights.some((x) => x.after_full !== undefined);
  const grid = `minmax(220px,1.7fr) minmax(150px,1.2fr) 96px 104px 150px${withFull ? ' 140px' : ''}`;
  return (
    <section style={{ ...card, gap: 16 }}>
      <CardHead title={t('ya.tv.evT')} sub={t('ya.tv.evSub')} />
      {nights.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.evNone')}</p> : (
        <div className="ya-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 160) }}>
          <div style={{ minWidth: withFull ? 820 : 700, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', ...mono }}>
              <span>{t('ya.ana.col.night')}</span><span>{t('ya.tv.col.visits')}</span><span style={{ textAlign: 'right' }}>{t('ya.tv.col.visitors')}</span>
              <span style={{ textAlign: 'right' }}>{t('ya.tv.col.time')}</span><span style={{ textAlign: 'right' }}>{t('ya.tv.col.conv')}</span>
              {withFull && <span style={{ textAlign: 'right' }}>{t('ya.tv.col.afterFull')}</span>}
            </div>
            {nights.map((x, i) => {
              const cv = rate(x.orders, x.visits);
              return (
                <div
                  key={x.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setF({ event: x.id })}
                  onKeyDown={(k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); setF({ event: x.id }); } }}
                  title={t('ya.tv.evOpen')}
                  style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 14.5, fontVariantNumeric: 'tabular-nums', background: f.event === x.id ? 'var(--ya-red-50)' : 'transparent' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</b><span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{dShort(x.start_at)}</span></span>
                    <StatePill state={x.state} label={t(`ya.ana.state.${x.state}`)} />
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><b style={{ width: 56 }}>{n(x.visits)}</b><span style={{ flex: 1 }}><Fill pct={(x.visits / max) * 100} go={go} delay={i * 70} dur={800} /></span></span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(x.visitors)}</span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{x.measured >= MIN_SAMPLE ? fmtDur(T, x.median_s) : '—'}</span>
                  <b style={{ textAlign: 'right' }}>{cv !== null ? pct(cv, 1) : n(x.orders)}</b>
                  {withFull && <span style={{ textAlign: 'right', fontSize: 13.5, color: x.after_full ? 'var(--ya-red-600)' : 'var(--ya-sand-500)' }}>{x.after_full === null || x.after_full === undefined ? t('ya.tv.notFull') : T.tp('ya.tv.nVisits', x.after_full, { n: n(x.after_full) })}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {withFull && <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.afterFoot')}</span>}
    </section>
  );
}

// ── Vos liens suivis ──────────────────────────────────────────────────────

export function LinksCard({ links, rv, go, ev = false }: { links: VisitLink[]; rv: boolean; go: boolean; ev?: boolean }) {
  const T = useTixT();
  const { t, tp, n, pct, dShort } = T;
  const max = Math.max(1, ...links.map((l) => l.clicks));
  const grid = ev ? 'minmax(220px,1.8fr) minmax(130px,1fr) 96px 104px 110px 96px' : 'minmax(220px,1.8fr) minmax(130px,1fr) 96px 96px 110px';
  return (
    <section style={{ ...card, gap: 16 }}>
      <CardHead title={t(ev ? 'ya.tv.lkTEv' : 'ya.tv.lkT')} sub={t(ev ? 'ya.tv.lkSubEv' : 'ya.tv.lkSub')} />
      {links.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t(ev ? 'ya.tv.lkNoneEv' : 'ya.tv.lkNone')}</p> : (
        <div className="ya-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 160) }}>
          <div style={{ minWidth: ev ? 780 : 660, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', ...mono }}>
              <span>{t('ya.tv.col.link')}</span><span>{t('ya.tv.col.clicks')}</span><span style={{ textAlign: 'right' }}>{t('ya.tv.col.people')}</span>
              {ev ? <span style={{ textAlign: 'right' }}>{t('ya.tv.col.time')}</span> : <span style={{ textAlign: 'right' }}>{t('ya.tv.col.phone')}</span>}
              <span style={{ textAlign: 'right' }}>{t('ya.tv.col.clickBuy')}</span>
              {ev && <span style={{ textAlign: 'right' }}>{t('ya.tv.col.shared')}</span>}
            </div>
            {links.map((l, i) => {
              const cv = rate(l.orders, l.clicks);
              const sub = ev
                ? (l.med === 'partner_link' ? t('ya.tv.kid.partner') : l.net && NETS.includes(l.net) ? t(`ya.tr.net.${l.net}`) : t('ya.tv.kid.link'))
                : l.event_title ? `${l.event_title} · ${dShort(l.event_start ?? '')}` : t(l.target === 'venue' ? 'ya.tr.link.toVenue' : 'ya.tr.link.toPage');
              return (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '11px 10px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkLabel(l, t)}</b>
                    <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><b>{n(l.clicks)}</b><Fill pct={(l.clicks / max) * 100} go={go} delay={i * 60} h={5} bg="var(--ya-red-400)" dur={800} /></span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(l.people)}</span>
                  {ev
                    ? <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{l.measured >= MIN_SAMPLE ? fmtDur(T, l.median_s) : '—'}</span>
                    : <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{l.dev_known >= MIN_SAMPLE ? pct((l.mobile / l.dev_known) * 100) : '—'}</span>}
                  <b style={{ textAlign: 'right', color: cv !== null && cv >= 5 ? 'var(--ya-green-700)' : 'var(--ya-ink)' }}>{cv !== null ? pct(cv, 1) : tp('ya.tv.nBuys', l.orders, { n: n(l.orders) })}</b>
                  {ev && <span style={{ textAlign: 'right', color: 'var(--ya-sand-600)' }}>{dShort(l.created_at)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Le pont vers Ventes ───────────────────────────────────────────────────

export function BridgeBand({ d, ev, onGo, rv }: { d: AnaVisits; ev: boolean; onGo: () => void; rv: boolean }) {
  const T = useTixT();
  const { t, tp, n, eur } = T;
  const b = d.bridge;
  const head = b.revenue !== null && b.revenue !== undefined
    ? tp('ya.tv.bridge', b.orders, { v: n(d.totals.visits), o: n(b.orders), e: eur(Number(b.revenue)) })
    : tp('ya.tv.bridgeN', b.orders, { v: n(d.totals.visits), o: n(b.orders) });
  return (
    <section style={{ ...nightCard, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '18px 28px', padding: '26px 30px', ...fadeIn(rv, 200) }}>
      <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(20px,2.2vw,26px)', lineHeight: 1.2, letterSpacing: '-.02em', textWrap: 'balance' }}>{head}</b>
        <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--ya-text-on-night-2)' }}>{t(ev ? 'ya.tv.bridgeSubEv' : 'ya.tv.bridgeSub')}</span>
      </div>
      <BrandArrowButton label={t(ev ? 'ya.tv.bridgeCtaEv' : 'ya.tv.bridgeCta')} onClick={onGo} />
    </section>
  );
}
