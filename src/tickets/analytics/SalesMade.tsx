/**
 * Yuno Tickets › Analyses › Ventes › « Ce qui a fait vendre » (lot T4 du plan
 * Trafic, décision de Paul du 27/10). Les blocs d'argent de l'ancien onglet
 * Trafic, DÉPLACÉS, pas réécrits : l'attribution reste celle de
 * `tix_ana_traffic` (la source figée sur chaque vente) et de
 * `tix_ana_traffic_detail` (liens sous leur source, e-mails et push à 7 jours).
 * Qui fait vendre (graphique empilé, euros ou billets), quelle source fait
 * vendre (avec ses liens), ce que vos messages ont rapporté (la carte noire),
 * qui vous découvre. Chaque source renvoie à son trafic.
 */
import { useMemo, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useProgress } from '@/crm/ui/motion';
import { ArrowLink, Segmented } from '@/tickets/analytics/kit';
import { useTixT } from '@/tickets/analytics/i18n';
import { SOURCE_KEYS, type AnaFilters, type AnaTab, type AnaTraffic, type AnaTrafficDetail, type SourceKey, type TixTrafficLink, type TixTrafficMessage } from '@/tickets/analytics/data';
import { SourceLinks } from './TrafficDetail';
import {
  BrandArrowButton, CardHead, ChartSkeleton, Fill, Sk, StackChart, bucketTitle, card, fadeIn, nightCard, useGo, xLabels,
} from './anaUi';
import { jLabelFor } from './SalesTab';


export const SOURCE_COLOR: Record<SourceKey, string> = {
  ys: 'var(--ya-red-600)', yb: 'var(--ya-red-400)', yt: 'var(--ya-red-900)', wa: '#25D366', yl: 'var(--ya-red-200)',
  pr: '#6366F1', pa: '#38BDF8', em: 'var(--ya-tangerine-500)', sm: 'var(--ya-amber-500)', ad: '#1877F2', pc: '#D62976',
  mk: 'var(--ya-ink)', so: '#962FBF', se: 'var(--ya-amber-700)', au: 'var(--ya-sand-400)', di: 'var(--ya-sand-300)', of: 'var(--ya-sand-200)',
};

const MIN_SAMPLE = 10;

