/**
 * Analyses › Trafic — « D'où vient mon public ? ». Les ventes par source
 * (lues dans les UTM des billets), les clics sur vos messages, les nouveaux
 * clients et ce qui les amène, et les soirées qui recrutent. Les visites de
 * page et l'appareil arriveront avec les pages d'inscription : rien n'est
 * inventé en attendant.
 */
import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useProgress } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SOURCE_KEYS, type AnaFilters, type AnaTraffic, type SourceKey } from '@/crm/data/analytics';
import {
  CardHead, ChartSkeleton, Fill, Sk, StackChart, StatePill, Tile, TileSkeleton, bucketTitle, card, fadeIn, useGo, xLabels, type TileSpec,
} from './anaUi';
import { deltaPct, jLabelFor } from './SalesTab';

type T = ReturnType<typeof useCrmT>;

export const SOURCE_COLOR: Record<SourceKey, string> = {
  yl: 'var(--red-500)', em: 'var(--tangerine-500)', sm: 'var(--amber-500)', dm: 'var(--red-300)',
  so: 'var(--red-700)', sg: 'var(--ink)', au: 'var(--sand-400)', di: 'var(--sand-300)', of: 'var(--sand-200)',
};

export function trafficCsv(d: AnaTraffic, T: T, money: boolean): { columns: string[]; rows: unknown[][] } {
  const cols = [T.t('yc.ana.csv.source'), T.t('yc.ana.csv.orders'), T.t('yc.ana.csv.tickets'), T.t('yc.ana.csv.buyers'), T.t('yc.ana.csv.newBuyers'), ...(money ? [T.t('yc.ana.csv.revenue')] : [])];
  const rows = d.sources.map((s) => [T.t(`yc.ana.src.${s.k}`), s.orders, s.tickets, s.buyers, s.new_buyers, ...(money ? [s.revenue] : [])]);
  return { columns: cols, rows };
}

