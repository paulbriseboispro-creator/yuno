/**
 * Analyses › Ventes — « Combien ai-je vendu ? ». Le héros (ventes ou billets,
 * par case ou cumulées, la période d'avant, les envois de messages), quatre
 * tuiles, l'objectif de la prochaine soirée et sa courbe de vente comparée
 * aux deux dernières, l'heure des achats, les tarifs, les soirées, et la part
 * des ventes venue d'un message Yuno.
 */
import { useEffect, useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented } from '@/tickets/analytics/kit';
import { useProgress } from '@/crm/ui/motion';
import { useTixT, type TixFormatters } from '@/tickets/analytics/i18n';
import { useTixCaps, useTixNights } from '@/tickets/analytics/scope';
import { TicketSplit } from '@/tickets/analytics/TicketSplit';
import { useTixRoutes } from '@/tickets/analytics/routes';
import { PILLARS, useAnaTraffic, useAnaTrafficDetail, useNightDoor, type AnaFilters, type AnaPillar, type AnaSales, type AnaTab, type TixPayout, type TixRefundsBlock } from '@/tickets/analytics/data';
import { useEventReport } from '@/hooks/useEventReport';
import { DoorCard, LinesCard, NightHeader, TargetCard, reportMarks } from './NightReport';
import {
  BrandArrowButton, CardHead, ChartSkeleton, Fill, Gauge, MultiLine, Sk, StatePill, Takeaway, Tile, TileSkeleton, TrendChart,
  bucketTitle, card, fadeIn, nightCard, useGo, xLabels, type CurveLine, type TileSpec,
} from './anaUi';
import { TablesKept } from './KeptBlocks';
import { SalesMade, newShareByNight } from './SalesMade';

type T = ReturnType<typeof useTixT>;

const DAYS_REF = [new Date(2024, 0, 1), new Date(2024, 0, 2), new Date(2024, 0, 3), new Date(2024, 0, 4), new Date(2024, 0, 5), new Date(2024, 0, 6), new Date(2024, 0, 7)];
const SLOT_START = [10, 12, 14, 16, 18, 20, 22, 0];

export function jLabelFor(t: T['t']) {
  return (k: number) => (k <= 0 ? t('ya.ana.jDay') : t('ya.ana.jMinus', { k }));
}

/** Écart en % entre deux valeurs, en texte « ▲ 12 % ». */
export function deltaPct(cur: number, prev: number, f: TixFormatters): { text: string; up: boolean } | null {
  if (!(prev > 0)) return null;
  const d = (cur - prev) / prev;
  return { text: `${d >= 0 ? '▲' : '▼'} ${f.pct(Math.abs(d) * 100)}`, up: d >= 0 };
}

export function salesCsv(d: AnaSales, T: T, money: boolean): { columns: string[]; rows: unknown[][] } {
  const jl = jLabelFor(T.t);
  const split = d.totals.paid_tickets !== undefined;
  const cols = [T.t('ya.ana.csv.when'), ...(money ? [T.t('ya.ana.csv.revenue')] : []), T.t('ya.ana.csv.tickets'), ...(split ? [T.t('ya.ana.csv.paidTickets')] : []), ...(money ? [T.t('ya.ana.csv.prevRevenue')] : []), T.t('ya.ana.csv.prevTickets')];
  const rows = d.series.map((s, i) => [bucketTitle(d.meta, i, T, jl), ...(money ? [s.revenue] : []), s.tickets, ...(split ? [s.paid_tickets ?? 0] : []), ...(money ? [s.prev_revenue] : []), s.prev_tickets]);
  return { columns: cols, rows };
}