export function SalesMade({ q, detail, f, money, goTab, onWrite }: {
  q: { data: AnaTraffic | undefined; isFetching: boolean; isPlaceholderData: boolean; dataUpdatedAt: number };
  detail: { data: AnaTrafficDetail | undefined; isFetching: boolean; isPlaceholderData: boolean };
  f: AnaFilters; money: boolean; goTab: (k: AnaTab) => void; onWrite: () => void;
}) {
  const T = useTixT();
  const { t, tp, n, eur, pct } = T;
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const euros = money && !!d && d.sources.every((s) => s.revenue !== null);
  const [metricRaw, setMetric] = useState<'eur' | 'bil'>('eur');
  const metric = euros ? metricRaw : 'bil';
  const dataKey = `${f.period}:${f.event}:${q.dataUpdatedAt}`;
  const [hidden, setHidden] = useState<SourceKey[]>([]);
  const [focus, setFocus] = useState<SourceKey | null>(null);
  const [open, setOpen] = useState<SourceKey | null>(null);
  const linksBy = useMemo(() => {
    const out = new Map<SourceKey, TixTrafficLink[]>();
    for (const l of detail.data?.links ?? []) out.set(l.src, [...(out.get(l.src) ?? []), l]);
    return out;
  }, [detail.data]);
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${hidden.join(',')}:${metric}`, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);
  const jl = jLabelFor(t);

  const v = useMemo(() => {
    if (!d) return null;
    const val = (s: AnaTraffic['sources'][number]) => (metric === 'eur' ? Number(s.revenue ?? 0) : Number(s.tickets));
    // Les sources qui n'ont rien rapporté sur la période ne prennent pas de place ;
    // une source qui n'a vendu que des tables compte par ses commandes.
    const used = SOURCE_KEYS.filter((k) => d.sources.find((s) => s.k === k && (Number(s.tickets) > 0 || Number(s.prev_tickets) > 0 || Number(s.orders) > 0)));
    const keys = used.length ? used : (['of'] as SourceKey[]);
    const series = keys.map((k) => ({ k, label: t(`ya.ana.src.${k}`), c: SOURCE_COLOR[k], v: d.series.map((b) => Number((metric === 'eur' ? b.revenue?.[k] : b.tickets[k]) ?? 0)) }));
    const rows = d.sources.filter((s) => keys.includes(s.k)).sort((a, b) => val(b) - val(a) || Number(b.orders) - Number(a.orders));
    const tot = rows.reduce((a, s) => a + val(s), 0);
    const orders = rows.reduce((a, s) => a + Number(s.orders), 0);
    const revenue = rows.reduce((a, s) => a + Number(s.revenue ?? 0), 0);
    return { series, rows, tot, orders, revenue, val };
  }, [d, metric, t]);

  if (!d || !v) {
    return (
      <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={280} /><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></section>
    );
  }
  const m = d.meta;
  const unit = m.mode === 'hour' ? 'hour' : m.mode === 'month' ? 'month' : 'day';
  const fmt = (x: number) => (metric === 'eur' ? eur(x) : n(x));
  const marks = d.sends.map((s) => ({ i: s.i, title: `${s.channel === 'sms' ? 'SMS' : s.channel === 'push' ? t('ya.ana.push') : t('ya.ana.email')} · ${s.name}` }));
  const rowMax = Math.max(1, ...v.rows.map((s) => v.val(s)));
  const grid = 'minmax(170px,1.4fr) 100px 84px 130px 110px minmax(170px,1.4fr)';
  const newPct = d.buyers.buyers > 0 ? (d.buyers.new / d.buyers.buyers) * 100 : null;
  const newRows = [...v.rows].filter((s) => Number(s.new_buyers) > 0).sort((a, b) => Number(b.new_buyers) - Number(a.new_buyers)).slice(0, 4);
  const newTot = d.buyers.new || 1;
  const topNew = newRows[0] ?? null;
  const topNewPct = topNew && d.buyers.new > 0 ? (Number(topNew.new_buyers) / d.buyers.new) * 100 : null;

  return (
    <>
      {/* Qui fait vendre ? */}
      <section id="ya-made" style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', scrollMarginTop: 96 }}>
        <CardHead
          title={t('ya.ana.t.heroT')}
          sub={t('ya.mk.heroSub', { unit: t(`ya.ana.unit.${m.mode === 'event' ? 'day' : unit}`) })}
          right={euros ? <Segmented value={metric} onChange={(x) => setMetric(x)} ariaLabel={t('ya.ana.t.heroT')} options={[{ value: 'eur', label: t('ya.ana.s.eur') }, { value: 'bil', label: t('ya.ana.s.bil') }]} /> : undefined}
        />
        {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(48px,6vw,84px)', lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{fmt(v.tot * prog)}</span>
              <span style={{ fontSize: 14, color: 'var(--ya-sand-500)', paddingBottom: 8 }}>{metric === 'eur' ? tp('ya.mk.bigEur', v.orders, { n: n(v.orders) }) : tp('ya.mk.bigTk', v.orders, { n: n(v.orders) })}</span>
            </div>
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
                    style={{ height: 32, padding: '0 11px 0 9px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: on ? 'var(--ya-card)' : 'transparent', color: on ? 'var(--ya-ink)' : 'var(--ya-sand-400)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms' }}
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
              fy={fmt}
              tipTitle={(i) => bucketTitle(m, i, T, jl)}
              tipValue={(x) => (metric === 'eur' ? eur(x) : t('ya.ana.nTickets', { n: n(x) }))}
              xl={xLabels(m, T, jl)}
              height={260}
            />
          </div>
        )}
      </section>

      {/* Quelle source fait vendre ? */}
      <section style={{ ...card, gap: 16 }}>
        <CardHead title={t('ya.mk.srcT')} sub={t('ya.mk.srcSub')} right={<ArrowLink onClick={() => goTab('traffic')}>{t('ya.mk.toTraffic')}</ArrowLink>} />
        {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Sk key={i} h={52} r={14} />)}</div> : (
          <div className="ya-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 180) }}>
            <div style={{ minWidth: 720, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
                <span>{t('ya.ana.col.source')}</span><span style={{ textAlign: 'right' }}>{t('ya.mk.col.orders')}</span><span style={{ textAlign: 'right' }}>{t('ya.mk.col.tickets')}</span>
                <span style={{ textAlign: 'right' }}>{t('ya.ana.col.newClients')}</span><span style={{ textAlign: 'right' }}>{t('ya.mk.col.basket')}</span><span>{t(euros ? 'ya.mk.col.revenue' : 'ya.mk.col.tickets')}</span>
              </div>
              {v.rows.map((s, i) => {
                const val = euros ? Number(s.revenue ?? 0) : Number(s.tickets);
                const off = hidden.includes(s.k);
                const sl = linksBy.get(s.k) ?? [];
                const basket = euros && Number(s.orders) > 0 ? Number(s.revenue ?? 0) / Number(s.orders) : null;
                const tot = euros ? v.revenue : v.rows.reduce((a, x) => a + Number(x.tickets), 0);
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
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(Number(s.tickets) * prog)}</span>
                      <b style={{ textAlign: 'right' }}>{n(Number(s.new_buyers) * prog)}</b>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{basket !== null ? eur(basket) : '—'}</span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{euros ? eur(val) : t('ya.ana.nTickets', { n: n(val) })}</b><span style={{ color: 'var(--ya-sand-500)', fontSize: 13 }}>{tot > 0 ? pct((val / tot) * 100) : '—'}</span></span>
                        <Fill pct={(v.val(s) / rowMax) * 100} go={go} delay={i * 80} h={5} bg="var(--ya-ink)" dur={800} />
                      </span>
                    </div>
                    {open === s.k && sl.length > 0 && <SourceLinks links={sl} money={euros} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.mk.srcFoot')}</span>
      </section>

      <MessagesMade d={detail.data} totalRevenue={v.revenue} totalOrders={v.orders} money={euros} loading={!detail.data || (detail.isFetching && detail.isPlaceholderData)} rv={rv} onWrite={onWrite} />

      {/* Qui vous découvre ? */}
      <section style={{ ...card, gap: 18 }}>
        <CardHead title={t('ya.ana.t.newT')} sub={t('ya.mk.newSub')} />
        {loading ? <Sk h={200} r={16} /> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, ...fadeIn(rv, 240) }}>
            <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px 14px' }}>
                <span style={{ flex: 'none', whiteSpace: 'nowrap', fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{newPct !== null && d.buyers.buyers >= MIN_SAMPLE ? pct(newPct * prog) : n(d.buyers.new)}</span>
                <span style={{ fontSize: 14, color: 'var(--ya-sand-500)', paddingBottom: 6 }}>{tp('ya.mk.newBig', d.buyers.new, { n: n(d.buyers.new) })}</span>
              </div>
              <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: go ? `${newPct ?? 0}%` : '0%', background: 'var(--ya-gradient-brand)', transition: 'width 800ms cubic-bezier(.22,1,.36,1)' }} />
                <div style={{ flex: 1, background: 'var(--ya-sand-200)' }} />
              </div>
              <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--ya-sand-50)', fontSize: 14, lineHeight: 1.45, color: 'var(--ya-sand-700)', textWrap: 'pretty' }}>
                {d.buyers.new === 0 ? t('ya.ana.t.newNone') : topNew && topNewPct !== null ? t('ya.ana.t.newIns', { src: t(`ya.ana.src.${topNew.k}.s`), pct: pct(topNewPct) }) : ''}
              </div>
            </div>
            {newRows.length > 0 && (
              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.ana.t.newFrom')}</span>
                {newRows.map((s, i) => (
                  <div key={s.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(92px,140px) minmax(0,1fr) 48px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
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
    </>
  );
}

/** « Ce que vos messages ont rapporté » : la carte noire, avec la liste des messages (e-mails et push, 7 jours après un clic). */
function MessagesMade({ d, totalRevenue, totalOrders, money, loading, rv, onWrite }: {
  d: AnaTrafficDetail | undefined; totalRevenue: number; totalOrders: number; money: boolean; loading: boolean; rv: boolean; onWrite: () => void;
}) {
  const T = useTixT();
  const { t, tp, n, eur, pct, dShort } = T;
  const [more, setMore] = useState(false);
  const all = d?.messages ?? [];
  const rows = more ? all : all.slice(0, 6);
  const tot = d?.messages_total;
  const mRev = tot ? Number(tot.email.revenue ?? 0) + Number(tot.push.revenue ?? 0) : 0;
  const mOrd = tot ? tot.email.orders + tot.push.orders : 0;
  const share = money ? (totalRevenue > 0 ? Math.min(100, (mRev / totalRevenue) * 100) : null) : (totalOrders > 0 ? Math.min(100, (mOrd / totalOrders) * 100) : null);
  const name = (x: TixTrafficMessage) => (x.channel === 'email' && x.recipe ? t('ya.tr.msg.recipe', { name: t(`em.auto.kind.${x.recipe}.title`) }) : x.name ?? '—');
  const grid = 'minmax(200px,1.8fr) 80px 80px 110px 90px';
  const muted = 'var(--ya-text-on-night-2)';
  return (
    <section style={{ ...nightCard, display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(22px,2.6vw,30px)', ...fadeIn(rv, 120) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: muted }}>{t('ya.mk.msgT')}</span>
          {loading || !tot ? <Sk h={64} w={260} r={14} /> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 22px' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(52px,6.5vw,80px)', lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{share !== null ? pct(share) : '—'}</span>
              <span style={{ fontSize: 16, lineHeight: 1.4, color: muted, maxWidth: 460, paddingBottom: 8 }}>
                {money ? tp('ya.mk.msgS', mOrd, { v: eur(mRev), n: n(mOrd) }) : tp('ya.mk.msgSN', mOrd, { n: n(mOrd) })}
              </span>
            </div>
          )}
          <span style={{ fontSize: 13.5, color: muted, maxWidth: 620 }}>{t('ya.mk.msgSub')}</span>
        </div>
        <BrandArrowButton label={t('ya.mk.msgCta')} onClick={onWrite} />
      </div>
      {!loading && rows.length > 0 && (
        <div className="ya-thin-scroll" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 600, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '0 4px 10px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: muted, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <span>{t('ya.tr.msg.col.msg')}</span><span style={{ textAlign: 'right' }}>{t('ya.mk.col.clicks')}</span><span style={{ textAlign: 'right' }}>{t('ya.mk.col.sales')}</span>
              <span style={{ textAlign: 'right' }}>{t(money ? 'ya.mk.col.revenue' : 'ya.mk.col.buyers')}</span><span style={{ textAlign: 'right' }}>{t('ya.mk.col.perClick')}</span>
            </div>
            {rows.map((x) => {
              const per = money && x.clicked >= MIN_SAMPLE ? Number(x.revenue ?? 0) / x.clicked : null;
              return (
                <div key={`${x.channel}:${x.id}`} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '11px 4px', fontSize: 14, fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <Icon name={x.channel === 'email' ? 'mail' : 'bell'} size={15} stroke={2.2} style={{ flex: 'none', color: muted }} />
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(x)}</b>
                      <span style={{ fontSize: 12, color: muted }}>{[x.channel === 'push' ? t('ya.tr.msg.push') : x.recipe ? t('ya.tr.msg.auto') : t('ya.tr.msg.email'), x.at ? dShort(x.at) : null].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>{n(x.clicked)}</span>
                  <span style={{ textAlign: 'right' }}>{n(x.orders)}</span>
                  <b style={{ textAlign: 'right' }}>{money ? eur(Number(x.revenue ?? 0)) : n(x.buyers)}</b>
                  <span style={{ textAlign: 'right', color: muted }}>{per !== null ? eur(per) : '—'}</span>
                </div>
              );
            })}
          </div>
          {all.length > 6 && (
            <Hv
              as="button"
              type="button"
              onClick={() => setMore((o) => !o)}
              style={{ marginTop: 10, height: 34, padding: '0 14px', borderRadius: 99, border: '1px solid rgba(255,255,255,.18)', background: 'transparent', color: 'var(--ya-text-on-night)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              hover={{ borderColor: 'rgba(255,255,255,.4)' }}
            >
              {more ? t('ya.tr.msg.less') : t('ya.tr.msg.more', { n: n(all.length) })}
              <Icon name="chevronDown" size={14} stroke={2.4} style={{ transform: `rotate(${more ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
            </Hv>
          )}
        </div>
      )}
      {!loading && rows.length === 0 && <span style={{ fontSize: 14, color: muted }}>{t('ya.tr.msg.empty')}</span>}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: muted }}>{t('ya.mk.msgFoot')}</span>
    </section>
  );
}

/** Part des nouveaux clients d'une soirée, d'après `tix_ana_traffic.events` (colonne de « Quelles soirées marchent le mieux ? »). */
export function newShareByNight(d: AnaTraffic | undefined): Map<string, { n: number; of: number }> {
  return new Map((d?.events ?? []).map((e) => [e.id, { n: Number(e.new_buyers), of: Number(e.buyers) }]));
}
