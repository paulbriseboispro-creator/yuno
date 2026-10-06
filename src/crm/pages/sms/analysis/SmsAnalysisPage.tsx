/**
 * SMS · Analyse (maquette « SMS Analyse.dc.html ») : `/crm/sms/analysis`.
 *
 * Sur les SMS partis des 12 derniers mois (crm_sms_analysis) : le groupe qui
 * réagit le plus, le meilleur moment, ce qu'il faut surveiller, les SMS qui
 * ont le mieux vendu, à qui écrire, ce que rapportent 10 000 Yunits, quand
 * envoyer, qui se désabonne. Sans accès à l'argent, les ventes deviennent des
 * achats.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Skel } from '@/crm/ui/kit';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { EASE, useProgress } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { useCrmShell } from '@/crm/data/shell';
import { useSmsAnalysis, useSmsCampaigns, useSmsSettings, type SmsAnalysisRow } from '@/crm/data/sms';
import { audienceLabel, rate } from '@/crm/lib/emails';
import { inQuiet, smsCost } from '@/crm/lib/sms';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SmsShell } from '../SmsShell';

const enter = (d: number) => ({ animation: `yc-rise 800ms ${EASE} ${d}ms both` });
/** Tranches horaires de la carte, coupées aux heures calmes du compte. */
const EDGES = [8, 10, 12, 14, 17, 20, 22];
function bandsFor(quietTo: number, quietFrom: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < EDGES.length - 1; i++) {
    const a = Math.max(EDGES[i], quietTo), b = Math.min(EDGES[i + 1], quietFrom);
    if (b > a) out.push([a, b]);
  }
  return out.length ? out : [[EDGES[0], EDGES[EDGES.length - 1]]];
}
const STOP_ALERT = 1; // pour 100 SMS
const COLS = 'minmax(160px,1.3fr) minmax(180px,2fr) 64px 64px 64px';

