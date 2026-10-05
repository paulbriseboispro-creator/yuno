/**
 * Section 2 du Parcours — « Que font-ils avant d'acheter ? » (les cinq
 * chemins les plus suivis par les acheteurs, un chemin e-mail isole le canal)
 * et « Combien de temps avant l'achat ? » (du premier clic à l'achat, par
 * tranche de délai, délai médian et e-mails reçus avant).
 */
import { forwardRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from '@/crm/ui/Icon';
import type { useCrmT } from '@/crm/i18n';
import type { JrFilters, JrPathKey, Journey } from '@/crm/data/journey';
import type { SourceKey } from '@/crm/data/analytics';
import { Note, SecHead } from './jrUi';
import { JR_IC, clamp01, durShort } from './jrLib';

type T = ReturnType<typeof useCrmT>;

type NodeTone = 0 | 1 | 2;
const NODE_STYLE: Record<NodeTone, [string, string]> = {
  0: ['var(--ink)', '#fff'],
  1: ['var(--sand-100)', 'var(--sand-700)'],
  2: ['var(--green-50)', 'var(--green-700)'],
};
const SRC_IC: Record<SourceKey, string> = {
  em: JR_IC.mail, sm: JR_IC.sms, dm: JR_IC.send, ys: JR_IC.instagram, yb: JR_IC.instagram, yt: JR_IC.link, yl: JR_IC.link, so: JR_IC.instagram, sg: JR_IC.ticket, au: JR_IC.globe, di: JR_IC.click, of: JR_IC.card,
};

function pathNodes(key: JrPathKey, t: T['t']): { l: string; d: string; tone: NodeTone }[] {
  const buy = { l: t('yc.jr.node.buy'), d: JR_IC.card, tone: 2 as const };
  const mail = { l: t('yc.jr.node.mail'), d: JR_IC.mail, tone: 0 as const };
  const click = { l: t('yc.jr.node.click'), d: JR_IC.click, tone: 1 as const };
  if (key === 'm_click') return [mail, click, buy];
  if (key === 'mm_click') return [mail, { l: t('yc.jr.node.mail2'), d: JR_IC.repeat, tone: 1 }, click, buy];
  if (key === 'm_noclick') return [mail, { l: t('yc.jr.node.noclick'), d: JR_IC.x, tone: 1 }, buy];
  const src = key.slice(4) as SourceKey;
  return [{ l: t(`yc.ana.src.${src}`), d: SRC_IC[src] ?? JR_IC.globe, tone: 0 }, buy];
}

const BAR_BG = ['linear-gradient(180deg,var(--tangerine-500),var(--red-500))', 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))', 'var(--red-100)', 'var(--red-100)'];