export function SalesTab({ q, f, setF, goTab }: { q: UseQueryResult<AnaSales>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void; goTab: (k: AnaTab) => void }) {
  const T = useTixT();
  const { t, tp, n, n1, eur, eur2, pct, dShort, dLong, lang } = T;
  const caps = useTixCaps();
  const R = useTixRoutes();
  const navigate = useNavigate();
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  // Le pilier lu (lot 1 du plan combiné) : celui de la réponse, sinon celui demandé.
  const pl: AnaPillar = d?.meta.pillar ?? f.pillar;
  const isTb = pl === 'tables';
  const isGl = pl === 'guestlist';
  const isRf = pl === 'refunds';
  // Une inscription guest list ne rapporte rien : ce pilier se lit en nombres.
  const money = caps.money && !!d && d.totals.revenue !== null && !isGl;
  const [metricRaw, setMetric] = useState<'eur' | 'bil'>('eur');
  const metric = money ? metricRaw : 'bil';
  const [mode, setMode] = useState<'bucket' | 'cumul'>('bucket');
  const dataKey = `${f.period}:${f.event}:${f.seg}:${pl}:${q.dataUpdatedAt}`;
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${metric}:${mode}:${f.cmp}`, !loading);
  const prog = useProgress(1000, 0, `${dataKey}:${metric}`, !loading);
  const jl = jLabelFor(t);
  const [th, setTh] = useState<number | null>(null);
  const [hh, setHh] = useState<string | null>(null);
  const [rowH, setRowH] = useState<string | null>(null);
  // Une soirée choisie (lot 2) : le rapport de soirée de la Billetterie, la
  // soirée comparée (choisie, sinon la précédente de la série) et la porte.
  const nightId = f.event;
  const night = useEventReport(nightId);
  const compareNightId = nightId ? f.compare ?? d?.meta.prev_event?.id ?? null : null;
  const compareNight = useEventReport(compareNightId);
  const door = useNightDoor(nightId);
  const scopeNights = useTixNights();
  // « Ce qui a fait vendre » (lot T4 du plan Trafic) : l'attribution de chaque vente, sous « Tout ».
  const made = useAnaTraffic(f, pl === 'all');
  const madeDetail = useAnaTrafficDetail(f, pl === 'all');
  const newBy = useMemo(() => newShareByNight(made.data), [made.data]);
  // Arrivé depuis Trafic (« Voir ce qui a fait vendre ») : la partie s'ouvre à l'écran.
  useEffect(() => {
    if (pl !== 'all' || !made.data || window.location.hash !== '#ya-made') return;
    const el = document.getElementById('ya-made');
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [pl, made.data]);

  // Billets payants à part des entrées gratuites (D4, 20261020200000).
  // Une table VIP, une inscription ou un remboursement se comptent un par un.
  const split = !!d && (pl === 'all' || pl === 'tickets') && d.totals.paid_tickets !== undefined && d.totals.free_tickets !== undefined;
  const v = useMemo(() => {
    if (!d) return null;
    const m = d.meta;
    const unit = m.mode === 'hour' ? 'hour' : m.mode === 'month' ? 'month' : 'day';
    const rf = isRf ? d.refunds_block ?? null : null;
    const rows: AnaSales['series'] = rf ? rf.series : d.series;
    const pick = (s: AnaSales['series'][number], prev: boolean) => (metric === 'eur' ? Number((prev ? s.prev_revenue : s.revenue) ?? 0)
      : split ? Number((prev ? s.prev_paid_tickets : s.paid_tickets) ?? 0) : Number(prev ? s.prev_tickets : s.tickets));
    let cur = rows.map((s) => pick(s, false));
    let prev = rows.map((s) => pick(s, true));
    if (mode === 'cumul') {
      let a = 0; let b = 0;
      cur = cur.map((x) => (a += x)); prev = prev.map((x) => (b += x));
    }
    const total = rf ? Number(metric === 'eur' ? rf.totals.revenue ?? 0 : rf.totals.n)
      : metric === 'eur' ? Number(d.totals.revenue ?? 0) : Number(split ? d.totals.paid_tickets : d.totals.tickets);
    const ptotal = rf ? Number(metric === 'eur' ? rf.totals.prev_revenue ?? 0 : rf.totals.prev_n)
      : metric === 'eur' ? Number(d.totals.prev_revenue ?? 0) : Number(split ? d.totals.prev_paid_tickets : d.totals.prev_tickets);
    const marks = d.sends.map((s) => ({ i: s.i, title: `${s.channel === 'sms' ? 'SMS' : t('ya.ana.email')} · ${s.name}` }));
    // Effet des envois : ventes moyennes dans les 2 cases qui suivent un envoi, contre le reste.
    const raw = d.series.map((s) => Number(s.tickets));
    const win = new Set<number>();
    d.sends.forEach((s) => { for (let k = 0; k < 2; k++) if (s.i + k < raw.length) win.add(s.i + k); });
    let a = 0; let an = 0; let b = 0; let bn = 0;
    raw.forEach((x, i) => { if (win.has(i)) { a += x; an++; } else { b += x; bn++; } });
    const ratio = !rf && m.mode !== 'month' && an && bn && b > 0 ? (a / an) / (b / bn) : null;
    return { m, unit, cur, prev, total, ptotal, marks, ratio };
  }, [d, metric, mode, t, split, isRf]);

  if (!d || !v) return <SalesSkeleton />;
  const m = v.m;
  const ev = m.mode === 'event';
  const rf = isRf ? d.refunds_block ?? null : null;
  const showPrev = f.cmp && !!(rf ? rf.totals.has_prev : d.totals.has_prev);
  const fmtVal = (x: number) => (metric === 'eur' ? eur(x)
    : isTb ? tp('ya.ana.s.nTables', x, { n: n(x) })
      : isGl ? tp('ya.ana.nSignups', x, { n: n(x) })
        : isRf ? tp('ya.ana.nRefunds', x, { n: n(x) })
          : t(split ? 'ya.ana.nPaidTickets' : 'ya.ana.nTickets', { n: n(x) }));
  const fmtAxis = (x: number) => (metric === 'eur' ? eur(x) : n(x));
  const vs = ev ? t(d.totals.prev_same_day ? 'ya.ana.vsPrevNightSame' : 'ya.ana.vsPrevNight') : t(`ya.ana.per.vs.${m.period}`);
  const dl = deltaPct(v.total, v.ptotal, T);
  const diff = v.total - v.ptotal;
  const heroTitle = isRf ? t('ya.ana.rf.title') : isGl ? t(ev ? 'ya.ana.gl.titleEv' : `ya.ana.gl.title.${v.unit}`) : ev ? t('ya.ana.s.titleEv') : t(`ya.ana.s.title.${v.unit}`);
  const unitVars = { unit: t(`ya.ana.unit.${v.unit}`) };
  const subKey = isRf ? (metric === 'eur' ? 'ya.ana.rf.sub' : 'ya.ana.rf.subN')
    : metric === 'eur' ? (pl === 'tickets' ? 'ya.ana.s.subEur.tickets' : isTb ? 'ya.ana.s.subEur.tables' : 'ya.ana.s.subEur')
      : isTb ? 'ya.ana.s.subBil.tables' : isGl ? 'ya.ana.s.subBil.guestlist' : 'ya.ana.s.subBil';
  const heroSub = `${t(subKey, unitVars)}${mode === 'cumul' ? ` · ${t('ya.ana.s.cumulated')}` : ''}`;
  const bigUnit = isTb ? t('ya.ana.big.tables') : isGl ? t('ya.ana.big.guestlist') : isRf ? t('ya.ana.rf.big') : t(split ? 'ya.ana.paidTickets' : 'ya.ana.tickets');
  const legend = mode === 'cumul' ? t('ya.ana.s.legCumul')
    : isRf ? t('ya.ana.rf.leg', { unit: t(`ya.ana.unitOf.${v.unit}`) })
      : t(metric === 'eur' ? 'ya.ana.s.legEur' : isTb ? 'ya.ana.s.legBil.tables' : isGl ? 'ya.ana.s.legBil.guestlist' : 'ya.ana.s.legBil', { unit: t(`ya.ana.unitOf.${v.unit}`) });
  const share = d.msg?.share ?? null;
  const ratioTxt = v.ratio && v.ratio > 1.05 ? ` ${t(m.mode === 'hour' ? 'ya.ana.s.insRatioH' : 'ya.ana.s.insRatioD', { x: n1(v.ratio) })}` : '';
  const topReason = rf?.reasons[0];
  const insight = rf
    ? (rf.totals.n === 0 ? t('ya.ana.rf.insNone')
      : topReason?.reason ? t('ya.ana.rf.ins', { n: tp('ya.ana.nRefunds', rf.totals.n, { n: n(rf.totals.n) }), r: topReason.reason })
        : t('ya.ana.rf.insNoReason', { n: tp('ya.ana.nRefunds', rf.totals.n, { n: n(rf.totals.n) }) }))
    : isTb ? `${t('ya.ana.s.insTables', { n: n(Number(d.totals.tables ?? 0)) })}${ratioTxt}`
      : isGl ? `${t('ya.ana.s.insGl', { n: n(Number(d.totals.tickets)), p: d.gl_block?.per_night != null ? n1(Number(d.gl_block.per_night)) : '—' })}${ratioTxt}`
        : !d.sends.length
          ? t('ya.ana.s.insNone')
          : `${share !== null ? (money ? t('ya.ana.s.insShare', { pct: pct(share), v: eur(d.msg?.revenue ?? 0) }) : t('ya.ana.s.insShareTk', { pct: pct(share), n: n(d.msg?.tickets ?? 0) })) : ''}${ratioTxt}`.trim();

  // ── Tuiles ──
  const tk = Number(d.totals.tickets);
  // La tuile et le prix moyen comptent les billets PAYANTS : une entrée
  // gratuite n'est pas une vente à 0 € qui ferait baisser le prix moyen.
  const ptk = Number(d.totals.prev_tickets);
  const paidTk = split ? Number(d.totals.paid_tickets) : tk;
  const prevPaidTk = split ? Number(d.totals.prev_paid_tickets) : ptk;
  const freeTk = split ? Number(d.totals.free_tickets) : 0;
  const tkD = f.cmp ? deltaPct(paidTk, prevPaidTk, T) : null;
  // Prix moyen d'un BILLET : le chiffre d'affaires des tables VIP n'y entre pas.
  const avg = money && paidTk > 0 ? (Number(d.totals.revenue) - Number(d.totals.table_money?.revenue ?? 0)) / paidTk : null;
  const pavg = money && prevPaidTk > 0 ? (Number(d.totals.prev_revenue) - Number(d.totals.table_money?.prev_revenue ?? 0)) / prevPaidTk : null;
  const perBuyer = d.totals.buyers > 0 ? tk / d.totals.buyers : null;
  const tarTot = d.tariffs.reduce((s, x) => s + Number(x.tickets), 0) || 1;
  // Le prix moyen d'un BILLET : sa répartition ne montre que des tarifs de billets (une table n'y entre pas).
  const tkTariffs = d.tariffs.filter((x) => x.pillar !== 'tables');
  const t0 = tkTariffs[0]; const t1 = tkTariffs[1];
  const p0 = t0 ? (Number(t0.tickets) / tarTot) * 100 : 0;
  const p1 = t1 ? (Number(t1.tickets) / tarTot) * 100 : 0;
  const fillPct = d.fill.cap ? (Number(d.fill.sold) / Number(d.fill.cap)) * 100 : null;
  const pfillPct = d.fill.prev_cap ? (Number(d.fill.prev_sold) / Number(d.fill.prev_cap)) * 100 : null;
  const pts = (a: number, b: number | null) => (b === null ? undefined : `${a - b >= 0 ? '▲' : '▼'} ${t('ya.ana.pts', { n: n1(Math.abs(a - b)) })} ${t('ya.ana.vsBefore')}`);
  const refund = d.totals.refund_pct;
  const ticketTiles: TileSpec[] = [
    split
      ? { kind: 'spark', label: t('ya.ana.s.t.paid'), value: n(paidTk * prog), delta: tkD ? `${tkD.text} ${t('ya.ana.vsBefore')}` : undefined, dc: tkD && !tkD.up ? 'var(--ya-red-600)' : undefined, cap: freeTk > 0 ? tp('ya.ana.s.t.freeCap', freeTk, { n: n(freeTk) }) : t('ya.ana.s.t.ticketsCap'), values: d.series.map((s) => Number(s.paid_tickets ?? 0)) }
      : { kind: 'spark', label: t('ya.ana.s.t.tickets'), value: n(tk * prog), delta: tkD ? `${tkD.text} ${t('ya.ana.vsBefore')}` : undefined, dc: tkD && !tkD.up ? 'var(--ya-red-600)' : undefined, cap: t('ya.ana.s.t.ticketsCap'), values: d.series.map((s) => Number(s.tickets)) },
    money
      ? { kind: 'stack', label: t('ya.ana.s.t.avg'), value: avg !== null ? eur2(avg * prog) : '—', delta: f.cmp && avg !== null && pavg !== null ? `${avg - pavg >= 0 ? '▲' : '▼'} ${eur2(Math.abs(avg - pavg))} ${t('ya.ana.vsBefore')}` : undefined, dc: avg !== null && pavg !== null && avg < pavg ? 'var(--ya-red-600)' : undefined, cap: t('ya.ana.s.t.avgCap'), parts: [{ w: p0, c: 'var(--ya-red-500)' }, { w: p1, c: 'var(--ya-red-200)' }, { w: 100 - p0 - p1, c: 'var(--ya-sand-300)' }], legL: t0 ? `${t0.deal} ${pct(p0)}` : '', legR: t1 ? `${t1.deal} ${pct(p1)}` : '' }
      : { kind: 'stack', label: t('ya.ana.s.t.perBuyer'), value: perBuyer !== null ? n1(perBuyer * prog) : '—', cap: t('ya.ana.s.t.perBuyerCap'), parts: [{ w: p0, c: 'var(--ya-red-500)' }, { w: p1, c: 'var(--ya-red-200)' }, { w: 100 - p0 - p1, c: 'var(--ya-sand-300)' }], legL: t0 ? `${t0.deal} ${pct(p0)}` : '', legR: t1 ? `${t1.deal} ${pct(p1)}` : '' },
    f.seg !== 'all'
      ? { kind: 'ring', label: t('ya.ana.s.t.segShare'), value: d.seg_share !== null ? pct(Number(d.seg_share) * prog) : '—', cap: t('ya.ana.s.t.segShareCap'), ring: Number(d.seg_share ?? 0) }
      : { kind: 'ring', label: t('ya.ana.s.t.fill'), value: fillPct !== null ? pct(fillPct * prog) : '—', delta: f.cmp && fillPct !== null ? pts(fillPct, pfillPct) : undefined, dc: fillPct !== null && pfillPct !== null && fillPct < pfillPct ? 'var(--ya-red-600)' : undefined, cap: fillPct !== null ? (ev ? t('ya.ana.s.t.fillCapEv', { sold: n(Number(d.fill.sold)), cap: n(Number(d.fill.cap)) }) : tp('ya.ana.s.t.fillCap', Number(d.fill.nights), { n: n(Number(d.fill.nights)), sold: n(Number(d.fill.sold)), cap: n(Number(d.fill.cap)) })) : t('ya.ana.s.t.fillNone'), ring: fillPct ?? 0 },
    { kind: 'hb', label: t('ya.ana.s.t.refunds'), value: refund !== null ? pct(Number(refund) * prog, 1) : '—', delta: f.cmp && refund !== null && d.totals.prev_refund_pct !== null ? `${Number(refund) - Number(d.totals.prev_refund_pct) >= 0 ? '▲' : '▼'} ${t('ya.ana.pts', { n: n1(Math.abs(Number(refund) - Number(d.totals.prev_refund_pct))) })} ${t('ya.ana.vsBefore')}` : undefined, dc: refund !== null && d.totals.prev_refund_pct !== null && Number(refund) > Number(d.totals.prev_refund_pct) ? 'var(--ya-red-600)' : undefined, cap: money && d.totals.refunds.amount !== null ? t('ya.ana.s.t.refundsCap', { a: eur(Number(d.totals.refunds.amount)), b: eur(Number(d.totals.refunds.revenue)) }) : t('ya.ana.s.t.refundsCapTk'), hb: Math.min(100, Number(refund ?? 0) * 10), hbL: t('ya.ana.s.t.refundsBar') },
  ];

  // ── Tuiles d'un pilier (lot 1 du plan combiné) ──
  const stackOf = (rows: { label: string; v: number }[], tot: number) => {
    const a = rows[0]; const b = rows[1];
    // Une légende tient sur une ligne dans une tuile : un nom long est coupé.
    const cut = (x: string) => (x.length > 13 ? `${x.slice(0, 12).trimEnd()}…` : x);
    const pa = a && tot > 0 ? (a.v / tot) * 100 : 0;
    const pb = b && tot > 0 ? (b.v / tot) * 100 : 0;
    return {
      parts: [{ w: pa, c: 'var(--ya-red-500)' }, { w: pb, c: 'var(--ya-red-200)' }, { w: Math.max(0, 100 - pa - pb), c: 'var(--ya-sand-300)' }],
      legL: a ? `${cut(a.label)} ${pct(pa)}` : '', legR: b ? `${cut(b.label)} ${pct(pb)}` : '',
    };
  };
  const dealName = (x: string) => (x === '—' ? t(isGl ? 'ya.ana.gl.house' : 'ya.ana.s.tarNone') : x);
  let tiles: TileSpec[] = ticketTiles;
  if (isTb && d.tables_block) {
    const b = d.tables_block;
    const tb = Number(b.n); const ptb = Number(b.prev_n);
    const tbD = f.cmp ? deltaPct(tb, ptb, T) : null;
    const basket = money && tb > 0 ? Number(d.totals.revenue ?? 0) / tb : null;
    const tfill = b.fill.cap ? (Number(b.fill.sold) / Number(b.fill.cap)) * 100 : null;
    const ptfill = b.prev_fill.cap ? (Number(b.prev_fill.sold) / Number(b.prev_fill.cap)) * 100 : null;
    const engaged = Number(b.engaged.amount ?? 0);
    const deposits = Number(b.deposits.amount ?? 0);
    const depPct = money ? (engaged > 0 ? (deposits / engaged) * 100 : null) : (tb > 0 ? (Number(b.online_n) / tb) * 100 : null);
    const packs = stackOf(d.tariffs.map((x) => ({ label: dealName(x.deal).replace(/^Table · /, ''), v: Number(x.units ?? x.tickets) })), d.tariffs.reduce((a, x) => a + Number(x.units ?? x.tickets), 0));
    const g = b.guests !== null ? n1(Number(b.guests)) : '—';
    tiles = [
      { kind: 'spark', label: t('ya.ana.tb.t.n'), value: n(tb * prog), delta: tbD ? `${tbD.text} ${t('ya.ana.vsBefore')}` : undefined, dc: tbD && !tbD.up ? 'var(--ya-red-600)' : undefined, cap: t('ya.ana.tb.t.nCap'), values: d.series.map((x) => Number(x.tickets)) },
      money
        ? { kind: 'stack', label: t('ya.ana.tb.t.basket'), value: basket !== null ? eur(basket * prog) : '—', cap: b.min_spend.amount !== null ? t('ya.ana.tb.t.basketCap', { min: eur(Number(b.min_spend.amount)), g }) : t('ya.ana.tb.t.basketCapNoMin', { g }), ...packs }
        : { kind: 'stack', label: t('ya.ana.tb.t.perGuests'), value: g, cap: t('ya.ana.tb.t.nCap'), ...packs },
      { kind: 'ring', label: t('ya.ana.tb.t.fill'), value: tfill !== null ? pct(tfill * prog) : '—', delta: f.cmp && tfill !== null ? pts(tfill, ptfill) : undefined, dc: tfill !== null && ptfill !== null && tfill < ptfill ? 'var(--ya-red-600)' : undefined, cap: tfill !== null ? (ev ? t('ya.ana.tb.t.fillCapEv', { sold: n(Number(b.fill.sold)), cap: n(Number(b.fill.cap)) }) : tp('ya.ana.tb.t.fillCap', Number(b.fill.nights), { n: n(Number(b.fill.nights)), sold: n(Number(b.fill.sold)), cap: n(Number(b.fill.cap)) })) : t('ya.ana.tb.t.fillNone'), ring: tfill ?? 0 },
      { kind: 'hb', label: t('ya.ana.tb.t.deposit'), value: depPct !== null ? pct(depPct * prog) : '—', cap: money ? t('ya.ana.tb.t.depositCap', { a: eur(deposits), b: eur(Math.max(0, engaged - deposits)) }) : t('ya.ana.tb.t.depositCapTk', { a: n(Number(b.online_n)), b: n(Number(b.on_site_n)) }), hb: depPct ?? 0, hbL: t(money ? 'ya.ana.tb.t.depositBar' : 'ya.ana.tb.t.depositBarTk') },
    ];
  } else if (isGl) {
    const b = d.gl_block;
    const gl = Number(d.totals.tickets); const pgl = Number(d.totals.prev_tickets);
    const glD = f.cmp ? deltaPct(gl, pgl, T) : null;
    // Venus : seulement sur une porte mesurée, et jamais un pourcentage sous 10 inscrits.
    const came = b && b.signups_measured >= 10 ? (Number(b.came) / Number(b.signups_measured)) * 100 : null;
    const lists = stackOf(d.tariffs.map((x) => ({ label: dealName(x.deal), v: Number(x.tickets) })), d.tariffs.reduce((a, x) => a + Number(x.tickets), 0));
    tiles = [
      { kind: 'spark', label: t('ya.ana.gl.t.n'), value: n(gl * prog), delta: glD ? `${glD.text} ${t('ya.ana.vsBefore')}` : undefined, dc: glD && !glD.up ? 'var(--ya-red-600)' : undefined, cap: t('ya.ana.gl.t.nCap'), values: d.series.map((x) => Number(x.tickets)) },
      { kind: 'ring', label: t('ya.ana.gl.t.came'), value: came !== null ? pct(came * prog) : '—', cap: came !== null && b ? tp('ya.ana.gl.t.cameCap', Number(b.nights_measured), { n: n(Number(b.nights_measured)), came: n(Number(b.came)), s: n(Number(b.signups_measured)) }) : t('ya.ana.gl.t.cameNone'), ring: came ?? 0 },
      { kind: 'stack', label: t('ya.ana.gl.t.lists'), value: n(d.tariffs.length), cap: t('ya.ana.gl.t.listsCap'), ...lists },
      { kind: 'txt', label: t('ya.ana.gl.t.perNight'), value: b?.per_night != null ? n1(Number(b.per_night)) : '—', cap: b ? tp('ya.ana.gl.t.perNightCap', Number(b.nights), { n: n(Number(b.nights)) }) : '', color: 'var(--ya-ink)' },
    ];
  } else if (rf) {
    const amt = Number(rf.totals.revenue ?? 0); const pamt = Number(rf.totals.prev_revenue ?? 0);
    const cnt = Number(rf.totals.n); const pcnt = Number(rf.totals.prev_n);
    // Plus de remboursements, c'est un écart dans le mauvais sens.
    const down = (a: number, b: number) => { const x = deltaPct(a, b, T); return x ? { text: `${x.text} ${t('ya.ana.vsBefore')}`, bad: x.up } : null; };
    const aD = f.cmp ? down(amt, pamt) : null;
    const nD = f.cmp ? down(cnt, pcnt) : null;
    const rTot = rf.reasons.reduce((a, x) => a + Number(x.n), 0);
    const reasons = stackOf(rf.reasons.map((x) => ({ label: x.reason ?? t('ya.ana.rf.noReason'), v: Number(x.n) })), rTot);
    const nCap = t('ya.ana.rf.t.nCap', { t: n(rf.totals.tickets_n), b: n(rf.totals.tables_n), f: n(rf.totals.full) });
    const rate = { ...(ticketTiles[3] as Extract<TileSpec, { kind: 'hb' }>), label: t('ya.ana.rf.t.rate'), hbL: t('ya.ana.rf.t.rateCap') };
    const why: TileSpec = { kind: 'stack', label: t('ya.ana.rf.t.reasons'), value: n(rf.reasons.length), cap: t('ya.ana.rf.t.reasonsCap'), ...reasons };
    // Sans l'accès à l'argent, le nombre de remboursements mène.
    tiles = money
      ? [
        { kind: 'spark', label: t('ya.ana.rf.t.amount'), value: eur(amt * prog), delta: aD?.text, dc: aD?.bad ? 'var(--ya-red-600)' : undefined, cap: t('ya.ana.rf.t.amountCap'), values: rf.series.map((x) => Number(x.revenue ?? 0)) },
        { kind: 'txt', label: t('ya.ana.rf.t.n'), value: n(cnt * prog), delta: nD?.text, dc: nD?.bad ? 'var(--ya-red-600)' : undefined, cap: nCap, color: 'var(--ya-ink)' },
        rate, why,
      ]
      : [
        { kind: 'spark', label: t('ya.ana.rf.t.n'), value: n(cnt * prog), delta: nD?.text, dc: nD?.bad ? 'var(--ya-red-600)' : undefined, cap: nCap, values: rf.series.map((x) => Number(x.tickets)) },
        rate, why,
      ];
  }

  const heroMarks = ev ? [...v.marks, ...reportMarks(night.data, t)] : v.marks;

  return (
    <>
      {ev && (
        <NightHeader
          report={night.data}
          compare={compareNight.data}
          door={door.data ?? null}
          compareId={f.compare}
          onCompare={(id) => setF({ compare: id })}
          nights={scopeNights.data?.nights ?? []}
          rv={rv}
        />
      )}

      {/* Héros */}
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)' }}>
        {/* Le pilier : tout, ou un pilier (billets, tables VIP, guest list, remboursements). */}
        <div className="ya-thin-scroll" style={{ overflowX: 'auto', margin: '-4px', padding: 4 }}>
          <Segmented value={f.pillar} onChange={(x) => setF({ pillar: x })} ariaLabel={t('ya.ana.pl.label')} options={PILLARS.map((k) => ({ value: k, label: t(`ya.ana.pl.${k}`) }))} />
        </div>
        <CardHead
          title={heroTitle}
          sub={heroSub}
          right={(
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {money && <Segmented value={metric} onChange={(x) => setMetric(x)} ariaLabel={heroTitle} options={[{ value: 'eur', label: t('ya.ana.s.eur') }, { value: 'bil', label: t(isTb ? 'ya.ana.s.bil.tables' : isRf ? 'ya.ana.rf.seg.n' : 'ya.ana.s.bil') }]} />}
              <Segmented value={mode} onChange={(x) => setMode(x)} ariaLabel={heroTitle} options={[{ value: 'bucket', label: t('ya.ana.s.per', { unit: t(`ya.ana.unit.${ev ? 'day' : v.unit}`) }) }, { value: 'cumul', label: t('ya.ana.s.cumul') }]} />
            </div>
          )}
        />
        {loading ? <HeroSkeleton /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>
                {metric === 'eur' ? eur(v.total * prog) : n(v.total * prog)}
                {metric === 'bil' && <span style={{ marginLeft: 12, fontSize: 'clamp(20px,2.4vw,28px)', letterSpacing: '-.02em', color: 'var(--ya-sand-500)' }}>{bigUnit}</span>}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                {f.cmp && (dl
                  ? <span style={{ fontSize: 17, fontWeight: 600, color: dl.up !== isRf ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{dl.text} {vs}</span>
                  : <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--ya-sand-500)' }}>{t('ya.ana.noPrev')}</span>)}
                {f.cmp && dl && <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{diff >= 0 ? t('ya.ana.more', { v: fmtVal(Math.abs(diff)) }) : t('ya.ana.less', { v: fmtVal(Math.abs(diff)) })}</span>}
                {split && <TicketSplit paid={d.totals.paid_tickets} free={d.totals.free_tickets} tables={d.totals.tables} mult={prog} style={{ fontSize: 14 }} />}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 13, color: 'var(--ya-sand-600)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 14, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg,var(--ya-tangerine-500),var(--ya-red-500))', display: 'inline-block' }} />{legend}</span>
              {showPrev && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 18, height: 0, borderTop: '2px solid var(--ya-ink)', display: 'inline-block' }} />{ev ? t('ya.ana.prevNight') : t('ya.ana.prevPeriod')}</span>}
              {v.marks.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--ya-ink)', display: 'inline-block' }} />{t('ya.ana.sendMark')}</span>}
            </div>
            <TrendChart
              kind={mode === 'cumul' ? 'area' : 'bars'}
              cur={v.cur}
              prev={v.prev}
              showPrev={showPrev}
              marks={heroMarks}
              go={go}
              fy={fmtAxis}
              tipTitle={(i) => bucketTitle(m, i, T, jl)}
              tipValue={fmtVal}
              tipPrev={(x) => `${ev ? t('ya.ana.prevNight') : t('ya.ana.prevPeriod')} : ${fmtVal(x)}`}
              xl={xLabels(m, T, jl)}
            />
            {isRf ? <Takeaway>{insight}</Takeaway> : <Takeaway cta={t('ya.ana.s.insCta')} onCta={() => goTab('traffic')}>{insight}</Takeaway>}
          </div>
        )}
      </section>

      {/* Tuiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      {/* Une soirée choisie : son objectif d'entrées et sa porte. */}
      {ev && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
          <TargetCard report={night.data} compare={compareNight.data} rv={rv} go={go} />
          <DoorCard door={door.data ?? null} loading={door.isLoading} rv={rv} go={go} />
        </div>
      )}

      {/* Objectif + courbe : la jauge des billets, pour « Tout » et « Billets ». */}
      {(pl === 'all' || pl === 'tickets') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
          <GoalCard d={d} loading={loading} rv={rv} go={go} prog={prog} />
          <CurveCard d={d} loading={loading} rv={rv} go={go} />
        </div>
      )}

      {/* Remboursements : les motifs et les soirées qui remboursent. */}
      {rf && <RefundCards rf={rf} money={money} loading={loading} rv={rv} go={go} />}

      {/* Heure des achats + tarifs */}
      {!rf && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ ...card, flex: '1 1 440px' }}>
          <CardHead title={t(isGl ? 'ya.ana.gl.heatT' : 'ya.ana.s.heatT')} sub={isGl ? t('ya.ana.gl.heatSub') : d.heat.days30 ? t('ya.ana.s.heatSub30') : t('ya.ana.s.heatSub')} />
          {loading ? <Sk h={280} r={16} /> : (() => {
            const cells = d.heat.cells;
            const max = Math.max(1, ...cells.flat().map((c) => c.n));
            let best: [number, number] = [0, 0];
            cells.forEach((row, r) => row.forEach((c, k) => { if (c.n > cells[best[0]][best[1]].n) best = [r, k]; }));
            const sel = (hh ?? `${best[0]}-${best[1]}`).split('-').map(Number);
            const cell = cells[sel[0]]?.[sel[1]];
            const day = (r: number, len: 'long' | 'short') => DAYS_REF[r].toLocaleDateString(T.locale, { weekday: len });
            const slot = (k: number) => `${hourShort(SLOT_START[k], lang)}–${hourShort((SLOT_START[k] + 2) % 24, lang)}`;
            const anyBuy = cells.flat().some((c) => c.n > 0);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...fadeIn(rv, 180) }}>
                <div style={{ display: 'grid', gridTemplateColumns: '44px repeat(8,minmax(0,1fr))', gap: 4, alignItems: 'center' }}>
                  <span />
                  {SLOT_START.map((h, k) => <span key={k} style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 10, textAlign: 'center', color: 'var(--ya-sand-500)', whiteSpace: 'nowrap' }}>{hourShort(h, lang)}</span>)}
                  {cells.map((row, r) => [
                    <span key={`l${r}`} style={{ fontSize: 12, color: 'var(--ya-sand-600)', textTransform: 'capitalize' }}>{day(r, 'short')}</span>,
                    ...row.map((c, k) => {
                      const a = c.n / max;
                      const key = `${r}-${k}`;
                      const on = (hh ?? `${best[0]}-${best[1]}`) === key;
                      return (
                        <div
                          key={key}
                          onMouseEnter={() => setHh(key)}
                          style={{ height: 30, borderRadius: 7, background: `color-mix(in oklab, #E8192C ${Math.round(8 + a * 92)}%, var(--ya-red-50))`, transform: `scale(${go ? 1 : 0.6})`, opacity: go ? 1 : 0, transition: go ? `transform 500ms ease-out ${(r + k) * 35}ms,opacity 500ms ${(r + k) * 35}ms,box-shadow 120ms` : 'none', boxShadow: on ? '0 0 0 2px var(--ya-ink)' : 'none', cursor: 'crosshair' }}
                        />
                      );
                    }),
                  ])}
                </div>
                <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--ya-sand-50)', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {cell ? `${day(sel[0], 'long')}, ${slot(sel[1])} : ${isGl ? tp('ya.ana.nSignups', cell.n, { n: n(cell.n) }) : tp('ya.ana.s.buys', cell.n, { n: n(cell.n) })}${money && cell.amount !== null ? ` · ${eur(Number(cell.amount))}` : ''}` : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ya-sand-700)', flex: '1 1 220px', textWrap: 'pretty' }}>
                    {anyBuy ? t('ya.ana.s.best', { day: day(best[0], 'long'), slot: slot(best[1]) }) : t('ya.ana.s.heatEmpty')}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ya-sand-500)' }}>
                    {t('ya.ana.less2')}
                    {[10, 40, 70].map((p) => <i key={p} style={{ width: 14, height: 14, borderRadius: 4, background: `color-mix(in oklab,#E8192C ${p}%,var(--ya-red-50))` }} />)}
                    <i style={{ width: 14, height: 14, borderRadius: 4, background: '#E8192C' }} />
                    {t('ya.ana.more2')}
                  </span>
                </div>
              </div>
            );
          })()}
        </section>
        {ev ? <LinesCard report={night.data} pillar={pl} money={money} rv={rv} go={go} /> : (
        <section style={{ ...card, flex: '1.2 1 460px', gap: 16 }}>
          <CardHead title={t(isTb ? 'ya.ana.s.tarT.tables' : isGl ? 'ya.ana.s.tarT.guestlist' : 'ya.ana.s.tarT')} sub={t(isTb ? 'ya.ana.s.tarSub.tables' : isGl ? 'ya.ana.s.tarSub.guestlist' : 'ya.ana.s.tarSub')} />
          {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Sk key={i} h={36} />)}</div> : d.tariffs.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.s.tarEmpty')}</p>
          ) : (() => {
            // Une table VIP n'a pas de place de billetterie : sa barre suit son
            // chiffre d'affaires (ou son nombre de tables), jamais la part des billets.
            const mx = Math.max(1, ...d.tariffs.map((x) => Number(x.tickets)));
            const isTable = (x: AnaSales['tariffs'][number]) => x.pillar === 'tables';
            const tabMx = Math.max(1, ...d.tariffs.filter(isTable).map((x) => (money ? Number(x.revenue ?? 0) : Number(x.units ?? 0))));
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...fadeIn(rv, 100) }}>
                {d.tariffs.map((x, i) => (
                  <div key={i} onMouseEnter={() => setTh(i)} onMouseLeave={() => setTh(null)} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,150px) minmax(0,1fr) 92px', gap: 14, alignItems: 'center', padding: '9px 10px', margin: '0 -10px', borderRadius: 12, background: th === i ? 'var(--ya-sand-50)' : 'transparent', transition: 'background 140ms' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dealName(x.deal)}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{x.price === null ? '—' : Number(x.price) === 0 ? t('ya.ana.free') : eur2(Number(x.price))}</span>
                    </span>
                    <Fill pct={isTable(x) ? ((money ? Number(x.revenue ?? 0) : Number(x.units ?? 0)) / tabMx) * 100 : (Number(x.tickets) / mx) * 100} go={go} delay={i * 80} h={12} bg={th === i ? 'var(--ya-gradient-brand)' : isTable(x) ? 'var(--ya-amber-500)' : 'var(--ya-red-200)'} dur={800} />
                    <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{isTable(x) ? tp('ya.ana.s.nTables', Number(x.units ?? 0), { n: n(Number(x.units ?? 0)) }) : pct((Number(x.tickets) / tarTot) * 100)}</b>
                      <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{money && x.revenue !== null ? eur(Number(x.revenue)) : isGl ? tp('ya.ana.nSignups', Number(x.tickets), { n: n(Number(x.tickets)) }) : t('ya.ana.nTickets', { n: n(Number(x.tickets)) })}</span>
                    </span>
                  </div>
                ))}
                <p style={{ margin: '10px 0 0', fontSize: 14.5, lineHeight: 1.45, color: 'var(--ya-sand-700)', textWrap: 'pretty' }}>
                  {t(isTb ? 'ya.ana.s.tarTxt.tables' : isGl ? 'ya.ana.s.tarTxt.guestlist' : 'ya.ana.s.tarTxt', { deal: dealName(d.tariffs[0].deal), pct: pct((Number(d.tariffs[0].tickets) / tarTot) * 100) })}
                </p>
              </div>
            );
          })()}
        </section>
        )}
      </div>}

      {/* Ce qui a fait vendre : les sources, les messages, qui vous découvre. */}
      {pl === 'all' && <SalesMade q={made} detail={madeDetail} f={f} money={money} goTab={goTab} onWrite={() => navigate(R.campaigns)} />}

      {/* Soirées */}
      {!rf && <section style={{ ...card, gap: 16 }}>
        <CardHead
          title={t('ya.ana.s.evT')}
          sub={t('ya.ana.s.evSub')}
          right={f.event && m.event ? (
            <Hv as="button" type="button" onClick={() => setF({ event: null })} style={{ height: 34, padding: '0 12px 0 14px', border: 0, borderRadius: 99, background: 'var(--ya-red-50)', color: 'var(--ya-red-700)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} hover={{ background: 'var(--ya-red-100)' }}>
              {m.event.title} · {dShort(m.event.start_at)}<Icon name="x" size={14} stroke={2.4} />
            </Hv>
          ) : undefined}
        />
        {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Sk key={i} h={56} r={14} />)}</div> : d.events.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.s.evEmpty')}</p>
        ) : (() => {
          // Une table ou une inscription se compte une par une ; un billet payant, en places.
          const tkOf = (e: AnaSales['events'][number]) => Number(isTb ? e.tables ?? e.tickets : isGl ? e.tickets : e.paid ?? e.tickets);
          const cntLabel = (e: AnaSales['events'][number], x: number) => (isTb ? tp('ya.ana.s.nTables', x, { n: n(x) }) : isGl ? tp('ya.ana.nSignups', x, { n: n(x) }) : t(e.paid !== undefined ? 'ya.ana.nPaidTickets' : 'ya.ana.nTickets', { n: n(x) }));
          const amtMax = Math.max(1, ...d.events.map((e) => (money ? Number(e.revenue ?? 0) : tkOf(e))));
          // La porte de chaque soirée ; le bilan de toute la soirée, sous « Tout » et pour qui voit l'argent.
          const showBal = money && pl === 'all';
          // Sous « Tout » : la part de nouveaux clients de chaque soirée (déplacée depuis Trafic).
          const showNew = pl === 'all' && newBy.size > 0;
          const grid = `minmax(190px,1.4fr) minmax(170px,1.1fr) minmax(140px,.9fr) minmax(120px,.8fr)${showBal ? ' minmax(150px,.9fr)' : ''}${showNew ? ' 84px' : ''} 96px`;
          return (
            <div style={{ overflowX: 'auto', ...fadeIn(rv, 100) }} className="ya-thin-scroll">
              <div style={{ minWidth: (showBal ? 940 : 800) + (showNew ? 90 : 0), display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, padding: '0 12px 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
                  <span>{t('ya.ana.col.night')}</span><span>{t(isTb ? 'ya.ana.col.tablesFill' : 'ya.ana.col.fill')}</span><span>{t(isGl ? 'ya.ana.col.periodSignups' : 'ya.ana.col.periodSales')}</span><span>{t('ya.ana.col.entries')}</span>
                  {showBal && <span>{t('ya.ana.col.balance')}</span>}
                  {showNew && <span style={{ textAlign: 'right' }} title={t('ya.ana.col.newClients')}>{t('ya.ana.col.newShare')}</span>}
                  <span style={{ textAlign: 'right' }}>{t('ya.ana.col.vsPrev')}</span>
                </div>
                {d.events.map((e, i) => {
                  // Tables VIP : la soirée se remplit en tables (réservées / en vente).
                  const tf = isTb ? e.tables_fill ?? null : null;
                  const fSold = tf ? Number(tf.sold) : Number(e.sold);
                  const fCap = tf ? (tf.cap ? Number(tf.cap) : null) : (e.cap ? Number(e.cap) : null);
                  const fillP = fCap ? (fSold / fCap) * 100 : null;
                  const on = f.event === e.id;
                  const amt = money ? Number(e.revenue ?? 0) : tkOf(e);
                  const dlt = e.upcoming ? null : (e.prev_sold && Number(e.prev_sold) > 0 ? (Number(e.sold) - Number(e.prev_sold)) / Number(e.prev_sold) : null);
                  return (
                    <div
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setF({ event: on ? null : e.id })}
                      onKeyDown={(k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); setF({ event: on ? null : e.id }); } }}
                      onMouseEnter={() => setRowH(e.id)}
                      onMouseLeave={() => setRowH(null)}
                      style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, alignItems: 'center', padding: 12, borderRadius: 14, background: on ? 'var(--ya-red-50)' : rowH === e.id ? 'var(--ya-sand-50)' : 'transparent', cursor: 'pointer', transition: 'background 140ms' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
                          <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{dShort(e.start_at)}</span>
                        </span>
                        <StatePill state={e.state} label={t(`ya.ana.state.${e.state}`)} />
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ya-sand-600)', fontVariantNumeric: 'tabular-nums' }}>
                          <span>{fCap ? `${n(fSold)} / ${n(fCap)}` : tf ? tp('ya.ana.s.nTables', fSold, { n: n(fSold) }) : t('ya.ana.nTickets', { n: n(fSold) })}</span>
                          <b style={{ color: 'var(--ya-ink)' }}>{fillP !== null ? pct(fillP) : '—'}</b>
                        </span>
                        <Fill pct={fillP ?? 0} go={go} delay={i * 90} />
                        {(pl === 'all' || pl === 'tickets') && <TicketSplit paid={e.paid} free={e.free} tables={e.tables} style={{ fontSize: 12.5 }} />}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{money ? eur(amt) : cntLabel(e, amt)}</b>
                        <Fill pct={(amt / amtMax) * 100} go={go} delay={i * 90} h={4} bg="var(--ya-ink)" />
                      </span>
                      <DoorCell door={e.door ?? null} upcoming={e.upcoming} go={go} delay={i * 90} />
                      {showBal && <BalanceCell night={e.balance ?? null} upcoming={e.upcoming} />}
                      {showNew && (() => {
                        const nb = newBy.get(e.id);
                        return <span style={{ textAlign: 'right', fontSize: 14, color: 'var(--ya-sand-700)', fontVariantNumeric: 'tabular-nums' }}>{!nb || nb.of === 0 ? '—' : nb.of >= 10 ? pct((nb.n / nb.of) * 100) : n(nb.n)}</span>;
                      })()}
                      <span style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: e.upcoming ? 'var(--ya-sand-500)' : dlt === null ? 'var(--ya-sand-400)' : dlt >= 0 ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>
                        {e.upcoming ? t('ya.ana.s.ongoing') : dlt === null ? '—' : `${dlt >= 0 ? '▲' : '▼'} ${pct(Math.abs(dlt) * 100)}`}
                      </span>
                    </div>
                  );
                })}
                {d.events_other && (
                  <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, padding: 12, fontSize: 14.5, color: 'var(--ya-sand-600)' }}>
                    <span>{tp('ya.ana.s.others', d.events_other.count, { n: n(d.events_other.count) })}</span><span />
                    <b style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ya-ink)' }}>{money && d.events_other.revenue !== null ? eur(Number(d.events_other.revenue)) : isTb ? tp('ya.ana.s.nTables', Number(d.events_other.tickets), { n: n(Number(d.events_other.tickets)) }) : isGl ? tp('ya.ana.nSignups', Number(d.events_other.tickets), { n: n(Number(d.events_other.tickets)) }) : t('ya.ana.nTickets', { n: n(Number(d.events_other.tickets)) })}</b><span />{showBal && <span />}{showNew && <span />}<span />
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </section>}

      {/* « Tout » : ce que vous touchez. Un pilier : ce qui a fait vendre. */}
      {pl === 'all' && money && d.payout ? <PayoutCard p={d.payout} rv={rv} prog={prog} /> : !rf && <section style={{ ...nightCard, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '20px 32px', padding: '28px 32px', ...fadeIn(rv, 120) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-text-on-night-2)' }}>{t('ya.ana.s.madeT')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 22px' }}>
            <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(56px,7vw,88px)', lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{share !== null ? pct(Number(share) * prog) : '—'}</span>
            <span style={{ fontSize: 16, lineHeight: 1.4, color: 'var(--ya-text-on-night-2)', maxWidth: 440, paddingBottom: 8 }}>
              {money ? t('ya.ana.s.madeS', { v: eur(Number(d.msg?.revenue ?? 0)) }) : isGl ? t('ya.ana.s.madeSGl', { n: n(Number(d.msg?.tickets ?? 0)) }) : t('ya.ana.s.madeSTk', { n: n(Number(d.msg?.tickets ?? 0)) })}
            </span>
          </div>
        </div>
        <BrandArrowButton label={t('ya.ana.s.madeCta')} onClick={() => navigate(R.campaigns)} />
      </section>}
      <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)', marginTop: -8 }}>{t('ya.ana.s.foot', { h: hourShort(m.night_end_hour, lang), date: dLong(m.now) })}</span>
      {isTb && <TablesKept period={f.period} eventId={f.event} />}
    </>
  );
}

