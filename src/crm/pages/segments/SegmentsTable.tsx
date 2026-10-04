/**
 * Vue « Mes segments » : pastilles Tous / Automatiques / À vous, tableau trié
 * (nom, clients, cliquent, ventes), une ligne par segment avec sa variation,
 * ses joignables, sa réponse aux messages, ses ventes et sa courbe.
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { SegPeriod } from '@/crm/data/segments';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { linePath, rate, ratePct } from './segFormat';
import { deltaText } from './vm';
import type { SegVM } from './vm';

export type SegSort = 'name' | 'n' | 'click' | 'sales';
export type SegGroup = 'all' | 'auto' | 'mine';

const COLS = 'minmax(260px,2.2fr) 150px 120px 130px 150px 104px 20px';

export function SegmentsTable({
  segs, period, sort, dir, onSort, group, setGroup, loading, onOpen, onNew,
}: {
  segs: SegVM[];
  period: SegPeriod;
  sort: SegSort;
  dir: number;
  onSort: (k: SegSort) => void;
  group: SegGroup;
  setGroup: (g: SegGroup) => void;
  loading: boolean;
  onOpen: (key: string) => void;
  onNew: () => void;
}) {
  const T = useCrmT();
  const { t, tp, n, eur, pct } = T;
  const autoS = segs.filter((s) => s.kind === 'auto');
  const mineS = segs.filter((s) => s.kind === 'custom');
  const valOf = (s: SegVM): number | string => (sort === 'name' ? s.label.toLowerCase()
    : sort === 'click' ? (s.msg.received ? rate(s.msg.clicked, s.msg.received) : -1)
      : sort === 'sales' ? (s.msg.received ? s.msg.revenue : -1) : s.n);
  const srt = (a: SegVM[]) => a.slice().sort((x, y) => {
    const vx = valOf(x); const vy = valOf(y);
    if (sort === 'name') return (vx < vy ? -1 : vx > vy ? 1 : 0) * dir;
    return ((vy as number) - (vx as number)) * dir;
  });
  const hd = (k: SegSort, label: string) => {
    const on = sort === k;
    const ar = on ? (k === 'name' ? (dir === 1 ? '↑' : '↓') : (dir === 1 ? '↓' : '↑')) : '';
    return (
      <Hv as="button" type="button" onClick={() => onSort(k)} style={{ textAlign: 'left', border: 0, background: 'none', padding: 0, font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: on ? 'var(--ink)' : 'var(--sand-500)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
        {label} {ar}
      </Hv>
    );
  };
  const grps: { k: SegGroup; l: string; c: number }[] = [
    { k: 'all', l: t('yc.seg.grp.all'), c: segs.length },
    { k: 'auto', l: t('yc.seg.grp.auto'), c: autoS.length },
    { k: 'mine', l: t('yc.seg.grp.mine'), c: mineS.length },
  ];
  const on = t(`yc.seg.on.${period}`);
  let ri = 0;
  const row = (s: SegVM) => {
    const i = ri++;
    const has = s.msg.received > 0;
    const pts = s.spark.map((x) => x.n);
    const sp = pts.length >= 2 ? linePath(pts, 28) : 'M0 14 L100 14';
    const d = deltaText(s, t, n, period);
    const jp = s.n ? Math.round((s.reachable / s.n) * 100) : 0;
    return (
      <Hv
        key={s.key}
        role="row"
        tabIndex={0}
        onClick={() => onOpen(s.key)}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(s.key); } }}
        style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 16, padding: '0 clamp(18px,2.2vw,28px)', height: 72, borderBottom: '1px solid var(--sand-100)', cursor: 'pointer', animation: `yc-rise 480ms ${EASE} both`, animationDelay: `${Math.min(i, 10) * 40}ms`, transition: 'background 140ms', outline: 0 }}
        hover={{ background: 'var(--paper)' }}
      >
        <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
          <i style={{ flex: 'none', width: 12, height: 12, borderRadius: 4, background: s.color }} />
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 15.5, fontWeight: 600, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
            <span style={{ fontSize: 13, lineHeight: '17px', color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.rule}</span>
          </span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{n(s.n)}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: d.fg, fontVariantNumeric: 'tabular-nums' }}>{d.txt}</span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{s.n ? pct(jp) : '—'}</span>
          <span style={{ display: 'block', width: 64, height: 4, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}><i style={{ display: 'block', width: `${jp}%`, height: '100%', background: 'var(--ink)', borderRadius: 99 }} /></span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: has ? 'var(--ink)' : 'var(--sand-400)' }}>{has ? ratePct(pct, s.msg.clicked, s.msg.received) : '—'}</span>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{has ? t('yc.seg.row.recv', { n: n(s.msg.received) }) : t('yc.seg.row.noSend')}</span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: has ? 'var(--ink)' : 'var(--sand-400)' }}>{has ? eur(s.msg.revenue) : '—'}</span>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{has ? tp('yc.seg.row.buyers', s.msg.buyers, { n: n(s.msg.buyers) }) : t(`yc.seg.onCap.${period}`)}</span>
        </span>
        <span>
          <svg viewBox="0 0 100 28" width="96" height="28" preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block' }}>
            <path d={sp} fill="none" stroke={pts.length >= 2 ? 'var(--red-500)' : 'var(--sand-300)'} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={pts.length >= 2 ? undefined : '3 4'} />
          </svg>
        </span>
        <Icon name="chevronRight" size={16} stroke={2.4} color="var(--sand-300)" />
      </Hv>
    );
  };
  const head = (title: string, sub: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '16px clamp(18px,2.2vw,28px) 8px', background: 'var(--sand-50)', borderBottom: '1px solid var(--sand-100)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-600)' }}>{title}</span>
      <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{sub}</span>
    </div>
  );
  const noRows = !loading && group === 'mine' && mineS.length === 0;

  return (
    <section style={{ position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', animation: `yc-rise 520ms ${EASE} both` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px 20px', padding: 'clamp(18px,2.2vw,28px) clamp(18px,2.2vw,28px) 16px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.seg.list.title')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.seg.list.sub')}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {grps.map((g) => {
            const act = group === g.k;
            return (
              <Hv key={g.k} as="button" type="button" onClick={() => setGroup(g.k)} aria-pressed={act} style={{ height: 38, padding: '0 14px', borderRadius: 99, border: `1px solid ${act ? 'var(--ink)' : 'var(--sand-200)'}`, background: act ? 'var(--ink)' : '#fff', color: act ? '#fff' : 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms,border-color 160ms' }} hover={{ borderColor: 'var(--sand-400)' }}>
                {g.l}<span style={{ fontSize: 13, fontWeight: 500, color: act ? 'rgba(255,255,255,.7)' : 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{n(g.c)}</span>
              </Hv>
            );
          })}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 980 }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 16, padding: '0 clamp(18px,2.2vw,28px)', height: 44, borderTop: '1px solid var(--sand-100)', borderBottom: '1px solid var(--sand-100)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
            {hd('name', t('yc.seg.col.segment'))}
            {hd('n', t('yc.seg.col.clients'))}
            <span>{t('yc.seg.col.reach')}</span>
            {hd('click', t('yc.seg.col.click'))}
            {hd('sales', t('yc.seg.col.sales'))}
            <span>{t('yc.seg.col.trend')}</span>
            <span />
          </div>
          {loading ? (
            <div aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 16, padding: '0 clamp(18px,2.2vw,28px)', height: 72, borderBottom: '1px solid var(--sand-100)' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <i className="yc-skel" style={{ display: 'block', width: 130 + ((i * 37) % 70), height: 13, borderRadius: 6 }} />
                    <i style={{ display: 'block', width: 170 + ((i * 53) % 60), height: 10, borderRadius: 6, background: 'var(--sand-100)' }} />
                  </span>
                  {[70, 60, 50, 80, 90].map((w, k) => <i key={k} style={{ display: 'block', width: w, height: k === 4 ? 20 : 14, borderRadius: 6, background: 'var(--sand-100)' }} />)}
                  <span />
                </div>
              ))}
            </div>
          ) : noRows ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '56px 24px', textAlign: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.seg.mine.none')}</span>
              <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-500)', maxWidth: 420, textWrap: 'pretty' }}>{t('yc.seg.mine.noneHint')}</span>
              <Hv as="button" type="button" onClick={onNew} style={{ marginTop: 8, height: 42, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>
                {t('yc.seg.new')}
              </Hv>
            </div>
          ) : (
            <div>
              {group !== 'mine' && head(t('yc.seg.head.auto'), t('yc.seg.head.autoSub'))}
              {group !== 'mine' && srt(autoS).map(row)}
              {group !== 'auto' && mineS.length > 0 && head(t('yc.seg.head.mine'), t('yc.seg.head.mineSub'))}
              {group !== 'auto' && srt(mineS).map(row)}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 16px', padding: '14px clamp(18px,2.2vw,28px)', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)', borderRadius: '0 0 28px 28px' }}>
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 720 }}>{t('yc.seg.foot', { on })}</span>
        <Hv as={Link} to={CRM_ROUTES.clients} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
          {t('yc.seg.allClients')}<Icon name="arrowRight" size={14} stroke={2.4} />
        </Hv>
      </div>
    </section>
  );
}
