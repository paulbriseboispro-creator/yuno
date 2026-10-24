/**
 * Yuno Tickets › Analyses › Trafic — « D'où vient mon public ? » (copie de
 * l'onglet Trafic de Yuno CRM). Les ventes par source (l'attribution figée sur
 * chaque vente Yuno : lien suivi, promoteur, partenaire, e-mail, pages Yuno…),
 * les clics sur vos messages, les nouveaux clients et ce qui les amène, les
 * soirées qui recrutent — et, là où le CRM dit « Bientôt, avec Shotgun », les
 * visites de la page de vente et leur passage vers l'achat, que Yuno mesure.
 * Lot 4 du plan combiné (`TrafficDetail.tsx`) : la page du club / de
 * l'organisateur, les liens suivis sous leur source, les e-mails et push.
 */
import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useProgress } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixCaps } from '@/tickets/analytics/scope';
import { useTixRoutes } from '@/tickets/analytics/routes';
import { SOURCE_KEYS, useAnaTrafficDetail, type AnaFilters, type AnaTraffic, type SourceKey, type TixTrafficLink, type TixVisits } from '@/tickets/analytics/data';
import { MessagesCard, PageCard, SourceLinks } from './TrafficDetail';
import { TrafficKept } from './KeptBlocks';
import {
  CardHead, ChartSkeleton, Fill, Sk, StackChart, StatePill, Tile, TileSkeleton, bucketTitle, card, fadeIn, useGo, xLabels, type TileSpec,
} from './anaUi';
import { deltaPct, jLabelFor } from './SalesTab';

type T = ReturnType<typeof useTixT>;

export const SOURCE_COLOR: Record<SourceKey, string> = {
  ys: 'var(--ya-red-600)', yb: 'var(--ya-red-400)', yt: 'var(--ya-red-900)', wa: '#25D366', yl: 'var(--ya-red-200)',
  pr: '#6366F1', pa: '#38BDF8', em: 'var(--ya-tangerine-500)', sm: 'var(--ya-amber-500)', ad: '#1877F2', pc: '#D62976',
  mk: 'var(--ya-ink)', so: '#962FBF', se: 'var(--ya-amber-700)', au: 'var(--ya-sand-400)', di: 'var(--ya-sand-300)', of: 'var(--ya-sand-200)',
};

export function trafficCsv(d: AnaTraffic, T: T, money: boolean): { columns: string[]; rows: unknown[][] } {
  const cols = [T.t('ya.ana.csv.source'), T.t('ya.ana.csv.orders'), T.t('ya.ana.csv.tickets'), T.t('ya.ana.csv.buyers'), T.t('ya.ana.csv.newBuyers'), ...(money ? [T.t('ya.ana.csv.revenue')] : [])];
  const rows = d.sources.map((s) => [T.t(`ya.ana.src.${s.k}`), s.orders, s.tickets, s.buyers, s.new_buyers, ...(money ? [s.revenue] : [])]);
  return { columns: cols, rows };
}

