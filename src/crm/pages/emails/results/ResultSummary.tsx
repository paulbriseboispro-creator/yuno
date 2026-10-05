/**
 * Résultats › Résumé : ce qu'il a fait vendre (classement, trois chiffres
 * comparés à la moyenne du compte), l'e-mail envoyé, l'entonnoir de l'envoi
 * à l'achat, la courbe des réactions sur 72 h et la santé de l'envoi.
 */
import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, clamp01, useProgress, wipe } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useNarrow } from '@/crm/ui/useNarrow';
import { niceTop } from '@/crm/lib/axis';
import { useCrmT } from '@/crm/i18n';
import type { EmailResult } from '@/crm/data/emails';

type Stats = NonNullable<EmailResult['stats']>;

const box = { display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' } as const;
const subCss = { fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, textWrap: 'pretty' } as const;

export function ResultSummary({ r, s, html, onZoom }: { r: EmailResult; s: Stats; html: string | null | undefined; onZoom: () => void }) {
  const { t, tp, n, n1, eur, pct } = useCrmT();
  const g = useProgress(1300, 400, r.id);
  const openRate = s.received ? s.opened / s.received : 0;
  const clickRate = s.received ? s.clicked / s.received : 0;
  const pk = s.n ? (s.purchases / s.n) * 1000 : 0;
  const pt = (a: number, b: number | null) => {
    if (b === null) return { txt: t('yc.em.rs.k.noAvg'), up: true };
    const d = (a - b) * 100;
    return { txt: t(d >= 0 ? 'yc.em.rs.k.vsUp' : 'yc.em.rs.k.vsDown', { v: n1(Math.abs(d)) }), up: d >= 0 };
  };
  const kOpen = pt(openRate, r.avg.open_rate);
  const kClick = pt(clickRate, r.avg.click_rate);
  const kPk = r.avg.per_k === null ? { txt: t('yc.em.rs.k.noAvg'), up: true } : { txt: t(pk >= r.avg.per_k ? 'yc.em.rs.k.aboveAvg' : 'yc.em.rs.k.belowAvg', { v: n1(r.avg.per_k) }), up: pk >= r.avg.per_k };
  const good = r.rank !== null && r.rank <= Math.ceil(r.rank_of / 2);
  const verdict = r.rank_of <= 1 || r.rank === null ? t('yc.em.rs.rankFirst') : t(good ? 'yc.em.rs.rankGood' : 'yc.em.rs.rankLow', { r: r.rank, of: r.rank_of });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ ...box, flex: '1.5 1 520px', minWidth: 0, gap: 20, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
          <div><h2 style={h2}>{t('yc.em.rs.sell.t')}</h2><div style={{ ...subCss, maxWidth: 520 }}>{t('yc.em.rs.sell.s')}</div></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,104px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(Math.round(s.purchases * g))}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{s.revenue === null ? tp('yc.em.rs.buysN', s.purchases) : tp('yc.em.rs.buys', s.purchases, { rev: eur(s.revenue) })}</span>
              <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.em.rs.clickLine', { c: n(s.clicked), t: n(s.ticketing) })}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 16, background: good || r.rank_of <= 1 ? 'var(--green-50)' : 'var(--amber-50)' }}>
            <YunitFace mood={good || r.rank_of <= 1 ? 'ravi' : 'content'} size={40} />
            <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{verdict}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
            {[
              { l: t('yc.em.rs.k.open'), v: pct(openRate * 100), d: kOpen },
              { l: t('yc.em.rs.k.click'), v: pct(clickRate * 100, 1), d: kClick },
              { l: t('yc.em.rs.k.perk'), v: n1(pk), d: kPk },
            ].map((k) => (
              <div key={k.l} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px', borderRadius: 16, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{k.l}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>{k.v}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: k.d.up ? 'var(--green-700)' : 'var(--red-600)' }}>{k.d.txt}</span>
              </div>
            ))}
          </div>
        </section>
        <section style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 22, borderRadius: 28, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <div style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.em.rs.sent')}</span>
            {html && <Hv as="button" type="button" onClick={onZoom} style={{ border: 0, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--red-600)' }}>{t('yc.em.rs.zoom')}<Icon name="maximize" size={15} stroke={2.2} /></Hv>}
          </div>
          {html ? (
            <Hv as="button" type="button" onClick={onZoom} aria-label={t('yc.em.rs.zoomLabel')} style={{ position: 'relative', width: 300, maxWidth: '100%', height: 420, padding: 0, border: 0, borderRadius: 18, overflow: 'hidden', background: '#fff', boxShadow: '0 0 0 1px var(--sand-200),var(--shadow-md)', cursor: 'zoom-in', transition: `translate 240ms ${EASE}` }} hover={{ translate: '0 -4px' }}>
              <iframe title={t('yc.em.rs.sent')} srcDoc={html} tabIndex={-1} sandbox="" style={{ position: 'absolute', top: 0, left: 0, width: 600, height: 840, border: 0, transform: 'scale(.5)', transformOrigin: 'top left', pointerEvents: 'none', background: '#fff' }} />
            </Hv>
          ) : (
            <div style={{ width: 300, maxWidth: '100%', height: 420, borderRadius: 18, display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box', textAlign: 'center', background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: '0 0 0 1px var(--sand-200)' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <b style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '-.02em', color: 'var(--sand-700)' }}>{r.subject}</b>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.em.rs.noContent')}</span>
              </span>
            </div>
          )}
        </section>
      </div>
      <Funnel r={r} s={s} g={g} />
      <Timeline r={r} g={g} />
      <Health s={s} />
    </div>
  );
}

function Funnel({ r, s, g }: { r: EmailResult; s: Stats; g: number }) {
  const { t, n, pct, n1 } = useCrmT();
  const narrow = useNarrow(640);
  const [hov, setHov] = useState<number | null>(null);
  const openRate = s.received ? s.opened / s.received : 0;
  const clickRate = s.received ? s.clicked / s.received : 0;
  const cmp = (a: number, b: number | null) => {
    if (b === null) return null;
    const d = (a - b) * 100;
    return { txt: t('yc.em.rs.f.vs', { d: `${d >= 0 ? '▲ +' : '▼ −'}${n1(Math.abs(d))}` }), up: d >= 0 };
  };
  const steps = [
    { l: t('yc.em.rs.f.sent'), v: s.n, d: t('yc.em.rs.f.sentD'), c: null },
    { l: t('yc.em.rs.f.received'), v: s.received, d: t('yc.em.rs.f.receivedD', { n: n(s.bounced) }), c: null },
    { l: t('yc.em.rs.f.opened'), v: s.opened, d: t('yc.em.rs.f.openedD'), c: cmp(openRate, r.avg.open_rate) },
    { l: t('yc.em.rs.f.clicked'), v: s.clicked, d: t('yc.em.rs.f.clickedD'), c: cmp(clickRate, r.avg.click_rate) },
    { l: t('yc.em.rs.f.ticketing'), v: s.ticketing, d: t('yc.em.rs.f.ticketingD'), c: null },
    // L'entonnoir compte des PERSONNES : un acheteur de trois billets compte une fois.
    { l: t('yc.em.rs.f.bought'), v: s.buyers ?? s.purchases, d: t('yc.em.rs.f.boughtD'), c: null },
  ];
  return (
    <section style={{ ...box, gap: 18 }}>
      <div><h2 style={h2}>{t('yc.em.rs.f.t')}</h2><div style={subCss}>{t('yc.em.rs.f.s')}</div></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((st, i) => {
          const prev = i ? steps[i - 1].v : 0;
          const w = Math.max(3, Math.sqrt(s.n ? st.v / s.n : 0) * 100 * clamp01(g * 1.5 - i * 0.12));
          const conv = i === 0 ? t('yc.em.rs.f.start') : t('yc.em.rs.f.conv', { p: pct(prev ? (st.v / prev) * 100 : 0, prev && st.v / prev < 0.1 ? 1 : 0) });
          const on = hov === i;
          return (
            <div key={st.l} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(120px,190px) 1fr', alignItems: 'center', gap: narrow ? '6px 0' : '8px 20px', padding: '10px 12px', margin: '0 -12px', borderRadius: 16, background: on ? 'var(--sand-50)' : 'transparent', opacity: hov !== null && !on ? 0.5 : 1, transition: 'background 160ms,opacity 160ms' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{st.l}{narrow && <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--sand-500)' }}> · {conv}</span>}</span>
                {!narrow && <span style={{ fontSize: 12.5, lineHeight: '16px', color: 'var(--sand-500)' }}>{conv}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ flex: '0 1 auto', height: 30, width: `${w}%`, minWidth: 8, borderRadius: 99, background: i === steps.length - 1 ? 'var(--gradient-brand)' : i === 0 ? 'var(--sand-200)' : `color-mix(in srgb,var(--red-500) ${24 + i * 13}%,#fff)` }} />
                <span style={{ flex: 'none', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{n(st.v)}</span>
                {st.c && <span style={{ flex: 'none', height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', whiteSpace: 'nowrap', alignItems: 'center', fontSize: 12.5, fontWeight: 600, background: st.c.up ? 'var(--green-50)' : 'var(--red-50)', color: st.c.up ? 'var(--green-700)' : 'var(--red-700)' }}>{st.c.txt}</span>}
              </div>
              <div style={{ gridColumn: narrow ? 1 : 2, fontSize: 13, lineHeight: '17px', color: 'var(--sand-600)', maxHeight: on ? 40 : 0, opacity: on ? 1 : 0, overflow: 'hidden', transition: 'max-height 200ms,opacity 200ms' }}>{st.d}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}


function Timeline({ r, g }: { r: EmailResult; g: number }) {
  const { t, tp, n, pct, time, dShort, dWeek } = useCrmT();
  const narrow = useNarrow(640);
  const [metric, setMetric] = useState<'opens' | 'clicks'>('opens');
  const [hov, setHov] = useState<number | null>(null);
  const pts = r.timeline.length ? r.timeline : [{ h: 0, opens: 0, clicks: 0 }];
  const vals = pts.map((p) => p[metric]);
  const tot = vals[vals.length - 1] || 0;
  const top = niceTop(tot, { headroom: 1.05, empty: 10 });
  const sent = new Date(r.sent_at ?? Date.now());
  const px = (h: number) => (h / 72) * 100;
  const py = (v: number) => 100 - (v / top) * 100;
  const line = `M${pts.map((p, i) => `${px(p.h).toFixed(2)} ${py(vals[i]).toFixed(2)}`).join(' L')}`;
  const area = `${line} L100 100 L0 100 Z`;
  const at = (h: number) => vals[pts.findIndex((p) => p.h >= h)] ?? tot;
  const insight = tot > 0 ? t(metric === 'opens' ? 'yc.em.rs.t.insOpens' : 'yc.em.rs.t.insClicks', { a: pct((at(3) / tot) * 100), b: pct((at(24) / tot) * 100) }) : t('yc.em.rs.t.none');
  const move = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = Math.max(0, Math.min(72, ((e.clientX - rect.left) / rect.width) * 72));
    const i = pts.reduce((best, p, k) => (Math.abs(p.h - h) < Math.abs(pts[best].h - h) ? k : best), 0);
    if (hov !== i) setHov(i);
  };
  const tip = hov !== null ? pts[hov] : null;
  return (
    <section style={{ ...box, gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div><h2 style={h2}>{t('yc.em.rs.t.t')}</h2><div style={subCss}>{t('yc.em.rs.t.s')}</div></div>
        <div role="group" aria-label={t('yc.em.rs.t.metric')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
          {(['opens', 'clicks'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMetric(m); setHov(null); }} aria-pressed={metric === m} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 99, background: metric === m ? '#fff' : 'transparent', boxShadow: metric === m ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: metric === m ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer' }}>{t(`yc.em.rs.t.${m}`)}</button>
          ))}
        </div>
      </div>
      <div onMouseMove={move} onMouseLeave={() => setHov(null)} style={{ position: 'relative', height: 220, marginLeft: 56, cursor: 'crosshair' }}>
        {[0, 0.5, 1].map((k) => (
          <div key={k} style={{ position: 'absolute', left: -56, right: 0, bottom: `${k * 100}%`, borderTop: '1px solid var(--sand-100)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: 0, top: -9, width: 48, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4, boxSizing: 'border-box' }}>{k === 0 ? '0' : n(top * k)}</span>
          </div>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', clipPath: wipe(clamp01(g * 1.15)) }}>
          <path d={area} fill="var(--red-50)" />
          <path d={line} fill="none" stroke="var(--red-500)" strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {tip && (() => {
          const v = vals[hov!];
          const when = new Date(sent.getTime() + tip.h * 36e5);
          return (
            <>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${px(tip.h)}%`, borderLeft: '1px solid var(--sand-300)', pointerEvents: 'none' }} />
              <i style={{ position: 'absolute', left: `${px(tip.h)}%`, top: `${py(v)}%`, width: 12, height: 12, margin: '-6px 0 0 -6px', borderRadius: 99, background: 'var(--red-500)', boxShadow: '0 0 0 4px rgba(227,20,27,.18)', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: 4, left: `${px(tip.h)}%`, transform: tip.h < 40 ? 'translateX(16px)' : 'translateX(calc(-100% - 16px))', pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap', zIndex: 3 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{dWeek(when)} · {time(when)}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{tp(metric === 'opens' ? 'yc.em.rs.t.vOpens' : 'yc.em.rs.t.vClicks', v, { n: n(v) })}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{tip.h === 0 ? t('yc.em.rs.t.atSend') : t('yc.em.rs.t.after', { h: tip.h, p: pct(tot ? (v / tot) * 100 : 0) })}</span>
              </div>
            </>
          );
        })()}
      </div>
      <div style={{ marginLeft: 56, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--sand-500)' }}>
        {[0, 24, 48, 72].map((h) => {
          const d = new Date(sent.getTime() + h * 36e5);
          if (narrow) return <span key={h}>{h === 0 ? time(d) : `+${h} h`}</span>;
          return <span key={h}>{h === 0 ? t('yc.em.rs.t.send', { time: time(d) }) : t('yc.em.rs.t.plus', { h, date: dShort(d) })}</span>;
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
        <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{insight}</span>
      </div>
    </section>
  );
}

function Health({ s }: { s: Stats }) {
  const { t, n, pct } = useCrmT();
  const ok = (v: number, lim: number) => v <= lim;
  const items = [
    { l: t('yc.em.rs.h.received'), v: s.received, p: pct(s.n ? (s.received / s.n) * 100 : 0, 1), d: t('yc.em.rs.h.receivedD'), good: true },
    { l: t('yc.em.rs.h.bounced'), v: s.bounced, p: pct(s.n ? (s.bounced / s.n) * 100 : 0, 1), d: t('yc.em.rs.h.bouncedD'), good: ok(s.n ? s.bounced / s.n : 0, 0.03) },
    { l: t('yc.em.rs.h.unsub'), v: s.unsub, p: pct(s.received ? (s.unsub / s.received) * 100 : 0, 2), d: t('yc.em.rs.h.unsubD'), good: ok(s.received ? s.unsub / s.received : 0, 0.005) },
    { l: t('yc.em.rs.h.spam'), v: s.complained, p: pct(s.received ? (s.complained / s.received) * 100 : 0, 2), d: t('yc.em.rs.h.spamD'), good: ok(s.received ? s.complained / s.received : 0, 0.001) },
  ];
  return (
    <section style={{ ...box, gap: 16 }}>
      <div><h2 style={h2}>{t('yc.em.rs.h.t')}</h2><div style={subCss}>{t('yc.em.rs.h.s')}</div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12 }}>
        {items.map((h) => (
          <div key={h.l} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 18px', borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{h.l}</span>
              <span style={{ height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: h.good ? 'var(--green-50)' : 'var(--amber-50)', color: h.good ? 'var(--green-700)' : 'var(--amber-700)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t(h.good ? 'yc.em.rs.h.ok' : 'yc.em.rs.h.watch')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(h.v)}</span>
              <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{h.p}</span>
            </div>
            <span style={{ fontSize: 12.5, lineHeight: '17px', color: 'var(--sand-500)' }}>{h.d}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
