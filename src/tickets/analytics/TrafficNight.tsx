/**
 * Yuno Tickets › Analyses › Trafic d'UNE soirée (`?e=`, lot T3 du plan Trafic) :
 * qui regarde cette soirée, depuis quand, d'où, et combien passent à l'achat.
 * Comparée à une autre soirée (`?ce=`, sinon la précédente de la série) AU MÊME
 * JOUR avant la soirée : la courbe cumulée des visites depuis la publication,
 * les visiteurs, le temps passé, le passage à l'achat. Lecture : le mode
 * soirée de `tix_ana_visits`.
 */
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useProgress } from '@/crm/ui/motion';
import { niceTop, COARSE_STEPS } from '@/crm/lib/axis';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixNights } from '@/tickets/analytics/scope';
import type { AnaFilters, AnaTab, AnaVisits, VisitFam } from '@/tickets/analytics/data';
import {
  CardHead, ChartSkeleton, Fill, MultiLine, Sk, StatePill, Tile, TileSkeleton, card, fadeIn, useGo, type NightState, type TileSpec,
} from './anaUi';
import { deltaPct, jLabelFor } from './SalesTab';
import { BridgeBand, Chip, FAM_COLOR, FunnelCard, LinksCard, MIN_SAMPLE, countryName, fmtDur, peakHours, rate } from './TrafficTab';


