/**
 * Yuno Tickets › Analyses › Trafic, le détail (lot 4 du plan combiné,
 * migration 20261109340000, `tix_ana_traffic_detail`) : la page du club / de
 * l'organisateur (onglet Trafic) et les liens suivis rangés sous leur source
 * (Ventes › Ce qui a fait vendre).
 */
import type { CSSProperties } from 'react';
import { useTixT } from '@/tickets/analytics/i18n';
import type { AnaMeta, TixPageTraffic, TixTrafficLink } from '@/tickets/analytics/data';
import { CardHead, Fill, TrendChart, bucketTitle, card, fadeIn, xLabels } from './anaUi';
import { deltaPct, jLabelFor } from './SalesTab';

/** Sous 10, un pourcentage ne veut rien dire : l'écran montre les nombres. */
const MIN_SAMPLE = 10;
const REF_KEYS = ['direct', 'social', 'paid_social', 'search', 'paid_search', 'email', 'affiliate', 'internal', 'referral', 'qr'];

const mono: CSSProperties = { fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' };

// ── La page du club / de l'organisateur ───────────────────────────────────

export function PageCard({ p, meta, cmp, rv, go, prog }: { p: TixPageTraffic; meta: AnaMeta; cmp: boolean; rv: boolean; go: boolean; prog: number }) {
  const T = useTixT();
  const { t, tp, n, pct } = T;
  const jl = jLabelFor(t);
  const d = cmp ? deltaPct(p.visits, p.prev_visits, T) : null;
  const top = Math.max(1, ...p.sources.map((s) => s.visits));
  const conv = p.visits >= MIN_SAMPLE ? (p.ordered / p.visits) * 100 : null;
  const stats = [
    { k: 'visitors', l: t('ya.tr.page.visitors'), v: n(p.visitors) },
    { k: 'returning', l: t('ya.tr.page.returning'), v: p.visits >= MIN_SAMPLE ? pct((p.returning / p.visits) * 100) : n(p.returning) },
    { k: 'ordered', l: t('ya.tr.page.ordered'), v: n(p.ordered), sub: conv !== null ? t('ya.tr.page.orderedPct', { pct: pct(conv, 1) }) : undefined },
  ];
  return (
    <section style={{ ...card, gap: 18, ...fadeIn(rv, 200) }}>
      <CardHead title={t(p.kind === 'venue' ? 'ya.tr.page.tVenue' : 'ya.tr.page.tOrg')} sub={t('ya.tr.page.sub')} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        <div style={{ flex: '1.4 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 20px' }}>
            <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{n(p.visits * prog)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 6 }}>
              <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{tp('ya.tr.page.visitsN', p.visits)}</span>
              {d && <span style={{ fontSize: 14, fontWeight: 600, color: d.up ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{`${d.text} ${t('ya.ana.vsBefore')}`}</span>}
            </span>
          </div>
          <TrendChart
            kind="bars"
            cur={p.series}
            prev={[]}
            showPrev={false}
            marks={[]}
            go={go}
            fy={(x) => n(x)}
            tipTitle={(i) => bucketTitle(meta, i, T, jl)}
            tipValue={(x) => tp('ya.tr.page.visitsNn', x, { n: n(x) })}
            xl={xLabels(meta, T, jl)}
            height={180}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 10 }}>
            {stats.map((s) => (
              <div key={s.k} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', borderRadius: 16, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }}>
                <span style={{ fontSize: 13, color: 'var(--ya-sand-600)' }}>{s.l}</span>
                <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{s.v}</b>
                {s.sub && <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{s.sub}</span>}
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={mono}>{t('ya.tr.page.from')}</span>
          {p.sources.length === 0 ? (
            <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t('ya.tr.page.none')}</span>
          ) : p.sources.map((s, i) => (
            <div key={s.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(96px,140px) minmax(0,1fr) 56px', gap: 12, alignItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: 'var(--ya-sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`ya.tr.ref.${REF_KEYS.includes(s.k) ? s.k : 'other'}`)}</span>
              <Fill pct={(s.visits / top) * 100} go={go} delay={i * 70} h={10} bg={i === 0 ? 'var(--ya-gradient-brand)' : 'var(--ya-sand-400)'} dur={800} />
              <b style={{ textAlign: 'right' }}>{n(s.visits)}</b>
            </div>
          ))}
          {p.next && p.next.length > 0 && (
            <>
              <span style={{ ...mono, marginTop: 10 }}>{t('ya.tr.page.next')}</span>
              {p.next.map((x) => (
                <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--ya-sand-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title} · {T.dShort(x.start_at)}</span>
                  <b>{n(x.n)}</b>
                </div>
              ))}
              <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('ya.tr.page.nextFoot')}</span>
            </>
          )}
        </div>
      </div>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.tr.page.foot')}</span>
    </section>
  );
}

// ── Les liens d'une source ────────────────────────────────────────────────

/** Nom lisible d'un lien : son nom, sinon son réseau et son emplacement, sinon « lien de co-soirée ». */
function linkName(l: TixTrafficLink, t: (k: string) => string): string {
  if (l.placement === 'party_link') return l.label ?? t('ya.tr.link.party');
  if (l.label && l.label.toLowerCase() !== (l.network ?? '').toLowerCase()) return l.label;
  const net = l.network ? t(`ya.tr.net.${['instagram', 'tiktok', 'whatsapp', 'newsletter', 'facebook', 'sms', 'email'].includes(l.network) ? l.network : 'other'}`) : t('ya.tr.link.link');
  return l.placement && !['partner_link', 'party_link'].includes(l.placement) ? `${net} · ${l.placement.replace(/_/g, ' ')}` : net;
}

export function SourceLinks({ links, money }: { links: TixTrafficLink[]; money: boolean }) {
  const T = useTixT();
  const { t, tp, n, eur, dShort } = T;
  return (
    <div style={{ margin: '2px 10px 10px 30px', padding: '6px 0', borderLeft: '2px solid var(--ya-sand-100)', display: 'flex', flexDirection: 'column' }}>
      {links.map((l) => (
        <div key={l.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 80px 90px 110px', gap: 12, alignItems: 'center', padding: '8px 0 8px 16px', fontSize: 13.5, fontVariantNumeric: 'tabular-nums', opacity: l.archived ? 0.55 : 1 }}>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkName(l, t)}</b>
            <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.event_title ? `${l.event_title} · ${dShort(l.event_start ?? '')}` : t(l.target === 'venue' ? 'ya.tr.link.toVenue' : 'ya.tr.link.toPage')}
            </span>
          </span>
          <span style={{ textAlign: 'right', color: 'var(--ya-sand-600)' }}>{tp('ya.ana.t.clicksN', l.clicks, { n: n(l.clicks) })}</span>
          <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{tp('ya.tr.ordersN', l.orders, { n: n(l.orders) })}</span>
          <b style={{ textAlign: 'right' }}>{money ? eur(Number(l.revenue ?? 0)) : tp('ya.pa.placesN', l.tickets, { n: n(l.tickets) })}</b>
        </div>
      ))}
    </div>
  );
}