function hourShort(h: number, lang: string): string {
  if (lang !== 'en') return `${h} h`;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function HeroSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <Sk h={72} w="min(360px,60%)" r={14} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Sk h={16} w={150} /><Sk h={12} w={100} /></div>
      </div>
      <ChartSkeleton />
      <Sk h={48} r={16} />
    </div>
  );
}

function SalesSkeleton() {
  return (
    <>
      <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={280} /><HeroSkeleton /></section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)}</div>
    </>
  );
}

// ── Soirées : la porte et le bilan ───────────────────────────────────────

/** Entrées d'une soirée passée (en personnes), seulement sur une porte mesurée. */
function DoorCell({ door, upcoming, go, delay }: { door: AnaSales['events'][number]['door'] | null; upcoming: boolean; go: boolean; delay: number }) {
  const { t, n, pct } = useTixT();
  if (upcoming || !door) return <span style={{ fontSize: 14, color: 'var(--ya-sand-400)' }}>—</span>;
  if (!door.measured) return <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{t('ya.ana.s.doorNone')}</span>;
  const p = door.expected > 0 ? (door.entered / door.expected) * 100 : null;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 13, color: 'var(--ya-sand-600)', fontVariantNumeric: 'tabular-nums' }}>
        <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', color: 'var(--ya-ink)' }}>{n(door.entered)}</b>
        {/* Jamais un pourcentage sous 10 personnes attendues. */}
        <span>{p !== null && door.expected >= 10 ? pct(p) : ''}</span>
      </span>
      <Fill pct={p ?? 0} go={go} delay={delay} h={4} bg="var(--ya-green-500)" />
      <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.s.doorOf', { n: n(door.expected) })}</span>
    </span>
  );
}