/** « samedi 17 octobre » → « Samedi 17 octobre » (une seule majuscule). */
function capFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function hourLabel(h: number, lang: string): string {
  if (lang !== 'en') return `${h} h`;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function TrafficNight({ q, f, setF, goTab }: { q: UseQueryResult<AnaVisits>; f: AnaFilters; setF: (p: Partial<AnaFilters>) => void; goTab: (k: AnaTab, hash?: string) => void }) {
  const T = useTixT();
  const { t, tp, n, pct, dShort, dLong } = T;
  const d = q.data;
  const ready = !!d && d.meta.mode === 'event' && d.meta.event?.id === f.event;
  const loading = !ready || (q.isFetching && q.isPlaceholderData);
  const dataKey = `${f.event}:${f.compare}:${q.dataUpdatedAt}`;
  const rv = useGo(dataKey, !loading);
  const go = useGo(dataKey, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);
  const jl = jLabelFor(t);
  const scopeNights = useTixNights();

  const view = useMemo(() => {
    if (!d || !ready || !d.curve) return null;
    const cur = d.curve.cur;
    const prev = d.curve.prev;
    const lastI = (() => { let k = cur.length - 1; while (k > 0 && cur[k] === null) k--; return k; })();
    const top = niceTop(Math.max(1, ...cur.map((x) => x ?? 0), ...(prev ?? [])), { headroom: 1.08, empty: 1, steps: COARSE_STEPS });
    return { cur, prev, lastI, top };
  }, [d, ready]);

  if (!d || !ready || !view) {
    return (
      <>
        <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={26} w={280} /><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton height={260} /></section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)}</div>
      </>
    );
  }
  const m = d.meta;
  const ev = m.event!;
  const pev = m.prev_event;
  const tt = d.totals;
  const left = ev.days_left ?? 0;
  const upcoming = !!ev.upcoming;
  const jNow = upcoming ? jl(left) : t('ya.tv.ev.after');
  const state: NightState = !upcoming ? 'past' : left === 0 ? 'tonight' : 'presale';
  const prevAt = view.prev ? view.prev[view.lastI] ?? 0 : null;
  const vD = pev ? deltaPct(tt.visits, tt.prev_visits, T) : null;
  const uD = pev ? deltaPct(tt.visitors, tt.prev_visitors, T) : null;
  const conv = rate(tt.orders, tt.visits);
  const pConv = rate(tt.prev_orders, tt.prev_visits);
  const cD = pev && conv !== null && pConv !== null ? { up: conv >= pConv, text: `${conv >= pConv ? '▲' : '▼'} ${t('ya.tv.pts', { n: T.n1(Math.abs(conv - pConv)) })}` } : null;
  const durD = pev && tt.median_s !== null && tt.prev_median_s !== null && tt.measured >= MIN_SAMPLE && tt.prev_measured >= MIN_SAMPLE
    ? (tt.median_s === tt.prev_median_s ? { up: true, text: '=' } : { up: tt.median_s > tt.prev_median_s, text: `${tt.median_s > tt.prev_median_s ? '▲' : '▼'} ${fmtDur(T, Math.abs(tt.median_s - tt.prev_median_s))}` })
    : null;
  const vsP = pev ? t('ya.tv.ev.vs', { title: `${pev.title} (${dShort(pev.start_at)})`, j: upcoming ? jNow : '' }).replace(/\s+$/, '') : '';
  const kb = d.known_before;
  // Visites de chaque jour (la courbe est cumulée) : l'étincelle de la tuile Visiteurs.
  const daily = view.cur.slice(0, view.lastI + 1).map((x, i, a) => (x ?? 0) - (i ? a[i - 1] ?? 0 : 0));
  const e = d.engagement;
  const longer = rate(e.dur[2] + e.dur[3] + e.dur[4], e.measured);
  const kbPct = kb ? rate(kb.came, kb.connected) : null;
  const tiles: TileSpec[] = [
    { kind: 'spark', label: t('ya.tv.t.visitors'), value: n(tt.visitors * prog), delta: uD ? `${uD.text} ${vsP}` : undefined, dc: uD && !uD.up ? 'var(--ya-red-600)' : undefined, cap: tt.visitors > 0 ? t('ya.tv.ev.perPerson', { n: T.n1(tt.visits / tt.visitors) }) : t('ya.tv.none'), values: daily },
    { kind: 'hb', label: t('ya.tv.t.time'), value: fmtDur(T, tt.median_s), delta: durD ? `${durD.text} ${vsP}` : undefined, dc: durD && !durD.up ? 'var(--ya-red-600)' : 'var(--ya-sand-600)', cap: t('ya.tv.ev.timeCap'), hb: longer ?? 0, hbL: longer !== null ? t('ya.tv.t.timeBar', { pct: pct(longer) }) : '' },
    { kind: 'txt', label: t('ya.tv.t.conv'), value: conv !== null ? pct(conv * prog, 1) : n(tt.orders), delta: cD ? `${cD.text} ${vsP}` : undefined, dc: cD && !cD.up ? 'var(--ya-red-600)' : undefined, cap: tp('ya.tv.ev.convCap', tt.orders, { n: n(tt.orders) }), color: 'var(--ya-gradient-brand)' },
    { kind: 'ring', label: t('ya.tv.ev.known'), value: kbPct !== null ? pct(kbPct * prog) : kb && kb.connected > 0 ? n(kb.came) : '—', cap: kbPct !== null ? t('ya.tv.ev.knownCap') : t('ya.tv.ev.knownFew', { n: n(kb?.connected ?? 0) }), ring: kbPct ?? 0 },
  ];
  const nightsOpts = (scopeNights.data?.nights ?? []).filter((x) => x.id !== ev.id && new Date(x.start_at).getTime() < new Date(ev.start_at).getTime())
    .sort((a, b) => b.start_at.localeCompare(a.start_at));
  const xl = [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const i = Math.round(r * (m.n - 1));
    return jl(m.n - 1 - i);
  });
  const lines = [
    { name: `${ev.title} · ${dShort(ev.start_at)}`, c: 'var(--ya-red-500)', w: 3, dash: '', vals: view.cur },
    ...(view.prev && pev ? [{ name: t('ya.tv.ev.prevLine', { title: `${pev.title} · ${dShort(pev.start_at)}` }), c: 'var(--ya-ink)', w: 2, dash: '5 5', vals: view.prev as (number | null)[] }] : []),
  ];
  // Sources de la soirée, triées par visites.
  const src = [...d.sources].sort((a, b) => b.visits - a.visits);
  const srcMax = Math.max(1, ...src.map((s) => s.visits));
  const hours = d.hours ?? [];
  const hMax = Math.max(1, ...hours);
  const pk = peakHours(hours);
  const dist = d.distance;
  const art = d.artists;
  const artMax = Math.max(1, ...art.map((a) => a.clicks));
  const topCities = d.cities.top.slice(0, 5);
  const demand = d.demand;

  return (
    <>
      {/* La soirée et la comparaison */}
      <section style={{ ...card, gap: 14, padding: 'clamp(18px,2.2vw,24px)', ...fadeIn(rv) }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200, flex: '1 1 260px' }}>
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.025em' }}>{ev.title}</span>
              <StatePill state={state} label={t(`ya.ana.state.${state}`)} />
              {upcoming && <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.06em', color: 'var(--ya-sand-500)' }}>{jNow}</span>}
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--ya-sand-500)' }}>{capFirst(dLong(ev.start_at))}</span>
          </div>
          <label style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, maxWidth: '100%', fontSize: 13, color: 'var(--ya-sand-600)' }}>
            <span style={{ whiteSpace: 'nowrap' }}>{t('ya.nr.compareWith')}</span>
            <select
              value={f.compare ?? ''}
              onChange={(e) => setF({ compare: e.target.value || null })}
              style={{ maxWidth: 'min(280px, 100%)', minWidth: 0, height: 34, padding: '0 10px', borderRadius: 99, border: 0, boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', background: 'var(--ya-card)', color: 'var(--ya-ink)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
            >
              <option value="">{pev && !f.compare ? `${t('ya.nr.compareNone')} · ${pev.title} (${dShort(pev.start_at)})` : t('ya.nr.compareNone')}</option>
              {nightsOpts.map((o) => <option key={o.id} value={o.id}>{o.title} · {dShort(o.start_at)}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* Héros : la courbe cumulée */}
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)' }}>
        <CardHead title={t('ya.tv.ev.heroT')} sub={t('ya.tv.ev.heroSub')} />
        {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}><Sk h={72} w="min(340px,60%)" r={14} /><ChartSkeleton height={260} /></div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(tt.visits * prog)}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{upcoming ? t('ya.tv.ev.bigUp', { j: jNow, n: n(tt.visitors) }) : t('ya.tv.ev.bigPast', { n: n(tt.visitors) })}</span>
                {pev && (vD
                  ? <span style={{ fontSize: 15, fontWeight: 600, color: vD.up ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{`${vD.text} ${vsP} (${n(tt.prev_visits)})`}</span>
                  : <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ya-sand-500)' }}>{t('ya.tv.ev.noPrev', { title: pev.title })}</span>)}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 13, color: 'var(--ya-sand-600)' }}>
              {lines.map((l) => (
                <span key={l.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <i style={{ width: 18, height: 0, borderTop: `${l.dash ? '2px dashed' : '3px solid'} ${l.c}`, display: 'inline-block' }} />{l.name}
                </span>
              ))}
            </div>
            <MultiLine
              lines={lines}
              top={view.top}
              go={go}
              fy={(x) => n(x)}
              tipTitle={(i) => `${jl(m.n - 1 - i)} · ${dShort(m.labels[i])}`}
              tipValue={(x) => tp('ya.tv.nVisits', x, { n: n(x) })}
              xl={xl}
              height={260}
            />
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        {/* D'où arrivent-ils pour cette soirée ? */}
        <section style={{ ...card, flex: '1 1 440px', gap: 14 }}>
          <CardHead title={t('ya.tv.ev.srcT')} sub={t('ya.tv.ev.srcSub')} />
          {src.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.none')}</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...fadeIn(rv, 120) }}>
              {src.map((s, i) => {
                const cv = rate(s.orders, s.visits);
                return (
                  <div key={s.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,170px) minmax(0,1fr) 64px 64px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <i style={{ flex: 'none', width: 9, height: 9, borderRadius: 3, background: FAM_COLOR[s.k as VisitFam] }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ya-sand-700)' }}>{t(`ya.tv.fam.${s.k}`)}</span>
                    </span>
                    <Fill pct={(s.visits / srcMax) * 100} go={go} delay={i * 70} h={10} bg={FAM_COLOR[s.k as VisitFam]} dur={800} />
                    <b style={{ textAlign: 'right' }}>{n(s.visits)}</b>
                    <span style={{ textAlign: 'right', color: cv !== null && conv !== null && cv >= conv * 1.3 ? 'var(--ya-green-700)' : 'var(--ya-sand-600)' }}>{cv !== null ? pct(cv, 1) : '—'}</span>
                  </div>
                );
              })}
              <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.ev.srcFoot')}</span>
            </div>
          )}
        </section>
        <div style={{ flex: '1.4 1 520px', minWidth: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><FunnelCard d={d} rv={rv} go={go} prog={prog} ev /></div>
        </div>
      </div>

      <LinksCard links={d.links} rv={rv} go={go} ev />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        {/* Quand regardent-ils cette soirée ? */}
        <section style={{ ...card, flex: '1.3 1 460px', gap: 14 }}>
          <CardHead title={t('ya.tv.ev.hoursT')} sub={`${t('ya.tv.ev.hoursSub')}${pk && tt.visits >= MIN_SAMPLE ? ` ${t('ya.tv.ev.hoursPeak', { h1: hourLabel(pk[0], T.lang), h2: hourLabel(pk[1], T.lang) })}` : ''}`} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 150, ...fadeIn(rv, 140) }}>
            {hours.map((x, h) => (
              <div key={h} title={`${hourLabel(h, T.lang)} : ${tp('ya.tv.nVisits', x, { n: n(x) })}`} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ width: '100%', height: `${Math.max(1, (x / hMax) * 100)}%`, borderRadius: '3px 3px 0 0', background: pk && ((h - pk[0] + 24) % 24) < 3 ? 'linear-gradient(180deg,var(--ya-tangerine-500),var(--ya-red-500))' : 'var(--ya-red-200)', transform: `scaleY(${go ? 1 : 0})`, transformOrigin: 'bottom', transition: go ? `transform 600ms cubic-bezier(.22,1,.36,1) ${h * 15}ms` : 'none' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--ya-font-mono)', fontSize: 11, color: 'var(--ya-sand-500)' }}>
            {[0, 6, 12, 18, 23].map((h) => <span key={h}>{hourLabel(h, T.lang)}</span>)}
          </div>
        </section>

        {/* Quels artistes intriguent ? */}
        <section style={{ ...card, flex: '1 1 340px', gap: 14 }}>
          <CardHead title={t('ya.tv.ev.artT')} sub={t('ya.tv.ev.artSub')} />
          {art.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.ev.artNone')}</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...fadeIn(rv, 160) }}>
              {art.map((a, i) => (
                <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '32px minmax(90px,140px) minmax(0,1fr) 44px', gap: 10, alignItems: 'center', fontSize: 14 }}>
                  {a.photo ? <img src={a.photo} alt="" style={{ width: 32, height: 32, borderRadius: 99, objectFit: 'cover' }} /> : <span style={{ width: 32, height: 32, borderRadius: 99, background: 'var(--ya-sand-100)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600 }}>{a.name.slice(0, 1).toUpperCase()}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{a.name}</span>
                  <Fill pct={(a.clicks / artMax) * 100} go={go} delay={i * 70} h={8} bg="#B05BE0" dur={800} />
                  <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n(a.clicks)}</b>
                </div>
              ))}
            </div>
          )}
          <span style={{ fontSize: 13.5, color: 'var(--ya-sand-600)' }}>{tp('ya.tv.ev.shares', d.engagement.shares, { n: n(d.engagement.shares) })}</span>
        </section>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        {/* D'où regardent-ils ? */}
        <section style={{ ...card, flex: '1 1 420px', gap: 14 }}>
          <CardHead title={t('ya.tv.cityT')} sub={t('ya.tv.ev.distSub')} />
          {dist && dist.known >= MIN_SAMPLE ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...fadeIn(rv, 160) }}>
              {(['near', 'mid', 'far'] as const).map((k, i) => (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,170px) minmax(0,1fr) 52px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--ya-sand-700)' }}>{t(`ya.tv.ev.dist.${k}`)}</span>
                  <Fill pct={(dist[k] / dist.known) * 100} go={go} delay={i * 80} h={12} bg={i === 0 ? 'var(--ya-gradient-brand)' : 'var(--ya-sand-400)'} dur={800} />
                  <b style={{ textAlign: 'right' }}>{pct((dist[k] / dist.known) * 100)}</b>
                </div>
              ))}
            </div>
          ) : <p style={{ margin: 0, fontSize: 14, color: 'var(--ya-sand-500)' }}>{t(dist ? 'ya.tv.ev.distFew' : 'ya.tv.ev.distNo')}</p>}
          {topCities.length > 0 && (
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ya-sand-600)', textWrap: 'pretty' }}>
              {t('ya.tv.ev.cities', { list: topCities.map((c) => `${c.city} ${n(c.n)}`).join(', ') })}
              {d.cities.abroad.length > 0 ? ` ${t('ya.tv.ev.abroad', { list: d.cities.abroad.slice(0, 3).map((c) => `${countryName(c.cc, T.locale)} ${n(c.n)}`).join(', ') })}` : ''}
            </span>
          )}
        </section>

        {/* La demande qui reste */}
        <section style={{ ...card, flex: '1 1 420px', gap: 14 }}>
          <CardHead title={t('ya.tv.ev.demT')} sub={t('ya.tv.ev.demSub')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 10 }}>
            {demand && (
              <Chip
                label={t('ya.tv.ev.dem.after')}
                value={demand.sold_out_at ? n(demand.after_full ?? 0) : '—'}
                sub={demand.sold_out_at ? t('ya.tv.ev.dem.afterS', { d: dShort(demand.sold_out_at) }) : t('ya.tv.ev.dem.notFull')}
              />
            )}
            <Chip label={t('ya.tv.ev.dem.wait')} value={n(d.funnel.waitlist)} sub={t('ya.tv.ev.dem.waitS')} />
            {demand && demand.soldout_seen !== null && (
              <Chip label={t('ya.tv.ev.dem.seen')} value={n(demand.soldout_seen)} sub={t('ya.tv.ev.dem.seenS')} />
            )}
          </div>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.ev.demFoot')}</span>
        </section>
      </div>

      <BridgeBand d={d} ev onGo={() => goTab('sales')} rv={rv} />
    </>
  );
}
