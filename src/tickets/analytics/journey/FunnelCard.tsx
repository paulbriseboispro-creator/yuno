/**
 * Section 1 du Parcours — « Où s'arrêtent-ils ? » : l'entonnoir Reçu →
 * Ouvert → Clic → Achat → Retour (un ruban qui se découvre, une colonne
 * cliquable par étape, une pastille de perte entre deux), puis le panneau de
 * l'étape choisie : combien s'arrêtent, quoi leur dire, sur quel message et
 * qui ils sont. Chaque ligne du panneau filtre la page.
 */
import { useEffect, useRef, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING, reveal } from '@/crm/ui/motion';
import type { useTixT } from '@/tickets/analytics/i18n';
import type { Lifecycle } from '@/crm/data/clients';
import type { JrFilters, Journey } from '@/tickets/analytics/data';
import { Note } from './jrUi';
import { JR_IC, STEP_IC, biggestLoss, clamp01 } from './jrLib';

type T = ReturnType<typeof useTixT>;

const MSG_COLORS = ['var(--ya-ink)', 'var(--ya-red-500)', 'var(--ya-tangerine-500)', 'var(--ya-red-200)', 'var(--ya-sand-300)'];
const SEG_ORDER: Lifecycle[] = ['nou', 'occ', 'hab', 'end', 'none'];

export interface RelaunchAsk { k: number; reach: number; emails: string[] | null }

/** Le ruban de l'entonnoir (viewBox 500 × 200), épaisseur en racine. */
function flowPath(S: number[]): string {
  const n0 = Math.max(1, S[0]);
  const N = 5; const W = 100; const H = 200; const maxH = 172; const minH = 54;
  const hs = S.map((v) => minH + (maxH - minH) * Math.sqrt(Math.max(0, v) / n0));
  const tp = hs.map((h) => +((H - h) / 2).toFixed(1));
  const bt = hs.map((h) => +((H + h) / 2).toFixed(1));
  let top = '';
  for (let i = 0; i < N; i++) {
    const a = i * W + 0.72 * W;
    top += `${i ? ' L' : ''}${i ? i * W + 0.28 * W : 0} ${tp[i]} L${i === N - 1 ? N * W : a} ${tp[i]}`;
    if (i < N - 1) { const m = (i + 1) * W; const e = (i + 1) * W + 0.28 * W; top += ` C${m} ${tp[i]} ${m} ${tp[i + 1]} ${e} ${tp[i + 1]}`; }
  }
  let back = '';
  for (let i = N - 1; i >= 0; i--) {
    const xe = i === N - 1 ? N * W : i * W + 0.72 * W; const xs = i ? i * W + 0.28 * W : 0;
    back += ` L${xe} ${bt[i]} L${xs} ${bt[i]}`;
    if (i > 0) { const m = i * W; const e = (i - 1) * W + 0.72 * W; back += ` C${m} ${bt[i]} ${m} ${bt[i - 1]} ${e} ${bt[i - 1]}`; }
  }
  return `M${top}${back} Z`;
}