export const BeforeBuy = forwardRef<HTMLDivElement, { d: Journey; f: JrFilters; T: T; a2: number; style: CSSProperties; thin: boolean; setF: (p: Partial<JrFilters>) => void }>(
  function BeforeBuy({ d, f, T, a2, style, thin, setF }, ref) {
    const { t, tp, n } = T;
    const [pathH, setPathH] = useState<number | null>(null);
    const [delH, setDelH] = useState<number | null>(null);

    const P = d.paths;
    const tot = P?.total || 0;
    const top = (P?.list ?? []).slice(0, 5);
    const maxP = top.length ? top[0].n : 1;
    const pSum = top.reduce((a, x) => a + x.n, 0);

    const dn = d.delays.n || 0;
    const sh = d.delays.b.map((x) => (dn ? x / dn : 0));
    const maxS = Math.max(0.01, ...sh);
    const w2 = sh[0] + sh[1];
    const card: CSSProperties = { minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16, padding: 24, borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' };

    return (
      <div ref={ref} style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch', ...style }}>
        <section style={{ ...card, flex: '1.5 1 480px' }}>
          <SecHead title={t('yc.jr.s2.title')} sub={t('yc.jr.s2.sub')} />
          {top.length === 0 ? (
            <div style={{ padding: '22px 20px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.jr.s2.none')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {top.map((x, i) => {
                const mail = !x.key.startsWith('src_');
                const nodes = pathNodes(x.key, t);
                const body = (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                      {nodes.map((nd, j) => (
                        <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ height: 30, padding: '0 12px 0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, background: NODE_STYLE[nd.tone][0], color: NODE_STYLE[nd.tone][1], whiteSpace: 'nowrap' }}>
                            <Icon d={nd.d} size={14} stroke={2.2} />{nd.l}
                          </span>
                          {j < nodes.length - 1 && <Icon d={JR_IC.arrow} size={14} stroke={2} color="var(--sand-400)" />}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${((x.n / maxP) * 100 * clamp01(a2 * 1.3 - i * 0.1)).toFixed(1)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} />
                      </div>
                      <b style={{ width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{T.pct(Math.round((x.n / (tot || 1)) * 100))}</b>
                      <span style={{ width: 110, textAlign: 'right', fontSize: 13, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{tp('yc.jr.s2.buyers', x.n, { n: n(x.n) })}</span>
                    </div>
                  </>
                );
                const base: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', margin: '0 -16px', border: 0, borderRadius: 18, background: pathH === i ? 'var(--sand-50)' : 'transparent', textAlign: 'left', color: 'var(--ink)', transition: 'background 160ms' };
                return mail ? (
                  <button
                    key={x.key}
                    type="button"
                    title={t('yc.jr.s2.isolate')}
                    onClick={() => setF({ channel: f.channel === 'email' ? 'all' : 'email' })}
                    onMouseEnter={() => setPathH(i)}
                    onMouseLeave={() => setPathH(null)}
                    style={{ ...base, cursor: 'pointer' }}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={x.key} onMouseEnter={() => setPathH(i)} onMouseLeave={() => setPathH(null)} style={base}>{body}</div>
                );
              })}
            </div>
          )}
          {top.length > 0 && (
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-500)' }}>{t('yc.jr.s2.note', { p: T.pct(Math.round((pSum / (tot || 1)) * 100)) })}</p>
          )}
        </section>

        <section style={{ ...card, flex: '1 1 360px' }}>
          <SecHead title={t('yc.jr.d.title')} sub={t('yc.jr.d.sub')} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 190, paddingTop: 8 }}>
            {sh.map((x, i) => (
              <div
                key={i}
                onMouseEnter={() => setDelH(i)}
                onMouseLeave={() => setDelH(null)}
                onClick={() => setDelH((h) => (h === i ? null : i))}
                style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 8, cursor: 'default' }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: delH === i ? 'var(--red-600)' : 'var(--ink)' }}>{T.pct(Math.round(x * 100))}</span>
                <div style={{ width: '100%', height: `${((x / maxS) * 150 * clamp01(a2 * 1.3 - i * 0.1)).toFixed(0)}px`, minHeight: 4, borderRadius: '10px 10px 4px 4px', background: dn ? BAR_BG[i] : 'var(--sand-100)', opacity: delH !== null && delH !== i ? 0.45 : 1, transition: 'background 160ms,opacity 160ms' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: -4 }}>
            {[0, 1, 2, 3].map((i) => <span key={i} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12.5, lineHeight: '15px', color: 'var(--sand-500)' }}>{t(`yc.jr.d.${i}`)}</span>)}
          </div>
          <div style={{ minHeight: 44, display: 'flex', alignItems: 'center', padding: '10px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 14, lineHeight: 1.4, color: 'var(--sand-700)' }}>
            {!dn ? t('yc.jr.d.none')
              : delH !== null ? tp('yc.jr.d.cap', d.delays.b[delH], { n: n(d.delays.b[delH]), p: T.pct(Math.round(sh[delH] * 100)), w: t(`yc.jr.d.w.${delH}`) })
                : t('yc.jr.d.hover')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', lineHeight: 1.1 }}>{dn && d.delays.median_h !== null ? durShort(T, d.delays.median_h) : '—'}</b>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.jr.d.median')}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', lineHeight: 1.1 }}>{dn && d.delays.touches !== null ? T.n1(Number(d.delays.touches)) : '—'}</b>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.jr.d.touches')}</span>
            </div>
          </div>
          {dn > 0 && !thin && (
            <Note size={14.5}>{w2 >= 0.5 ? t('yc.jr.d.fast', { x: Math.round(w2 * 10) }) : t('yc.jr.d.slow')}</Note>
          )}
        </section>
      </div>
    );
  },
);