export function TrafficTab({ q, f }: { q: UseQueryResult<AnaTraffic>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void }) {
  const T = useTixT();
  const { t, tp, n, eur, pct, dShort } = T;
  const caps = useTixCaps();
  const R = useTixRoutes();
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const money = caps.money && !!d && d.sources.every((s) => s.revenue !== null);
  const dataKey = `${f.period}:${f.event}:${q.dataUpdatedAt}`;
  const [hidden, setHidden] = useState<SourceKey[]>([]);
  const [focus, setFocus] = useState<SourceKey | null>(null);
  const [open, setOpen] = useState<SourceKey | null>(null);
  const detail = useAnaTrafficDetail(f);
  const linksBy = useMemo(() => {
    const out = new Map<SourceKey, TixTrafficLink[]>();
    for (const l of detail.data?.links ?? []) out.set(l.src, [...(out.get(l.src) ?? []), l]);
    return out;
  }, [detail.data]);
  const detailLoading = !detail.data || (detail.isFetching && detail.isPlaceholderData);
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${hidden.join(',')}`, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);
  const jl = jLabelFor(t);

  const v = useMemo(() => {
    if (!d) return null;
    const val = (s: AnaTraffic['sources'][number]) => (money ? Number(s.revenue ?? 0) : Number(s.tickets));
    // Les sources qui n'ont rien rapporté sur la période ne prennent pas de place.
    // Une table VIP n'a pas de place de billetterie : une source qui n'a vendu
    // que des tables compte par ses commandes.
    const used = SOURCE_KEYS.filter((k) => d.sources.find((s) => s.k === k && (Number(s.tickets) > 0 || Number(s.prev_tickets) > 0 || Number(s.orders) > 0)));
    const keys = used.length ? used : (['of'] as SourceKey[]);
    const series = keys.map((k) => ({ k, label: t(`ya.ana.src.${k}`), c: SOURCE_COLOR[k], v: d.series.map((b) => Number((money ? b.revenue?.[k] : b.tickets[k]) ?? 0)) }));
    const rows = d.sources.filter((s) => keys.includes(s.k)).sort((a, b) => val(b) - val(a));
    const tot = rows.reduce((a, s) => a + val(s), 0);
    const orders = rows.reduce((a, s) => a + Number(s.orders), 0);
    const best = rows[0] ?? null;
    const bestNew = [...rows].sort((a, b) => Number(b.new_buyers) - Number(a.new_buyers))[0] ?? null;
    return { series, rows, tot, orders, best, bestNew, val };
  }, [d, money, t]);

  if (!d || !v) {
    return (
      <>
        <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={280} /><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)}</div>
      </>
    );
  }
  const m = d.meta;
  const unit = m.mode === 'hour' ? 'hour' : m.mode === 'month' ? 'month' : 'day';
  const fmt = (x: number) => (money ? eur(x) : n(x));
  const marks = d.sends.map((s) => ({ i: s.i, title: `${s.channel === 'sms' ? 'SMS' : s.channel === 'push' ? t('ya.ana.push') : t('ya.ana.email')} · ${s.name}` }));
  const newPct = d.buyers.buyers > 0 ? (d.buyers.new / d.buyers.buyers) * 100 : null;
  const pnewPct = d.buyers.prev_buyers > 0 ? (d.buyers.prev_new / d.buyers.prev_buyers) * 100 : null;
  const clD = f.cmp ? deltaPct(d.clicks.total, d.clicks.prev, T) : null;
  const totVal = v.tot;
  const tiles: TileSpec[] = [
    { kind: 'spark', label: t('ya.ana.t.t.clicks'), value: n(d.clicks.total * prog), delta: clD ? `${clD.text} ${t('ya.ana.vsBefore')}` : undefined, dc: clD && !clD.up ? 'var(--ya-red-600)' : undefined, cap: t('ya.ana.t.t.clicksCap'), values: d.series.map((b) => b.clicks) },
    { kind: 'ring', label: t('ya.ana.t.t.new'), value: newPct !== null ? pct(newPct * prog) : '—', delta: f.cmp && newPct !== null && pnewPct !== null ? `${newPct - pnewPct >= 0 ? '▲' : '▼'} ${t('ya.ana.pts', { n: T.n1(Math.abs(newPct - pnewPct)) })} ${t('ya.ana.vsBefore')}` : undefined, cap: t('ya.ana.t.t.newCap'), ring: newPct ?? 0 },
    { kind: 'spark', label: t('ya.ana.t.t.gained'), value: n(d.gained.total * prog), cap: t('ya.ana.t.t.gainedCap'), values: d.gained.series },
    { kind: 'txt', label: t('ya.ana.t.t.best'), value: v.best ? t(`ya.ana.src.${v.best.k}.s`) : '—', delta: v.best && totVal > 0 ? t('ya.ana.t.t.bestShare', { pct: pct((v.val(v.best) / totVal) * 100) }) : undefined, dc: 'var(--ya-sand-600)', cap: v.bestNew && Number(v.bestNew.new_buyers) > 0 ? t('ya.ana.t.t.bestNew', { src: t(`ya.ana.src.${v.bestNew.k}.s`) }) : t('ya.ana.t.t.bestNewNone'), color: v.best ? SOURCE_COLOR[v.best.k] : 'var(--ya-sand-100)' },
  ];
  const rowMax = Math.max(1, ...v.rows.map((s) => v.val(s)));
  const grid = 'minmax(150px,1.3fr) 76px 92px 128px minmax(150px,1.4fr)';
  const newRows = [...v.rows].filter((s) => Number(s.new_buyers) > 0).sort((a, b) => Number(b.new_buyers) - Number(a.new_buyers)).slice(0, 4);
  const newTot = d.buyers.new || 1;
  // La phrase ne dit que ce que les chiffres montrent : la source qui amène
  // le plus de nouveaux clients, et sa part.
  const topNew = newRows[0] ?? null;
  const topNewPct = topNew && d.buyers.new > 0 ? (Number(topNew.new_buyers) / d.buyers.new) * 100 : null;
  const evMax = Math.max(1, ...d.events.map((e) => Number(e.buyers)));

  return (
    <>
      {/* Héros : qui fait vendre */}
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)' }}>
        <CardHead
          title={t('ya.ana.t.heroT')}
          sub={t('ya.ana.t.heroSub', { unit: t(`ya.ana.unit.${m.mode === 'event' ? 'day' : unit}`), n: n(v.orders) })}
          right={(
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {v.series.map((s) => {
                const on = !hidden.includes(s.k as SourceKey);
                return (
                  <Hv
                    key={s.k}
                    as="button"
                    type="button"
                    aria-pressed={on}
                    title={t('ya.ana.t.toggle')}
                    onClick={() => {
                      if (on && v.series.length - hidden.length <= 1) return;
                      setHidden((h) => (on ? [...h, s.k as SourceKey] : h.filter((x) => x !== s.k)));
                    }}
                    style={{ height: 34, padding: '0 12px 0 10px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: on ? 'var(--ya-card)' : 'transparent', color: on ? 'var(--ya-ink)' : 'var(--ya-sand-400)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms' }}
                    hover={{ borderColor: 'var(--ya-sand-400)' }}
                  >
                    <i style={{ width: 10, height: 10, borderRadius: 3, background: on ? s.c : 'transparent', boxShadow: `inset 0 0 0 1.5px ${s.c}`, display: 'inline-block' }} />{s.label}
                  </Hv>
                );
              })}
            </div>
          )}
        />
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{fmt(totVal * prog)}</span>
              <span style={{ fontSize: 14, color: 'var(--ya-sand-500)', paddingBottom: 10 }}>{t(money ? 'ya.ana.t.bigSub' : 'ya.ana.t.bigSubTk')}</span>
            </div>
            <StackChart
              series={v.series}
              hidden={hidden}
              focus={focus}
              marks={marks}
              go={go}
              fy={fmt}
              tipTitle={(i) => bucketTitle(m, i, T, jl)}
              tipValue={(x) => (money ? eur(x) : t('ya.ana.nTickets', { n: n(x) }))}
              xl={xLabels(m, T, jl)}
            />
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ ...card, flex: '1.6 1 560px', gap: 16 }}>
          <CardHead title={t('ya.ana.t.srcT')} sub={t('ya.ana.t.srcSub')} />
          {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Sk key={i} h={52} r={14} />)}</div> : (
            <div className="ya-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 180) }}>
              <div style={{ minWidth: 600, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
                  <span>{t('ya.ana.col.source')}</span><span style={{ textAlign: 'right' }}>{t('ya.ana.col.orders')}</span><span style={{ textAlign: 'right' }}>{t('ya.ana.col.newShare')}</span><span style={{ textAlign: 'right' }}>{t('ya.ana.col.newClients')}</span><span>{t('ya.ana.col.sales')}</span>
                </div>
                {v.rows.map((s, i) => {
                  const val = v.val(s);
                  const ns = Number(s.buyers) > 0 ? (Number(s.new_buyers) / Number(s.buyers)) * 100 : null;
                  const off = hidden.includes(s.k);
                  const sl = linksBy.get(s.k) ?? [];
                  return (
                    <div key={s.k}>
                    <div
                      onMouseEnter={() => setFocus(s.k)}
                      onMouseLeave={() => setFocus(null)}
                      onClick={sl.length ? () => setOpen((o) => (o === s.k ? null : s.k)) : undefined}
                      role={sl.length ? 'button' : undefined}
                      aria-expanded={sl.length ? open === s.k : undefined}
                      title={sl.length ? t('ya.tr.link.toggle') : undefined}
                      style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, background: focus === s.k || open === s.k ? 'var(--ya-sand-50)' : 'transparent', opacity: off ? 0.4 : 1, transition: 'background 140ms,opacity 160ms', fontSize: 14.5, fontVariantNumeric: 'tabular-nums', cursor: sl.length ? 'pointer' : 'default' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, minWidth: 0 }}><i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: SOURCE_COLOR[s.k], boxShadow: 'inset 0 0 0 1px rgb(var(--ink) / .12)' }} /><span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`ya.ana.src.${s.k}.s`)}</span>{sl.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--ya-sand-500)' }}>{tp('ya.tr.link.n', sl.length, { n: n(sl.length) })}<Icon name="chevronDown" size={13} stroke={2.4} style={{ transform: `rotate(${open === s.k ? 180 : 0}deg)`, transition: 'transform 200ms' }} /></span>}</span></span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(Number(s.orders) * prog)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{ns !== null ? pct(ns) : '—'}</span>
                      <b style={{ textAlign: 'right' }}>{n(Number(s.new_buyers) * prog)}</b>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{money ? eur(val) : t('ya.ana.nTickets', { n: n(val) })}</b><span style={{ color: 'var(--ya-sand-500)', fontSize: 13 }}>{totVal > 0 ? pct((val / totVal) * 100) : '—'}</span></span>
                        <Fill pct={(val / rowMax) * 100} go={go} delay={i * 80} h={5} bg="var(--ya-ink)" dur={800} />
                      </span>
                    </div>
                    {open === s.k && sl.length > 0 && <SourceLinks links={sl} money={money} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.t.srcFoot')}{linksBy.size > 0 ? ` ${t('ya.tr.link.foot')}` : ''}</span>
        </section>

        <section style={{ ...card, flex: '1 1 340px' }}>
          <CardHead title={t('ya.ana.t.newT')} sub={t('ya.ana.t.newSub')} />
          {loading ? <Sk h={260} r={16} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv, 240) }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px 14px' }}>
                <span style={{ flex: 'none', whiteSpace: 'nowrap', fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{newPct !== null ? pct(newPct * prog) : '—'}</span>
                <span style={{ fontSize: 14, color: 'var(--ya-sand-500)', paddingBottom: 6 }}>{t('ya.ana.t.newBig')}</span>
              </div>
              <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: go ? `${newPct ?? 0}%` : '0%', background: 'var(--ya-gradient-brand)', transition: 'width 800ms cubic-bezier(.22,1,.36,1)' }} />
                <div style={{ flex: 1, background: 'var(--ya-sand-200)' }} />
              </div>
              <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--ya-sand-50)', fontSize: 14, lineHeight: 1.45, color: 'var(--ya-sand-700)', textWrap: 'pretty' }}>
                {d.buyers.new === 0 ? t('ya.ana.t.newNone') : topNew && topNewPct !== null ? t('ya.ana.t.newIns', { src: t(`ya.ana.src.${topNew.k}.s`), pct: pct(topNewPct) }) : ''}
              </div>
              {newRows.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4, borderTop: '1px solid var(--ya-sand-100)' }}>
                  <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)', paddingTop: 12 }}>{t('ya.ana.t.newFrom')}</span>
                  {newRows.map((s, i) => (
                    <div key={s.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(92px,120px) minmax(0,1fr) 48px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: 'var(--ya-sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`ya.ana.src.${s.k}.s`)}</span>
                      <Fill pct={(Number(s.new_buyers) / newTot) * 100} go={go} delay={i * 80} h={10} bg={i === 0 ? 'var(--ya-gradient-brand)' : 'var(--ya-sand-400)'} dur={800} />
                      <b style={{ textAlign: 'right' }}>{pct((Number(s.new_buyers) / newTot) * 100)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <MessagesCard d={detail.data} money={money} loading={detailLoading} rv={rv} go={go} />

      <section style={{ ...card, gap: 20 }}>
        <CardHead title={t('ya.ana.t.evT')} sub={t('ya.ana.t.evSub')} />
        {loading ? <Sk h={220} r={16} /> : d.events.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.ana.s.evEmpty')}</p>
        ) : (
          <div className="ya-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 180) }}>
            <div style={{ minWidth: 620, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.6fr) minmax(180px,2fr) 100px 140px', gap: 14, padding: '0 10px 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
                <span>{t('ya.ana.col.night')}</span><span>{t('ya.ana.col.buyers')}</span><span style={{ textAlign: 'right' }}>{t('ya.ana.col.newShare')}</span><span style={{ textAlign: 'right' }}>{t('ya.ana.col.clicks')}</span>
              </div>
              {d.events.map((e, i) => (
                <div key={e.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.6fr) minmax(180px,2fr) 100px 140px', gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, background: f.event === e.id ? 'var(--ya-red-50)' : 'transparent', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</b><span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{dShort(e.start_at)}</span></span>
                    <StatePill state={e.state} label={t(`ya.ana.state.${e.state}`)} />
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><b style={{ width: 56 }}>{n(Number(e.buyers) * prog)}</b><span style={{ flex: 1 }}><Fill pct={(Number(e.buyers) / evMax) * 100} go={go} delay={i * 80} dur={800} /></span></span>
                  <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{Number(e.buyers) > 0 ? pct((Number(e.new_buyers) / Number(e.buyers)) * 100) : '—'}</span>
                  <b style={{ textAlign: 'right' }}>{tp('ya.ana.t.clicksN', Number(e.clicks), { n: n(Number(e.clicks)) })}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {d.visits && <VisitsCard v={d.visits} cmp={f.cmp} ev={m.mode === 'event'} rv={rv} go={go} prog={prog} />}

      {m.mode !== 'event' && detail.data?.page && <PageCard p={detail.data.page} meta={detail.data.meta} cmp={f.cmp} rv={rv} go={go} prog={prog} />}

      {m.mode !== 'event' && <TrafficKept period={f.period} />}

      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px 24px', padding: '22px 26px', borderRadius: 24, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', ...fadeIn(rv, 240) }}>
        <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('ya.ana.t.pathT')}</b>
          <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--ya-sand-600)' }}>{t('ya.ana.t.pathS')}</span>
        </div>
        <Hv as={Link} to={R.journey} style={{ flex: 'none', height: 46, padding: '0 20px', borderRadius: 99, background: 'var(--ya-ink)', color: 'var(--ya-on-ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', transition: 'background 160ms' }} hover={{ background: 'var(--ya-sand-700)', color: 'var(--ya-on-ink)', textDecoration: 'none' }}>
          {t('ya.ana.t.pathCta')}<Icon name="arrowRight" size={16} stroke={2.4} />
        </Hv>
      </section>
    </>
  );
}

/**
 * Ce que Yuno mesure et que le CRM ne peut pas (Shotgun ne rend pas ses
 * visites) : les visites de la page de vente de la période ou de la soirée, et
 * leur passage vers l'achat. Mêmes étapes que la Billetterie : panier = a
 * choisi un billet, paiement = a ouvert le paiement, achat = une vente payée
 * est née de la visite.
 */
function VisitsCard({ v, cmp, ev, rv, go, prog }: { v: TixVisits; cmp: boolean; ev: boolean; rv: boolean; go: boolean; prog: number }) {
  const T = useTixT();
  const { t, tp, n, pct } = T;
  const steps = [
    { k: 'visits', l: t('ya.ana.t.vis.visits'), v: v.visits },
    { k: 'carts', l: t('ya.ana.t.vis.carts'), v: v.carts },
    { k: 'checkouts', l: t('ya.ana.t.vis.checkouts'), v: v.checkouts },
    { k: 'orders', l: t('ya.ana.t.vis.orders'), v: v.orders },
  ];
  const conv = v.visits >= 10 ? (v.orders / v.visits) * 100 : null;
  const pconv = v.prev_visits !== null && v.prev_orders !== null && v.prev_visits >= 10 ? (v.prev_orders / v.prev_visits) * 100 : null;
  const vD = cmp && v.prev_visits !== null ? deltaPct(v.visits, v.prev_visits, T) : null;
  const top = Math.max(1, v.visits);
  const lost = v.carts - v.orders;
  return (
    <section style={{ ...card, gap: 18, ...fadeIn(rv, 200) }}>
      <CardHead title={t('ya.ana.t.vis.t')} sub={t(ev ? 'ya.ana.t.vis.subEv' : 'ya.ana.t.vis.sub')} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
        <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{conv !== null ? pct(conv * prog, 1) : '—'}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 6 }}>
          <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{conv !== null ? t('ya.ana.t.vis.convBig') : t('ya.ana.t.vis.convSmall')}</span>
          {cmp && conv !== null && pconv !== null && <span style={{ fontSize: 14, fontWeight: 600, color: conv >= pconv ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{`${conv - pconv >= 0 ? '▲' : '▼'} ${t('ya.ana.pts', { n: T.n1(Math.abs(conv - pconv)) })} ${t('ya.ana.vsBefore')}`}</span>}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 12 }}>
        {steps.map((x, i) => (
          <div key={x.k} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 18, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ya-sand-600)' }}>{x.l}</span>
            <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(x.v * prog)}</b>
              {i > 0 && v.visits >= 10 && <span style={{ fontSize: 13, color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{pct((x.v / v.visits) * 100, 1)}</span>}
              {i === 0 && vD && <span style={{ fontSize: 13, fontWeight: 600, color: vD.up ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{vD.text}</span>}
            </span>
            <Fill pct={(x.v / top) * 100} go={go} delay={i * 90} h={8} bg={i === 3 ? 'var(--ya-gradient-brand)' : 'var(--ya-red-200)'} dur={800} />
          </div>
        ))}
      </div>
      <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ya-sand-600)', textWrap: 'pretty' }}>
        {v.visits === 0 ? t('ya.ana.t.vis.none') : lost > 0 ? tp('ya.ana.t.vis.lost', lost, { n: n(lost) }) : t('ya.ana.t.vis.noLost')}
      </span>
    </section>
  );
}
