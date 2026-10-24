/**
 * Yuno Tickets › Analyses › Gratuits, le détail (lot 6 du plan combiné,
 * migration 20261109350000, `tix_ana_free_detail`) : quotas et remplissage des
 * listes, détenteurs de liste, ce que vaut un invité face à un client payant,
 * et ce que coûtent les absents. Règles de l'onglet : « venu » = scanné sur une
 * porte mesurée, aucun pourcentage sous 10.
 */
import { useState, type CSSProperties } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixCaps } from '@/tickets/analytics/scope';
import { useAnaFreeDetail, type AnaFreeDetail, type AnaPeriod, type FreeHolder } from '@/tickets/analytics/data';
import { CardHead, Fill, Sk, StatePill, card, fadeIn, useGo } from './anaUi';

const mono: CSSProperties = { fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' };
const HOLDER_TYPES = ['club', 'organizer', 'promoter', 'dj', 'guest', 'custom'];

export function FreeDetail({ period, event }: { period: AnaPeriod; event: string | null }) {
  const q = useAnaFreeDetail(period, event);
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const key = `${period}:${event}:${q.dataUpdatedAt}`;
  const rv = useGo(key, !loading);
  const go = useGo(key, !loading);
  if (!d) {
    return <section style={{ ...card }}><Sk h={26} w={260} /><Sk h={180} r={16} /></section>;
  }
  if (d.quotas.lists === 0) return null;
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <QuotasCard d={d} ev={!!event} rv={rv} go={go} />
        <NoShowCard d={d} rv={rv} />
      </div>
      <HoldersCard holders={d.holders} ev={!!event} rv={rv} go={go} />
      {!event && <WorthCard d={d} rv={rv} />}
    </>
  );
}

// ── Quotas et remplissage ─────────────────────────────────────────────────

