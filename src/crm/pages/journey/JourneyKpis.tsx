/**
 * Les quatre chiffres du Parcours : personnes touchées (étincelle), acheteurs
 * (barres), message → achat (anneau, écart en points), délai médian du
 * premier clic à l'achat (barre empilée par délai). Comparés à la période
 * d'avant quand elle existe.
 */
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { reveal } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { JrFilters, Journey } from '@/crm/data/journey';
import { sparkPaths } from '@/crm/pages/analytics/anaUi';
import { clamp01, durShort, hasPrevious, pc } from './jrLib';

type T = ReturnType<typeof useCrmT>;

const G = 'var(--green-700)';
const R = 'var(--red-600)';
const MUTED = 'var(--sand-500)';
const STACK = ['var(--red-500)', 'var(--tangerine-500)', 'var(--red-200)', 'var(--sand-300)'];
const DELAYS = [400, 490, 580, 670];

export function JourneyKpis({ d, f, T, cc, intro }: { d: Journey; f: JrFilters; T: T; cc: number; intro: boolean }) {
  const { t, n } = T;
  const S = d.funnel;
  const prev = hasPrevious(d, f) ? d.prev : null;
  const vs = t(`yc.ana.per.vs.${f.period}`);
  const noCmp = !f.cmp || f.campaign ? '' : d.days > 90 ? t('yc.jr.k.noPrev') : '';
  const dPct = (a: number, b: number | undefined): [string, string] => {
    if (!prev || !b) return [noCmp, MUTED];
    const r = a / b - 1;
    return [`${r >= 0 ? '▲' : '▼'} ${T.pct(Math.abs(r) * 100)} ${vs}`, r >= 0 ? G : R];
  };

  // 1 · Personnes touchées
  const [d0, c0] = dPct(S[0], prev?.[0]);
  const spark = d.spark && d.spark.some((x) => x > 0) ? sparkPaths(d.spark) : null;

  // 2 · Acheteurs
  const [d3, c3] = dPct(S[3], prev?.[3]);
  const bars = d.bars && d.bars.some((x) => x > 0) ? d.bars : null;
  const bMax = bars ? Math.max(1, ...bars) : 1;

  // 3 · Message → achat
  const conv = S[0] ? S[3] / S[0] : 0;
  const pConv = prev && prev[0] ? prev[3] / prev[0] : null;
  const dPts = pConv !== null ? (conv - pConv) * 100 : null;
  const convDelta = dPts !== null ? `${dPts >= 0 ? '▲' : '▼'} ${t('yc.jr.pt', { n: T.n1(Math.abs(dPts)) })} ${vs}` : noCmp;

  // 4 · Délai médian
  const dn = d.delays.n || 0;
  const share = d.delays.b.map((x) => (dn ? x / dn : 0));
  const med = d.delays.median_h;
  const pMed = prev ? d.delays.prev_median_h : null;
  const medDelta = med !== null && pMed !== null && pMed !== undefined
    ? `${med <= pMed ? '▼' : '▲'} ${durShort(T, Math.abs(med - pMed))} ${vs}`
    : noCmp;

  const wipe = (x: number) => `inset(0 ${((1 - clamp01(x)) * 100).toFixed(1)}% 0 0)`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
      <Kpi i={0} intro={intro} label={t('yc.jr.k.reach')} value={n(S[0] * cc)} delta={d0} dc={c0} cap={t('yc.jr.k.reachCap')}>
        {spark && (
          <div style={{ marginTop: 8, clipPath: wipe(cc * 1.2) }}>
            <svg viewBox="0 0 100 34" width="100%" height={48} preserveAspectRatio="none" aria-hidden>
              <path d={spark.area} fill="var(--red-50)" stroke="none" />
              <path d={spark.line} fill="none" stroke="var(--red-500)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </Kpi>
      <Kpi i={1} intro={intro} label={t('yc.jr.k.buyers')} value={n(S[3] * cc)} delta={d3} dc={c3} cap={t('yc.jr.k.buyersCap')}>
        {bars && (
          <div style={{ marginTop: 8, height: 48, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            {bars.map((b, i) => (
              <div key={i} style={{ flex: 1, height: `${Math.max(b > 0 ? 6 : 2, (b / bMax) * 100 * clamp01(cc * 1.5 - i * 0.12))}%`, borderRadius: '4px 4px 0 0', background: i === bars.length - 1 ? 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))' : 'var(--red-100)' }} />
            ))}
          </div>
        )}
      </Kpi>
      <Kpi
        i={2}
        intro={intro}
        label={t('yc.jr.k.conv')}
        value={pc(T, conv * cc)}
        delta={convDelta}
        dc={dPts === null ? MUTED : dPts >= 0 ? G : R}
        cap={t('yc.jr.k.convCap')}
        side={(
          <div style={{ position: 'relative', flex: 'none', width: 56, height: 56, borderRadius: '50%', background: `conic-gradient(var(--red-500) 0 ${(Math.min(1, conv * 6) * 360 * cc).toFixed(1)}deg,var(--red-100) 0)` }}>
            <span style={{ position: 'absolute', inset: 9, borderRadius: '50%', background: '#fff' }} />
          </div>
        )}
      />
      <Kpi
        i={3}
        intro={intro}
        label={t('yc.jr.k.delay')}
        value={med !== null && dn ? durShort(T, med) : '—'}
        delta={medDelta}
        dc={med !== null && pMed !== null && pMed !== undefined ? (med <= pMed ? G : R) : MUTED}
        cap={t('yc.jr.k.delayCap')}
      >
        {dn > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 99, overflow: 'hidden', clipPath: wipe(cc * 1.2) }}>
              {share.map((x, i) => (x > 0 ? <div key={i} style={{ width: `${(x * 100).toFixed(1)}%`, background: STACK[i] }} /> : null))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 12, color: 'var(--sand-500)' }}>
              <span>{t('yc.jr.k.legL', { p: T.pct(share[0] * 100) })}</span>
              <span>{t('yc.jr.k.legR', { p: T.pct(share[3] * 100) })}</span>
            </div>
          </div>
        )}
      </Kpi>
    </div>
  );
}

function Kpi({
  i, intro, label, value, delta, dc, cap, side, children,
}: { i: number; intro: boolean; label: string; value: string; delta: string; dc: string; cap: string; side?: ReactNode; children?: ReactNode }) {
  return (
    <Hv
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)', minWidth: 0, ...reveal(intro, DELAYS[i]) }}
      hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 44, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 0 }}>{value}</span>
        {side}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, minHeight: 18, color: dc }}>{delta}</span>
      {children}
      <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)', marginTop: 4 }}>{cap}</span>
    </Hv>
  );
}