export default function SmsAnalysisPage() {
  const T = useCrmT();
  const { t, tp, n, eur, eur2, pct, dShort, locale } = T;
  const caps = useCrmCaps();
  const shell = useCrmShell();
  const settings = useSmsSettings();
  const q = useSmsAnalysis();
  const camps = useSmsCampaigns();
  const g = useProgress(1200, 500, q.data ? 'ok' : 'wait', !!q.data);
  const narrow = useNarrow(720);
  const rows = q.data?.campaigns ?? [];
  const money = caps.money && rows.every((r) => r.revenue !== null);
  const smsRate = Number(shell.data?.wallet.rates?.sms ?? 35);
  const emailRate = Number(shell.data?.wallet.rates?.email ?? 1);
  const drafts = (camps.data?.campaigns ?? []).filter((c) => c.status === 'draft').length;
  const qf = settings.data?.quiet_from ?? 20, qt = settings.data?.quiet_to ?? 8, noSun = settings.data?.no_sunday ?? true;

  const BANDS = useMemo(() => bandsFor(qt, qf), [qt, qf]);
  const label = (r: SmsAnalysisRow) => audienceLabel(r.audiences, t) ?? t('yc.em.aud.none');
  const value = (r: { revenue: number | null; purchases: number; n: number }) => (money ? Number(r.revenue ?? 0) / Math.max(1, r.n) : (r.purchases / Math.max(1, r.n)) * 100);
  const fmtV = (v: number) => (money ? eur2(v) : t('yc.sm.an.per100', { n: n(v) }));

  const ranked = [...rows].sort((a, b) => value(b) - value(a));
  const topV = Math.max(0.0001, ...ranked.map(value));
  const groupMap = new Map<string, { label: string; n: number; d: number; c: number; p: number }>();
  for (const r of rows) {
    const l = label(r);
    const x = groupMap.get(l) ?? { label: l, n: 0, d: 0, c: 0, p: 0 };
    x.n += r.n; x.d += r.delivered; x.c += r.clicked; x.p += r.purchases;
    groupMap.set(l, x);
  }
  const groups = [...groupMap.values()].map((x) => ({ ...x, r: x.d ? x.c / x.d : 0 })).sort((a, b) => b.r - a.r);
  const grid = new Map<string, { d: number; c: number }>();
  for (const r of rows) {
    const bi = BANDS.findIndex(([a, b]) => r.hour >= a && r.hour < b);
    if (bi < 0) continue;
    const key = `${(r.dow + 6) % 7}-${bi}`;
    const x = grid.get(key) ?? { d: 0, c: 0 };
    x.d += r.delivered; x.c += r.clicked;
    grid.set(key, x);
  }
  let bestCell: { key: string; r: number } | null = null;
  for (const [key, v] of grid) { const r0 = v.d ? v.c / v.d : 0; if (!bestCell || r0 > bestCell.r) bestCell = { key, r: r0 }; }
  const tot = rows.reduce((a, r) => ({ n: a.n + r.n, d: a.d + r.delivered, c: a.c + r.clicked, p: a.p + r.purchases, v: a.v + Number(r.revenue ?? 0), units: a.units + r.n * r.parts }), { n: 0, d: 0, c: 0, p: 0, v: 0, units: 0 });
  const worstStop = [...rows].filter((r) => r.n >= 30).sort((a, b) => b.stop / b.n - a.stop / a.n)[0] ?? null;

  const wday = (i: number) => new Date(2026, 0, 5 + i).toLocaleDateString(locale, { weekday: 'long' });
  const wshort = (i: number) => new Date(2026, 0, 5 + i).toLocaleDateString(locale, { weekday: 'short' });
  const bandL = (bi: number) => t('yc.sm.an.band', { a: BANDS[bi][0], b: BANDS[bi][1] });
  const title = <>{t('yc.sm.an.h.a')}<span className="yc-accent-word">{t('yc.sm.an.h.b')}</span>{t('yc.sm.an.h.c')}</>;

  if (!q.data) return <SmsShell tab="analysis" title={title} sub={t('yc.sm.an.subEmpty')} drafts={drafts}>{q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /> : <Skel h={520} r={28} />}</SmsShell>;
  if (rows.length === 0) {
    return (
      <SmsShell tab="analysis" title={title} sub={t('yc.sm.an.subEmpty')} drafts={drafts}>
        <section style={{ padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <YunitFace mood="endormi" size={56} />
          <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22 }}>{t('yc.sm.an.empty.t')}</b>
          <span style={{ fontSize: 14.5, color: 'var(--sand-500)', maxWidth: 420 }}>{t('yc.sm.an.empty.s')}</span>
        </section>
      </SmsShell>
    );
  }

  const bestG = groups[0], worstG = groups[groups.length - 1];
  const [bd, bb] = bestCell ? bestCell.key.split('-').map(Number) : [null, null];
  // 10 000 Yunits rapportés à ce qu'ont coûté tous les envois (parties comprises).
  const k10 = tot.units > 0 ? 10000 / (tot.units * smsRate) : 0;
  const per10k = tot.n * k10;
  const stopRow = worstStop && worstStop.stop / worstStop.n * 100 >= STOP_ALERT * 0.5 ? worstStop : null;

  return (
    <SmsShell tab="analysis" title={title} sub={tp('yc.sm.an.sub', rows.length, { n: rows.length })} drafts={drafts} hideNew>
      {/* Trois réponses */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 14, ...enter(400) }}>
        <Insight dark k={t('yc.sm.an.q1')} title={bestG?.label ?? '—'} text={bestG && worstG && groups.length > 1 ? t('yc.sm.an.q1s', { a: pct(bestG.r * 100), b: pct(worstG.r * 100), g: worstG.label.toLowerCase() }) : t('yc.sm.an.q1one', { a: pct((bestG?.r ?? 0) * 100) })} />
        <Insight k={t('yc.sm.an.q2')} title={bd !== null && bb !== null ? t('yc.sm.an.slot', { day: wday(bd).replace(/^\w/, (c) => c.toUpperCase()), band: bandL(bb) }) : '—'} text={bestCell ? t('yc.sm.an.q2s', { p: pct(bestCell.r * 100) }) : t('yc.sm.an.few')} />
        {stopRow ? (
          <Insight alert k={t('yc.sm.an.q3')} title={t('yc.sm.an.q3t', { g: label(stopRow).toLowerCase() })} text={t('yc.sm.an.q3s', { p: pct((stopRow.stop / stopRow.n) * 100, 1), name: stopRow.name ?? '' })} />
        ) : (
          <Insight k={t('yc.sm.an.q3')} title={t('yc.sm.an.q3ok')} text={t('yc.sm.an.q3oks')} />
        )}
      </div>

      {/* Quels SMS ont le mieux vendu ? */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(480) }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.an.best.t')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t(money ? 'yc.sm.an.best.s' : 'yc.sm.an.best.sN')}</div>
        </div>
        {narrow ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {ranked.map((r, i) => {
              const sr = r.n ? (r.stop / r.n) * 100 : 0;
              return (
                <Hv key={r.id} as={Link} to={CRM_ROUTES.smsResults(r.id)} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 0', borderTop: i ? '1px solid var(--sand-100)' : 'none', color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--ink)', textDecoration: 'none' }}>
                  <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <b style={{ fontSize: 14.5, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name || t('yc.sm.untitled')}</b>
                    <b style={{ flex: 'none', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{fmtV(value(r))}</b>
                  </span>
                  <span style={{ height: 10, width: `${Math.max(3, (value(r) / topV) * 100 * g)}%`, borderRadius: 99, background: i === 0 ? 'var(--gradient-brand)' : 'var(--red-200)' }} />
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>
                    {dShort(r.sent_at)} · {label(r)} · {t('yc.sm.an.rowMeta', { c: pct((rate(r.clicked, r.delivered) ?? 0) * 100), p: n(r.purchases) })} · <span style={{ color: sr >= STOP_ALERT ? 'var(--red-600)' : 'inherit', fontWeight: sr >= STOP_ALERT ? 600 : 400 }}>{pct(sr, 1)} STOP</span>
                  </span>
                </Hv>
              );
            })}
          </div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>
              <span>{t('yc.sm.an.col.sms')}</span><span>{t(money ? 'yc.sm.an.col.per' : 'yc.sm.an.col.perN')}</span><span style={{ textAlign: 'right' }}>{t('yc.sm.an.col.clicks')}</span><span style={{ textAlign: 'right' }}>{t('yc.sm.an.col.buys')}</span><span style={{ textAlign: 'right' }}>STOP</span>
            </div>
            {ranked.map((r, i) => {
              const sr = r.n ? (r.stop / r.n) * 100 : 0;
              return (
                <Hv key={r.id} as={Link} to={CRM_ROUTES.smsResults(r.id)}
                  style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '12px 10px', borderRadius: 14, color: 'var(--ink)', textDecoration: 'none', background: 'transparent' }}
                  hover={{ color: 'var(--ink)', textDecoration: 'none', background: 'var(--sand-50)' }}>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <b style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name || t('yc.sm.untitled')}</b>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dShort(r.sent_at)} · {label(r)}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ height: 14, width: `${Math.max(3, (value(r) / topV) * 82 * g)}%`, borderRadius: 99, background: i === 0 ? 'var(--gradient-brand)' : 'var(--red-200)' }} />
                    <b style={{ fontSize: 14.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtV(value(r))}</b>
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{pct((rate(r.clicked, r.delivered) ?? 0) * 100)}</span>
                  <span style={{ textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{n(r.purchases)}</span>
                  <span style={{ textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: sr >= STOP_ALERT ? 'var(--red-600)' : 'var(--ink)', fontWeight: sr >= STOP_ALERT ? 600 : 400 }}>{pct(sr, 1)}</span>
                </Hv>
              );
            })}
          </div>
        )}
      </section>

      {/* À qui écrire ? · Que rapportent 10 000 Yunits ? */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(540) }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.an.who.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sm.an.who.s')}</div>
          </div>
          {groups.map((x, i) => (
            <div key={x.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <b style={{ fontSize: 14.5 }}>{x.label}</b>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.sm.an.who.meta', x.p, { n: n(x.n), p: n(x.p) })}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 14, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                  <div style={{ width: `${(x.r / Math.max(0.0001, groups[0].r)) * 100 * g}%`, height: '100%', borderRadius: 99, background: i === 0 ? 'var(--gradient-brand)' : 'var(--red-200)' }} />
                </div>
                <b style={{ width: 52, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17 }}>{pct(x.r * 100)}</b>
              </div>
            </div>
          ))}
        </section>
        <section style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(600) }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.an.k.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sm.an.k.s', { n: n(per10k) })}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 56, letterSpacing: '-.05em', lineHeight: 1 }}>{money ? eur(tot.v * k10 * g) : n(tot.p * k10 * g)}</b>
            <span style={{ fontSize: 15, color: 'var(--sand-500)' }}>{t(money ? 'yc.sm.an.k.sales' : 'yc.sm.an.k.buys')}</span>
          </div>
          {(() => {
            const sms10 = per10k, c10 = tot.c * k10, p10 = tot.p * k10;
            return (
              <>
                <div style={{ display: 'flex', height: 30, borderRadius: 10, overflow: 'hidden', background: 'var(--sand-100)' }}>
                  <div style={{ width: `${Math.min(100, sms10 ? (c10 / sms10) * 100 : 0)}%`, minWidth: 60, background: 'var(--gradient-brand)', color: '#fff', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', paddingLeft: 10, whiteSpace: 'nowrap' }}>{t('yc.sm.an.k.clicks', { n: n(c10) })}</div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.sm.an.k.noClick')}</div>
                </div>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.sm.an.k.line', { s: n(sms10), c: n(c10), p: n(p10) })}</span>
              </>
            );
          })()}
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderRadius: 14, background: 'var(--red-50)', fontSize: 14, lineHeight: 1.45 }}>
            <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)', marginTop: 6 }} />
            {t('yc.sm.an.k.note', { y: n(smsCost(1, 1, smsRate)), e: n(emailRate) })}
          </div>
        </section>
      </div>

      {/* Quand les envoyer ? */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(660) }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.an.when.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sm.an.when.s')}</div>
          </div>
          {rows.length < 12 && <span style={{ height: 26, padding: '0 11px', borderRadius: 99, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{tp('yc.sm.an.when.trend', rows.length, { n: rows.length })}</span>}
        </div>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: `${narrow ? 34 : 52}px repeat(${BANDS.length},minmax(0,1fr))`, gap: narrow ? 4 : 6 }}>
            <span />
            {BANDS.map((_, bi) => <span key={bi} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: narrow ? 9.5 : 11, whiteSpace: 'nowrap', color: 'var(--sand-400)' }}>{bandL(bi)}</span>)}
            {Array.from({ length: 7 }, (_, d) => (
              <div key={d} style={{ display: 'contents' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: narrow ? 9.5 : 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-400)', alignSelf: 'center' }}>{wshort(d)}</span>
                {BANDS.map(([a], bi) => {
                  const off = (noSun && d === 6) || inQuiet(a, qf, qt);
                  const c = grid.get(`${d}-${bi}`);
                  const r0 = c && c.d ? c.c / c.d : null;
                  const isBest = bestCell?.key === `${d}-${bi}`;
                  return (
                    <span key={bi} title={r0 !== null ? pct(r0 * 100) : ''} style={{ height: narrow ? 34 : 38, borderRadius: narrow ? 8 : 10, display: 'grid', placeItems: 'center', fontSize: narrow ? 11 : 12.5, fontWeight: 600, background: off ? 'repeating-linear-gradient(135deg,var(--sand-50) 0 6px,var(--sand-100) 6px 12px)' : r0 === null ? 'var(--sand-50)' : `color-mix(in srgb,var(--red-500) ${Math.round(18 + Math.min(1, r0 / Math.max(0.01, bestCell?.r ?? 0.01)) * 62)}%,#fff)`, color: off || r0 === null ? 'var(--sand-400)' : '#fff', boxShadow: isBest ? 'inset 0 0 0 2px var(--ink)' : 'none' }}>
                      {off ? '—' : r0 === null ? '' : pct(r0 * 100)}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
          <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
          <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500 }}>{bestCell && bd !== null && bb !== null ? t('yc.sm.an.when.best', { day: wday(bd), band: bandL(bb), p: pct(bestCell.r * 100) }) : t('yc.sm.an.few')}</span>
        </div>
      </section>

      {/* Qui se désabonne ? */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(720) }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sm.an.stop.t')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sm.an.stop.s', { p: pct(STOP_ALERT) })}</div>
        </div>
        {[...rows].sort((a, b) => b.stop / Math.max(1, b.n) - a.stop / Math.max(1, a.n)).map((r) => {
          const sr = r.n ? (r.stop / r.n) * 100 : 0;
          return (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,190px) 1fr 54px', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <div style={{ position: 'relative', height: 10, borderRadius: 99, background: 'var(--sand-100)' }}>
                <div style={{ width: `${Math.min(100, (sr / (STOP_ALERT * 2)) * 100 * g)}%`, height: '100%', borderRadius: 99, background: sr >= STOP_ALERT ? 'var(--red-500)' : 'var(--green-500)' }} />
                <span style={{ position: 'absolute', left: '50%', top: -4, bottom: -4, borderLeft: '1.5px dashed var(--sand-400)' }} />
              </div>
              <b style={{ textAlign: 'right', fontSize: 13.5, color: sr >= STOP_ALERT ? 'var(--red-600)' : 'var(--ink)' }}>{pct(sr, 1)}</b>
            </div>
          );
        })}
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.sm.an.stop.legend', { a: pct(STOP_ALERT), b: pct(STOP_ALERT * 2) })}</span>
      </section>
    </SmsShell>
  );
}

function Insight({ k, title, text, dark, alert }: { k: string; title: string; text: string; dark?: boolean; alert?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '22px 22px', borderRadius: 22, background: dark ? 'var(--night)' : alert ? 'var(--red-50)' : '#fff', color: dark ? 'var(--text-on-night)' : alert ? 'var(--red-800)' : 'var(--ink)', boxShadow: dark ? 'none' : `inset 0 0 0 1px ${alert ? 'var(--red-200)' : 'var(--sand-200)'}`, minHeight: 150 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: dark ? 'var(--text-on-night-2)' : alert ? 'var(--red-700)' : 'var(--sand-500)' }}>{k}</span>
      <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' }}>{title}</b>
      <span style={{ fontSize: 14, lineHeight: 1.45, color: dark ? 'var(--text-on-night-2)' : alert ? 'var(--red-700)' : 'var(--sand-600)', textWrap: 'pretty' }}>{text}</span>
    </div>
  );
}
