/**
 * Analyses › Ventes › « Ce qui a fait vendre » (27/10, TRAFFIC_TAB_PLAN.md
 * lot C5). Les blocs d'argent qui vivaient dans Trafic, déplacés tels quels :
 * les ventes par source (la source que Shotgun rend sur chaque billet), les
 * liens Yuno qui ont vendu, ce que vos messages ont rapporté, les partenaires
 * et les nouveaux clients. Lecture : crm_ana_traffic (inchangée, plus `links`,
 * `messages`, `night_mix`). Les visites de la page Shotgun ne sont pas dans
 * l'API : « Bientôt », dans Trafic.
 */
import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented } from '@/crm/ui/kit';
import { useProgress } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SOURCE_KEYS, type AnaFilters, type AnaPartner, type AnaSales, type AnaTraffic, type SourceKey } from '@/crm/data/analytics';
import { linkConversion } from '@/crm/lib/links';
import {
  BrandArrowButton, CardHead, ChartSkeleton, Fill, Sk, StackChart, bucketTitle, card, fadeIn, nightCard, useGo, xLabels,
} from './anaUi';
import { jLabelFor } from './SalesTab';

type T = ReturnType<typeof useCrmT>;

export const SOURCE_COLOR: Record<SourceKey, string> = {
  ys: 'var(--red-600)', yb: 'var(--red-400)', yt: 'var(--red-900)', yl: 'var(--red-200)', em: 'var(--tangerine-500)', sm: 'var(--amber-500)', dm: '#D62976', pa: '#3B5BDB',
  so: '#962FBF', sg: 'var(--ink)', ex: 'var(--green-600)', se: 'var(--amber-700)', au: 'var(--sand-400)', di: 'var(--sand-300)', of: 'var(--sand-200)',
};

/** Les quatre sources « lien Yuno » regroupées en une ligne dépliable. */
const YUNO_LINK_KEYS: SourceKey[] = ['ys', 'yb', 'yt', 'yl'];

export function trafficCsv(d: AnaTraffic, T: T, money: boolean): { columns: string[]; rows: unknown[][] } {
  const cols = [T.t('yc.ana.csv.source'), T.t('yc.ana.csv.orders'), T.t('yc.ana.csv.tickets'), T.t('yc.ana.csv.buyers'), T.t('yc.ana.csv.newBuyers'), ...(money ? [T.t('yc.ana.csv.revenue')] : [])];
  const rows = d.sources.map((s) => [T.t(`yc.ana.src.${s.k}`), s.orders, s.tickets, s.buyers, s.new_buyers, ...(money ? [s.revenue] : [])]);
  return { columns: cols, rows };
}

