/**
 * Vue « Derniers envois » : chaque message de la période, filtré par canal et
 * par segment visé, avec ses reçus, clics, achats et ventes ; un clic déplie
 * ses quatre étapes.
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { SegPeriod, SendRow } from '@/crm/data/segments';
import { relDays } from '@/crm/lib/lifecycle';
import { rate, ratePct } from './segFormat';
import type { SegVM } from './vm';

const COLS = 'minmax(260px,2.2fr) 150px 110px 100px 100px 120px 20px';
const PAGE = 8;

export function SendsView({
  sends, segs, period, seg, setSeg,
}: {
  sends: SendRow[];
  segs: SegVM[];
  period: SegPeriod;
  /** Segment visé choisi (clé de cible), ou '*' pour tous les envois. */
  seg: string;
  setSeg: (k: string) => void;
}) {
  const T = useCrmT();
  const { t, tp, n, eur, pct, locale } = T;
  const [ch, setCh] = useState<'all' | 'email' | 'sms'>('all');
  const [lim, setLim] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const byKey = new Map(segs.map((s) => [s.key, s]));
  const targetOf = (k: string) => {
    const s = byKey.get(k);
    if (s) return { l: s.label, c: s.color };
    return { l: t(k === 'all' ? 'yc.seg.target.all' : 'yc.seg.target.custom'), c: 'var(--sand-400)' };
  };
  const inCh = sends.filter((e) => ch === 'all' || e.channel === ch);
  const targets = Array.from(new Set(inCh.map((e) => e.target)));
  const order = (k: string) => { const i = segs.findIndex((s) => s.key === k); return i < 0 ? 999 + (k === 'all' ? 0 : 1) : i; };
  targets.sort((a, b) => order(a) - order(b));
  const list = inCh.filter((e) => seg === '*' || e.target === seg);
  const shown = list.slice(0, lim);
  const tot = list.reduce((a, e) => ({ r: a.r + e.received, s: a.s + e.revenue }), { r: 0, s: 0 });
  const on = t(`yc.seg.on.${period}`);
  const now = Date.now();
  const chips = [{ k: '*', l: t('yc.seg.ch.all'), c: inCh.length }, ...targets.map((k) => ({ k, l: targetOf(k).l, c: inCh.filter((e) => e.target === k).length }))];
  const pick = (k: string) => { setSeg(k); setLim(PAGE); setOpen(null); };

  return (
    <section style={{ position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', animation: `yc-rise 520ms ${EASE} both` }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(18px,2.2vw,28px) clamp(18px,2.2vw,28px) 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px 20px' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.seg.env.title')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.seg.env.sub')}</div>
          </div>
          <Segmented value={ch} onChange={(v) => { setCh(v); setLim(PAGE); setOpen(null); }} options={(['all', 'email', 'sms'] as const).map((k) => ({ value: k, label: t(`yc.seg.ch.${k}`) }))} ariaLabel={t('yc.cli.msg.channel')} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', marginRight: 4 }}>{t('yc.seg.env.segment')}</span>
          {chips.map((c) => {
            const act = seg === c.k;
            return (
              <Hv key={c.k} as="button" type="button" onClick={() => pick(c.k)} aria-pressed={act} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: `1px solid ${act ? 'var(--ink)' : 'var(--sand-200)'}`, background: act ? 'var(--ink)' : '#fff', color: act ? '#fff' : 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms,border-color 160ms' }} hover={{ borderColor: 'var(--sand-400)' }}>
                {c.l}<span style={{ fontSize: 13, fontWeight: 500, color: act ? 'rgba(255,255,255,.7)' : 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{n(c.c)}</span>
              </Hv>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', padding: '12px clamp(18px,2.2vw,28px)', borderTop: '1px solid var(--sand-100)', background: 'var(--sand-50)', fontSize: 14.5, color: 'var(--sand-600)' }}>
        <b style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{tp('yc.seg.env.n', list.length, { n: n(list.length) })}</b>
        <span>{list.length ? t('yc.seg.env.sum', { recv: n(tot.r), sales: eur(tot.s), on }) : t('yc.seg.env.nothing')}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 900 }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 14, padding: '0 clamp(18px,2.2vw,28px)', height: 44, borderBottom: '1px solid var(--sand-100)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
            <span>{t('yc.seg.env.col.msg')}</span><span>{t('yc.seg.env.col.seg')}</span><span>{t('yc.seg.env.col.recv')}</span>
            <span>{t('yc.seg.env.col.click')}</span><span>{t('yc.seg.env.col.buy')}</span><span>{t('yc.seg.env.col.sales')}</span><span />
          </div>
          {shown.map((e, i) => {
            const isOpen = open === e.id;
            const tg = targetOf(e.target);
            const d = new Date(e.sent_at);
            const days = Math.max(0, Math.floor((now - d.getTime()) / 86_400_000));
            const steps = [
              { l: t('yc.seg.st.received'), v: e.received, w: e.received ? 1 : 0, s: t('yc.seg.st.receivedS') },
              { l: t('yc.seg.st.clicked'), v: e.clicked, w: rate(e.clicked, e.received), s: t('yc.seg.st.clickedS', { pct: ratePct(pct, e.clicked, e.received) }) },
              { l: t('yc.seg.st.ticketing'), v: e.ticketing, w: rate(e.ticketing, e.received), s: t('yc.seg.st.ticketingS', { pct: ratePct(pct, e.ticketing, e.clicked) }) },
              { l: t('yc.seg.st.bought'), v: e.bought, w: rate(e.bought, e.received), s: t('yc.seg.st.boughtS', { pct: ratePct(pct, e.bought, e.ticketing) }) },
            ];
            return (
              <div key={`${e.channel}-${e.id}`} style={{ borderBottom: '1px solid var(--sand-100)', animation: `yc-rise 460ms ${EASE} both`, animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <Hv
                  role="row"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : e.id)}
                  onKeyDown={(ev: React.KeyboardEvent) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) { ev.preventDefault(); setOpen(isOpen ? null : e.id); } }}
                  style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 14, padding: '0 clamp(18px,2.2vw,28px)', height: 68, cursor: 'pointer', background: isOpen ? 'var(--paper)' : 'transparent', transition: 'background 140ms', outline: 0 }}
                  hover={{ background: 'var(--paper)' }}
                >
                  <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon name={e.channel === 'sms' ? 'message' : 'mail'} size={16} stroke={2} /></span>
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name || '—'}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t(`yc.seg.ch.${e.channel}`)} · {d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} · {relDays(days, t, tp)}</span>
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: 'var(--sand-700)', minWidth: 0 }}>
                    <i style={{ flex: 'none', width: 9, height: 9, borderRadius: 3, background: tg.c }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tg.l}</span>
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{n(e.received)}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{e.channel === 'sms' ? '—' : ratePct(pct, e.clicked, e.received)}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{ratePct(pct, e.bought, e.received)}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{eur(e.revenue)}</span>
                  <Icon name="chevronDown" size={16} stroke={2.4} color="var(--sand-400)" style={{ transform: `rotate(${isOpen ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
                </Hv>
                {isOpen && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, padding: '4px clamp(18px,2.2vw,28px) 18px', background: 'var(--paper)', animation: `yc-pop 240ms ${EASE}` }}>
                    {steps.map((s) => (
                      <div key={s.l} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
                        <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{s.l}</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{n(s.v)}</span>
                        <span style={{ height: 5, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}><i style={{ display: 'block', width: `${(s.w * 100).toFixed(1)}%`, height: '100%', background: 'var(--gradient-brand)', borderRadius: 99 }} /></span>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {list.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '56px 24px', textAlign: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.seg.env.none', { on })}</span>
              <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-500)', maxWidth: 420, textWrap: 'pretty' }}>{t('yc.seg.env.noneHint')}</span>
              {(seg !== '*' || ch !== 'all') && (
                <Hv as="button" type="button" onClick={() => { pick('*'); setCh('all'); }} style={{ marginTop: 8, height: 42, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>
                  {t('yc.cli.list.clearFilters')}
                </Hv>
              )}
            </div>
          )}
        </div>
      </div>
      {list.length > shown.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 16px', padding: '16px clamp(18px,2.2vw,28px)' }}>
          <span style={{ fontSize: 14, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.cli.list.shown', { a: n(shown.length), b: n(list.length) })}</span>
          <Hv as="button" type="button" onClick={() => setLim((l) => l + PAGE)} style={{ height: 42, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)', transition: `translate 200ms ${EASE},box-shadow 200ms` }} hover={{ translate: '0 -2px', boxShadow: 'var(--shadow-md)' }}>
            {t('yc.seg.env.moreN', { n: n(Math.min(PAGE, list.length - shown.length)) })}
          </Hv>
        </div>
      )}
    </section>
  );
}
