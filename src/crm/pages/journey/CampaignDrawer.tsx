/**
 * Tiroir d'une campagne du Parcours : sa conversion face à la moyenne, ce
 * que ses destinataires ont fait étape par étape, qui a acheté, quand les
 * achats arrivent ; puis dupliquer la campagne, filtrer la page sur elle ou
 * ouvrir ses résultats complets.
 */
import { useEffect, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { ArrowLink, Portal } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { Lifecycle } from '@/crm/data/clients';
import type { JrCampaign } from '@/crm/data/journey';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { Note } from './jrUi';
import { JR_IC, campConv, pc } from './jrLib';

type T = ReturnType<typeof useCrmT>;

const SEGS: Lifecycle[] = ['nou', 'occ', 'hab', 'end', 'none'];

export function CampaignDrawer({
  c, avg, T, canWrite, busy, onClose, onOnly, onDup,
}: {
  c: JrCampaign | null; avg: number; T: T; canWrite: boolean; busy: boolean;
  onClose: () => void; onOnly: (id: string) => void; onDup: (c: JrCampaign) => void;
}) {
  const { t, n, dShort } = T;
  const [go, setGo] = useState(false);

  useEffect(() => {
    if (!c) { setGo(false); return; }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setGo(true)); });
    return () => { document.removeEventListener('keydown', k); cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [c, onClose]);

  if (!c) return null;
  const cv = campConv(c);
  const vsA = avg > 0 ? cv / avg : 0;
  const vs = avg > 0 ? (vsA >= 1.05 || vsA <= 0.95 ? t('yc.jr.dr.vsUp', { x: T.n1(Math.round(vsA * 10) / 10) }) : t('yc.jr.dr.vsAvg')) : '';
  const vsFg = vsA >= 1.05 ? 'var(--green-700)' : vsA <= 0.95 ? 'var(--amber-700)' : 'var(--sand-600)';
  const mx = c.received || 1;
  const rows: { l: string; v: number; p: string; bg: string }[] = [
    { l: t('yc.jr.dr.r.rc'), v: c.received, p: T.pct(100), bg: 'var(--sand-400)' },
    { l: t('yc.jr.dr.r.op'), v: c.opened, p: t('yc.jr.dr.p.op', { p: pc(T, c.received ? c.opened / c.received : 0) }), bg: 'var(--sand-400)' },
    { l: t('yc.jr.dr.r.ck'), v: c.clicked, p: t('yc.jr.dr.p.ck', { p: pc(T, c.opened ? c.clicked / c.opened : 0) }), bg: 'var(--sand-400)' },
    { l: t('yc.jr.dr.r.tk'), v: c.ticket_clicks, p: t('yc.jr.dr.p.tk', { p: pc(T, c.clicked ? c.ticket_clicks / c.clicked : 0) }), bg: 'var(--sand-400)' },
    { l: t('yc.jr.dr.r.b'), v: c.buyers, p: t('yc.jr.dr.p.b', { p: pc(T, c.clicked ? c.buyers / c.clicked : 0) }), bg: 'var(--gradient-brand)' },
    { l: t('yc.jr.dr.r.bk'), v: c.back, p: t('yc.jr.dr.p.bk', { p: pc(T, c.buyers ? c.back / c.buyers : 0) }), bg: 'var(--red-200)' },
  ];
  const segs = SEGS.map((s) => ({ s, v: Number(c.buyers_seg?.[s] ?? 0) })).filter((x) => x.v > 0 || ['nou', 'occ', 'hab'].includes(x.s));
  const segTot = c.buyers || 1;
  const fast = c.buyers ? c.within2d / c.buyers : 0;
  const when = !c.buyers ? t('yc.jr.dr.whenNone') : fast >= 0.5 ? t('yc.jr.dr.when', { p: T.pct(Math.round(fast * 100)) }) : t('yc.jr.dr.whenLong', { p: T.pct(Math.round(fast * 100)) });
  const mono = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'var(--sand-400)' };

  return (
    <Portal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(26,20,18,.28)', animation: 'yc-fade 200ms ease both' }} />
      <aside role="dialog" aria-modal="true" aria-label={t('yc.jr.dr.aria')} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 91, width: 'min(500px,100vw)', boxSizing: 'border-box', background: '#fff', boxShadow: '-24px 0 48px -24px rgba(26,20,18,.28)', display: 'flex', flexDirection: 'column', animation: `yc-drawer-in 340ms ${EASE} both` }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '22px 24px 16px' }}>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: 'var(--ink)', color: '#fff' }}>{t('yc.jr.ch.email')}</span>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{[dShort(c.sent_at), c.event_title].filter(Boolean).join(' · ')}</span>
            </div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: '-.03em', textWrap: 'balance' }}>{c.name}</h3>
          </div>
          <Hv
            as="button"
            type="button"
            onClick={onClose}
            aria-label={t('yc.common.close')}
            style={{ flex: 'none', width: 40, height: 40, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
            hover={{ background: 'var(--sand-200)' }}
          >
            <Icon d={JR_IC.x} size={16} stroke={2.4} />
          </Hv>
        </div>

        <div className="yc-thin-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 18px', padding: '18px 20px', borderRadius: 20, background: 'var(--sand-50)' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 64, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{pc(T, cv)}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4 }}>
              {vs && <span style={{ fontSize: 14.5, fontWeight: 600, color: vsFg }}>{vs}</span>}
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.jr.dr.bought')}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={mono}>{t('yc.jr.dr.steps')}</span>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontSize: 14 }}>
                  <span style={{ fontWeight: 500 }}>{r.l}</span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>{n(r.v)}</b>
                    <span style={{ minWidth: 92, textAlign: 'right', fontSize: 12.5, color: 'var(--sand-500)' }}>{r.p}</span>
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: go ? `${(Math.sqrt(r.v / mx) * 100).toFixed(1)}%` : '0%', borderRadius: 99, background: r.bg, transition: `width 700ms ${EASE} ${i * 50}ms` }} />
                </div>
              </div>
            ))}
            <span style={{ fontSize: 12, color: 'var(--sand-400)' }}>{t('yc.jr.dr.scale')}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>{t('yc.jr.dr.who')}</span>
            {segs.map((x) => (
              <div key={x.s} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
                <span style={{ width: 104, fontWeight: 500 }}>{t(`yc.cli.seg.${x.s}`)}</span>
                <div style={{ flex: 1, height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: go ? `${((x.v / segTot) * 100).toFixed(0)}%` : '0%', borderRadius: 99, background: 'var(--ink)', transition: `width 700ms ${EASE} 200ms` }} />
                </div>
                <b style={{ minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{T.pct(Math.round((x.v / segTot) * 100))}</b>
              </div>
            ))}
          </div>

          <Note size={14.5}>{when}</Note>
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.jr.dr.rule')}</span>
          <ArrowLink to={CRM_ROUTES.emailResults(c.id)} size={14}>{t('yc.jr.dr.results')}</ArrowLink>
        </div>

        <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: canWrite ? 'space-between' : 'flex-end', padding: '16px 20px', borderTop: '1px solid var(--sand-100)', background: 'var(--sand-50)' }}>
          {canWrite && (
            <Hv
              as="button"
              type="button"
              onClick={() => onDup(c)}
              disabled={busy}
              style={{ height: 44, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}
              hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}
            >
              {t('yc.jr.dr.dup')}
            </Hv>
          )}
          <Hv
            as="button"
            type="button"
            onClick={() => onOnly(c.id)}
            style={{ height: 44, padding: '0 5px 0 16px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
            hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
            active={{ transform: 'scale(.97)' }}
          >
            {t('yc.jr.dr.only')}
            <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon d={JR_IC.arrow} size={15} stroke={2.4} /></span>
          </Hv>
        </div>
      </aside>
    </Portal>
  );
}