export function MadeSell({ q, f, msg }: { q: UseQueryResult<AnaTraffic>; f: AnaFilters; msg: AnaSales['msg'] }) {
  const T = useCrmT();
  const { t, n, eur, pct } = T;
  const caps = useCrmCaps();
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const money = caps.money && !!d && d.sources.every((s) => s.revenue !== null);
  const [metricRaw, setMetric] = useState<'eur' | 'bil'>('eur');
  const metric = money ? metricRaw : 'bil';
  const dataKey = `${f.period}:${f.event}:${q.dataUpdatedAt}`;
  const [hidden, setHidden] = useState<SourceKey[]>([]);
  const [focus, setFocus] = useState<SourceKey | null>(null);
  const [open, setOpen] = useState(false);
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${hidden.join(',')}:${metric}`, !loading);
  const prog = useProgress(1000, 0, `${dataKey}:${metric}`, !loading);
  const jl = jLabelFor(t);
  const eurMode = metric === 'eur';

  const v = useMemo(() => {
    if (!d) return null;
    const val = (s: AnaTraffic['sources'][number]) => (eurMode ? Number(s.revenue ?? 0) : Number(s.tickets));
    // Les sources qui n'ont rien rapporté sur la période ne prennent pas de place.
    const used = SOURCE_KEYS.filter((k) => d.sources.find((s) => s.k === k && (Number(s.tickets) > 0 || Number(s.prev_tickets) > 0)));
    const keys = used.length ? used : (['of'] as SourceKey[]);
    const series = keys.map((k) => ({ k, label: t(`yc.ana.src.${k}`), c: SOURCE_COLOR[k], v: d.series.map((b) => Number((eurMode ? b.revenue?.[k] : b.tickets[k]) ?? 0)) }));
    const rows = d.sources.filter((s) => keys.includes(s.k)).sort((a, b) => val(b) - val(a));
    const tot = rows.reduce((a, s) => a + val(s), 0);
    const orders = rows.reduce((a, s) => a + Number(s.orders), 0);
    return { series, rows, tot, orders, val };
  }, [d, eurMode, t]);

  if (!d || !v) {
    return <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={280} /><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></section>;
  }
  const m = d.meta;
  const unit = m.mode === 'hour' ? 'hour' : m.mode === 'month' ? 'month' : 'day';
  const fmt = (x: number) => (eurMode ? eur(x) : n(x));
  const marks = d.sends.map((s) => ({ i: s.i, title: `${s.channel === 'sms' ? 'SMS' : t('yc.ana.email')} · ${s.name}` }));

  // Table des sources : les liens Yuno (story, bio, autres) en UNE ligne dépliable.
  const yRows = v.rows.filter((s) => YUNO_LINK_KEYS.includes(s.k));
  type Row = { k: SourceKey | 'yuno'; orders: number; tickets: number; new_buyers: number; buyers: number; val: number };
  const yunoRow: Row | null = yRows.length ? {
    k: 'yuno',
    orders: yRows.reduce((a, s) => a + Number(s.orders), 0),
    tickets: yRows.reduce((a, s) => a + Number(s.tickets), 0),
    new_buyers: yRows.reduce((a, s) => a + Number(s.new_buyers), 0),
    buyers: yRows.reduce((a, s) => a + Number(s.buyers), 0),
    val: yRows.reduce((a, s) => a + v.val(s), 0),
  } : null;
  const tableRows: Row[] = [
    ...v.rows.filter((s) => !YUNO_LINK_KEYS.includes(s.k)).map((s) => ({ k: s.k, orders: Number(s.orders), tickets: Number(s.tickets), new_buyers: Number(s.new_buyers), buyers: Number(s.buyers), val: v.val(s) })),
    ...(yunoRow ? [yunoRow] : []),
  ].sort((a, b) => b.val - a.val);
  const rowMax = Math.max(1, ...tableRows.map((r) => r.val));
  const kids = (d.links ?? []).map((l) => ({ ...l, val: eurMode ? Number(l.revenue ?? 0) : Number(l.tickets) })).sort((a, b) => b.val - a.val);
  const grid = 'minmax(170px,1.5fr) 92px 84px 128px minmax(170px,1.4fr)';
  const mono = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'var(--sand-500)' };

  // Qui vous découvre.
  const newRows = [...v.rows].filter((s) => Number(s.new_buyers) > 0).sort((a, b) => Number(b.new_buyers) - Number(a.new_buyers)).slice(0, 4);
  const newTot = d.buyers.new || 1;
  const newPct = d.buyers.buyers > 0 ? (d.buyers.new / d.buyers.buyers) * 100 : null;
  // La phrase ne dit que ce que les chiffres montrent : la source qui amène
  // le plus de nouveaux clients, et sa part.
  const topNew = newRows[0] ?? null;
  const topNewPct = topNew && d.buyers.new > 0 ? (Number(topNew.new_buyers) / d.buyers.new) * 100 : null;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
        <span style={{ flex: 1, height: 1, background: 'var(--sand-200)' }} />
        <span style={mono}>{t('yc.ana.s.madeT')}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--sand-200)' }} />
      </div>

      {/* Qui fait vendre : ventes par source, empilées */}
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)' }}>
        <CardHead
          title={t('yc.ana.t.heroT')}
          sub={t('yc.ana.ms.heroSub', { unit: t(`yc.ana.unit.${m.mode === 'event' ? 'day' : unit}`), n: n(v.orders) })}
          right={money ? <Segmented value={metric} onChange={(x) => setMetric(x)} ariaLabel={t('yc.ana.t.heroT')} options={[{ value: 'eur', label: t('yc.ana.s.eur') }, { value: 'bil', label: t('yc.ana.s.bil') }]} /> : undefined}
        />
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(48px,6vw,80px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{fmt(v.tot * prog)}</span>
              <span style={{ fontSize: 14, color: 'var(--sand-500)', paddingBottom: 8 }}>{t(eurMode ? 'yc.ana.t.bigSub' : 'yc.ana.t.bigSubTk')}</span>
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
                    title={t('yc.ana.t.toggle')}
                    onClick={() => {
                      if (on && v.series.length - hidden.length <= 1) return;
                      setHidden((h) => (on ? [...h, s.k as SourceKey] : h.filter((x) => x !== s.k)));
                    }}
                    style={{ height: 32, padding: '0 12px 0 10px', borderRadius: 99, border: '1px solid var(--sand-200)', background: on ? '#fff' : 'transparent', color: on ? 'var(--ink)' : 'var(--sand-400)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms' }}
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
              focus={focus}
              marks={marks}
              go={go}
              fy={fmt}
              height={240}
              tipTitle={(i) => bucketTitle(m, i, T, jl)}
              tipValue={(x) => (eurMode ? eur(x) : t('yc.ana.nTickets', { n: n(x) }))}
              xl={xLabels(m, T, jl)}
            />
          </div>
        )}
      </section>

      {/* Quelle source fait vendre */}
      <section style={{ ...card, gap: 16 }}>
        <CardHead
          title={t('yc.ana.ms.srcT')}
          sub={t('yc.ana.ms.srcSub')}
          right={(
            <Hv as={Link} to={`${CRM_ROUTES.traffic}${f.event ? `?e=${f.event}` : f.period !== '30d' ? `?p=${f.period}` : ''}`} style={{ flex: 'none', height: 38, padding: '0 16px', borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }} hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-400)', textDecoration: 'none' }}>
              {t('yc.ana.ms.toTraffic')}<Icon name="arrowRight" size={15} stroke={2.4} />
            </Hv>
          )}
        />
        {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Sk key={i} h={52} r={14} />)}</div> : (
          <div className="yc-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 180) }}>
            <div style={{ minWidth: 700, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '0 10px 10px', ...mono }}>
                <span>{t('yc.ana.col.source')}</span><span style={{ textAlign: 'right' }}>{t('yc.tr.lk.col.orders')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.ms.col.tickets')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.col.newClients')}</span><span>{t(eurMode ? 'yc.ana.ms.col.revenue' : 'yc.ana.ms.col.tickets')}</span>
              </div>
              {tableRows.map((s, i) => {
                const isY = s.k === 'yuno';
                const off = !isY && hidden.includes(s.k as SourceKey);
                const hot = !isY && focus === s.k;
                return (
                  <div key={s.k} style={{ borderRadius: 14, background: isY && open ? 'var(--sand-50)' : hot ? 'var(--sand-50)' : 'transparent' }}>
                    <div
                      onMouseEnter={() => { if (!isY) setFocus(s.k as SourceKey); }}
                      onMouseLeave={() => setFocus(null)}
                      onClick={isY ? () => setOpen((o) => !o) : undefined}
                      role={isY ? 'button' : undefined}
                      aria-expanded={isY ? open : undefined}
                      tabIndex={isY ? 0 : undefined}
                      onKeyDown={isY ? (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); setOpen((o) => !o); } } : undefined}
                      style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '12px 10px', opacity: off ? 0.4 : 1, cursor: isY ? 'pointer' : 'default', transition: 'opacity 160ms', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: isY ? 'var(--red-600)' : SOURCE_COLOR[s.k as SourceKey], boxShadow: 'inset 0 0 0 1px rgba(28,21,23,.12)' }} />
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isY ? t('yc.ana.ms.yuno') : t(`yc.ana.src.${s.k}.s`)}</b>
                          {isY && <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.ana.ms.yunoSub')}</span>}
                        </span>
                        {isY && kids.length > 0 && <Icon name="chevronDown" size={14} stroke={2.4} color="var(--sand-400)" style={{ flex: 'none', transform: `rotate(${open ? 180 : 0}deg)`, transition: 'transform 200ms' }} />}
                      </span>
                      <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{n(s.orders * prog)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--sand-700)' }}>{n(s.tickets * prog)}</span>
                      <b style={{ textAlign: 'right' }}>{n(s.new_buyers * prog)}</b>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{eurMode ? eur(s.val) : t('yc.ana.nTickets', { n: n(s.val) })}</b><span style={{ color: 'var(--sand-500)', fontSize: 13 }}>{v.tot > 0 ? pct((s.val / v.tot) * 100) : '—'}</span></span>
                        <Fill pct={(s.val / rowMax) * 100} go={go} delay={i * 80} h={5} bg="var(--ink)" dur={800} />
                      </span>
                    </div>
                    {isY && open && kids.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', padding: '0 10px 10px 30px' }}>
                        {kids.map((l) => (
                          <div key={l.id} style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--sand-100)', fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: 'var(--sand-700)' }}>
                            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                              <span style={{ color: 'var(--ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                              <span style={{ fontSize: 12, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.event_title ?? ''} · {t(`yc.tr.kind.${l.src === 'yl' && l.placement === 'page' ? 'yl' : l.src}`)}</span>
                            </span>
                            <span style={{ textAlign: 'right' }}>{n(Number(l.orders))}</span>
                            <span style={{ textAlign: 'right' }}>{n(Number(l.tickets))}</span>
                            <span style={{ textAlign: 'right' }}>{n(Number(l.new_buyers))}</span>
                            <b style={{ color: 'var(--ink)' }}>{eurMode ? eur(l.val) : t('yc.ana.nTickets', { n: n(l.val) })}</b>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--sand-500)' }}>{t('yc.ana.ms.srcFoot')}</span>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <MessagesCard d={d} msg={msg} money={money} prog={prog} rv={rv} T={T} />
        <PartnersCard d={d} loading={loading} money={money} prog={prog} go={go} rv={rv} T={T} />
      </div>

      {/* Qui vous découvre */}
      <section style={{ ...card, gap: 18 }}>
        <CardHead title={t('yc.ana.t.newT')} sub={t('yc.ana.ms.newSub')} />
        {loading ? <Sk h={200} r={16} /> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 36px', ...fadeIn(rv, 240) }}>
            <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px 14px' }}>
                <span style={{ flex: 'none', whiteSpace: 'nowrap', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{newPct !== null ? pct(newPct * prog) : '—'}</span>
                <span style={{ fontSize: 14, color: 'var(--sand-500)', paddingBottom: 6 }}>{t('yc.ana.ms.newBig', { n: n(d.buyers.new) })}</span>
              </div>
              <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: go ? `${newPct ?? 0}%` : '0%', background: 'var(--gradient-brand)', transition: 'width 800ms cubic-bezier(.22,1,.36,1)' }} />
                <div style={{ flex: 1, background: 'var(--sand-200)' }} />
              </div>
              <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)', textWrap: 'pretty' }}>
                {d.buyers.new === 0 ? t('yc.ana.t.newNone') : topNew && topNewPct !== null ? t('yc.ana.t.newIns', { src: t(`yc.ana.src.${topNew.k}.s`), pct: pct(topNewPct) }) : ''}
              </div>
            </div>
            {newRows.length > 0 && (
              <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={mono}>{t('yc.ana.t.newFrom')}</span>
                {newRows.map((s, i) => (
                  <div key={s.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(92px,140px) minmax(0,1fr) 48px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: 'var(--sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`yc.ana.src.${s.k}.s`)}</span>
                    <Fill pct={(Number(s.new_buyers) / newTot) * 100} go={go} delay={i * 80} h={10} bg={SOURCE_COLOR[s.k]} dur={800} />
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

/**
 * « Ce que vos messages ont rapporté » : la carte noire de Ventes, qui gagne
 * la liste des envois. Un acheteur compte quand il a cliqué dans les 7 jours
 * avant l'achat, le dernier clic gagne (_crm_email_attrib) ; un SMS, par son
 * lien court.
 */
function MessagesCard({ d, msg, money, prog, rv, T }: { d: AnaTraffic; msg: AnaSales['msg']; money: boolean; prog: number; rv: boolean; T: T }) {
  const { t, tp, n, eur, eur2, pct, dShort } = T;
  const navigate = useNavigate();
  const share = msg?.share ?? null;
  const rows = (d.messages ?? []).slice(0, 6);
  const grid = 'minmax(150px,1.6fr) 80px 96px 80px';
  return (
    <section style={{ ...nightCard, flex: '1.3 1 520px', display: 'flex', flexDirection: 'column', gap: 18, padding: '26px 28px', ...fadeIn(rv, 120) }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.ana.ms.msgT')}</h2>
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-on-night-2)' }}>{t('yc.ana.ms.msgSub')}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 18px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(48px,6vw,72px)', lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{share !== null ? pct(Number(share) * prog) : '—'}</span>
        <span style={{ fontSize: 15, lineHeight: 1.4, color: 'var(--text-on-night-2)', maxWidth: 420, paddingBottom: 6 }}>
          {money ? t('yc.ana.s.madeS', { v: eur(Number(msg?.revenue ?? 0)) }) : t('yc.ana.s.madeSTk', { n: n(Number(msg?.tickets ?? 0)) })}
        </span>
      </div>
      {rows.length > 0 && (
        <div className="yc-thin-scroll" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 440, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '0 0 8px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>
              <span>{t('yc.ana.ms.col.msg')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.col.buyers')}</span><span style={{ textAlign: 'right' }}>{t(money ? 'yc.ana.ms.col.revenue' : 'yc.ana.ms.col.tickets')}</span><span style={{ textAlign: 'right' }}>{t('yc.ana.ms.col.perSend')}</span>
            </div>
            {rows.map((r, i) => {
              const val = money ? Number(r.revenue ?? 0) : Number(r.tickets);
              const sub = r.kind === 'recipe' ? tp('yc.tr.msg.recipe', Number(r.nights), { n: n(Number(r.nights)) })
                : r.kind === 'sms' ? `SMS${r.at ? ` · ${dShort(r.at)}` : ''}` : `${t('yc.tr.kind.em')}${r.at ? ` · ${dShort(r.at)}` : ''}`;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,.1)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.kind === 'recipe' ? t(`yc.au.r.${r.name}.name`) : r.name}</b>
                    <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{sub}</span>
                  </span>
                  <span style={{ textAlign: 'right' }}>{n(Number(r.buyers))}</span>
                  <b style={{ textAlign: 'right' }}>{money ? eur(val) : n(val)}</b>
                  <span style={{ textAlign: 'right', color: 'var(--text-on-night-2)' }}>{money && Number(r.sent) > 0 ? eur2(val / Number(r.sent)) : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ marginTop: 'auto' }}><BrandArrowButton label={t('yc.ana.s.madeCta')} onClick={() => navigate(CRM_ROUTES.emailAnalysis)} /></div>
    </section>
  );
}

/**
 * « Quels partenaires font vendre ? » : un lien de suivi Shotgun nommé
 * (« assas », « dj-masza ») ou un lien Yuno « partenaire », un par ligne.
 * Shotgun ne rapporte pas les clics de ses liens : la case dit « Bientôt »,
 * jamais un chiffre. Un lien Yuno mesure clics, visiteurs et conversion.
 */
function PartnersCard({ d, loading, money, prog, go, rv, T }: {
  d: AnaTraffic; loading: boolean; money: boolean; prog: number; go: boolean; rv: boolean; T: T;
}) {
  const { t, tp, n, eur, pct } = T;
  const rows: AnaPartner[] = d.partners ?? [];
  const val = (p: AnaPartner) => (money ? Number(p.revenue ?? 0) : Number(p.tickets));
  const max = Math.max(1, ...rows.map(val));
  const next = d.events.find((e) => e.state !== 'past') ?? null;
  const cta = next ? `${CRM_ROUTES.nights}?e=${next.id}&v=links` : CRM_ROUTES.nights;
  const grid = 'minmax(150px,1.4fr) 70px 84px 90px minmax(110px,1fr)';
  const muted = { textAlign: 'right' as const, color: 'var(--sand-700)' };
  return (
    <section style={{ ...card, flex: '1 1 460px', gap: 16 }}>
      <CardHead
        title={t('yc.ana.pt.t')}
        sub={t('yc.ana.pt.s')}
        right={(
          <Hv as={Link} to={cta} style={{ flex: 'none', height: 38, padding: '0 16px', borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }} hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-400)', textDecoration: 'none' }}>
            <Icon name="link" size={15} stroke={2.4} />{t('yc.ana.pt.cta')}
          </Hv>
        )}
      />
      {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2].map((i) => <Sk key={i} h={52} r={14} />)}</div> : rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-500)' }}>{t('yc.ana.pt.empty')}</p>
      ) : (
        <div className="yc-thin-scroll" style={{ overflowX: 'auto', ...fadeIn(rv, 180) }}>
          <div style={{ minWidth: 560, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '0 10px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
              <span>{t('yc.ana.pt.col.partner')}</span>
              <span style={{ textAlign: 'right' }}>{t('yc.ana.pt.col.clicks')}</span>
              <span style={{ textAlign: 'right' }} title={t('yc.ana.pt.convTip')}>{t('yc.ana.pt.col.conv')}</span>
              <span style={{ textAlign: 'right' }}>{t('yc.ana.pt.col.tickets')}</span>
              <span>{t('yc.ana.col.sales')}</span>
            </div>
            {rows.map((p, i) => {
              const v = val(p);
              const conv = p.via === 'yuno' && p.visitors !== null ? linkConversion({ visitors: Number(p.visitors), orders: Number(p.orders) }) : null;
              const soon = (
                <span title={t('yc.ana.pt.soonTip')} style={{ justifySelf: 'end', height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="lock" size={10} stroke={2.6} />{t('yc.lk.soon.badge')}
                </span>
              );
              return (
                <div key={`${p.via}:${p.code ?? p.name}`} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '12px 10px', borderRadius: 14, fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</b>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t(`yc.ana.pt.via.${p.via}`)} · {tp('yc.ana.pt.nights', Number(p.nights), { n: n(Number(p.nights)) })}</span>
                  </span>
                  {p.via === 'yuno' ? <span style={muted}>{n(Number(p.clicks ?? 0) * prog)}</span> : soon}
                  {p.via === 'yuno' ? <span style={muted} title={t('yc.ana.pt.convTip')}>{conv !== null ? pct(conv * 100) : '—'}</span> : soon}
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                    <b>{n(Number(p.tickets) * prog)}</b>
                    <span style={{ fontSize: 12, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>{t('yc.ana.pt.split', { paid: n(Number(p.paid)), free: n(Number(p.free)) })}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <b>{money ? eur(v) : t('yc.ana.nTickets', { n: n(v) })}</b>
                    <Fill pct={(v / max) * 100} go={go} delay={i * 80} h={5} bg="#3B5BDB" dur={800} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--sand-500)' }}>{t('yc.ana.pt.foot')}</span>
    </section>
  );
}