export function FunnelCard({
  d, f, T, g, cc, intro, thin, sel, onSel, swap, setF, scope, canWrite, onRelaunch,
}: {
  d: Journey; f: JrFilters; T: T; g: number; cc: number; intro: boolean; thin: boolean;
  sel: number | null; onSel: (k: number) => void; swap: number;
  setF: (p: Partial<JrFilters>) => void; scope: string; canWrite: boolean;
  onRelaunch: (a: RelaunchAsk) => void;
}) {
  const { t, tp, n } = T;
  const S = d.funnel;
  const steps = [0, 1, 2, 3, 4].map((i) => t(`ya.jr.step.${i}`));
  const loss = [0, 1, 2, 3].map((k) => (S[k] ? 1 - S[k + 1] / S[k] : 0));
  const big = biggestLoss(S);
  const k = sel ?? big;
  const hasInsight = S[0] >= 100;
  const flow = flowPath(S);
  const [msgH, setMsgH] = useState<number | null>(null);
  // Sur un écran étroit l'entonnoir défile de côté : l'étape choisie reste en vue.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth + 4) return;
    const col = el.scrollWidth / 5;
    el.scrollTo({ left: Math.max(0, col * k - (el.clientWidth - col) / 2), behavior: 'smooth' });
  }, [k]);

  const st = d.steps[k];
  const lost = st ? st.lost : Math.max(0, S[k] - S[k + 1]);
  const reach = st?.reach ?? 0;

  // Sur quel message : les 4 campagnes qui portent le plus de perdus, puis le reste.
  const byC = st?.by_campaign ?? [];
  const rest = Math.max(0, lost - byC.reduce((a, x) => a + x.n, 0));
  const msgs = [
    ...byC.map((x, i) => ({ key: x.id, id: x.id as string | null, name: x.name, v: x.n, c: MSG_COLORS[i] })),
    ...(rest > 0 ? [{ key: 'rest', id: null, name: t('ya.jr.pn.msgOther'), v: rest, c: MSG_COLORS[4] }] : []),
  ];
  const msgSum = msgs.reduce((a, x) => a + x.v, 0) || 1;

  // Qui sont-ils : cycles de vie présents.
  const segAll = SEG_ORDER.map((s) => ({ s, v: Number(st?.by_seg?.[s] ?? 0) })).filter((x) => x.v > 0 || ['nou', 'occ', 'hab'].includes(x.s));
  const segSum = segAll.reduce((a, x) => a + x.v, 0) || 1;

  const tooMany = canWrite && reach > 2000 && !st?.emails;
  const canAct = canWrite && reach > 0 && (!!st?.emails || k < 3);
  const anim = `${swap % 2 ? 'ya-swap-a' : 'ya-swap-b'} 420ms ${EASE}`;

  const coverage = d.cover && d.cover.buyers > 0
    ? t('ya.jr.cover', { p: T.pct((d.cover.attributed / d.cover.buyers) * 100), a: n(d.cover.attributed), b: n(d.cover.buyers) })
    : t('ya.jr.coverRule');

  return (
    <section style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)', minWidth: 0, ...reveal(intro, 640) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px 20px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('ya.jr.s1.title')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--ya-sand-500)', marginTop: 2 }}>{tp('ya.jr.s1.sub', S[0], { n: n(S[0]), scope })}</div>
        </div>
        <span style={{ fontSize: 13, color: 'var(--ya-sand-500)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon d={JR_IC.click} size={15} stroke={2} />{t('ya.jr.s1.click')}
        </span>
      </div>

      {hasInsight && !thin && (
        <Note>{t('ya.jr.s1.insight', { a: steps[big], b: steps[big + 1], p: T.pct(Math.round(loss[big] * 100)) })}</Note>
      )}
      {thin && <Note tone="amber" size={14.5}>{t('ya.jr.s1.thin')}</Note>}
      {d.campaigns.some((c) => c.channel === 'push') && <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.jr.pushNote')}</span>}

      <div ref={scroller} className="ya-noscroll" style={{ overflowX: 'auto', margin: '0 -8px', padding: '0 8px' }}>
        <div style={{ position: 'relative', minWidth: 680 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', height: 78 }}>
            {steps.map((s, i) => {
              const on = i === k;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center', padding: '0 6px' }}>
                  <span style={{ width: 38, height: 38, borderRadius: 99, display: 'grid', placeItems: 'center', background: on ? 'var(--ya-ink)' : 'var(--ya-sand-100)', color: on ? 'var(--ya-on-ink)' : 'var(--ya-ink)', transition: 'background 200ms,color 200ms' }}>
                    <Icon d={STEP_IC[i]} size={18} stroke={2} />
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.1 }}>{s}</span>
                </div>
              );
            })}
          </div>
          <div style={{ position: 'relative', height: 220 }}>
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(-10% ${((1 - clamp01(g * 1.1)) * 100).toFixed(1)}% -10% 0)` }}>
              <svg viewBox="0 0 500 200" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} role="img" aria-label={t('ya.jr.s1.svg')}>
                <defs>
                  <linearGradient id="ya-jr-fg" x1="0" x2="1"><stop offset="0" stopColor="#E8192C" /><stop offset=".6" stopColor="#F2392A" /><stop offset="1" stopColor="#FF6B35" /></linearGradient>
                  <linearGradient id="ya-jr-fs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".2" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient>
                </defs>
                <path d={flow} fill="url(#ya-jr-fg)" />
                <path d={flow} fill="url(#ya-jr-fs)" />
                <rect x="428" y="0" width="72" height="200" style={{ fill: 'var(--ya-card)' }} fillOpacity=".5" />
              </svg>
            </div>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', pointerEvents: 'none' }}>
              {steps.map((_, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', textAlign: 'center', opacity: clamp01(g * 2.2 - 0.5 - i * 0.18) }}>
                  <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>
                    {i ? T.pct(Math.round((S[i] / (S[i - 1] || 1)) * 100)) : T.pct(100)}
                  </b>
                  <span style={{ fontSize: 12, marginTop: 4, opacity: 0.92 }}>{t(`ya.jr.step.${i}.ctx`)}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', paddingTop: 12 }}>
            {steps.map((_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 2, padding: '0 6px 10px' }}>
                <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 32, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{n(S[i] * cc)}</b>
                <span style={{ fontSize: 13, lineHeight: '17px', color: 'var(--ya-sand-600)', textWrap: 'balance' }}>{t(`ya.jr.step.${i}.l`)}</span>
              </div>
            ))}
          </div>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
            {steps.map((s, i) => {
              const on = i === k;
              return (
                <Hv
                  key={i}
                  as="button"
                  type="button"
                  onClick={() => onSel(i === 4 ? 3 : i)}
                  aria-pressed={on}
                  aria-label={t('ya.jr.s1.aria', { s })}
                  style={{ border: `1.5px solid ${on ? 'var(--ya-red-200)' : 'transparent'}`, borderRadius: 20, background: on ? 'rgba(232,25,44,.045)' : 'transparent', cursor: 'pointer', padding: 0, transition: 'background 180ms,border-color 180ms' }}
                  hover={{ background: on ? 'rgba(232,25,44,.06)' : 'rgb(var(--ink) / .03)' }}
                />
              );
            })}
          </div>
          {[0, 1, 2, 3].map((kk) => {
            const on = kk === k;
            const isBig = kk === big && hasInsight && !thin;
            return (
              <Hv
                key={kk}
                as="button"
                type="button"
                onClick={() => onSel(kk)}
                title={kk === 3 ? t('ya.jr.s1.lossBack') : t('ya.jr.s1.lossT', { s: steps[kk] })}
                style={{
                  position: 'absolute', left: `${(kk + 1) * 20}%`, top: 188, transform: 'translate(-50%,-50%)', zIndex: 2, height: 28, padding: '0 11px', borderRadius: 99,
                  border: `1px solid ${on ? 'var(--ya-ink)' : isBig ? 'var(--ya-red-500)' : 'var(--ya-sand-200)'}`, background: on ? 'var(--ya-ink)' : isBig ? 'var(--ya-red-500)' : 'var(--ya-card)',
                  color: on ? 'var(--ya-on-ink)' : isBig ? '#fff' : 'var(--ya-ink)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: 'pointer',
                  boxShadow: 'var(--ya-shadow-xs)', opacity: clamp01(g * 2.4 - 0.8 - kk * 0.15), animation: isBig && !on ? 'ya-pulse-red 1.8s ease-out infinite' : 'none',
                  transition: `background 160ms,color 160ms,transform 200ms ${SPRING}`,
                }}
                hover={{ transform: 'translate(-50%,-50%) scale(1.08)' }}
              >
                −{T.pct(Math.round(loss[kk] * 100))}
              </Hv>
            );
          })}
        </div>
      </div>

      {/* Qui s'arrête ici */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 32px', padding: 24, borderRadius: 22, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', animation: anim }}>
        <div style={{ flex: '1.1 1 270px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>
            {k === 3 ? t('ya.jr.pn.afterBack') : t('ya.jr.pn.after', { s: steps[k] })}
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 12px' }}>
            <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{n(lost * cc)}</span>
            <span style={{ fontSize: 15, color: 'var(--ya-sand-600)' }}>{tp(k === 3 ? 'ya.jr.pn.lostBack' : 'ya.jr.pn.lost', lost)}</span>
          </div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--ya-sand-700)', textWrap: 'pretty' }}>
            {t(`ya.jr.pn.fact.${k}`)}{thin ? '' : ` ${t(`ya.jr.pn.do.${k}`)}`}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', marginTop: 'auto', paddingTop: 4 }}>
            {canAct && (
              <Hv
                as="button"
                type="button"
                onClick={() => onRelaunch({ k, reach, emails: st?.emails ?? null })}
                style={{ height: 44, padding: '0 5px 0 18px', borderRadius: 99, border: 0, background: 'var(--ya-gradient-brand)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--ya-shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
                hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
                active={{ transform: 'scale(.97)' }}
              >
                {t(`ya.jr.pn.cta.${k}`)}
                <span style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--ya-card)', color: 'var(--ya-red-500)', display: 'grid', placeItems: 'center' }}><Icon d={JR_IC.arrow} size={15} stroke={2.4} /></span>
              </Hv>
            )}
            <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>
              {tooMany ? t('ya.jr.pn.tooMany') : reach > 0 ? tp('ya.jr.pn.reach', reach, { n: n(reach) }) : t('ya.jr.pn.noReach')}
            </span>
          </div>
        </div>

        <div style={{ flex: '1 1 290px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('ya.jr.pn.msgs')}</span>
          <div style={{ display: 'flex', height: 14, gap: 2, borderRadius: 99, overflow: 'hidden', background: msgs.length ? undefined : 'var(--ya-sand-200)' }}>
            {msgs.map((x, i) => (
              <div key={x.key} style={{ width: `${((x.v / msgSum) * 100 * clamp01(g * 1.4)).toFixed(1)}%`, background: x.c, opacity: msgH !== null && msgH !== i ? 0.35 : 1, transition: `opacity 160ms,width 600ms ${EASE}` }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {msgs.map((x, i) => {
              const on = !!x.id && f.campaign === x.id;
              const row = (
                <>
                  <i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: x.c, boxShadow: 'inset 0 0 0 1px rgb(var(--ink) / .1)' }} />
                  <span style={{ flex: 1, minWidth: 0, fontWeight: on ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{n(x.v)}</b>
                  <span style={{ width: 44, textAlign: 'right', color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{T.pct(Math.round((x.v / msgSum) * 100))}</span>
                </>
              );
              const base = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', margin: '0 -10px', border: 0, borderRadius: 12, background: msgH === i ? 'var(--ya-sand-100)' : 'transparent', textAlign: 'left' as const, fontSize: 14.5, color: 'var(--ya-ink)', transition: 'background 140ms' };
              return x.id ? (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setF({ campaign: on ? null : x.id })}
                  onMouseEnter={() => setMsgH(i)}
                  onMouseLeave={() => setMsgH(null)}
                  title={t('ya.jr.pn.msgPick')}
                  style={{ ...base, cursor: 'pointer' }}
                >
                  {row}
                </button>
              ) : (
                <div key={x.key} onMouseEnter={() => setMsgH(i)} onMouseLeave={() => setMsgH(null)} style={base}>{row}</div>
              );
            })}
          </div>
        </div>

        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('ya.jr.pn.segs')}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {segAll.map((x) => {
              const on = f.seg === x.s;
              return (
                <button
                  key={x.s}
                  type="button"
                  onClick={() => setF({ seg: on ? 'all' : x.s })}
                  title={t('ya.jr.pn.segPick')}
                  style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ya-ink)' }}
                >
                  <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 14.5, width: '100%' }}>
                    <span style={{ fontWeight: on ? 600 : 500 }}>{t(`ya.cli.seg.${x.s}`)}</span>
                    <span style={{ display: 'flex', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                      <b>{n(x.v)}</b>
                      <span style={{ width: 40, textAlign: 'right', color: 'var(--ya-sand-500)' }}>{T.pct(Math.round((x.v / segSum) * 100))}</span>
                    </span>
                  </span>
                  <span style={{ height: 8, borderRadius: 99, background: 'var(--ya-sand-200)', overflow: 'hidden', width: '100%' }}>
                    <span style={{ display: 'block', height: '100%', width: `${((x.v / segSum) * 100 * clamp01(g * 1.4)).toFixed(1)}%`, borderRadius: 99, background: on ? 'var(--ya-red-500)' : 'var(--ya-ink)', transition: `width 600ms ${EASE}` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)', textWrap: 'pretty' }}>{coverage}</p>
    </section>
  );
}
