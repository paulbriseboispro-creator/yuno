/**
 * « Combien ont-elles fait vendre ? » : le grand chiffre de la période (ventes,
 * ou achats pour un rôle sans accès au chiffre d'affaires), une barre par
 * semaine avec son détail au survol, le classement des recettes et la plus
 * rentable ; puis les quatre chiffres (envois, clics, achats, Yunits).
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { EASE } from '@/crm/ui/motion';
import { niceTop, COARSE_STEPS } from '@/crm/lib/axis';
import type { useCrmT } from '@/crm/i18n';
import type { AutoPeriod, Automations } from '@/crm/data/automations';
import { autoState, bestPerPerson, type CrmAutoKind } from '@/crm/lib/automations';
import { deltaPts, deltaText } from './autoFmt';
import { Pills } from './autoUi';

type T = ReturnType<typeof useCrmT>;
const cl01 = (x: number) => Math.max(0, Math.min(1, x));

/** Un pointeur qui survole (souris) ; faux sur un écran tactile. */
const canHover = () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(hover: hover)').matches;

export function AutoSales({
  d, T, money, g, period, onPeriod, onRank,
}: { d: Automations; T: T; money: boolean; g: number; period: AutoPeriod; onPeriod: (p: AutoPeriod) => void; onRank: (k: CrmAutoKind) => void }) {
  const { t, tp, n, eur, dShort } = T;
  const [hover, setHover] = useState<number | null>(null);
  const [rk, setRk] = useState<CrmAutoKind | null>(null);
  const tot = d.totals;
  const cur = money ? Number(tot.revenue ?? 0) : tot.purchases;
  const prev = money ? Number(d.prev.revenue ?? 0) : d.prev.purchases;
  const [dText, dFg] = deltaText(T, cur, prev);
  const vals = d.weeks.map((w) => (money ? Number(w.revenue ?? 0) : w.purchases));
  const top = niceTop(Math.max(0, ...vals), { steps: COARSE_STEPS, empty: money ? 100 : 10 });
  const nW = d.weeks.length;
  const fmtV = (v: number) => (money ? eur(v) : n(v));

  const name = (k: CrmAutoKind) => t(`yc.au.r.${k}.name`);
  const rank = d.recipes
    .filter((r) => r.contacted > 0)
    .sort((a, b) => (money ? Number(b.revenue ?? 0) - Number(a.revenue ?? 0) : b.purchases - a.purchases) || b.contacted - a.contacted);
  const rmax = Math.max(1, ...rank.map((r) => (money ? Number(r.revenue ?? 0) : r.purchases)));
  const best = bestPerPerson(d.recipes, money);
  const insight = best
    ? money
      ? t('yc.au.s1.insight', { name: name(best.r.kind), v: T.eur2(best.v) })
      : t('yc.au.s1.insightN', { name: name(best.r.kind), v: T.n1(best.v * 100) })
    : '';

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', animation: `yc-in-blur 800ms ${EASE} 460ms both`, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px 20px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.au.s1.title')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 600, textWrap: 'pretty', lineHeight: 1.45 }}>{t('yc.au.s1.sub', { period: t(`yc.au.per.full.${period}`) })}</div>
        </div>
        <Pills value={period} onChange={onPeriod} label={t('yc.au.per.label')} options={(['30d', '90d'] as const).map((k) => ({ k, l: t(`yc.au.per.${k}`) }))} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{fmtV(cur * g)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: dFg }}>{dText}</span>
          <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>
            {tp('yc.au.purchases', tot.purchases, { n: n(tot.purchases) })} · {tp('yc.au.contacted', tot.contacted ?? 0, { n: n(tot.contacted ?? 0) })} {tp('yc.au.byAutos', tot.recipes ?? 0, { n: n(tot.recipes ?? 0) })}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 13, color: 'var(--sand-600)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <i style={{ width: 10, height: 14, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))', display: 'inline-block' }} />
          {t(money ? 'yc.au.s1.legend' : 'yc.au.s1.legendN')}
        </span>
        <span>{t(canHover() ? 'yc.au.s1.hint' : 'yc.au.s1.hintTouch')}</span>
      </div>
      <div onMouseLeave={() => setHover(null)} style={{ position: 'relative', height: 230, marginLeft: 64 }}>
        {[0, 0.5, 1].map((r) => (
          <div key={r} style={{ position: 'absolute', left: -64, right: 0, bottom: `${r * 100}%`, height: 0, borderTop: '1px solid var(--sand-100)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: 0, top: -9, width: 56, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>{r === 0 ? '0' : fmtV(top * r)}</span>
          </div>
        ))}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: 8 }}>
          {d.weeks.map((w, i) => {
            const lp = cl01(g * 1.6 - (i / Math.max(1, nW)) * 0.6);
            const e3 = 1 - Math.pow(1 - lp, 3);
            const h = `${((vals[i] / top) * 100 * e3).toFixed(1)}%`;
            const curW = i === nW - 1;
            const on = hover === i;
            const pos = i < 2 ? { left: 0 } : i >= nW - 2 ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' };
            return (
              <div
                key={w.start}
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover((x) => (x === i ? null : i))}
                aria-label={t('yc.au.s1.week', { d: dShort(w.start) })}
                style={{ position: 'relative', flex: '1 1 0', maxWidth: 96, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'default' }}
              >
                <div style={{ width: '100%', height: h, minHeight: 3, borderRadius: '6px 6px 0 0', background: on ? 'var(--red-700)' : 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))', opacity: hover !== null && !on ? 0.45 : curW ? 0.7 : 1, transition: 'background 140ms,opacity 140ms' }} />
                {on && (
                  <div style={{ position: 'absolute', bottom: `calc(${h} + 10px)`, ...pos, pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap', zIndex: 3, animation: 'yc-fade 140ms both' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{t('yc.au.s1.week', { d: dShort(w.start) })}{curW ? t('yc.au.s1.current') : ''}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{money ? eur(vals[i]) : tp('yc.au.purchases', w.purchases, { n: n(w.purchases) })}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>
                      {money && `${tp('yc.au.purchases', w.purchases, { n: n(w.purchases) })} · `}{tp('yc.au.contacted', w.contacted, { n: n(w.contacted) })}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ marginLeft: 64, display: 'flex', justifyContent: 'space-around', gap: 8, marginTop: -6 }}>
        {d.weeks.map((w, i) => {
          const dt = new Date(w.start);
          const curW = i === nW - 1;
          return (
            <span key={w.start} style={{ flex: '1 1 0', maxWidth: 96, textAlign: 'center', fontSize: 11.5, lineHeight: '14px', color: curW ? 'var(--ink)' : 'var(--sand-500)', fontWeight: curW ? 600 : 400 }}>
              {nW <= 5 ? dShort(dt) : `${dt.getDate()}/${dt.getMonth() + 1}`}
            </span>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--sand-100)', paddingTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>{t(money ? 'yc.au.s1.rank' : 'yc.au.s1.rankN')}</h3>
          {rank.length > 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.au.s1.rankHint')}</span>}
        </div>
        {rank.length === 0 ? (
          <div style={{ marginTop: 8, padding: '18px 20px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 14.5, color: 'var(--sand-600)' }}>{t('yc.au.s1.none')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rank.map((r, i) => {
              const v = money ? Number(r.revenue ?? 0) : r.purchases;
              const paused = autoState(r) === 'off';
              return (
                <Hv
                  key={r.kind}
                  as="button"
                  type="button"
                  onClick={() => onRank(r.kind)}
                  onMouseEnter={() => setRk(r.kind)}
                  onMouseLeave={() => setRk(null)}
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,230px) 1fr minmax(84px,auto)', alignItems: 'center', gap: '8px 18px', padding: '10px 12px', margin: '0 -12px', border: 0, borderRadius: 14, background: rk === r.kind ? 'var(--sand-50)' : 'transparent', textAlign: 'left', cursor: 'pointer', opacity: rk && rk !== r.kind ? 0.5 : 1, transition: 'background 160ms,opacity 160ms', color: 'var(--ink)' }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(r.kind)}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>
                      {n(r.contacted)} {tp('yc.au.st.people', r.contacted)} · {tp('yc.au.purchases', r.purchases, { n: n(r.purchases) })}{paused ? ` · ${t('yc.au.s1.paused')}` : ''}
                    </span>
                  </span>
                  <span style={{ height: 12, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${((v / rmax) * 100 * cl01(g * 1.5 - i * 0.12)).toFixed(1)}%`, borderRadius: 99, background: i === 0 ? 'var(--gradient-brand)' : `color-mix(in srgb,var(--red-500) ${Math.max(22, 62 - i * 12)}%,#fff)` }} />
                  </span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtV(v)}</span>
                </Hv>
              );
            })}
          </div>
        )}
      </div>
      {insight && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
          <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
          <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{insight}</span>
        </div>
      )}
    </section>
  );
}

export function AutoKpis({ d, T, c, rates }: { d: Automations; T: T; c: number; rates: { email: number; sms: number } }) {
  const { t, n } = T;
  const tot = d.totals;
  const pv = d.prev;
  const cr = tot.sent ? tot.clicked / tot.sent : 0;
  const pcr = pv.sent ? pv.clicked / pv.sent : 0;
  const [dS, cS] = deltaText(T, tot.sent, pv.sent);
  const [dC, cC] = deltaPts(T, cr, pcr, pv.sent > 0);
  const [dB, cB] = deltaText(T, tot.purchases, pv.purchases);
  const [dY] = deltaText(T, tot.sent * rates.email, pv.sent * rates.email);
  const sp = (arr: number[]) => {
    const m = Math.max(1, ...arr);
    return arr.map((v, i) => ({ h: `${((30 + (v / m) * 70) * cl01(c * 1.5 - i * 0.07)).toFixed(0)}%`, bg: i === arr.length - 1 ? 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))' : 'var(--red-100)' }));
  };
  const tiles = [
    { l: t('yc.au.k.sent'), v: n(tot.sent * c), d: dS, dfg: cS, cap: t('yc.au.k.sentCap'), spark: sp(d.weeks.map((w) => w.sent)) },
    { l: t('yc.au.k.clicked'), v: T.pct(cr * 100 * c, 1), d: dC, dfg: cC, cap: t('yc.au.k.clickedCap'), ring: Math.min(1, cr * 3) * 360 * c },
    { l: t('yc.au.k.buys'), v: n(tot.purchases * c), d: dB, dfg: cB, cap: t('yc.au.k.buysCap'), spark: sp(d.weeks.map((w) => w.purchases)) },
    { l: t('yc.au.k.yunits'), v: n(tot.sent * rates.email * c), d: dY, dfg: 'var(--sand-500)', cap: t('yc.au.k.yunitsCap', { e: rates.email, s: rates.sms }), spark: sp(d.weeks.map((w) => w.sent * rates.email)) },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
      {tiles.map((k, i) => (
        <Hv
          key={k.l}
          style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)', minWidth: 0, animation: `yc-in-blur 800ms ${EASE} ${560 + i * 80}ms both`, transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }}
          hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
        >
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{k.l}</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 44, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{k.v}</span>
            {k.ring !== undefined && (
              <div style={{ position: 'relative', flex: 'none', width: 56, height: 56, borderRadius: '50%', background: `conic-gradient(var(--red-500) 0 ${k.ring.toFixed(1)}deg,var(--red-100) 0)` }}>
                <span style={{ position: 'absolute', inset: 9, borderRadius: '50%', background: '#fff' }} />
              </div>
            )}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: k.dfg }}>{k.d}</span>
          {k.spark && (
            <div style={{ marginTop: 6, height: 40, display: 'flex', alignItems: 'flex-end', gap: 4 }}>
              {k.spark.map((s, j) => <div key={j} style={{ flex: 1, height: s.h, borderRadius: '4px 4px 0 0', background: s.bg }} />)}
            </div>
          )}
          <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)', marginTop: 4 }}>{k.cap}</span>
        </Hv>
      ))}
    </div>
  );
}