/** Bilan de toute la soirée : CA (tous piliers) − cachets DJ = ce qui reste. */
function BalanceCell({ night, upcoming }: { night: AnaSales['events'][number]['balance'] | null; upcoming: boolean }) {
  const { t, eur } = useTixT();
  if (!night || night.revenue === null) return <span style={{ fontSize: 14, color: 'var(--ya-sand-400)' }}>—</span>;
  const fees = Number(night.fees.amount ?? 0);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{eur(Number(night.rest.amount ?? 0))}</b>
      <span style={{ fontSize: 12.5, lineHeight: 1.35, color: 'var(--ya-sand-500)' }}>
        {upcoming ? t('ya.ana.s.balSoFar') : fees > 0 ? t('ya.ana.s.balCap', { a: eur(Number(night.revenue)), b: eur(fees) }) : t('ya.ana.s.balCapNo')}
      </span>
    </span>
  );
}

// ── « Ce que vous touchez » (pilier Tout) ────────────────────────────────

function PayoutCard({ p, rv, prog }: { p: TixPayout; rv: boolean; prog: number }) {
  const { t, tp, n, eur } = useTixT();
  const gross = Number(p.gross.amount ?? 0);
  const refunds = Number(p.refunds.amount ?? 0);
  const stripe = Number(p.stripe.amount ?? 0);
  const net = Number(p.net.amount ?? 0);
  const onSite = Number(p.on_site.amount ?? 0);
  // Votre part : seulement s'il y a au moins une co-soirée dont le contrat se lit vente par vente.
  const share = p.share && p.share.nights > 0 ? p.share : null;
  const unknown = p.share?.unknown ?? 0;
  const big = share ? Number(share.amount ?? 0) : net;
  const cells: { l: string; v: string; c: string; strong?: boolean }[] = [
    { l: t('ya.ana.po.gross'), v: eur(gross), c: tp('ya.ana.po.grossCap', p.gross.n, { n: n(p.gross.n) }) },
    { l: t('ya.ana.po.refunds'), v: refunds > 0 ? `− ${eur(refunds)}` : eur(0), c: tp('ya.ana.po.refundsCap', p.refunds.n, { n: n(p.refunds.n) }) },
    { l: t('ya.ana.po.stripe'), v: stripe > 0 ? `− ${eur(stripe)}` : eur(0), c: t('ya.ana.po.stripeCap') },
    { l: t('ya.ana.po.net'), v: eur(net), c: t('ya.ana.po.netCap'), strong: true },
  ];
  if (share) cells.push({ l: t('ya.ana.po.share'), v: eur(Number(share.amount ?? 0)), c: tp('ya.ana.po.shareCap', share.nights, { n: n(share.nights) }), strong: true });
  const muted = 'var(--ya-text-on-night-2)';
  return (
    <section style={{ ...nightCard, display: 'flex', flexDirection: 'column', gap: 22, padding: 'clamp(22px,2.6vw,32px)', ...fadeIn(rv, 120) }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: muted }}>{t('ya.ana.po.t')}</span>
        {p.gross.n === 0 ? (
          <span style={{ fontSize: 16, color: muted }}>{t('ya.ana.po.empty')}</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 22px' }}>
            <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(48px,6.4vw,84px)', lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{eur(big * prog)}</span>
            <span style={{ fontSize: 16, lineHeight: 1.4, color: muted, maxWidth: 440, paddingBottom: 8 }}>{t(share ? 'ya.ana.po.shareBig' : 'ya.ana.po.netBig')}</span>
          </div>
        )}
      </div>
      {p.gross.n > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 0, borderTop: '1px solid rgba(255,255,255,.1)' }}>
          {cells.map((c, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 18px 4px 0', borderRight: i < cells.length - 1 ? '1px solid rgba(255,255,255,.08)' : 'none', paddingLeft: i > 0 ? 18 : 0, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: muted }}>{c.l}</span>
              <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: c.strong ? 26 : 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: c.strong ? '#fff' : 'var(--ya-text-on-night)' }}>{c.v}</b>
              <span style={{ fontSize: 12.5, lineHeight: 1.35, color: muted }}>{c.c}</span>
            </div>
          ))}
        </div>
      )}
      {(onSite > 0 || unknown > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13.5, lineHeight: 1.45, color: muted }}>
          {onSite > 0 && <span>{t('ya.ana.po.onSite', { v: eur(onSite) })}</span>}
          {unknown > 0 && <span>{tp('ya.ana.po.unknown', unknown, { n: n(unknown) })}</span>}
        </div>
      )}
    </section>
  );
}

