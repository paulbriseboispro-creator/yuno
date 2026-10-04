/**
 * Fiche d'un segment (volet droit) : nom (renommable pour un segment à vous),
 * Écrire / Voir les clients / Exporter, quatre chiffres, la règle, l'évolution
 * (entrés, sortis, courbe), la réponse aux messages comparée à la moyenne,
 * les derniers messages reçus par ses membres, comment les joindre, d'où ils
 * viennent. ↑ / ↓ passent au segment voisin, Échap ferme.
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented, Sheet, Skel } from '@/crm/ui/kit';
import { EASE, SPRING, clamp01, useProgress, wipe } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useSegmentDetail } from '@/crm/data/segments';
import type { MsgStats, SegPeriod } from '@/crm/data/segments';
import { criteria, clientsHrefFor } from '@/crm/lib/segments';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { PERIODS, rate, ratePct } from './segFormat';
import { deltaText } from './vm';
import type { SegVM } from './vm';

export function SegmentDrawer({
  seg, pos, period, setPeriod, avg, computedAt, onClose, onStep, onWrite, onExport, onRename, onDelete, onSeeSends, guardEscape,
}: {
  seg: SegVM | null;
  pos: { i: number; n: number } | null;
  period: SegPeriod;
  setPeriod: (p: SegPeriod) => void;
  /** Réponse moyenne de tous les messages de la période. */
  avg: MsgStats;
  computedAt: string | null;
  onClose: () => void;
  onStep: (d: 1 | -1) => void;
  onWrite: (s: SegVM) => void;
  onExport: (s: SegVM) => void;
  onRename: (s: SegVM, name: string) => void;
  onDelete: (s: SegVM) => void;
  onSeeSends: (s: SegVM) => void;
  guardEscape: boolean;
}) {
  const T = useCrmT();
  const { t } = T;
  const open = !!seg;
  const [last, setLast] = useState<SegVM | null>(seg);
  useEffect(() => { if (seg) setLast(seg); }, [seg]);
  const s = seg ?? last;

  useEffect(() => {
    if (!open) return;
    const kd = (e: KeyboardEvent) => {
      const tg = (e.target as HTMLElement | null)?.tagName ?? '';
      if (guardEscape || tg === 'INPUT' || tg === 'TEXTAREA') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onStep(e.key === 'ArrowDown' ? 1 : -1); }
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [open, guardEscape, onStep]);

  const posTxt = pos ? t('yc.cli.card.pos', { a: T.n(pos.i + 1), b: T.n(pos.n) }) : '';
  return (
    <Sheet open={open} onClose={() => { if (!guardEscape) onClose(); }} width={640} label={t('yc.seg.dr.label', { pos: posTxt })}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 16px 14px 24px', borderBottom: '1px solid var(--sand-100)', background: '#fff' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.seg.dr.label', { pos: posTxt })}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <HeadBtn label={t('yc.seg.dr.prev')} title={`${t('yc.seg.dr.prev')} (↑)`} dim={!pos || pos.i <= 0} onClick={() => onStep(-1)} icon="chevronUp" />
          <HeadBtn label={t('yc.seg.dr.next')} title={`${t('yc.seg.dr.next')} (↓)`} dim={!pos || pos.i >= pos.n - 1} onClick={() => onStep(1)} icon="chevronDown" />
          <HeadBtn label={t('yc.common.close')} title={`${t('yc.common.close')} (Esc)`} onClick={onClose} icon="x" />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {s && (
          <Body
            key={`${s.key}-${period}`}
            s={s}
            period={period}
            setPeriod={setPeriod}
            avg={avg}
            computedAt={computedAt}
            onWrite={() => onWrite(s)}
            onExport={() => onExport(s)}
            onRename={(name) => onRename(s, name)}
            onDelete={() => onDelete(s)}
            onSeeSends={() => onSeeSends(s)}
          />
        )}
      </div>
    </Sheet>
  );
}

function HeadBtn({ label, title, onClick, icon, dim }: { label: string; title: string; onClick: () => void; icon: 'chevronUp' | 'chevronDown' | 'x'; dim?: boolean }) {
  return (
    <Hv as="button" type="button" onClick={onClick} aria-label={label} title={title} disabled={dim} style={{ width: 36, height: 36, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-600)', cursor: dim ? 'default' : 'pointer', display: 'grid', placeItems: 'center', opacity: dim ? 0.3 : 1 }} hover={dim ? undefined : { background: 'var(--sand-100)' }}>
      <Icon name={icon} size={18} stroke={2.2} />
    </Hv>
  );
}

function Box({ children, gap = 14 }: { children: React.ReactNode; gap?: number }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap, padding: 18, borderRadius: 20, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>{children}</div>;
}

function BoxHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
      {sub && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{sub}</span>}
    </div>
  );
}

