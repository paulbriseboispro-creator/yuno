/**
 * Les quatre chiffres de l'accueil : clients, habitués, taux de conversion du
 * dernier envoi, joignables — chacun avec sa ligne de définition.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { clamp01, reveal, wipe } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { CrmHome } from '@/crm/data/home';

function Card({ children, intro, delay }: { children: ReactNode; intro: boolean; delay: number }) {
  return (
    <Hv
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)', minWidth: 0, ...reveal(intro, delay) }}
      hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
    >
      {children}
    </Hv>
  );
}

const label: CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' };
const value = (empty: boolean): CSSProperties => ({ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 44, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', color: empty ? 'var(--sand-300)' : 'var(--ink)' });
const delta = (color: string): CSSProperties => ({ fontSize: 13, fontWeight: 600, color });
const def: CSSProperties = { fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)' };

export function KpiCards({ data, intro, cc }: { data: CrmHome | undefined; intro: boolean; cc: number }) {
  const { t, n, pct, n1 } = useCrmT();
  const k = data?.kpi;
  const empty = !k || k.clients.total === 0;
  const G = 'var(--green-700)';
  const kop = empty ? 0.3 : 1;

  // Clients : courbe des 14 derniers jours.
  const spark = k?.clients.spark ?? [];
  const lo = spark.length ? Math.min(...spark) : 0;
  const hi = spark.length ? Math.max(...spark) : 1;
  const span = Math.max(1, hi - lo);
  const pts = spark.map((v, i) => `${((i / Math.max(1, spark.length - 1)) * 100).toFixed(1)} ${(32 - ((v - lo) / span) * 28).toFixed(1)}`);
  const clientsPath = pts.length ? 'M' + pts.join(' L') : '';

  // Habitués : six instantanés mensuels.
  const bars = k?.regulars.bars ?? [];
  const bmin = bars.length ? Math.min(...bars) : 0;
  const bmax = bars.length ? Math.max(...bars) : 1;
  const brange = Math.max(1, bmax - bmin);

  // Conversion du dernier envoi.
  const conv = k?.conversion?.[0] ?? null;
  const prevConv = k?.conversion?.[1] ?? null;
  const cpct = conv?.pct ?? null;
  const cdelta = cpct !== null && prevConv?.pct !== null && prevConv?.pct !== undefined ? cpct - prevConv.pct : null;

  // Joignables.
  const r = k?.reach;
  const rtot = Math.max(1, r?.total ?? 0);
  const rp = r ? Math.round((r.reachable / rtot) * 100) : 0;
  const w = (x: number) => `${((x / rtot) * 100).toFixed(1)}%`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
      <Card intro={intro} delay={400}>
        <span style={label}>{t('yc.home.kpi.clients')}</span>
        <span style={value(empty)}>{empty ? '—' : n((k?.clients.total ?? 0) * cc)}</span>
        <span style={delta(empty ? 'var(--sand-500)' : (k?.clients.today ? G : 'var(--sand-500)'))}>
          {empty ? t('yc.home.kpi.afterSync') : k?.clients.today ? t('yc.home.kpi.today', { n: n(k.clients.today) }) : t('yc.home.kpi.nothingToday')}
        </span>
        <div style={{ marginTop: 8, opacity: kop, clipPath: wipe(clamp01(cc * 1.2)) }}>
          <svg viewBox="0 0 100 34" width="100%" height="48" preserveAspectRatio="none" aria-hidden="true">
            {clientsPath && <path d={`${clientsPath} L100 34 L0 34 Z`} fill="var(--red-50)" stroke="none" />}
            {clientsPath && <path d={clientsPath} fill="none" stroke="var(--red-500)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
          </svg>
        </div>
        <span style={def}>{t('yc.home.kpi.clientsDef')}</span>
      </Card>

      <Card intro={intro} delay={490}>
        <span style={label}>{t('yc.home.kpi.regulars')}</span>
        <span style={value(empty)}>{empty ? '—' : n((k?.regulars.total ?? 0) * cc)}</span>
        <span style={delta(empty ? 'var(--sand-500)' : (k?.regulars.month_delta ?? 0) > 0 ? G : (k?.regulars.month_delta ?? 0) < 0 ? 'var(--red-600)' : 'var(--sand-500)')}>
          {empty ? t('yc.home.kpi.afterSync')
            : (k?.regulars.month_delta ?? 0) > 0 ? t('yc.home.kpi.month', { n: n(k?.regulars.month_delta ?? 0) })
              : (k?.regulars.month_delta ?? 0) < 0 ? t('yc.home.kpi.monthDown', { n: n(-(k?.regulars.month_delta ?? 0)) })
                : t('yc.home.kpi.monthFlat')}
        </span>
        <div style={{ marginTop: 8, height: 48, display: 'flex', alignItems: 'flex-end', gap: 6, opacity: kop }}>
          {(bars.length ? bars : [0, 0, 0, 0, 0, 0]).map((v, i, arr) => (
            <div key={i} style={{
              flex: 1, borderRadius: '4px 4px 0 0',
              height: `${((30 + ((v - bmin) / brange) * 70) * clamp01(cc * 1.5 - i * 0.14)).toFixed(0)}%`,
              background: i === arr.length - 1 ? 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))' : 'var(--red-100)',
            }} />
          ))}
        </div>
        <span style={def}>{t('yc.home.kpi.regularsDef', { n: k?.regulars.min_nights ?? 3, m: k?.regulars.window_months ?? 6 })}</span>
      </Card>

      <Card intro={intro} delay={580}>
        <span style={label}>{t('yc.home.kpi.conversion')}</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={value(cpct === null)}>{cpct === null ? '—' : pct(Math.round(cpct * cc))}</span>
          <div style={{ position: 'relative', flex: 'none', width: 56, height: 56, borderRadius: '50%', background: `conic-gradient(var(--red-500) 0 ${((cpct ?? 0) * 3.6 * cc).toFixed(1)}deg,var(--red-100) 0)`, opacity: cpct === null ? 0.3 : 1 }}>
            <span style={{ position: 'absolute', inset: 9, borderRadius: '50%', background: '#fff' }} />
          </div>
        </div>
        <span style={delta(cpct === null ? 'var(--sand-500)' : cdelta === null ? 'var(--sand-500)' : cdelta >= 0 ? G : 'var(--red-600)')}>
          {cpct === null ? t('yc.home.kpi.convEmpty')
            : cdelta === null ? t('yc.home.kpi.convFirst')
              : cdelta >= 0 ? t('yc.home.kpi.convUp', { pts: n1(Math.abs(cdelta)) })
                : t('yc.home.kpi.convDown', { pts: n1(Math.abs(cdelta)) })}
        </span>
        <span style={{ ...def, marginTop: 8 }}>{conv ? t('yc.home.kpi.conversionDef', { name: conv.name }) : '\u00a0'}</span>
      </Card>

      <Card intro={intro} delay={670}>
        <span style={label}>{t('yc.home.kpi.reachable')}</span>
        <span style={value(empty)}>{empty ? '—' : pct(Math.round(rp * cc))}</span>
        <span style={delta(empty ? 'var(--sand-500)' : G)}>
          {empty ? t('yc.home.kpi.afterSync') : t('yc.home.kpi.reachOf', { a: n(r?.reachable ?? 0), b: n(r?.total ?? 0) })}
        </span>
        <div style={{ marginTop: 8, opacity: kop }}>
          <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 99, overflow: 'hidden', clipPath: `inset(0 ${((1 - clamp01(cc * 1.2)) * 100).toFixed(1)}% 0 0)` }}>
            {r && r.both > 0 && <div style={{ width: w(r.both), background: 'var(--gradient-brand)' }} />}
            {r && r.email_only > 0 && <div style={{ width: w(r.email_only), background: r.both > 0 ? 'var(--red-300)' : 'var(--gradient-brand)' }} />}
            {r && r.sms_only > 0 && <div style={{ width: w(r.sms_only), background: 'var(--red-100)' }} />}
            <div style={{ flex: 1, background: 'var(--sand-200)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 12, color: 'var(--sand-500)' }}>
            <span>{r && r.both > 0 ? t('yc.home.kpi.reachBoth', { pct: pct(Math.round((r.both / rtot) * 100)) }) : t('yc.home.kpi.reachEmail', { pct: pct(r ? Math.round(((r.email_only + r.both) / rtot) * 100) : 0) })}</span>
            <span>{t('yc.home.kpi.reachNone', { pct: pct(r ? Math.round((r.none / rtot) * 100) : 0) })}</span>
          </div>
        </div>
        <span style={def}>{t('yc.home.kpi.reachableDef')}</span>
      </Card>
    </div>
  );
}