function QuotasCard({ d, ev, rv, go }: { d: AnaFreeDetail; ev: boolean; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, tp, n, pct, dShort } = T;
  const Q = d.quotas;
  const [more, setMore] = useState(false);
  const shown = more ? Q.nights : Q.nights.slice(0, 8);
  return (
    <section style={{ ...card, flex: '1.4 1 460px', gap: 16, ...fadeIn(rv, 100) }}>
      <CardHead title={t('ya.fd.q.t')} sub={t(ev ? 'ya.fd.q.subEv' : 'ya.fd.q.sub')} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 20px' }}>
        <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{Q.fill !== null ? pct(Q.fill) : '—'}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 6 }}>
          <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t('ya.fd.q.big', { filled: n(Q.filled), quota: n(Q.quota) })}</span>
          <span style={{ fontSize: 13.5, color: 'var(--ya-sand-600)' }}>
            {[tp('ya.fd.q.lists', Q.lists, { n: n(Q.lists) }), Q.full_lists > 0 ? tp('ya.fd.q.full', Q.full_lists, { n: n(Q.full_lists) }) : null].filter(Boolean).join(' · ')}
          </span>
        </span>
      </div>
      {!ev && Q.nights.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {shown.map((x, i) => (
            <div key={x.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(120px,1fr) 92px', gap: 14, alignItems: 'center', padding: '10px 4px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{dShort(x.start_at)} · {tp('ya.fd.q.lists', x.lists, { n: n(x.lists) })}</span>
                </span>
                {x.upcoming && <StatePill state="presale" label={t('ya.ana.state.presale')} />}
              </span>
              <Fill pct={x.quota > 0 ? (Math.min(x.entries, x.quota) / x.quota) * 100 : 0} go={go} delay={i * 50} h={8} bg={x.full_lists > 0 ? 'var(--ya-gradient-brand)' : 'var(--ya-red-300, var(--ya-red-200))'} dur={800} />
              <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}><b style={{ color: 'var(--ya-ink)' }}>{n(x.entries)}</b> / {n(x.quota)}</span>
            </div>
          ))}
          {Q.nights.length > 8 && (
            <Hv
              as="button"
              type="button"
              onClick={() => setMore((o) => !o)}
              style={{ alignSelf: 'flex-start', marginTop: 6, height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', color: 'var(--ya-ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              hover={{ borderColor: 'var(--ya-sand-400)' }}
            >
              {more ? t('ya.fd.q.less') : t('ya.fd.q.more', { n: n(Q.nights.length) })}
              <Icon name="chevronDown" size={14} stroke={2.4} style={{ transform: `rotate(${more ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
            </Hv>
          )}
        </div>
      )}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.fd.q.foot')}</span>
    </section>
  );
}

// ── Absents ───────────────────────────────────────────────────────────────

function NoShowCard({ d, rv }: { d: AnaFreeDetail; rv: boolean }) {
  const T = useTixT();
  const { t, tp, n, pct, eur } = T;
  const caps = useTixCaps();
  const N = d.noshow;
  const lost = caps.money ? N.lost.amount : null;
  return (
    <section style={{ ...card, flex: '1 1 320px', gap: 16, ...fadeIn(rv, 160) }}>
      <CardHead title={t('ya.fd.ns.t')} sub={t('ya.fd.ns.sub')} />
      {N.k_entries === 0 ? (
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t(N.unmeasured > 0 ? 'ya.fd.ns.unmeasured' : 'ya.fd.ns.none')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 16px' }}>
            <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 56, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{n(N.noshow)}</span>
            <span style={{ fontSize: 14, color: 'var(--ya-sand-500)', paddingBottom: 6 }}>
              {N.rate !== null ? t('ya.fd.ns.bigPct', { pct: pct(N.rate), n: n(N.k_entries) }) : tp('ya.fd.ns.big', N.k_entries, { n: n(N.k_entries) })}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label={t('ya.fd.ns.heldFull')} value={n(N.held_full)} />
            {lost !== null && lost > 0 && <Row label={t('ya.fd.ns.lost')} value={eur(lost)} />}
            {N.unmeasured > 0 && <Row label={t('ya.fd.ns.unmeasuredN')} value={n(N.unmeasured)} muted />}
          </div>
        </>
      )}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.fd.ns.foot')}</span>
    </section>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderRadius: 14, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)', fontSize: 14, color: muted ? 'var(--ya-sand-500)' : 'var(--ya-sand-700)' }}>
      <span>{label}</span><b style={{ color: muted ? 'var(--ya-sand-500)' : 'var(--ya-ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </div>
  );
}

// ── Détenteurs de liste ───────────────────────────────────────────────────

/** Sur une soirée choisie, « devenus payants » est le travail de la carte de la soirée (trop tôt les premiers jours) : la colonne n'y est pas. */
function HoldersCard({ holders, ev, rv, go }: { holders: FreeHolder[]; ev: boolean; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, n, pct } = T;
  const rows = holders.filter((h) => h.entries > 0 || h.upcoming > 0);
  if (rows.length === 0) return null;
  const top = Math.max(1, ...rows.map((h) => h.entries));
  const typeOf = (h: FreeHolder) => (HOLDER_TYPES.includes(h.type) ? h.type : 'custom');
  const grid = ev ? 'minmax(200px,1.6fr) 70px minmax(150px,1.2fr) 92px 92px' : 'minmax(200px,1.6fr) 70px minmax(150px,1.2fr) 92px 92px 120px';
  return (
    <section style={{ ...card, gap: 16, ...fadeIn(rv, 200) }}>
      <CardHead title={t('ya.fd.h.t')} sub={t('ya.fd.h.sub')} />
      <div className="ya-thin-scroll" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 760, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '0 10px 10px', ...mono }}>
            <span>{t('ya.fd.h.col.holder')}</span>
            <span style={{ textAlign: 'right' }}>{t('ya.fd.h.col.lists')}</span>
            <span>{t('ya.fd.h.col.entries')}</span>
            <span style={{ textAlign: 'right' }}>{t('ya.fd.h.col.came')}</span>
            <span style={{ textAlign: 'right' }}>{t('ya.fd.h.col.showup')}</span>
            {!ev && <span style={{ textAlign: 'right' }}>{t('ya.fd.h.col.conv')}</span>}
          </div>
          {rows.map((h, i) => {
            const type = typeOf(h);
            return (
              <div key={h.key} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '12px 10px', borderRadius: 14, fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label ?? t(`ya.fd.h.default.${type}`)}</b>
                  <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: 'var(--ya-sand-100)', color: 'var(--ya-sand-600)', whiteSpace: 'nowrap' }}>{t(`ya.fd.h.type.${type}`)}</span>
                </span>
                <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{n(h.lists)}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <b style={{ width: 48 }}>{n(h.entries)}</b>
                  <span style={{ flex: 1 }}><Fill pct={(h.entries / top) * 100} go={go} delay={i * 60} h={6} dur={800} /></span>
                </span>
                <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{h.k_entries > 0 ? `${n(h.came)} / ${n(h.k_entries)}` : '—'}</span>
                <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{h.showup !== null ? pct(h.showup) : '—'}</span>
                {!ev && (
                  <span style={{ textAlign: 'right' }}>
                    <b>{n(h.converted)}</b>
                    <span style={{ color: 'var(--ya-sand-500)', fontSize: 12.5 }}>{h.conv_pct !== null ? ` · ${pct(h.conv_pct)}` : ''}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t(ev ? 'ya.fd.h.footEv' : 'ya.fd.h.foot')}</span>
    </section>
  );
}

// ── Un invité vaut-il un client payant ? ──────────────────────────────────

function WorthCard({ d, rv }: { d: AnaFreeDetail; rv: boolean }) {
  const T = useTixT();
  const { t, n, eur } = T;
  const caps = useTixCaps();
  const W = d.worth;
  if (!caps.money || (W.guest_night.amount === null && W.paid_night.amount === null)) return null;
  const blocks = [
    { k: 'gn', l: t('ya.fd.w.guestNight'), v: W.guest_night.amount, s: t('ya.fd.w.guestNightS', { n: n(W.guests) }) },
    { k: 'gl', l: t('ya.fd.w.guestLater'), v: W.guest_later.amount, s: t('ya.fd.w.guestLaterS') },
    { k: 'pn', l: t('ya.fd.w.paidNight'), v: W.paid_night.amount, s: t('ya.fd.w.paidNightS', { n: n(W.payers) }) },
  ];
  const gTotal = W.guest_night.amount !== null && W.guest_later.amount !== null ? W.guest_night.amount + W.guest_later.amount : null;
  const sentence = gTotal !== null && W.paid_night.amount !== null
    ? t('ya.fd.w.ins', { g: eur(gTotal), p: eur(W.paid_night.amount) })
    : null;
  return (
    <section style={{ ...card, gap: 16, ...fadeIn(rv, 240) }}>
      <CardHead title={t('ya.fd.w.t')} sub={t('ya.fd.w.sub')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
        {blocks.map((b) => (
          <div key={b.k} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 18px', borderRadius: 18, background: b.k === 'pn' ? 'var(--ya-card)' : 'var(--ya-sand-50)', boxShadow: `inset 0 0 0 1px ${b.k === 'pn' ? 'var(--ya-sand-200)' : 'var(--ya-sand-100)'}` }}>
            <span style={{ fontSize: 13.5, color: 'var(--ya-sand-600)' }}>{b.l}</span>
            <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 32, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{b.v !== null ? eur(b.v) : '—'}</b>
            <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{b.s}</span>
          </div>
        ))}
      </div>
      {sentence && <span style={{ fontSize: 14.5, lineHeight: 1.45, fontWeight: 500, padding: '12px 16px', borderRadius: 14, background: 'var(--ya-red-50)' }}>{sentence}</span>}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.fd.w.foot')}</span>
    </section>
  );
}