export function TrafficTab({ q, f }: { q: UseQueryResult<AnaTraffic>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void }) {
  const T = useCrmT();
  const { t, tp, n, eur, pct, dShort } = T;
  const caps = useCrmCaps();
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const money = caps.money && !!d && d.sources.every((s) => s.revenue !== null);
  const dataKey = `${f.period}:${f.event}:${q.dataUpdatedAt}`;
  const [hidden, setHidden] = useState<SourceKey[]>([]);
  const [focus, setFocus] = useState<SourceKey | null>(null);
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${hidden.join(',')}`, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);
  const jl = jLabelFor(t);

  const v = useMemo(() => {
    if (!d) return null;
    const val = (s: AnaTraffic['sources'][number]) => (money ? Number(s.revenue ?? 0) : Number(s.tickets));
    // Les sources qui n'ont rien rapporté sur la période ne prennent pas de place.
    const used = SOURCE_KEYS.filter((k) => d.sources.find((s) => s.k === k && (Number(s.tickets) > 0 || Number(s.prev_tickets) > 0)));
    const keys = used.length ? used : (['of'] as SourceKey[]);
    const series = keys.map((k) => ({ k, label: t(`yc.ana.src.${k}`), c: SOURCE_COLOR[k], v: d.series.map((b) => Number((money ? b.revenue?.[k] : b.tickets[k]) ?? 0)) }));
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
  const marks = d.sends.map((s) => ({ i: s.i, title: `${s.channel === 'sms' ? 'SMS' : t('yc.ana.email')} · ${s.name}` }));
  const newPct = d.buyers.buyers > 0 ? (d.buyers.new / d.buyers.buyers) * 100 : null;
  const pnewPct = d.buyers.prev_buyers > 0 ? (d.buyers.prev_new / d.buyers.prev_buyers) * 100 : null;
  const clD = f.cmp ? deltaPct(d.clicks.total, d.clicks.prev, T) : null;
  const totVal = v.tot;
  const tiles: TileSpec[] = [
    { kind: 'spark', label: t('yc.ana.t.t.clicks'), value: n(d.clicks.total * prog), delta: clD ? `${clD.text} ${t('yc.ana.vsBefore')}` : undefined, dc: clD && !clD.up ? 'var(--red-600)' : undefined, cap: t('yc.ana.t.t.clicksCap'), values: d.series.map((b) => b.clicks) },
    { kind: 'ring', label: t('yc.ana.t.t.new'), value: newPct !== null ? pct(newPct * prog) : '—', delta: f.cmp && newPct !== null && pnewPct !== null ? `${newPct - pnewPct >= 0 ? '▲' : '▼'} ${t('yc.ana.pts', { n: T.n1(Math.abs(newPct - pnewPct)) })} ${t('yc.ana.vsBefore')}` : undefined, cap: t('yc.ana.t.t.newCap'), ring: newPct ?? 0 },
    { kind: 'spark', label: t('yc.ana.t.t.gained'), value: n(d.gained.total * prog), cap: t('yc.ana.t.t.gainedCap'), values: d.gained.series },
    { kind: 'txt', label: t('yc.ana.t.t.best'), value: v.best ? t(`yc.ana.src.${v.best.k}`) : '—', delta: v.best && totVal > 0 ? t('yc.ana.t.t.bestShare', { pct: pct((v.val(v.best) / totVal) * 100) }) : undefined, dc: 'var(--sand-600)', cap: v.bestNew && Number(v.bestNew.new_buyers) > 0 ? t('yc.ana.t.t.bestNew', { src: t(`yc.ana.src.${v.bestNew.k}`) }) : t('yc.ana.t.t.bestNewNone'), color: v.best ? SOURCE_COLOR[v.best.k] : 'var(--sand-100)' },
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
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <CardHead
          title={t('yc.ana.t.heroT')}
          sub={t('yc.ana.t.heroSub', { unit: t(`yc.ana.unit.${m.mode === 'event' ? 'day' : unit}`), n: n(v.orders) })}
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
                    title={t('yc.ana.t.toggle')}
                    onClick={() => {
                      if (on && v.series.length - hidden.length <= 1) return;
                      setHidden((h) => (on ? [...h, s.k as SourceKey] : h.filter((x) => x !== s.k)));
                    }}
                    style={{ height: 34, padding: '0 12px 0 10px', borderRadius: 99, border: '1px solid var(--sand-200)', background: on ? '#fff' : 'transparent', color: on ? 'var(--ink)' : 'var(--sand-400)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms' }}
                    hover={{ borderColor: 'var(--sand-400)' }}
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
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{fmt(totVal * prog)}</span>
              <span style={{ fontSize: 14, color: 'var(--sand-500)', paddingBottom: 10 }}>{t(money ? 'yc.ana.t.bigSub' : 'yc.ana.t.bigSubTk')}</span>
            </div>
            <StackChart
              series={v.series}
              hidden={hidden}
              focus={focus}
              marks={marks}
              go={go}
              fy={fmt}
              tipTitle={(i) => bucketTitle(m, i, T, jl)}
              tipValue={(x) => (money ? eur(x) : t('yc.ana.nTickets', { n: n(x) }))}
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
          <CardHead title={t('yc.ana.t.srcT')} sub={t('yc.ana.t.srcSub')} />
          {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Sk key={i} h={52} r={14} />)}</div> : (
            <div className="yc-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 180) }}>
              <div style={{ minWidth: 600, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
                  <span>{t('yc.ana.col.source')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.col.orders')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.col.newShare')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.col.newClients')}</span><span>{t('yc.ana.col.sales')}</span>
                </div>
                {v.rows.map((s, i) => {
                  const val = v.val(s);
                  const ns = Number(s.buyers) > 0 ? (Number(s.new_buyers) / Number(s.buyers)) * 100 : null;
                  const off = hidden.includes(s.k);
                  return (
                    <div key={s.k} onMouseEnter={() => setFocus(s.k)} onMouseLeave={() => setFocus(null)} style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, background: focus === s.k ? 'var(--sand-50)' : 'transparent', opacity: off ? 0.4 : 1, transition: 'background 140ms,opacity 160ms', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, minWidth: 0 }}><i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: SOURCE_COLOR[s.k], boxShadow: 'inset 0 0 0 1px rgba(28,21,23,.12)' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`yc.ana.src.${s.k}`)}</span></span>
                      <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{n(Number(s.orders) * prog)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{ns !== null ? pct(ns) : '—'}</span>
                      <b style={{ textAlign: 'right' }}>{n(Number(s.new_buyers) * prog)}</b>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{money ? eur(val) : t('yc.ana.nTickets', { n: n(val) })}</b><span style={{ color: 'var(--sand-500)', fontSize: 13 }}>{totVal > 0 ? pct((val / totVal) * 100) : '—'}</span></span>
                        <Fill pct={(val / rowMax) * 100} go={go} delay={i * 80} h={5} bg="var(--ink)" dur={800} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--sand-500)' }}>{t('yc.ana.t.srcFoot')}</span>
        </section>

        <section style={{ ...card, flex: '1 1 340px' }}>
          <CardHead title={t('yc.ana.t.newT')} sub={t('yc.ana.t.newSub')} />
          {loading ? <Sk h={260} r={16} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv, 240) }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px 14px' }}>
                <span style={{ flex: 'none', whiteSpace: 'nowrap', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{newPct !== null ? pct(newPct * prog) : '—'}</span>
                <span style={{ fontSize: 14, color: 'var(--sand-500)', paddingBottom: 6 }}>{t('yc.ana.t.newBig')}</span>
              </div>
              <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: go ? `${newPct ?? 0}%` : '0%', background: 'var(--gradient-brand)', transition: 'width 800ms cubic-bezier(.22,1,.36,1)' }} />
                <div style={{ flex: 1, background: 'var(--sand-200)' }} />
              </div>
              <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)', textWrap: 'pretty' }}>
                {d.buyers.new === 0 ? t('yc.ana.t.newNone') : topNew && topNewPct !== null ? t('yc.ana.t.newIns', { src: t(`yc.ana.src.${topNew.k}`), pct: pct(topNewPct) }) : ''}
              </div>
              {newRows.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4, borderTop: '1px solid var(--sand-100)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', paddingTop: 12 }}>{t('yc.ana.t.newFrom')}</span>
                  {newRows.map((s, i) => (
                    <div key={s.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(92px,120px) minmax(0,1fr) 48px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: 'var(--sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`yc.ana.src.${s.k}`)}</span>
                      <Fill pct={(Number(s.new_buyers) / newTot) * 100} go={go} delay={i * 80} h={10} bg={i === 0 ? 'var(--gradient-brand)' : 'var(--sand-400)'} dur={800} />
                      <b style={{ textAlign: 'right' }}>{pct((Number(s.new_buyers) / newTot) * 100)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section style={{ ...card, gap: 20 }}>
        <CardHead title={t('yc.ana.t.evT')} sub={t('yc.ana.t.evSub')} />
        {loading ? <Sk h={220} r={16} /> : d.events.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.ana.s.evEmpty')}</p>
        ) : (
          <div className="yc-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 180) }}>
            <div style={{ minWidth: 620, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.6fr) minmax(180px,2fr) 100px 140px', gap: 14, padding: '0 10px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
                <span>{t('yc.ana.col.night')}</span><span>{t('yc.ana.col.buyers')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.col.newShare')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.col.clicks')}</span>
              </div>
              {d.events.map((e, i) => (
                <div key={e.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.6fr) minmax(180px,2fr) 100px 140px', gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, background: f.event === e.id ? 'var(--red-50)' : 'transparent', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</b><span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{dShort(e.start_at)}</span></span>
                    <StatePill state={e.state} label={t(`yc.ana.state.${e.state}`)} />
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><b style={{ width: 56 }}>{n(Number(e.buyers) * prog)}</b><span style={{ flex: 1 }}><Fill pct={(Number(e.buyers) / evMax) * 100} go={go} delay={i * 80} dur={800} /></span></span>
                  <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{Number(e.buyers) > 0 ? pct((Number(e.new_buyers) / Number(e.buyers)) * 100) : '—'}</span>
                  <b style={{ textAlign: 'right' }}>{tp('yc.ana.t.clicksN', Number(e.clicks), { n: n(Number(e.clicks)) })}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px 24px', padding: '22px 26px', borderRadius: 24, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...fadeIn(rv, 240) }}>
        <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.ana.t.pathT')}</b>
          <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.ana.t.pathS')}</span>
        </div>
        <Hv as={Link} to={CRM_ROUTES.journey} style={{ flex: 'none', height: 46, padding: '0 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', transition: 'background 160ms' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>
          {t('yc.ana.t.pathCta')}<Icon name="arrowRight" size={16} stroke={2.4} />
        </Hv>
      </section>
    </>
  );
}
