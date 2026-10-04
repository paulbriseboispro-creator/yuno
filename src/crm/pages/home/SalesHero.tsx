/**
 * Héros de l'accueil : « Combien ai-je vendu ? » — total animé, écart avec la
 * période précédente, barres par jour (ou par heure), courbe de la période
 * précédente, repères des envois de messages et effet moyen d'un envoi.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Insight, Segmented } from '@/crm/ui/kit';
import { clamp01, reveal, useProgress, wipe } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { CrmHome, HomePeriod } from '@/crm/data/home';
import { COARSE_STEPS, niceTop } from '@/crm/lib/axis';

const PERIODS: HomePeriod[] = ['24h', '48h', '7d', '30d', '90d'];


export function SalesHero({
  data, period, onPeriod, intro, connected,
}: { data: CrmHome | undefined; period: HomePeriod; onPeriod: (p: HomePeriod) => void; intro: boolean; connected: boolean }) {
  const { t, n, eur, pct, locale } = useCrmT();
  const [hover, setHover] = useState<number | null>(null);
  const s = data?.sales;
  const hasData = !!s && s.has_any;
  // Première entrée : la courbe se dessine après les cartes (1,3 s, 600 ms de
  // retard) ; un changement de période la redessine aussitôt (0,9 s).
  const first = useRef(true);
  useEffect(() => { const id = setTimeout(() => { first.current = false; }, 2000); return () => clearTimeout(id); }, []);
  const gg = useProgress(first.current ? 1300 : 900, first.current ? 600 : 0, `${period}:${hasData}`, hasData);
  const H = s?.hourly ?? false;
  // Sans accès au chiffre d'affaires, le serveur rend les montants à null :
  // le bloc compte alors des billets (et la période d'avant, en total seulement).
  const money = !s || s.total !== null;

  const view = useMemo(() => {
    if (!s || !hasData) return null;
    const N = s.series.length;
    const cur = s.series.map((x) => Number(money ? x.cur : x.tickets));
    const prev = money ? s.series.map((x) => Number(x.prev)) : [];
    const top = niceTop(Math.max(0, ...cur, ...prev), { headroom: 1.12, empty: 1, steps: COARSE_STEPS });
    const starts = s.series.map((x) => new Date(x.t).getTime());
    const endMs = new Date(s.end).getTime();
    const idxOf = (iso: string) => {
      const ms = new Date(iso).getTime();
      if (ms < starts[0] || ms >= endMs) return -1;
      let i = 0;
      while (i + 1 < N && starts[i + 1] <= ms) i++;
      return i;
    };
    const sendAt: (CrmHome['sales']['sends'][number] | null)[] = new Array(N).fill(null);
    for (const sd of s.sends) { const i = idxOf(sd.at); if (i >= 0) sendAt[i] = sd; }
    const marks = s.sends.map((sd) => ({ i: idxOf(sd.at), sd })).filter((m) => m.i >= 0)
      .map((m) => ({ left: `${(((m.i + 0.5) / N) * 100).toFixed(2)}%`, title: `${m.sd.channel === 'sms' ? 'SMS' : 'E-mail'} · ${m.sd.name}` }));
    // Effet des envois : ventes moyennes dans la fenêtre qui suit un envoi
    // (3 heures ou 2 jours) contre le reste de la période.
    const win = H ? 3 : 2;
    let a = 0; let an = 0; let b = 0; let bn = 0;
    cur.forEach((v, i) => {
      const after = sendAt.some((sd, j) => sd && i >= j && i - j < win);
      if (after) { a += v; an++; } else { b += v; bn++; }
    });
    const ratio = an && bn && b > 0 ? (a / an) / (b / bn) : null;
    return { N, cur, prev, top, marks, sendAt, ratio, starts };
  }, [s, hasData, H, money]);

  const fmtDate = (ms: number, withHour: boolean) => {
    const d = new Date(ms);
    const day = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    return withHour ? `${day} · ${d.getHours()} h` : day;
  };

  let tip: null | { left: string; tx: string; date: string; value: string; prev: string; send: string } = null;
  if (view && hover !== null && hover < view.N) {
    const cx = ((hover + 0.5) / view.N) * 100;
    const sd = view.sendAt[hover];
    tip = {
      left: `${cx.toFixed(1)}%`,
      tx: cx < 55 ? 'translateX(24px)' : 'translateX(calc(-100% - 24px))',
      date: fmtDate(view.starts[hover], H),
      value: money ? eur(view.cur[hover]) : t('yc.home.sales.tipTickets', { n: n(view.cur[hover]) }),
      prev: money ? t('yc.home.sales.tipPrev', { v: eur(view.prev[hover]) }) : '',
      send: sd ? `${sd.channel === 'sms' ? 'SMS' : 'E-mail'} · ${sd.name}` : '',
    };
  }

  const xlabels = view
    ? [0, 0.25, 0.5, 0.75, 1].map((r) => {
      const d = new Date(view.starts[Math.min(view.N - 1, Math.round(r * (view.N - 1)))]);
      if (H) return `${view.N > 24 ? d.toLocaleDateString(locale, { weekday: 'short' }) + ' ' : ''}${d.getHours()} h`;
      return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    })
    : [];

  const total = s ? Number(money ? s.total : s.tickets) : 0;
  const ptotal = s ? Number(money ? s.prev_total : s.prev_tickets) : 0;
  const vs = t(`yc.home.periodVs.${period}`);
  let deltaText = '';
  let deltaColor = 'var(--green-700)';
  let deltaSub = '';
  if (!hasData) {
    deltaSub = t('yc.home.sales.emptySub');
  } else if (ptotal <= 0) {
    deltaText = total > 0 ? t('yc.home.sales.deltaNew', { vs }) : '';
    deltaColor = 'var(--sand-500)';
    deltaSub = money ? t('yc.home.sales.tickets', { n: n(s?.tickets ?? 0) }) : '';
  } else {
    const d = (total - ptotal) / ptotal;
    const p = Math.round(Math.abs(d) * 100);
    if (p === 0) { deltaText = t('yc.home.sales.deltaFlat', { vs }); deltaColor = 'var(--sand-500)'; }
    else if (d > 0) deltaText = t('yc.home.sales.deltaUp', { pct: pct(p), vs });
    else { deltaText = t('yc.home.sales.deltaDown', { pct: pct(p), vs }); deltaColor = 'var(--red-600)'; }
    const diff = total - ptotal;
    deltaSub = money
      ? (diff >= 0 ? t('yc.home.sales.more', { v: eur(diff) }) : t('yc.home.sales.less', { v: eur(-diff) }))
      : (diff >= 0 ? t('yc.home.sales.moreTickets', { n: n(diff) }) : t('yc.home.sales.lessTickets', { n: n(-diff) }));
  }

  const insight = !view
    ? ''
    : !s?.sends.length
      ? t('yc.home.sales.insightNone')
      : view.ratio && view.ratio > 1.05
        ? t(H ? 'yc.home.sales.insightHours' : 'yc.home.sales.insightDays', { x: view.ratio.toFixed(1).replace('.', locale.startsWith('en') ? '.' : ',') })
        : t('yc.home.sales.insightNoEffect');

  const lp2 = clamp01((gg - 0.3) / 0.7);
  const markO = clamp01((gg - 0.75) / 0.25);

  return (
    <Hv
      as="section"
      style={{
        display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28,
        background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff',
        boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', ...reveal(intro, 260),
      }}
      hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px 20px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.home.sales.title')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>
            {t(H ? 'yc.home.sales.subHour' : 'yc.home.sales.subDay', { period: t(`yc.home.periodLabel.${period}`) })}
          </div>
        </div>
        <Segmented
          value={period}
          onChange={(p) => { setHover(null); onPeriod(p); }}
          ariaLabel={t('yc.home.sales.title')}
          options={PERIODS.map((p) => ({ value: p, label: t(`yc.home.period.${p}`) }))}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(60px,9vw,128px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums', color: hasData ? 'var(--ink)' : 'var(--sand-300)' }}>
          {hasData ? (money ? eur(total * gg) : n(total * gg)) : '—'}
          {hasData && !money && <span style={{ marginLeft: 12, fontSize: 'clamp(20px,2.4vw,28px)', letterSpacing: '-.02em', color: 'var(--sand-500)' }}>{t('yc.home.sales.unitTickets')}</span>}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
          {deltaText && <span style={{ fontSize: 17, fontWeight: 600, color: deltaColor }}>{deltaText}</span>}
          <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{deltaSub}</span>
        </div>
      </div>

      {view ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 13, color: 'var(--sand-600)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 14, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))', display: 'inline-block' }} />{t(money ? (H ? 'yc.home.sales.legendHour' : 'yc.home.sales.legendDay') : (H ? 'yc.home.sales.legendHourTk' : 'yc.home.sales.legendDayTk'))}</span>
            {money && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 18, height: 0, borderTop: '2px solid var(--ink)', display: 'inline-block' }} />{t('yc.home.sales.legendPrev')}</span>}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--ink)', display: 'inline-block' }} />{t('yc.home.sales.legendSend')}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div onMouseLeave={() => setHover(null)} style={{ position: 'relative', height: 280, marginLeft: 60 }}>
              {[0, 0.5, 1].map((r) => (
                <div key={r} style={{ position: 'absolute', left: -60, right: 0, bottom: `${r * 100}%`, height: 0, borderTop: '1px solid var(--sand-100)', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', left: 0, top: -9, width: 52, whiteSpace: 'nowrap', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4 }}>
                    {r === 0 ? '0' : n(view.top * r)}
                  </span>
                </div>
              ))}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: view.N > 60 ? 1 : view.N > 40 ? 3 : view.N > 14 ? 4 : 10 }}>
                {view.cur.map((v, i) => {
                  const lp = clamp01(gg * 1.6 - (i / view.N) * 0.6);
                  const e3 = 1 - Math.pow(1 - lp, 3);
                  return (
                    <div key={i} onMouseEnter={() => setHover(i)} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'crosshair' }}>
                      <div style={{
                        width: '100%', height: `${((v / view.top) * 100 * e3).toFixed(1)}%`, borderRadius: '3px 3px 0 0',
                        background: hover === i ? 'var(--red-700)' : 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))',
                        opacity: hover !== null && hover !== i ? 0.5 : 1, transition: 'background 120ms,opacity 140ms',
                      }} />
                    </div>
                  );
                })}
              </div>
              {view.prev.length > 0 && <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', clipPath: wipe(lp2) }}>
                <path
                  d={'M' + view.prev.map((v, i) => `${(((i + 0.5) / view.N) * 100).toFixed(2)} ${(100 - (v / view.top) * 100).toFixed(2)}`).join(' L')}
                  fill="none" stroke="var(--ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
                />
              </svg>}
              {view.marks.map((m, k) => (
                <div key={k} style={{ position: 'absolute', top: 0, bottom: 0, left: m.left, width: 0, borderLeft: '1.5px dashed var(--sand-400)', pointerEvents: 'none', opacity: markO }}>
                  <span title={m.title} style={{ position: 'absolute', top: -5, left: -6, width: 10, height: 10, borderRadius: 99, background: 'var(--ink)', boxShadow: '0 0 0 3px #fff', pointerEvents: 'auto' }} />
                </div>
              ))}
              {tip && (
                <div style={{ position: 'absolute', top: 6, left: tip.left, transform: tip.tx, pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap', zIndex: 3 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tip.date}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{tip.value}</span>
                  {tip.prev && <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tip.prev}</span>}
                  {tip.send && <span style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: '#FF948D' }}>● {tip.send}</span>}
                </div>
              )}
            </div>
            <div style={{ marginLeft: 60, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--sand-500)' }}>
              {xlabels.map((x, i) => <span key={i}>{x}</span>)}
            </div>
          </div>
          {insight && <Insight>{insight}</Insight>}
        </>
      ) : (
        <div style={{ height: 280, borderRadius: 16, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', color: 'var(--sand-600)', fontSize: 15, lineHeight: 1.5 }}>
          {data ? t(connected ? 'yc.home.sales.emptyConnected' : 'yc.home.sales.empty') : ''}
        </div>
      )}
    </Hv>
  );
}
