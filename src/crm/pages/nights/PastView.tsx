/**
 * Soirées · Passées : période (3, 6, 12 mois) et série, quatre chiffres
 * comparés à la même durée juste avant, une colonne de remplissage par soirée,
 * la meilleure et la moins remplie, puis la liste triable.
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { NightRow } from '@/crm/data/nights';
import { PERIOD_MONTHS, deltaPct, fillOf, pastKind, totals, type PastKind, type PeriodMonths } from '@/crm/lib/nights';
import { DateTile, FilterChip, KeyTiles, SearchField, StatusPill } from './nightsUi';
import { ICO, tzDay, tzMonth, tzShort, tzWeek } from './nightsFormat';
import type { KeyTile } from './nightsUi';
import type { DrawerView } from './NightDrawer';

export type PastSort = 'date' | 'sold' | 'ca' | 'nw' | 'gl';

const PA_KEY: Record<PastKind, string> = { full: 'yc.ni.pa.full', good: 'yc.ni.pa.good', fair: 'yc.ni.pa.fair', low: 'yc.ni.pa.low', unknown: 'yc.ni.pa.unknown' };
const ROW_GRID = 'minmax(0,2.4fr) minmax(0,1.6fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.2fr) 140px 20px';
const HC = 176;

export function PastView({
  inW, prevW, rows, months, setMonths, series, ser, setSer, q, setQ, sort, dir, setSort, lim, setLim, drId, open, intro, cc,
}: {
  inW: NightRow[];
  prevW: NightRow[];
  rows: NightRow[];
  months: PeriodMonths;
  setMonths: (m: PeriodMonths) => void;
  series: { key: string; label: string; n: number }[];
  ser: string;
  setSer: (s: string) => void;
  q: string;
  setQ: (v: string) => void;
  sort: PastSort;
  dir: 1 | -1;
  setSort: (s: PastSort) => void;
  lim: number;
  setLim: (n: number) => void;
  drId: string | null;
  open: (id: string, view?: DrawerView) => void;
  intro: boolean;
  cc: number;
}) {
  const { t, tp, n, eur, pct, locale } = useCrmT();
  const [hv, setHvState] = useState<{ id: string; x: number } | null>(null);
  // La bulle suit la colonne réelle : avec peu de soirées, les colonnes n'occupent pas toute la largeur.
  const setHv = (id: string | null, el?: HTMLElement) => {
    if (!id || !el) { setHvState(null); return; }
    const box = el.offsetParent as HTMLElement | null;
    const w = box?.clientWidth ?? 0;
    const c = el.offsetLeft + el.offsetWidth / 2;
    setHvState({ id, x: w ? Math.max(110, Math.min(w - 110, c)) : c });
  };
  const sf = (e: NightRow) => ser === 'all' || e.series.toLowerCase() === ser;
  const W = inW.filter(sf);
  const PW = prevW.filter(sf);
  const cur = totals(W);
  const prev = totals(PW);
  const serLabel = series.find((s) => s.key === ser)?.label;

  // ── Chiffres clés comparés
  const pctDelta = (a: number, b: number): Pick<KeyTile, 'delta' | 'deltaColor'> => {
    const v = deltaPct(a, b, PW.length);
    if (v === null) return {};
    if (Math.abs(v) < 0.5) return { delta: t('yc.ni.d.same'), deltaColor: 'var(--sand-500)' };
    return { delta: t(v > 0 ? 'yc.ni.d.pctUp' : 'yc.ni.d.pctDown', { p: pct(Math.abs(v)), m: months }), deltaColor: v > 0 ? 'var(--green-700)' : 'var(--amber-700)' };
  };
  const nDelta: Pick<KeyTile, 'delta' | 'deltaColor'> = PW.length >= 3
    ? cur.nights === prev.nights ? { delta: t('yc.ni.d.same'), deltaColor: 'var(--sand-500)' }
      : { delta: t(cur.nights > prev.nights ? 'yc.ni.d.more' : 'yc.ni.d.less', { n: Math.abs(cur.nights - prev.nights), m: months }), deltaColor: cur.nights > prev.nights ? 'var(--green-700)' : 'var(--amber-700)' }
    : {};
  const fDelta: Pick<KeyTile, 'delta' | 'deltaColor'> = PW.length >= 3 && cur.fill !== null && prev.fill !== null
    ? Math.abs(cur.fill - prev.fill) < 0.005 ? { delta: t('yc.ni.d.same'), deltaColor: 'var(--sand-500)' }
      : { delta: t(cur.fill > prev.fill ? 'yc.ni.d.ptsUp' : 'yc.ni.d.ptsDown', { n: Math.abs(Math.round((cur.fill - prev.fill) * 100)), m: months }), deltaColor: cur.fill > prev.fill ? 'var(--green-700)' : 'var(--amber-700)' }
    : {};
  const empty = W.length === 0;
  const tiles: KeyTile[] = [
    { label: t('yc.ni.t.nights'), big: empty ? '—' : n(cur.nights * cc), sub: t('yc.ni.t.nightsSub', { m: months }) + (serLabel ? ` · ${serLabel}` : ''), icon: ICO.calendar, ...nDelta },
    { label: t('yc.ni.t.sold'), big: empty ? '—' : n(cur.sold * cc), sub: cur.cap ? t('yc.ni.t.soldOffered', { n: n(cur.cap) }) : t('yc.ni.t.soldShotgun'), icon: ICO.ticket, ...pctDelta(cur.sold, prev.sold) },
    { label: t('yc.ni.t.ca'), big: empty ? '—' : eur(cur.revenue * cc), sub: t('yc.ni.t.caPastSub'), icon: ICO.euro, ...pctDelta(cur.revenue, prev.revenue) },
    { label: t('yc.ni.t.fill'), big: empty || cur.fill === null ? '—' : pct(cur.fill * 100 * cc), sub: t('yc.ni.t.fillSub'), icon: ICO.chart, ...fDelta },
  ];

  // ── Colonnes de remplissage
  const chrono = W.slice().sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const maxCap = Math.max(1, ...chrono.map((e) => e.cap ?? e.sold));
  const hov = hv ? chrono.find((e) => e.id === hv.id) ?? null : null;
  const gap = chrono.length > 24 ? 4 : 8;
  const label = (e: NightRow) => t('yc.ni.label', { title: e.title, date: tzShort(locale, e.start_at, e.tz) });
  const known = chrono.filter((e) => fillOf(e) !== null);
  const best = known.length >= 5 ? known.reduce((a, e) => ((fillOf(e) ?? 0) >= (fillOf(a) ?? 0) ? e : a)) : null;
  const worst = known.length >= 5 ? known.reduce((a, e) => ((fillOf(e) ?? 0) < (fillOf(a) ?? 0) ? e : a)) : null;

  const head = (k: PastSort, l: string) => (
    <button type="button" onClick={() => setSort(k)} style={{ justifySelf: 'start', border: 0, background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: sort === k ? 'var(--ink)' : 'var(--sand-400)' }}>
      {l}{sort === k ? (dir === 1 ? ' ↓' : ' ↑') : ''}
    </button>
  );
  const shown = rows.slice(0, lim);
  const rest = rows.length - shown.length;

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 24px', animation: `yc-row 700ms ${EASE} 380ms both` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.ni.period')}</span>
          <div role="group" aria-label={t('yc.ni.period')} style={{ display: 'flex', padding: 3, borderRadius: 99, background: 'var(--sand-100)' }}>
            {PERIOD_MONTHS.map((m) => {
              const on = months === m;
              return (
                <button key={m} type="button" onClick={() => setMonths(m)} aria-pressed={on} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-sm)' : 'none', color: on ? 'var(--ink)' : 'var(--sand-600)', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'background 200ms,box-shadow 200ms' }}>
                  {t('yc.ni.period.m', { n: m })}
                </button>
              );
            })}
          </div>
        </div>
        {series.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <FilterChip on={ser === 'all'} label={t('yc.ni.series.all')} n={inW.length} onClick={() => setSer('all')} />
            {series.map((s) => <FilterChip key={s.key} on={ser === s.key} label={s.label} n={inW.filter((e) => e.series.toLowerCase() === s.key).length} onClick={() => setSer(s.key)} />)}
          </div>
        )}
      </div>

      <KeyTiles tiles={tiles} intro={intro} />

      {empty ? (
        <section style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: 32, borderRadius: 28, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.ni.paEmpty.t')}</span>
          <span style={{ fontSize: 15, color: 'var(--sand-600)' }}>{t('yc.ni.paEmpty.s')}</span>
          <Hv as="button" type="button" onClick={() => { setSer('all'); setMonths(12); setQ(''); }} style={{ height: 42, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-300)', background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-50)' }}>
            {t('yc.ni.list.reset')}
          </Hv>
        </section>
      ) : (
        <>
          {/* Remplissage */}
          <section style={{
            boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28,
            background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.06),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)',
            animation: `yc-row 800ms ${EASE} 460ms both`,
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '10px 20px' }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.ni.chart.t')}</h2>
                <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.ni.chart.s')}</div>
              </div>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.ni.chart.hint')}</span>
            </div>
            <div style={{ position: 'relative', paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap, height: HC, borderBottom: '1px solid var(--sand-200)' }}>
                {chrono.map((e) => {
                  const f = fillOf(e);
                  const th = ((e.cap ?? e.sold) / maxCap) * HC;
                  const on = drId === e.id;
                  const isHov = hov?.id === e.id;
                  const dim = (hov && !isHov) || (drId && !on && !hov);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => open(e.id)}
                      onMouseEnter={(ev) => setHv(e.id, ev.currentTarget)}
                      onMouseLeave={() => setHv(null)}
                      onFocus={(ev) => setHv(e.id, ev.currentTarget)}
                      onBlur={() => setHv(null)}
                      aria-label={`${label(e)} : ${n(e.sold)}${e.cap ? ` / ${n(e.cap)}` : ''}`}
                      style={{ flex: '1 1 0', minWidth: 0, maxWidth: 44, height: '100%', border: 0, background: 'none', padding: 0, display: 'flex', alignItems: 'flex-end', cursor: 'pointer', outline: 'none' }}
                    >
                      <span style={{ position: 'relative', display: 'block', width: '100%', height: Math.max(4, th), borderRadius: '10px 10px 3px 3px', background: 'var(--sand-100)', overflow: 'hidden', opacity: dim ? 0.45 : 1, transition: 'opacity 160ms' }}>
                        <span style={{
                          position: 'absolute', left: 0, right: 0, bottom: 0, height: `${((f ?? 1) * 100 * cc).toFixed(1)}%`, borderRadius: '10px 10px 3px 3px',
                          background: on || isHov ? 'var(--ink)' : f === null ? 'var(--sand-400)' : f >= 1 ? 'var(--gradient-brand)' : 'var(--red-500)',
                        }} />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap, height: 24, paddingTop: 6, boxSizing: 'border-box' }}>
                {chrono.map((e, i) => {
                  const m = tzMonth(locale, e.start_at, e.tz);
                  const pm = i ? tzMonth(locale, chrono[i - 1].start_at, chrono[i - 1].tz) : '';
                  return (
                    <span key={e.id} style={{ position: 'relative', flex: '1 1 0', minWidth: 0, maxWidth: 44 }}>
                      <span style={{ position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{m !== pm ? m : ''}</span>
                    </span>
                  );
                })}
              </div>
              {hov && (
                <div style={{
                  position: 'absolute', bottom: Math.round(((hov.cap ?? hov.sold) / maxCap) * HC + 34), left: hv?.x ?? 0, transform: 'translateX(-50%)',
                  pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 1, whiteSpace: 'nowrap', boxShadow: 'var(--shadow-md)', zIndex: 3,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tzWeek(locale, hov.start_at, hov.tz)}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{hov.title}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>
                    {hov.cap ? `${n(hov.sold)} / ${n(hov.cap)} · ${pct((fillOf(hov) ?? 0) * 100)}` : `${n(hov.sold)} · ${t('yc.ni.chart.noCap')}`}
                  </span>
                </div>
              )}
            </div>
            {best && worst && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', padding: '14px 18px', borderRadius: 18, background: 'var(--sand-50)', fontSize: 14.5, lineHeight: 1.5 }}>
                {[['yc.ni.best', best], ['yc.ni.worst', worst]].map(([k, e]) => {
                  const ev = e as NightRow;
                  return (
                    <span key={k as string}>
                      {t(k as string)}{' '}
                      <Hv as="button" type="button" onClick={() => open(ev.id)} style={{ border: 0, background: 'none', padding: 0, fontWeight: 600, color: 'var(--ink)', textDecoration: 'underline', textDecorationColor: 'var(--sand-300)', textUnderlineOffset: 3, cursor: 'pointer', font: 'inherit' }} hover={{ textDecorationColor: 'var(--red-500)' }}>
                        {label(ev)}
                      </Hv>{' '}
                      <span style={{ color: 'var(--sand-500)' }}>({pct((fillOf(ev) ?? 0) * 100)})</span>
                    </span>
                  );
                })}
              </div>
            )}
          </section>

          {/* Liste */}
          <section style={{
            boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff',
            boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', animation: `yc-row 800ms ${EASE} 560ms both`,
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 20px' }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{tp('yc.ni.pa.count', rows.length, { n: n(rows.length), m: months })}</h2>
                <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.ni.pa.listSub')}</div>
              </div>
              <SearchField value={q} onChange={setQ} placeholder={t('yc.ni.search')} />
            </div>
            <div style={{ overflowX: 'auto', margin: '0 -6px', padding: '0 6px' }}>
              <div style={{ minWidth: 980, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: ROW_GRID, gap: 16, padding: '0 14px 10px', borderBottom: '1px solid var(--sand-100)' }}>
                  {head('date', t('yc.ni.col.night'))}
                  {head('sold', t('yc.ni.col.sold'))}
                  {head('ca', t('yc.ni.col.ca'))}
                  {head('nw', t('yc.ni.col.new'))}
                  {head('gl', t('yc.gl.col'))}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{t('yc.ni.col.verdict')}</span>
                  <span />
                </div>
                {rows.length === 0 && <div style={{ padding: '36px 14px', textAlign: 'center', fontSize: 15, color: 'var(--sand-600)' }}>{t('yc.ni.pa.none', { q })}</div>}
                {shown.map((e, i) => {
                  const f = fillOf(e);
                  const k = pastKind(e);
                  const go = () => open(e.id);
                  return (
                    <Hv
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      className="yc-focus-ring"
                      onClick={go}
                      onKeyDown={(ev: React.KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } }}
                      style={{
                        display: 'grid', gridTemplateColumns: ROW_GRID, gap: 16, alignItems: 'center', padding: '12px 14px', marginTop: 2, borderRadius: 18,
                        background: drId === e.id ? 'var(--red-50)' : 'transparent', cursor: 'pointer', outline: 'none',
                        animation: `yc-row 600ms ${EASE} ${Math.min(560 + i * 45, 1100)}ms both`, transition: 'background 160ms',
                      }}
                      hover={{ background: drId === e.id ? 'var(--red-50)' : 'var(--sand-50)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                        <DateTile month={tzMonth(locale, e.start_at, e.tz)} day={tzDay(e.start_at, e.tz)} muted />
                        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <b style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</b>
                          <span style={{ fontSize: 13.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[tzWeek(locale, e.start_at, e.tz), e.city || e.street].filter(Boolean).join(' · ')}</span>
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
                        <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {n(e.sold * cc)}{e.cap ? <span style={{ fontWeight: 400, color: 'var(--sand-500)' }}> / {n(e.cap)}</span> : null}
                        </span>
                        {f !== null && (
                          <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${(f * 100 * cc).toFixed(1)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} />
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{eur(e.revenue)}</span>
                      <span style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{n(e.new_buyers)}</span>
                      <GlCell gl={e.gl ?? null} onOpen={() => open(e.id, 'gl')} />
                      <StatusPill past={k}>{t(PA_KEY[k])}</StatusPill>
                      <Icon name="chevronRight" size={18} stroke={2.2} color="var(--sand-400)" />
                    </Hv>
                  );
                })}
              </div>
            </div>
            {rest > 0 && (
              <Hv
                as="button"
                type="button"
                onClick={() => setLim(lim + 8)}
                style={{ alignSelf: 'center', height: 44, padding: '0 22px', borderRadius: 99, border: '1px solid var(--sand-300)', background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer', transition: `translate 240ms ${EASE},box-shadow 240ms` }}
                hover={{ translate: '0 -2px', boxShadow: 'var(--shadow-md)' }}
              >
                {t('yc.ni.pa.more', { n: Math.min(8, rest), r: rest })}
              </Hv>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** Colonne Guest list : venus / inscrits et taux de venue (porte scannée), sinon les inscrits. */
function GlCell({ gl, onOpen }: { gl: NightRow['gl'] | null; onOpen: () => void }) {
  const { t, n, pct } = useCrmT();
  if (!gl) return <span style={{ fontSize: 14, color: 'var(--sand-400)' }}>—</span>;
  const r = gl.scan_known && gl.entries > 0 ? (gl.came / gl.entries) * 100 : null;
  return (
    <Hv
      as="button"
      type="button"
      onClick={(ev: React.MouseEvent) => { ev.stopPropagation(); onOpen(); }}
      title={t('yc.gl.row.open')}
      style={{ justifySelf: 'start', minWidth: 0, border: 0, background: 'none', padding: '2px 6px', margin: '-2px -6px', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}
      hover={{ background: 'var(--sand-100)' }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {r !== null ? <>{n(gl.came)}<span style={{ fontWeight: 400, color: 'var(--sand-500)' }}> / {n(gl.entries)}</span></> : n(gl.entries)}
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>{r !== null ? t('yc.gl.row.showup', { pct: pct(r) }) : t('yc.gl.row.entries')}</span>
    </Hv>
  );
}
