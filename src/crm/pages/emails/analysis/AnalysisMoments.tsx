/**
 * Analyse › Meilleurs moments : la carte jour × heure du taux de clic, le
 * meilleur créneau (parmi ceux assez fournis), et l'ouverture selon la
 * longueur de l'objet, avec l'effet du prénom.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Insight } from '@/crm/ui/kit';
import { Rich } from '@/crm/ui/Rich';
import { EASE, clamp01, useProgress } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import type { EmailAnalysis } from '@/crm/data/emails';
import { SLOT_MIN, bestSlot, personalOpen, slotGrid, subjectBuckets, type Campaign } from '@/crm/lib/emailAnalysis';
import { box, h2, subCss } from './analysisUi';

const HOURS = [8, 10, 12, 14, 16, 18, 20, 22];
/** Un chiffre dans une phrase ne se coupe jamais de son unité (« 52 % »). */
const nb = (s: string) => s.replace(/ /g, '\u00a0');

export function AnalysisMoments({ a }: { a: EmailAnalysis }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <Heatmap grid={a.grid} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <BestSlot grid={a.grid} />
        <Subjects subjects={a.subjects} campaigns={a.campaigns} />
      </div>
    </div>
  );
}

function Heatmap({ grid }: { grid: EmailAnalysis['grid'] }) {
  const { t, tp, n, pct } = useCrmT();
  const narrow = useNarrow(640);
  const [hov, setHov] = useState<number | null>(null);
  const cells = useMemo(() => slotGrid(grid), [grid]);
  const { best } = bestSlot(grid);
  const max = Math.max(0.0001, ...cells.map((c) => (c ? c.rate : 0)));
  const hour = (h: number) => t('yc.em.an.m.hour', { h });
  const day = (d: number) => t(`yc.em.an.m.D${d}`);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <section style={{ ...box, gap: 16, boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
      <div><h2 style={h2}>{t('yc.em.an.m.t')}</h2><div style={subCss}>{t('yc.em.an.m.s')}</div></div>
      <div className="yc-thin-scroll" style={{ overflowX: 'auto', margin: '0 -4px', padding: '4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '34px repeat(8,minmax(0,1fr))' : '44px repeat(8,minmax(38px,1fr))', gap: narrow ? 4 : 5, alignItems: 'center' }} onMouseLeave={() => setHov(null)}>
          <span />
          {HOURS.map((h) => <span key={h} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: narrow ? 10.5 : 11.5, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>{narrow ? h : hour(h)}</span>)}
          {Array.from({ length: 7 }, (_, d) => [
            <span key={`l${d}`} style={{ fontSize: narrow ? 12 : 13, fontWeight: 500, color: 'var(--sand-600)' }}>{t(`yc.em.an.m.d${d}`)}</span>,
            ...HOURS.map((h, hi) => {
              const i = d * 8 + hi;
              const c = cells[i];
              const isBest = !!best && best.d === d && best.h === hi;
              const on = hov === i;
              const bg = !c ? 'var(--sand-50)'
                : c.low ? 'repeating-linear-gradient(135deg,var(--sand-50) 0 5px,var(--sand-100) 5px 10px)'
                  : `color-mix(in oklab,#E3141B ${Math.round(8 + (c.rate / max) * 80)}%,#FFF2F1)`;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHov(i)}
                  style={{ position: 'relative', height: narrow ? 34 : 42, borderRadius: narrow ? 8 : 10, background: bg, boxShadow: isBest ? '0 0 0 2.5px var(--ink)' : c?.low ? 'inset 0 0 0 1.5px var(--sand-200)' : !c ? 'inset 0 0 0 1px var(--sand-100)' : 'none', opacity: hov !== null && !on ? 0.55 : 1, transition: 'box-shadow 120ms,opacity 120ms' }}
                >
                  {on && (
                    <div style={{ position: 'absolute', ...(d < 2 ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 8px)' }), left: '50%', transform: `translateX(${hi < 2 ? '-15%' : hi > 5 ? '-85%' : '-50%'})`, pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap', zIndex: 5 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{t('yc.em.an.m.when', { day: cap(day(d)), hour: hour(h) })}</span>
                      {c ? (
                        <>
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.em.an.m.rate', { p: pct(c.rate * 100, 1) })}</span>
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{tp('yc.em.an.m.on', c.n, { n: n(c.n) })}{c.low ? t('yc.em.an.m.unsure') : ''}</span>
                        </>
                      ) : <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.em.an.m.noSend')}</span>}
                    </div>
                  )}
                </div>
              );
            }),
          ])}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', fontSize: 12.5, color: 'var(--sand-500)' }}>
        <span>{t('yc.em.an.m.less')}</span>
        <div style={{ width: 120, height: 10, borderRadius: 99, background: 'linear-gradient(90deg,var(--red-50),var(--red-500))' }} />
        <span>{t('yc.em.an.m.more')}</span>
        <span style={{ marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 14, height: 14, borderRadius: 5, border: '1.5px dashed var(--sand-300)', display: 'inline-block', boxSizing: 'border-box' }} />{t('yc.em.an.m.thin')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 14, height: 14, borderRadius: 5, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', display: 'inline-block' }} />{t('yc.em.an.m.empty')}</span>
      </div>
    </section>
  );
}

function BestSlot({ grid }: { grid: EmailAnalysis['grid'] }) {
  const { t, n, pct } = useCrmT();
  const { best, avg } = bestSlot(grid);
  return (
    <section style={{ flex: '1 1 360px', position: 'relative', overflow: 'hidden', isolation: 'isolate', display: 'flex', flexDirection: 'column', gap: 14, padding: 26, borderRadius: 28, color: 'var(--text-on-night)', background: 'radial-gradient(90% 70% at 100% 110%,rgba(227,20,27,.4),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.em.an.b.kick')}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(34px,4vw,48px)', letterSpacing: '-.04em', lineHeight: 1 }}>
        {best ? t('yc.em.an.b.when', { day: t(`yc.em.an.m.D${best.d}`), hour: t('yc.em.an.m.hour', { h: HOURS[best.h] }) }) : t('yc.em.an.b.none')}
      </span>
      <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-on-night-2)', textWrap: 'pretty' }}>
        {best && avg !== null
          ? t('yc.em.an.b.sub', { p: nb(pct(best.rate * 100, 1)), avg: nb(pct(avg * 100, 1)), n: nb(n(best.n)) })
          : t('yc.em.an.b.noneSub', { n: n(SLOT_MIN) })}
      </span>
      <Hv
        as={Link}
        to={`${CRM_ROUTES.emailTemplates}`}
        style={{ alignSelf: 'flex-start', marginTop: 'auto', height: 44, padding: '0 5px 0 18px', borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        hover={{ background: 'var(--sand-100)', color: 'var(--ink)', textDecoration: 'none' }}
      >
        {t('yc.em.an.b.cta')}
        <span style={{ width: 32, height: 32, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={15} stroke={2.4} /></span>
      </Hv>
    </section>
  );
}

function Subjects({ subjects, campaigns }: { subjects: EmailAnalysis['subjects']; campaigns: Campaign[] }) {
  const { t, pct } = useCrmT();
  const g = useProgress(1100, 300, subjects.length);
  const buckets = subjectBuckets(subjects);
  const filled = buckets.map((b, i) => ({ b, i })).filter((x): x is { b: { rate: number; received: number }; i: number } => !!x.b);
  const top = Math.max(0.0001, ...filled.map((x) => x.b.rate));
  const best = filled.slice().sort((a, b) => b.b.rate - a.b.rate)[0];
  const worst = filled.slice().sort((a, b) => a.b.rate - b.b.rate)[0];
  const perso = personalOpen(campaigns);
  const lines: string[] = [];
  if (best && worst && best.i !== worst.i) {
    lines.push(t('yc.em.an.s.insLen', { best: t(`yc.em.an.s.l${best.i}`), worst: t(`yc.em.an.s.l${worst.i}`), d: Math.round((best.b.rate - worst.b.rate) * 100) }));
  }
  if (perso) lines.push(t('yc.em.an.s.insName', { a: nb(pct(perso.with * 100)), b: nb(pct(perso.without * 100)) }));

  return (
    <section style={{ ...box, flex: '1.4 1 460px', gap: 14, padding: 'clamp(20px,2.4vw,26px)' }}>
      <div><h2 style={h2}>{t('yc.em.an.s.t')}</h2><div style={subCss}>{t('yc.em.an.s.s')}</div></div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 150 }}>
        {buckets.map((b, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%' }}>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: b ? 'var(--ink)' : 'var(--sand-300)' }}>{b ? pct(b.rate * 100) : '—'}</b>
            <div style={{ width: '100%', height: b ? `${(b.rate / top) * 82 * clamp01(g * 1.4 - i * 0.1)}%` : 4, borderRadius: '8px 8px 0 0', background: !b ? 'var(--sand-100)' : best && best.i === i ? 'var(--gradient-brand)' : 'var(--red-100)' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14 }}>
        {buckets.map((_, i) => <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: 12.5, lineHeight: '15px', color: 'var(--sand-500)' }}>{t(`yc.em.an.s.b${i}`)}</span>)}
      </div>
      {lines.length ? <Insight><Rich text={lines.join(' ')} /></Insight> : <div style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.em.an.s.none')}</div>}
    </section>
  );
}
