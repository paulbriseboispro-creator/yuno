/**
 * Tiroir d'une soirée (maquette « Détail de la soirée ») : naviguer de soirée
 * en soirée (flèches, clavier), le verdict, la courbe comparée, les tarifs,
 * qui a acheté, les messages, la fiche Shotgun en lecture seule. Trois vues :
 * Ventes, Guest list (NightGuestList) et Liens de partage.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { CtaButton, Segmented, Sheet, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE, useProgress } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useNightDetail } from '@/crm/data/nights';
import type { NightDetail } from '@/crm/data/nights';
import { fillOf, pastKind, upKind } from '@/crm/lib/nights';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SalesCurve } from './SalesCurve';
import { NightLinks } from './links/NightLinks';
import { NightGuestList } from './NightGuestList';
import { ShotgunLink, StatusPill } from './nightsUi';
import { ICO, comparedName, messageHref, priceLabel, tzLong, tzShort, tzTime } from './nightsFormat';

const UP_ST = { full: 'yc.ni.st.full', soon: 'yc.ni.st.soon', almost: 'yc.ni.st.almost', sale: 'yc.ni.st.sale' } as const;
const PA_ST = { full: 'yc.ni.pa.full', good: 'yc.ni.pa.good', fair: 'yc.ni.pa.fair', low: 'yc.ni.pa.low', unknown: 'yc.ni.pa.unknown' } as const;

export type DrawerView = 'sales' | 'gl' | 'links';

export function NightDrawer({
  id, ids, view, onView, onClose, onStep, onWrite,
}: {
  id: string | null;
  ids: string[];
  view: DrawerView;
  onView: (v: DrawerView) => void;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  onWrite: (d: { id: string; title: string; buyers: number }) => void;
}) {
  const { t, locale } = useCrmT();
  const q = useNightDetail(id);
  const d = q.data && q.data.id === id ? q.data : undefined;
  const idx = id ? ids.indexOf(id) : -1;

  useEffect(() => {
    if (!id) return;
    const kd = (e: KeyboardEvent) => {
      const tg = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tg === 'INPUT' || tg === 'TEXTAREA') return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [id, onStep]);

  const navBtn = (dir: -1 | 1, label: string, icon: 'chevronUp' | 'chevronDown', on: boolean) => (
    <Hv
      as="button"
      type="button"
      onClick={() => onStep(dir)}
      aria-label={label}
      disabled={!on}
      style={{ width: 40, height: 40, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.35 }}
      hover={{ background: 'var(--sand-50)' }}
    >
      <Icon name={icon} size={16} stroke={2.4} />
    </Hv>
  );

  return (
    <Sheet open={!!id} onClose={onClose} width={view === 'sales' ? 640 : 720} label={t('yc.ni.dr.aria')}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--sand-100)', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {navBtn(-1, t('yc.ni.dr.prev'), 'chevronUp', idx > 0)}
          {navBtn(1, t('yc.ni.dr.next'), 'chevronDown', idx >= 0 && idx < ids.length - 1)}
          {idx >= 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)', marginLeft: 6 }}>{t('yc.ni.dr.pos', { i: idx + 1, n: ids.length })}</span>}
        </div>
        <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.ni.dr.close')} style={{ width: 40, height: 40, borderRadius: 99, border: 0, background: 'var(--sand-100)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>
          <Icon name="x" size={16} stroke={2.4} />
        </Hv>
      </div>
      {id && d?.error !== 'not_found' && (
        <div style={{ flex: 'none', padding: '12px 20px', borderBottom: '1px solid var(--sand-100)', background: '#fff' }}>
          <Segmented<DrawerView>
            value={view}
            onChange={onView}
            ariaLabel={t('yc.ni.dr.aria')}
            options={[{ value: 'sales', label: t('yc.lk.tab.sales') }, { value: 'gl', label: t('yc.gl.tab') }, { value: 'links', label: t('yc.lk.tab.links') }]}
          />
        </div>
      )}
      {d?.error === 'not_found' ? (
        <div style={{ flex: 1, padding: 32, fontSize: 15, color: 'var(--sand-600)' }}>{t('yc.ni.dr.notFound')}</div>
      ) : id && view === 'gl' ? (
        <NightGuestList key={`gl-${id}`} eventId={id} />
      ) : id && view === 'links' ? (
        <div key={`links-${id}`} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 20px 32px' }}>
          {d && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 18, animation: `yc-row 500ms ${EASE} 60ms both` }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3.4vw,30px)', lineHeight: 1.08, letterSpacing: '-.03em', textWrap: 'balance' }}>{d.title}</h2>
              <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{`${tzLong(locale, d.start_at, d.tz)} · ${tzTime(locale, d.start_at, d.tz)}`}</span>
            </div>
          )}
          <NightLinks eventId={id} />
        </div>
      ) : d ? (
        <DrawerBody key={d.id} d={d} onWrite={onWrite} />
      ) : (
        <div style={{ flex: 1, padding: '24px 24px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Skel w={180} h={30} r={99} />
          <Skel w="70%" h={38} />
          <Skel h={260} r={24} />
          <Skel h={180} r={24} />
        </div>
      )}
    </Sheet>
  );
}

function DrawerBody({ d, onWrite }: { d: NightDetail; onWrite: (x: { id: string; title: string; buyers: number }) => void }) {
  const T = useCrmT();
  const { t, tp, n, eur, eur2, pct, locale, dShort, time } = T;
  const toast = useCrmToast();
  const [fiche, setFiche] = useState(false);
  const p = useProgress(1200, 350, d.id);
  const base = { sold: d.sold, cap: d.cap, sold_out: d.sold_out, sale_opens_at: d.sale_opens_at, msgs: d.msgs };
  const uk = upKind(base);
  const pk = pastKind(base);
  const f = fillOf(base);
  const pc = f !== null ? pct(f * 100) : '';
  const left = d.cap ? Math.max(0, d.cap - d.sold) : null;
  const prevDate = d.prev ? new Date(d.prev.start_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: d.tz }) : '';
  const lastPv = d.curve.length ? d.curve[d.curve.length - 1].pv : null;

  // ── Verdict
  let verdict: string;
  if (d.upcoming) {
    if (uk === 'soon' && d.sale_opens_at) {
      verdict = t('yc.ni.dr.v.soon', { opens: t('yc.ni.opens', { date: tzShort(locale, d.sale_opens_at, d.tz), time: tzTime(locale, d.sale_opens_at, d.tz) }) });
    } else {
      verdict = uk === 'full' && d.cap ? t('yc.ni.dr.v.full', { n: n(d.cap) })
        : left !== null ? tp('yc.ni.dr.v.left', left, { n: n(left) }) : t('yc.ni.dr.v.sold', { n: n(d.sold) });
      if (d.prev && lastPv !== null) verdict += t('yc.ni.dr.v.atSame', { title: d.prev.title, date: prevDate, pv: n(lastPv) });
    }
  } else {
    verdict = pk === 'full' && d.cap ? t('yc.ni.dr.v.pastFull', { n: n(d.cap) }) : f !== null ? t('yc.ni.dr.v.pastPct', { pct: pc }) : t('yc.ni.dr.v.pastSold', { n: n(d.sold) });
    if (f !== null && d.series_avg_fill !== null) {
      const gap = Math.round((f - d.series_avg_fill) * 100);
      verdict += Math.abs(gap) < 2 ? t('yc.ni.dr.v.avg', { series: d.series })
        : gap > 0 ? t('yc.ni.dr.v.above', { n: gap, series: d.series }) : t('yc.ni.dr.v.below', { n: -gap, series: d.series });
    }
  }

  // ── Acheteurs
  const B = d.buyers;
  const segs = [
    { k: 'new', l: t('yc.ni.dr.seg.new'), def: t('yc.ni.dr.seg.newD'), v: B.new, c: 'var(--red-500)' },
    { k: 'occ', l: t('yc.ni.dr.seg.occ'), def: t('yc.ni.dr.seg.occD'), v: B.occasional, c: 'var(--sand-300)' },
    { k: 'reg', l: t('yc.ni.dr.seg.reg'), def: t('yc.ni.dr.seg.regD'), v: B.regular, c: 'var(--ink)' },
  ];

  // ── Fiche
  const prices = d.tiers.map((x) => x.price).filter((x): x is number => x !== null);
  const pmin = prices.length ? Math.min(...prices) : null;
  const pmax = prices.length ? Math.max(...prices) : null;
  const pl = (v: number | null) => priceLabel(v, eur, eur2, t('yc.ni.tier.free'));
  const fieldsRows: [string, string][] = [
    [t('yc.ni.fiche.title'), d.title],
    [t('yc.ni.fiche.date'), `${tzLong(locale, d.start_at, d.tz)}, ${tzTime(locale, d.start_at, d.tz)} – ${tzTime(locale, d.end_at, d.tz)}`],
    [t('yc.ni.fiche.venue'), [d.street, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || t('yc.ni.fiche.unset')],
    [t('yc.ni.fiche.lineup'), d.lineup.length ? d.lineup.join(', ') : t('yc.ni.fiche.unset')],
    [t('yc.ni.fiche.cap'), d.cap ? t('yc.ni.fiche.capV', { n: n(d.cap) }) : t('yc.ni.fiche.unset')],
    [t('yc.ni.fiche.prices'), !d.tiers.length ? t('yc.ni.fiche.unset') : d.tiers.length === 1 ? tp('yc.ni.fiche.prices', 1, { a: pl(pmin) }) : tp('yc.ni.fiche.prices', d.tiers.length, { a: pl(pmin), b: pl(pmax) })],
    [t('yc.ni.fiche.status'), t(!d.upcoming ? 'yc.ni.fiche.st.done' : uk === 'soon' ? 'yc.ni.fiche.st.soon' : uk === 'full' ? 'yc.ni.fiche.st.full' : 'yc.ni.fiche.st.sale')],
  ];
  const syncedToday = d.synced_at && new Date(d.synced_at).toDateString() === new Date().toDateString();
  const noMsgTxt = d.upcoming
    ? uk === 'full' ? t('yc.ni.dr.noMsg.full') : uk === 'soon' ? t('yc.ni.dr.noMsg.soon')
      : left !== null ? tp('yc.ni.dr.noMsg.sale', left, { n: n(left) }) : t('yc.ni.dr.noMsg.saleNoCap')
    : t('yc.ni.dr.noMsg.past');
  const card = (delay: number) => ({ display: 'flex', flexDirection: 'column' as const, gap: 14, padding: 22, borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', animation: `yc-row 650ms ${EASE} ${delay}ms both` });
  const h3 = { margin: 0, fontSize: 16, fontWeight: 600 };
  const sub = { fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' };
  const maxSold = Math.max(1, ...d.tiers.map((x) => x.sold));

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 24px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Identité */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: `yc-row 600ms ${EASE} 120ms both` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {d.upcoming ? <StatusPill up={uk}>{t(UP_ST[uk])}</StatusPill> : <StatusPill past={pk}>{t(PA_ST[pk])}</StatusPill>}
            <span style={{ height: 30, padding: '0 12px 0 10px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Icon d={ICO.sync} size={14} stroke={2.2} />{t('yc.ni.dr.synced')}
            </span>
          </div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,4vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', textWrap: 'balance' }}>{d.title}</h2>
          <span style={{ fontSize: 15, color: 'var(--sand-600)', lineHeight: 1.45 }}>
            {[`${tzLong(locale, d.start_at, d.tz)} · ${tzTime(locale, d.start_at, d.tz)} – ${tzTime(locale, d.end_at, d.tz)}`, d.city || d.street].filter(Boolean).join(' · ')}
          </span>
        </div>

        {/* Ventes */}
        <section style={{ ...card(200), gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={h3}>{t(d.upcoming ? 'yc.ni.dr.sec.up' : 'yc.ni.dr.sec.past')}</h3>
            <span style={{ ...sub, textWrap: 'pretty' }}>{verdict}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '10px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 60, lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(d.sold * p)}</span>
              {d.cap ? <span style={{ fontSize: 17, color: 'var(--sand-500)' }}>{t('yc.ni.of', { n: n(d.cap) })}</span> : null}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'right' }}>
              <span style={{ fontSize: 20, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{eur(d.revenue)}</span>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.ni.dr.caNet')}</span>
            </div>
          </div>
          {f !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ height: 12, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(f * 100 * p).toFixed(1)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--sand-500)' }}>
                <span>{t('yc.ni.filled', { pct: pc })}</span>
                <span style={{ fontWeight: 600, color: 'var(--green-700)' }}>{d.today ? t('yc.ni.todayUp', { n: n(d.today) }) : ''}</span>
              </div>
            </div>
          )}
          {d.sold > 0 && d.curve.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.ni.curve.t')}</span>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>
                  {t('yc.ni.curve.range', {
                    a: new Date(Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: d.tz }).format(new Date(d.start_at)) + 'T12:00:00Z') - d.curve[0].d * 86_400_000).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
                    b: d.upcoming ? t('yc.ni.curve.today') : tzShort(locale, d.start_at, d.tz),
                  })}
                </span>
              </div>
              <div style={{ paddingTop: 14 }}><SalesCurve detail={d} progress={p} height={130} /></div>
              {d.prev && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.ni.curve.dashed', { name: comparedName(d, t, locale) })}</span>}
            </div>
          )}
        </section>

        {/* Tarifs */}
        <section style={card(280)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={h3}>{t(d.upcoming ? 'yc.ni.tiers.t' : 'yc.ni.dr.tiers.past')}</h3>
            <span style={sub}>{t('yc.ni.dr.tiers.s')}</span>
          </div>
          {d.tiers.length === 0 ? <span style={sub}>{t('yc.ni.dr.tiersNone')}</span> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {d.tiers.map((r) => {
                const w = r.cap ? Math.min(1, r.sold / r.cap) : r.sold / maxSold;
                const full = r.cap !== null && r.cap > 0 && r.sold >= r.cap;
                return (
                  <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0,1fr) auto', gap: 14, alignItems: 'center' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <b style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</b>
                      <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{pl(r.price)}</span>
                    </span>
                    <div style={{ height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(w * 100 * p).toFixed(1)}%`, borderRadius: 99, background: full ? 'var(--ink)' : r.cap === null ? 'var(--sand-500)' : 'var(--red-500)' }} />
                    </div>
                    <span style={{ fontSize: 13.5, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', minWidth: 92 }}>{r.cap !== null ? `${n(r.sold)} / ${n(r.cap)}` : t('yc.ni.tier.sold', { n: n(r.sold) })}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Qui a acheté */}
        {B.total > 0 && (
          <section style={card(360)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h3 style={h3}>{t('yc.ni.dr.buyers.t')}</h3>
              <span style={sub}>{tp('yc.ni.dr.buyers.s', B.total, { n: n(B.total) })}</span>
            </div>
            <div style={{ display: 'flex', height: 16, gap: 3, borderRadius: 99, overflow: 'hidden' }}>
              {segs.filter((s) => s.v > 0).map((s) => (
                <div key={s.k} title={`${s.l} : ${n(s.v)}`} style={{ flex: `${s.v} 1 0`, minWidth: 4, background: s.c, transformOrigin: 'left', transform: `scaleX(${p})` }} />
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 8 }}>
              {segs.map((s) => (
                <div key={s.k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 14, background: 'var(--sand-50)' }}>
                  <i style={{ flex: 'none', width: 10, height: 10, marginTop: 5, borderRadius: 99, background: s.c }} />
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontSize: 14.5, fontWeight: 600 }}>{s.l}</b>
                    <span style={{ fontSize: 13, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{n(s.v)} · {pct((s.v / B.total) * 100)}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)', marginTop: 2 }}>{s.def}</span>
                  </span>
                </div>
              ))}
            </div>
            <Link to={`${CRM_ROUTES.clients}?ev=${d.id}`} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--red-600)', textDecoration: 'none' }}>
              {t('yc.ni.dr.seeClients')}<Icon name="arrowRight" size={14} stroke={2.4} />
            </Link>
          </section>
        )}

        {/* Messages */}
        <section style={card(440)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={h3}>{t('yc.ni.dr.msgs.t')}</h3>
            <span style={sub}>{t('yc.ni.dr.msgs.s')}</span>
          </div>
          {d.msgs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {d.msgs.map((m) => {
                const tone = m.state === 'draft' ? ['var(--red-50)', 'var(--red-600)'] : m.state === 'plan' ? ['var(--sand-100)', 'var(--sand-700)'] : ['var(--green-50)', 'var(--green-700)'];
                const when = m.state === 'draft' ? t('yc.ni.msg.draftW') : m.state === 'plan' && m.at ? t('yc.ni.msg.planW', { date: dShort(m.at), time: time(m.at) }) : m.at ? t('yc.ni.msg.sentW', { date: dShort(m.at) }) : '';
                return (
                  <Hv key={m.id} as={Link} to={messageHref(m)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 6px', margin: '0 -6px', borderTop: '1px solid var(--sand-100)', borderRadius: 12, textDecoration: 'none', color: 'inherit', transition: 'background 160ms' }} hover={{ background: 'var(--sand-50)', textDecoration: 'none', color: 'inherit' }}>
                    <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}>
                      <Icon d={m.channel === 'sms' ? ICO.sms : ICO.mail} size={16} stroke={2.2} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <b style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || t('yc.ni.msg.untitled')}</b>
                      <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{when}{m.open_pct !== null && m.open_pct !== undefined ? t('yc.ni.dr.openRate', { p: pct(m.open_pct) }) : ''}</span>
                    </span>
                    <span style={{ flex: 'none', height: 26, padding: '0 11px', borderRadius: 99, background: tone[0], color: tone[1], fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t(`yc.ni.dr.tag.${m.state}`)}</span>
                  </Hv>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '14px 16px', borderRadius: 16, background: d.upcoming && uk !== 'full' ? 'var(--red-50)' : 'var(--sand-50)', fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)' }}>{noMsgTxt}</div>
          )}
        </section>

        {/* Fiche Shotgun */}
        <section style={{ display: 'flex', flexDirection: 'column', borderRadius: 24, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', overflow: 'hidden', flex: 'none', animation: `yc-row 650ms ${EASE} 520ms both` }}>
          <Hv as="button" type="button" onClick={() => setFiche((v) => !v)} aria-expanded={fiche} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 22px', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} hover={{ background: 'var(--sand-100)' }}>
            <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--sand-600)', display: 'grid', placeItems: 'center' }}>
              <Icon d={ICO.lock} size={15} stroke={2.2} />
            </span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <b style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.ni.fiche.t')}</b>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>
                {d.synced_at ? (syncedToday ? t('yc.ni.fiche.s', { time: time(d.synced_at) }) : t('yc.ni.fiche.sDay', { date: dShort(d.synced_at) })) : t('yc.ni.lock.b')}
              </span>
            </span>
            <Icon name="chevronDown" size={18} stroke={2.2} color="var(--sand-400)" style={{ transform: fiche ? 'rotate(180deg)' : 'none', transition: 'transform 240ms' }} />
          </Hv>
          {fiche && (
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0 22px 20px', animation: `yc-row 400ms ${EASE} both` }}>
              {fieldsRows.map(([k, v]) => (
                <div key={k} onClick={() => toast(t('yc.ni.fiche.lock'))} title={t('yc.ni.fiche.lock')} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) 16px', gap: 12, alignItems: 'start', padding: '12px 0', borderTop: '1px solid var(--sand-200)', cursor: 'not-allowed' }}>
                  <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{k}</span>
                  <span style={{ fontSize: 14.5, lineHeight: 1.4, color: 'var(--ink)' }}>{v}</span>
                  <Icon d={ICO.lock} size={14} stroke={2.2} color="var(--sand-400)" style={{ marginTop: 3 }} />
                </div>
              ))}
              <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', paddingTop: 12, borderTop: '1px solid var(--sand-200)' }}>{t('yc.ni.fiche.foot')}</span>
            </div>
          )}
        </section>
      </div>

      {/* Actions */}
      <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '16px 24px', borderTop: '1px solid var(--sand-100)', background: '#fff' }}>
        <CtaButton onClick={() => onWrite({ id: d.id, title: d.title, buyers: B.total })}>
          {B.total > 0 ? tp('yc.ni.dr.write', B.total, { n: n(B.total) }) : t('yc.ni.dr.writeAll')}
        </CtaButton>
        <Hv as={Link} to={`${CRM_ROUTES.sales}?event=${d.id}`} style={{ height: 46, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}>
          {t('yc.ni.dr.analytics')}
        </Hv>
        <ShotgunLink href={d.url}>{t('yc.ni.editShotgun')}</ShotgunLink>
      </div>
    </>
  );
}