function Body({
  s, period, setPeriod, avg, computedAt, onWrite, onExport, onRename, onDelete, onSeeSends,
}: {
  s: SegVM; period: SegPeriod; setPeriod: (p: SegPeriod) => void; avg: MsgStats; computedAt: string | null;
  onWrite: () => void; onExport: () => void; onRename: (name: string) => void; onDelete: () => void; onSeeSends: () => void;
}) {
  const T = useCrmT();
  const { t, tp, n, n1, eur, pct, locale, time } = T;
  const det = useSegmentDetail(s.key, period);
  const dd = useProgress(900, 200, s.key);
  const [menu, setMenu] = useState(false);
  const [ren, setRen] = useState(false);
  const [renName, setRenName] = useState(s.label);
  const [dh, setDh] = useState<number | null>(null);
  const renRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ren) setTimeout(() => { renRef.current?.focus(); renRef.current?.select(); }, 30); }, [ren]);

  const custom = s.kind === 'custom';
  const on = t(`yc.seg.on.${period}`);
  const m = s.msg;
  const has = m.received > 0;
  const d = deltaText(s, t, n, period);
  const jpc = s.n ? Math.round((s.reachable / s.n) * 100) : 0;
  const commitRename = () => {
    const nm = renName.trim();
    setRen(false);
    if (nm && nm !== s.label) onRename(nm);
  };

  const tiles = [
    { l: t('yc.seg.dr.t.clients'), v: n(s.n), sub: d.txt, fg: d.fg, fw: 600 },
    { l: t('yc.seg.dr.t.reach'), v: n(s.reachable), sub: t('yc.seg.dr.t.reachS', { pct: pct(jpc) }), fg: 'var(--sand-500)', fw: 400 },
    { l: t('yc.seg.dr.t.spend'), v: s.avg_spend === null ? '—' : eur(s.avg_spend), sub: t('yc.seg.dr.t.spendS'), fg: 'var(--sand-500)', fw: 400 },
    { l: t('yc.seg.dr.t.nights'), v: s.avg_nights === null ? '—' : n1(s.avg_nights), sub: t('yc.seg.dr.t.nightsS'), fg: 'var(--sand-500)', fw: 400 },
  ];

  // Évolution.
  const pts = s.spark;
  const vals = pts.map((x) => x.n);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 0;
  const pad = Math.max(1, (hi - lo) * 0.15);
  const np = vals.length;
  const sx = (i: number) => (np <= 1 ? 50 : (i / (np - 1)) * 100);
  const sy = (x: number) => 36 - ((x - (lo - pad)) / Math.max(1, hi - lo + 2 * pad)) * 32;
  const path = np >= 2 ? 'M' + vals.map((x, i) => `${sx(i).toFixed(1)} ${sy(x).toFixed(1)}`).join(' L') : '';
  const tip = dh !== null && pts[dh] ? {
    left: `${sx(dh).toFixed(1)}%`, top: `${((sy(vals[dh]) / 40) * 100).toFixed(1)}%`,
    tx: dh < np * 0.6 ? 'translateX(-12px)' : 'translateX(calc(-100% + 12px))',
    date: new Date(`${pts[dh].d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
    v: t('yc.seg.dr.tipN', { n: n(vals[dh]) }),
  } : null;
  const move = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(np - 1, Math.round(((e.clientX - r.left) / r.width) * (np - 1))));
    if (dh !== i) setDh(i);
  };
  const ent = det.data?.entered ?? null;
  const ext = det.data?.exited ?? null;
  const net = ent !== null && ext !== null ? ent - ext : null;
  const netFg = net !== null && net > 0 ? (s.good ? 'var(--green-700)' : 'var(--amber-700)') : 'var(--ink)';

  // Réponse aux messages, comparée à la moyenne de la période.
  const AV = { c: rate(avg.clicked, avg.received), k: rate(avg.ticketing, avg.received), b: rate(avg.bought, avg.received) };
  const fun = [
    { l: t('yc.seg.f.received'), v: m.received, w: 1, a: null as number | null, pc: '' },
    { l: t('yc.seg.f.clicked'), v: m.clicked, w: rate(m.clicked, m.received), a: AV.c, pc: ratePct(pct, m.clicked, m.received) },
    { l: t('yc.seg.f.ticketing'), v: m.ticketing, w: rate(m.ticketing, m.received), a: AV.k, pc: ratePct(pct, m.ticketing, m.received) },
    { l: t('yc.seg.f.bought'), v: m.bought, w: rate(m.bought, m.received), a: AV.b, pc: ratePct(pct, m.bought, m.received) },
  ];
  let ins = '';
  if (has && m.received >= 30 && AV.c > 0) {
    const q = rate(m.clicked, m.received) / AV.c;
    const p = ratePct(pct, m.clicked, m.received);
    const a = ratePct(pct, avg.clicked, avg.received);
    if (q >= 1.3) ins = t('yc.seg.dr.insMore', { x: n1(q), p, a });
    else if (q > 0 && q <= 0.7) ins = t('yc.seg.dr.insLess', { x: n1(1 / q), p, a });
    else ins = t('yc.seg.dr.insSame');
  } else if (has) ins = t('yc.seg.dr.insThin');

  const sends = (det.data?.sends ?? []).slice(0, 3);
  const joins = [
    { l: t('yc.seg.dr.j.email'), v: s.email, c: 'var(--ink)' },
    { l: t('yc.seg.dr.j.sms'), v: s.sms, c: 'var(--ink)' },
    { l: t('yc.seg.dr.j.none'), v: Math.max(0, s.n - s.reachable), c: 'var(--sand-300)' },
  ];
  const srcs = (['shotgun', 'utm', 'import', 'other'] as const)
    .map((k) => ({ k, v: s.sources?.[k] ?? 0 }))
    .filter((x) => x.v > 0);
  const crit = criteria(s.definition ?? {}, t);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '24px 24px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <i style={{ flex: 'none', width: 18, height: 18, marginTop: 9, borderRadius: 6, background: s.color }} />
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ren ? (
            <input
              ref={renRef}
              value={renName}
              onChange={(e) => setRenName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRename(); } else if (e.key === 'Escape') { e.stopPropagation(); setRen(false); } }}
              onBlur={commitRename}
              maxLength={80}
              aria-label={t('yc.cli.list.segName')}
              style={{ height: 44, width: '100%', padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-400)', outline: 0, background: '#fff', font: '600 24px/1 var(--font-display)', letterSpacing: '-.03em', color: 'var(--ink)', boxShadow: 'none' }}
            />
          ) : (
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1.05, letterSpacing: '-.03em', textWrap: 'balance' }}>{s.label}</h2>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px' }}>
            <span style={{ height: 26, padding: '0 11px', borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 600 }}>{t(custom ? 'yc.seg.dr.badgeMine' : 'yc.seg.dr.badgeAuto')}</span>
            {computedAt && <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.seg.dr.upd', { time: time(computedAt) })}</span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, position: 'relative' }}>
        {s.reachable > 0 && (
          <Hv
            as="button"
            type="button"
            onClick={onWrite}
            style={{ height: 44, padding: '0 5px 0 18px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', transition: `transform 200ms ${SPRING},filter 160ms` }}
            hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
            active={{ transform: 'scale(.97)' }}
          >
            {t('yc.seg.dr.write')}
            <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={15} stroke={2.4} /></span>
          </Hv>
        )}
        {s.n > 0 && (
          <Hv as={Link} to={clientsHrefFor(s, CRM_ROUTES.clients)} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)', color: 'var(--ink)', textDecoration: 'none' }}>
            {tp('yc.seg.dr.see', s.n, { n: n(s.n) })}
          </Hv>
        )}
        <Hv as="button" type="button" onClick={onExport} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
          {t('yc.cli.list.export')}
        </Hv>
        {custom && (
          <Hv as="button" type="button" onClick={() => setMenu(!menu)} aria-label={t('yc.seg.dr.more')} aria-haspopup="menu" aria-expanded={menu} style={{ width: 44, height: 44, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
            <Icon name="more" size={18} />
          </Hv>
        )}
        {menu && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
            <div role="menu" style={{ position: 'absolute', zIndex: 2, top: 52, right: 0, width: 220, padding: 6, borderRadius: 18, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', animation: `yc-pop 200ms ${EASE}`, transformOrigin: 'top right' }}>
              <Hv as="button" type="button" role="menuitem" onClick={() => { setMenu(false); setRenName(s.label); setRen(true); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: 0, borderRadius: 12, background: 'none', fontSize: 14.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }} hover={{ background: 'var(--sand-50)' }}>
                {t('yc.seg.dr.rename')}
              </Hv>
              <Hv as="button" type="button" role="menuitem" onClick={() => { setMenu(false); onDelete(); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: 0, borderRadius: 12, background: 'none', fontSize: 14.5, fontWeight: 500, color: 'var(--red-600)', cursor: 'pointer', textAlign: 'left' }} hover={{ background: 'var(--red-50)' }}>
                {t('yc.seg.dr.delete')}
              </Hv>
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.seg.dr.periodOn')}</span>
        <Segmented size="sm" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: t(`yc.seg.per.${p}`) }))} ariaLabel={t('yc.seg.period')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,140px),1fr))', gap: 10 }}>
        {tiles.map((x) => (
          <div key={x.l} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px', borderRadius: 16, background: '#fff', border: '1px solid var(--sand-200)' }}>
            <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{x.l}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{x.v}</span>
            <span style={{ fontSize: 12.5, fontWeight: x.fw, color: x.fg, textWrap: 'pretty' }}>{x.sub}</span>
          </div>
        ))}
      </div>

      <Box gap={12}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('yc.seg.dr.who')}</span>
        <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{s.rule}</span>
        {crit.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {crit.map((x, i) => (
              <span key={i} style={{ height: 30, padding: '0 12px', borderRadius: 99, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--sand-600)' }}>
                {x.k}<b style={{ fontWeight: 600, color: 'var(--ink)' }}>{x.v}</b>
              </span>
            ))}
          </div>
        )}
      </Box>

      <Box>
        <BoxHead title={t('yc.seg.dr.trend')} sub={t(`yc.seg.onCap.${period}`)} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
          {[
            { l: t('yc.seg.dr.entered'), v: ent === null ? null : n(ent), fg: 'var(--ink)' },
            { l: t('yc.seg.dr.exited'), v: ext === null ? null : n(ext), fg: 'var(--ink)' },
            { l: t('yc.seg.dr.net'), v: net === null ? null : net === 0 ? '0' : `${net > 0 ? '+' : '−'}${n(Math.abs(net))}`, fg: netFg },
          ].map((x) => (
            <div key={x.l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{x.l}</span>
              {x.v === null ? <Skel w={56} h={24} /> : <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums', color: x.fg }}>{x.v}</span>}
            </div>
          ))}
        </div>
        {np >= 2 ? (
          <>
            <div onMouseMove={move} onMouseLeave={() => setDh(null)} style={{ position: 'relative', height: 112, cursor: 'crosshair' }}>
              <svg viewBox="0 0 100 40" width="100%" height="112" preserveAspectRatio="none" role="img" aria-label={t('yc.seg.dr.chartAria')} style={{ display: 'block', clipPath: wipe(clamp01(dd * 1.15)) }}>
                <path d={`${path} L100 40 L0 40 Z`} fill="var(--red-50)" />
                <path d={path} fill="none" stroke="var(--red-500)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              {tip && (
                <>
                  <i style={{ position: 'absolute', left: tip.left, top: tip.top, width: 10, height: 10, margin: '-5px 0 0 -5px', borderRadius: 99, background: 'var(--red-500)', boxShadow: '0 0 0 4px rgba(227,20,27,.18)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', bottom: 120, left: tip.left, transform: tip.tx, pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 1, whiteSpace: 'nowrap', boxShadow: 'var(--shadow-md)', zIndex: 3 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tip.date}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>{tip.v}</span>
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--sand-500)' }}>
              <span>{t(`yc.seg.from.${period}`)}</span><span>{t('yc.seg.today')}</span>
            </div>
          </>
        ) : (
          <div style={{ padding: 22, borderRadius: 16, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>
            {t('yc.seg.dr.trendThin')}
          </div>
        )}
      </Box>

      <Box>
        <BoxHead title={t('yc.seg.dr.msgs')} sub={has ? t('yc.seg.dr.msgsSub', { on }) : undefined} />
        {!has ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', padding: 18, borderRadius: 16, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 14.5, lineHeight: 1.5, textWrap: 'pretty' }}>
            <span>{t('yc.seg.dr.msgsNone', { on })}</span>
            {s.reachable > 0 && (
              <Hv as="button" type="button" onClick={onWrite} style={{ border: 0, background: 'none', padding: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--red-600)', cursor: 'pointer' }} hover={{ color: 'var(--red-700)' }}>
                {t('yc.seg.dr.write')}
              </Hv>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {fun.map((f, i) => (
                <div key={f.l} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '6px 12px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{f.l}</span>
                  <span style={{ fontSize: 14, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>
                    <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', color: 'var(--ink)' }}>{n(f.v)}</b> {f.pc ? `· ${f.pc}` : ''}
                  </span>
                  <div style={{ gridColumn: '1 / -1', position: 'relative', height: 10, borderRadius: 99, background: 'var(--sand-100)' }}>
                    <i style={{ display: 'block', width: `${(f.w * 100 * clamp01(dd * 1.2 - i * 0.1)).toFixed(1)}%`, height: '100%', borderRadius: 99, background: 'var(--gradient-brand)' }} />
                    {f.a !== null && <i title={t('yc.seg.dr.avgT', { pct: ratePct(pct, f.a * 1000, 1000) })} style={{ position: 'absolute', top: -4, left: `${(f.a * 100).toFixed(1)}%`, width: 2, height: 18, marginLeft: -1, borderRadius: 2, background: 'var(--ink)' }} />}
                  </div>
                </div>
              ))}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--sand-500)' }}>
                <i style={{ width: 2, height: 14, borderRadius: 2, background: 'var(--ink)', display: 'inline-block' }} />{t('yc.seg.dr.avg')}
              </span>
            </div>
            {ins && (
              <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 16, background: 'var(--red-50)' }}>
                <span style={{ flex: 'none', width: 8, height: 8, marginTop: 7, borderRadius: 99, background: 'var(--red-500)' }} />
                <span style={{ fontSize: 14.5, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{ins}</span>
              </div>
            )}
          </>
        )}
      </Box>

      {sends.length > 0 && (
        <Box gap={6}>
          <span style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{t('yc.seg.dr.sends')}</span>
          {sends.map((e, k) => (
            <div key={`${e.channel}-${e.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', animation: `yc-rise 420ms ${EASE} both`, animationDelay: `${k * 50}ms` }}>
              <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon name={e.channel === 'sms' ? 'message' : 'mail'} size={16} stroke={2} /></span>
              <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name || '—'}</span>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.seg.dr.sendLine', { date: new Date(e.sent_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' }), n: n(e.received) })}</span>
              </div>
              <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{e.channel === 'sms' ? '—' : t('yc.seg.dr.sendClick', { pct: ratePct(pct, e.clicked, e.received) })}</span>
                <b style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{eur(e.revenue)}</b>
              </div>
            </div>
          ))}
          <Hv as="button" type="button" onClick={onSeeSends} style={{ alignSelf: 'flex-start', marginTop: 6, border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--red-600)' }}>
            {t('yc.seg.dr.allSends')}<Icon name="arrowRight" size={14} stroke={2.4} />
          </Hv>
        </Box>
      )}

      <Box>
        <BoxHead title={t('yc.seg.dr.join')} sub={t('yc.seg.dr.joinSub', { pct: pct(jpc) })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {joins.map((j) => (
            <div key={j.l} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 120px', gap: 12, alignItems: 'center', fontSize: 14 }}>
              <span style={{ color: 'var(--sand-600)' }}>{j.l}</span>
              <span style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}><i style={{ display: 'block', width: `${(s.n ? (j.v / s.n) * 100 * clamp01(dd * 1.2) : 0).toFixed(1)}%`, height: '100%', borderRadius: 99, background: j.c }} /></span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b style={{ fontWeight: 600 }}>{n(j.v)}</b> <span style={{ color: 'var(--sand-500)' }}>{s.n ? pct(Math.round((j.v / s.n) * 100)) : ''}</span></span>
            </div>
          ))}
        </div>
      </Box>

      {srcs.length > 0 && (
        <Box>
          <BoxHead title={t('yc.seg.dr.src')} sub={t('yc.seg.dr.srcSub')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {srcs.map((x) => (
              <div key={x.k} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) 56px', gap: 12, alignItems: 'center', fontSize: 14 }}>
                <span style={{ color: 'var(--sand-600)' }}>{t(`yc.seg.dr.s.${x.k}`)}</span>
                <span style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}><i style={{ display: 'block', width: `${(s.n ? (x.v / s.n) * 100 * clamp01(dd * 1.2) : 0).toFixed(1)}%`, height: '100%', borderRadius: 99, background: 'var(--ink)' }} /></span>
                <span style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{s.n ? pct(Math.round((x.v / s.n) * 100)) : '—'}</span>
              </div>
            ))}
          </div>
        </Box>
      )}
    </div>
  );
}