// ── Remboursements : les motifs, les soirées qui remboursent ─────────────

function RefundCards({ rf, money, loading, rv, go }: { rf: TixRefundsBlock; money: boolean; loading: boolean; rv: boolean; go: boolean }) {
  const { t, tp, n, eur, pct, dShort } = useTixT();
  const maxR = Math.max(1, ...rf.reasons.map((r) => Number(r.n)));
  const empty = <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.rf.empty')}</p>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
      <section style={{ ...card, flex: '1 1 400px', gap: 16 }}>
        <CardHead title={t('ya.ana.rf.whyT')} sub={t('ya.ana.rf.whySub')} />
        {loading ? <Sk h={220} r={16} /> : rf.reasons.length === 0 ? empty : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...fadeIn(rv, 100) }}>
            {rf.reasons.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,170px) minmax(0,1fr) auto', gap: 14, alignItems: 'center', padding: '9px 0' }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.reason ? 'var(--ya-ink)' : 'var(--ya-sand-500)' }}>{r.reason ?? t('ya.ana.rf.noReason')}</span>
                <Fill pct={(Number(r.n) / maxR) * 100} go={go} delay={i * 80} h={12} bg="var(--ya-red-200)" dur={800} />
                <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                  <b style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{tp('ya.ana.nRefunds', Number(r.n), { n: n(Number(r.n)) })}</b>
                  {money && r.revenue !== null && <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{eur(Number(r.revenue))}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section style={{ ...card, flex: '1.3 1 480px', gap: 16 }}>
        <CardHead title={t('ya.ana.rf.evT')} sub={t('ya.ana.rf.evSub')} />
        {loading ? <Sk h={220} r={16} /> : rf.events.length === 0 ? empty : (
          <div style={{ overflowX: 'auto', ...fadeIn(rv, 100) }} className="ya-thin-scroll">
            <div style={{ minWidth: 520, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.4fr) minmax(200px,1fr) 100px', gap: 16, padding: '0 0 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
                <span>{t('ya.ana.col.night')}</span><span>{t('ya.ana.rf.col.refunds')}</span><span style={{ textAlign: 'right' }}>{money ? t('ya.ana.rf.col.amount') : ''}</span>
              </div>
              {rf.events.map((e) => {
                // Jamais un pourcentage sous 10 ventes.
                const rate = e.sales >= 10 ? (Number(e.n) / Number(e.sales)) * 100 : null;
                return (
                  <div key={e.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.4fr) minmax(200px,1fr) 100px', gap: 16, alignItems: 'center', padding: '11px 0', borderTop: '1px solid var(--ya-sand-100)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
                        <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{dShort(e.start_at)}</span>
                      </span>
                      <StatePill state={e.state} label={t(`ya.ana.state.${e.state}`)} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, fontVariantNumeric: 'tabular-nums' }}>
                      <b style={{ fontSize: 15, whiteSpace: 'nowrap' }}>{tp('ya.ana.nRefunds', Number(e.n), { n: n(Number(e.n)) })}{rate !== null ? ` · ${pct(rate)}` : ''}</b>
                      <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.rf.ofSales', { n: n(Number(e.sales)) })}</span>
                    </span>
                    <b style={{ textAlign: 'right', fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{money && e.revenue !== null ? eur(Number(e.revenue)) : ''}</b>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Objectif de la soirée ────────────────────────────────────────────────

function goalModel(d: AnaSales) {
  const g = d.goal;
  if (!g) return null;
  const tg = g.target;
  const capOf = (c: { cap: number | null; sold: number }) => (c.cap && c.cap > 0 ? Number(c.cap) : null);
  const tCap = capOf(tg);
  // Références : part de leur jauge (ou de leur vente finale) atteinte chaque jour.
  const refPct = g.refs.map((r) => {
    const base = capOf(r) ?? (Number(r.sold) || 1);
    return r.curve.map((x) => (x === null ? null : (Number(x) / base) * 100));
  });
  const kn = Math.max(0, tg.curve.reduce((a, x, i) => (x !== null ? i : a), 0));
  const base = tCap ?? (g.refs.length ? g.refs.reduce((s, r) => s + Number(r.sold), 0) / g.refs.length : null);
  const curPct = tg.curve.map((x) => (x === null || !base ? null : (Number(x) / base) * 100));
  const ra = refPct.length
    ? Array.from({ length: 22 }, (_, i) => {
      const vs = refPct.map((a) => a[i]).filter((x): x is number => x !== null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    })
    : null;
  return { g, tg, tCap, base, kn, curPct, refPct, ra };
}

function GoalCard({ d, loading, rv, go, prog }: { d: AnaSales; loading: boolean; rv: boolean; go: boolean; prog: number }) {
  const { t, n, pct, dShort } = useTixT();
  const gm = goalModel(d);
  const head = (sub: string, badge?: { label: string; bg: string; fg: string }) => (
    <CardHead title={t('ya.ana.g.t')} sub={sub} right={badge ? <span style={{ flex: 'none', height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12.5, fontWeight: 600, background: badge.bg, color: badge.fg }}>{badge.label}</span> : undefined} />
  );
  if (!gm) {
    return (
      <section style={{ ...card, flex: '1 1 380px' }}>
        {head(t('ya.ana.g.none'))}
        {loading ? <Sk h={300} r={16} /> : <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.g.noneTxt')}</p>}
      </section>
    );
  }
  const { tg, tCap, base, kn, curPct, ra } = gm;
  const sold = Number(tg.sold);
  const up = tg.upcoming;
  const left = tg.days_left;
  const pctNow = curPct[kn] ?? 0;
  const exp = ra ? ra[kn] : null;
  const rate = d.goal ? Number(d.goal.week_sold) / 7 : 0;
  let fin: number | null = null; let fullAt: number | null = null;
  if (up && ra && ra[kn] && ra[kn]! > 0 && ra[21]) {
    fin = (pctNow * ra[21]!) / ra[kn]!;
    for (let i = kn; i < 22; i++) { const r = ra[i]; if (r !== null && (pctNow * r) / ra[kn]! >= 100) { fullAt = i; break; } }
  }
  const sub = `${tg.title} · ${dShort(tg.start_at)} · ${up ? (left > 0 ? t('ya.ana.jMinus', { k: left }) : t('ya.ana.g.tonight')) : t('ya.ana.g.past')}`;
  let badge: { label: string; bg: string; fg: string };
  if (!up) badge = { label: t('ya.ana.g.ended'), bg: 'var(--ya-sand-100)', fg: 'var(--ya-sand-600)' };
  else if (tCap && sold >= tCap) badge = { label: t('ya.ana.g.full'), bg: 'var(--ya-green-50)', fg: 'var(--ya-green-700)' };
  else if (exp === null) badge = { label: t('ya.ana.g.selling'), bg: 'var(--ya-sand-100)', fg: 'var(--ya-sand-700)' };
  else if (pctNow >= exp) badge = { label: t('ya.ana.g.ahead'), bg: 'var(--ya-green-50)', fg: 'var(--ya-green-700)' };
  else if (pctNow >= exp - 5) badge = { label: t('ya.ana.g.onPace'), bg: 'var(--ya-sand-100)', fg: 'var(--ya-sand-700)' };
  else badge = { label: t('ya.ana.g.behind'), bg: 'var(--ya-amber-50)', fg: 'var(--ya-amber-700)' };
  const free = tCap ? Math.max(0, tCap - sold) : null;
  type Row = { l: string; v: string; c?: string; mk?: boolean };
  let rows: Row[]; let text: string;
  if (up) {
    const places = fin !== null && base ? Math.round((Math.min(fin, tCap ? 100 : fin) / 100) * base) : null;
    rows = [
      { l: t('ya.ana.g.rate'), v: t('ya.ana.g.perDay', { n: n(rate) }) },
      left > 0 && free !== null
        ? { l: t('ya.ana.g.needed'), v: t('ya.ana.g.perDay', { n: n(Math.ceil(free / left)) }) }
        : { l: t('ya.ana.g.left'), v: free !== null ? n(free) : '—' },
      exp !== null && base ? { l: t('ya.ana.g.expected'), v: n((exp / 100) * base), mk: true } : { l: t('ya.ana.g.sold'), v: n(sold) },
      { l: t('ya.ana.g.proj'), v: fullAt !== null ? (fullAt === 21 ? t('ya.ana.g.fullDay') : t('ya.ana.g.fullAt', { k: 21 - fullAt })) : places !== null ? `≈ ${n(places)}` : '—', c: fin !== null && fin >= 90 ? 'var(--ya-green-700)' : 'var(--ya-amber-700)' },
    ];
    text = fullAt !== null
      ? t(fullAt === 21 ? 'ya.ana.g.txtFullDay' : 'ya.ana.g.txtFullAt', { k: 21 - fullAt })
      : places !== null && tCap
        ? t('ya.ana.g.txtMissing', { n: n(Math.max(0, tCap - places)) })
        : free !== null ? t('ya.ana.g.txtLeft', { n: n(free) }) : t('ya.ana.g.txtNoCap');
  } else {
    const p = tCap ? (sold / tCap) * 100 : null;
    rows = [
      { l: t('ya.ana.g.sold'), v: tCap ? `${n(sold)} / ${n(tCap)}` : n(sold) },
      { l: t('ya.ana.g.free'), v: free !== null ? n(free) : '—' },
      // Ventes réellement faites sur les 21 jours de la courbe (cumul J-0 − J-21).
      { l: t('ya.ana.g.avgRate'), v: t('ya.ana.g.perDay', { n: n(Math.max(0, Number(tg.curve[21] ?? sold) - Number(tg.curve[0] ?? 0)) / 21) }) },
      { l: t('ya.ana.g.fill'), v: p === null ? '—' : p >= 100 ? t('ya.ana.g.full') : pct(p), c: p !== null && p >= 100 ? 'var(--ya-green-700)' : undefined },
    ];
    text = p !== null ? t('ya.ana.g.txtPast', { pct: pct(p), sold: n(sold), cap: n(tCap!) }) : t('ya.ana.g.txtPastNoCap', { sold: n(sold) });
  }
  return (
    <section style={{ ...card, flex: '1 1 380px' }}>
      {head(sub, loading ? undefined : badge)}
      {loading ? <Sk h={300} r={16} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...fadeIn(rv, 60) }}>
          <Gauge pct={base ? (sold / base) * 100 : 0} mark={up && exp !== null ? exp : null} go={go} big={n(sold * prog)} cap={tCap ? `/ ${n(tCap)}` : ''} label={t('ya.ana.g.placesSold')} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '11px 0', borderTop: '1px solid var(--ya-sand-100)', fontSize: 14, color: 'var(--ya-sand-600)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{r.mk && <i style={{ display: 'inline-block', width: 12, height: 2.5, borderRadius: 2, background: 'var(--ya-ink)' }} />}{r.l}</span>
                <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 16, fontVariantNumeric: 'tabular-nums', color: r.c ?? 'var(--ya-ink)' }}>{r.v}</b>
              </div>
            ))}
          </div>
          <Takeaway size={14.5}>{text}{!tCap && base ? ` ${t('ya.ana.g.noCapNote')}` : ''}</Takeaway>
        </div>
      )}
    </section>
  );
}

function CurveCard({ d, loading, rv, go }: { d: AnaSales; loading: boolean; rv: boolean; go: boolean }) {
  const { t, n, pct, dShort } = useTixT();
  const gm = goalModel(d);
  const jl = jLabelFor(t);
  if (!gm) {
    return (
      <section style={{ ...card, flex: '1.3 1 520px' }}>
        <CardHead title={t('ya.ana.c.t')} />
        {loading ? <Sk h={280} r={16} /> : <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.g.noneTxt')}</p>}
      </section>
    );
  }
  const { g, tg, tCap, base, kn, curPct, refPct, ra } = gm;
  const usePct = !!base;
  const toV = (arr: (number | null)[], raw: (number | null)[]) => (usePct ? arr : raw.map((x) => (x === null ? null : Number(x))));
  const target = toV(curPct.map((x, i) => (i <= kn ? x : null)), tg.curve.map((x, i) => (i <= kn ? x : null)));
  const lines: CurveLine[] = [{ name: `${tg.title} · ${dShort(tg.start_at)}`, c: 'var(--ya-red-500)', w: 3, dash: '', vals: target }];
  const refColors = ['var(--ya-ink)', 'var(--ya-sand-400)'];
  g.refs.forEach((r, k) => lines.push({ name: `${r.title} · ${dShort(r.start_at)}`, c: refColors[k], w: 1.8, dash: '', vals: toV(refPct[k], r.curve) }));
  let proj: (number | null)[] | null = null;
  if (tg.upcoming && kn < 21 && ra && ra[kn] && usePct) {
    proj = ra.map((x, i) => (i < kn || x === null ? null : ((curPct[kn] ?? 0) * x) / ra[kn]!));
    lines.push({ name: t('ya.ana.c.proj'), c: 'var(--ya-red-500)', w: 2, dash: '5 5', vals: proj });
  }
  const all = lines.flatMap((l) => l.vals).filter((x): x is number => x !== null);
  const top = usePct ? Math.max(100, Math.ceil(Math.max(0, ...all) / 20) * 20) : Math.max(10, Math.ceil(Math.max(0, ...all) / 10) * 10);
  const i0 = Math.min(14, kn);
  const a0 = curPct[i0];
  const r0 = refPct[0]?.[i0] ?? null;
  let text = '';
  if (usePct && a0 !== null && r0 !== null && g.refs[0]) {
    text = t('ya.ana.c.txt', { j: jl(21 - i0), a: pct(a0), b: pct(r0), ref: g.refs[0].title, date: dShort(g.refs[0].start_at) });
    if (proj && proj[21] !== null && tCap) text += ` ${t('ya.ana.c.txtProj', { n: n(((proj[21] as number) / 100) * (base as number)), cap: n(tCap) })}`;
  } else if (!g.refs.length) {
    text = t('ya.ana.c.txtNoRef');
  } else {
    text = t('ya.ana.c.txtCounts', { n: n(Number(tg.sold)) });
  }
  return (
    <section style={{ ...card, flex: '1.3 1 520px' }}>
      <CardHead title={t('ya.ana.c.t')} sub={t(usePct ? 'ya.ana.c.sub' : 'ya.ana.c.subCounts', { title: tg.title, date: dShort(tg.start_at) })} />
      {loading ? <Sk h={280} r={16} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...fadeIn(rv, 100) }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13, color: 'var(--ya-sand-600)' }}>
            {lines.map((l, k) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 18, height: 0, borderTop: `${l.w}px ${l.dash ? 'dashed' : 'solid'} ${l.c}`, display: 'inline-block' }} />{l.name}</span>)}
          </div>
          <MultiLine
            lines={lines}
            top={top}
            go={go}
            fy={(x) => (usePct ? pct(x) : n(x))}
            tipTitle={(i) => (i === 21 ? t('ya.ana.jDay') : t('ya.ana.jMinus', { k: 21 - i }))}
            tipValue={(x) => (usePct && base ? `${pct(x)} · ${t('ya.ana.c.places', { n: n((x / 100) * base) })}` : t('ya.ana.nTickets', { n: n(x) }))}
            xl={[t('ya.ana.jMinus', { k: 21 }), t('ya.ana.jMinus', { k: 14 }), t('ya.ana.jMinus', { k: 7 }), t('ya.ana.jDay')]}
          />
          <Takeaway>{tidy(text)}</Takeaway>
        </div>
      )}
    </section>
  );
}

/** Une date abrégée (« sept. ») en fin de phrase ne double pas le point. */
export function tidy(s: string): string {
  return s.replace(/\.\./g, '.');
}
