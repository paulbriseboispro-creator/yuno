/**
 * Yuno Tickets › Analyses › Trafic, le détail (lot 4 du plan combiné,
 * migration 20261109340000, `tix_ana_traffic_detail`) : la page du club / de
 * l'organisateur, les liens suivis rangés sous leur source, et les e-mails /
 * push avec ce qui s'est vendu dans les 7 jours après un clic.
 */
import { useState, type CSSProperties } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useTixT } from '@/tickets/analytics/i18n';
import type { AnaMeta, TixPageTraffic, TixTrafficLink, TixTrafficMessage, AnaTrafficDetail } from '@/tickets/analytics/data';
import { CardHead, Fill, Sk, TrendChart, bucketTitle, card, fadeIn, xLabels } from './anaUi';
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

// ── E-mails et push ───────────────────────────────────────────────────────

export function MessagesCard({ d, money, loading, rv, go }: { d: AnaTrafficDetail | undefined; money: boolean; loading: boolean; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, tp, n, eur, pct, dShort } = T;
  const all = d?.messages ?? [];
  const [more, setMore] = useState(false);
  const rows = more ? all : all.slice(0, 8);
  const val = (x: TixTrafficMessage) => (money ? Number(x.revenue ?? 0) : x.orders);
  const top = Math.max(1, ...rows.map(val));
  const tot = d?.messages_total;
  const grid = 'minmax(210px,1.8fr) 84px 92px 92px 84px minmax(130px,1.1fr)';
  const name = (x: TixTrafficMessage) => (x.channel === 'email' && x.recipe
    ? t('ya.tr.msg.recipe', { name: t(`em.auto.kind.${x.recipe}.title`) })
    : x.name ?? '—');
  const rate = (k: number, of: number) => (of >= MIN_SAMPLE ? pct((k / of) * 100) : null);
  return (
    <section style={{ ...card, gap: 16 }}>
      <CardHead title={t('ya.tr.msg.t')} sub={t('ya.tr.msg.sub')} />
      {loading || !tot ? <Sk h={200} r={16} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, ...fadeIn(rv, 180) }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
            {(['email', 'push'] as const).map((c) => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 18, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }}>
                <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: c === 'email' ? 'var(--ya-tangerine-50, var(--ya-red-50))' : 'var(--ya-red-50)', color: 'var(--ya-red-600)' }}>
                  <Icon name={c === 'email' ? 'mail' : 'bell'} size={17} stroke={2.2} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, color: 'var(--ya-sand-600)' }}>{t(`ya.tr.msg.tot.${c}`)}</span>
                  <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>
                    {money ? eur(Number(tot[c].revenue ?? 0)) : tp('ya.tr.ordersN', tot[c].orders, { n: n(tot[c].orders) })}
                  </b>
                  <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{tp('ya.tr.buyersN', tot[c].buyers, { n: n(tot[c].buyers) })}</span>
                </span>
              </div>
            ))}
          </div>
          {rows.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.tr.msg.empty')}</p>
          ) : (
            <div className="ya-thin-scroll" style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 760, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '0 10px 10px', ...mono }}>
                  <span>{t('ya.tr.msg.col.msg')}</span>
                  <span style={{ textAlign: 'right' }}>{t('ya.tr.msg.col.sent')}</span>
                  <span style={{ textAlign: 'right' }}>{t('ya.tr.msg.col.opened')}</span>
                  <span style={{ textAlign: 'right' }}>{t('ya.tr.msg.col.clicked')}</span>
                  <span style={{ textAlign: 'right' }}>{t('ya.tr.msg.col.buyers')}</span>
                  <span>{t(money ? 'ya.pa.col.salesValue' : 'ya.tr.msg.col.orders')}</span>
                </div>
                {rows.map((x, i) => {
                  const v = val(x);
                  const op = rate(x.opened, x.sent);
                  const cl = rate(x.clicked, x.sent);
                  return (
                    <div key={`${x.channel}:${x.id}`} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '11px 10px', borderRadius: 14, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--ya-sand-100)', color: 'var(--ya-sand-600)' }}>
                          <Icon name={x.channel === 'email' ? 'mail' : 'bell'} size={14} stroke={2.2} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(x)}</b>
                          <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', whiteSpace: 'nowrap' }}>
                            {[x.channel === 'push' ? (x.recipe === 'auto' ? t('ya.tr.msg.pushAuto') : t('ya.tr.msg.push')) : x.recipe ? t('ya.tr.msg.auto') : t('ya.tr.msg.email'), x.at ? dShort(x.at) : null].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{x.sent > 0 ? n(x.sent) : '—'}</span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{x.channel === 'push' ? '—' : op ?? n(x.opened)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{cl ?? n(x.clicked)}</span>
                      <b style={{ textAlign: 'right' }}>{n(x.buyers)}</b>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <b>{money ? eur(v) : n(v)}</b>
                        <Fill pct={(v / top) * 100} go={go} delay={i * 50} h={5} bg="var(--ya-ink)" dur={800} />
                      </span>
                    </div>
                  );
                })}
              </div>
              {all.length > 8 && (
                <Hv
                  as="button"
                  type="button"
                  onClick={() => setMore((o) => !o)}
                  style={{ marginTop: 6, height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', color: 'var(--ya-ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  hover={{ borderColor: 'var(--ya-sand-400)' }}
                >
                  {more ? t('ya.tr.msg.less') : t('ya.tr.msg.more', { n: n(all.length) })}
                  <Icon name="chevronDown" size={14} stroke={2.4} style={{ transform: `rotate(${more ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
                </Hv>
              )}
            </div>
          )}
        </div>
      )}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.tr.msg.foot')}</span>
    </section>
  );
}
