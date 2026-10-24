/**
 * Yuno Tickets › Analyses › Guest list (copie de l'onglet Guest list de Yuno
 * CRM, sur les inscriptions de guest list Yuno et les billets à 0 €) — « Qui entre gratuitement, et qui finit par payer ? ».
 * Une période : les invités soirée par soirée (venus / pas venus), quatre
 * tuiles comparées à avant (invités, taux de venue, part des entrées
 * gratuites, devenus clients), la liste qui marche, l'heure d'arrivée, le
 * profil, puis ce qu'il y a à faire (habitués qui ne paient jamais, inscrits
 * qui ne viennent pas). Une soirée choisie dans les filtres : le même écran
 * que l'onglet Guest list de son tiroir (NightGuestList).
 * Lecture : tix_ana_guestlist (migration 20261109300000) ; le détail (quotas,
 * détenteurs, valeur d'un invité, absents) : tix_ana_free_detail (`FreeDetail.tsx`).
 */
import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { useProgress } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixCaps } from '@/tickets/analytics/scope';
import { useTixRoutes } from '@/tickets/analytics/routes';
import type { AnaFilters } from '@/tickets/analytics/data';
import type { AnaGuestList } from '@/tickets/analytics/data';
import { periodVerdict, ptsDelta, rate, DOOR_MIN_SCANS, DOOR_MIN_SHARE } from '@/crm/lib/guestlist';
import { ArrivalsCard, GL_COLORS, KindPill, NightGuestList, WhoCard } from './NightGuestList';
import { FreeDetail } from './FreeDetail';
import { tzShort, tzWeek } from '@/crm/pages/nights/nightsFormat';
import {
  BrandArrowButton, CardHead, ChartSkeleton, Sk, Takeaway, Tile, TileSkeleton, card, fadeIn, nightCard, useGo, type TileSpec,
} from './anaUi';
import { deltaPct } from './SalesTab';

type T = ReturnType<typeof useTixT>;

export function guestlistCsv(d: AnaGuestList, T: T): { columns: string[]; rows: unknown[][] } {
  const { t } = T;
  return {
    columns: [t('ya.gl.csv.date'), t('ya.gl.csv.night'), t('ya.gl.csv.entries'), t('ya.gl.csv.inv'), t('ya.gl.csv.came'), t('ya.gl.csv.showup')],
    rows: d.nights.map((x) => [x.start_at.slice(0, 10), x.title, x.entries, x.inv, x.scan_known ? x.came : '', x.showup ?? '']),
  };
}

export function GuestListTab({ q, f }: { q: UseQueryResult<AnaGuestList>; f: AnaFilters }) {
  if (f.event) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
        <NightGuestList eventId={f.event} inDrawer={false} />
        <FreeDetail period={f.period} event={f.event} />
      </div>
    );
  }
  return <PeriodView q={q} f={f} />;
}

function PeriodView({ q, f }: { q: UseQueryResult<AnaGuestList>; f: AnaFilters }) {
  const T = useTixT();
  const { t, tp, n, n1, eur, pct } = T;
  const caps = useTixCaps();
  const R = useTixRoutes();
  const navigate = useNavigate();
  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const dataKey = `${f.period}:${q.dataUpdatedAt}`;
  const rv = useGo(dataKey, !loading);
  const go = useGo(`${dataKey}:${f.cmp}`, !loading);
  const prog = useProgress(1000, 0, dataKey, !loading);

  if (!d) return <GlPeriodSkeleton />;
  if (!d.has_any) return <GlNever />;

  const X = d.totals;
  const C = d.conv;
  const v = periodVerdict({ entries: X.entries, nights: X.gl_nights, showup: X.showup, prevShowup: X.prev_showup, freeShare: X.free_share, converted: C.converted, eligible: C.eligible });
  const vars = Object.fromEntries(Object.entries(v.vars).map(([k, x]) => [k, typeof x === 'number' ? (k === 'pct' || k === 'conv' ? pct(x) : n(x)) : x]));
  const insight = t(v.key, vars);
  const eD = f.cmp ? deltaPct(X.entries, X.prev_entries, T) : null;
  const sD = f.cmp ? ptsDelta(X.showup, X.prev_showup) : null;
  const fD = f.cmp ? ptsDelta(X.free_share, X.prev_free_share) : null;
  const convR = rate(C.converted, C.eligible);
  const pts = (x: number) => `${x >= 0 ? '▲' : '▼'} ${t('ya.ana.pts', { n: n1(Math.abs(x)) })} ${t('ya.ana.vsBefore')}`;
  const tiles: TileSpec[] = [
    {
      kind: 'spark', label: t('ya.gl.a.t.entries'), value: n(X.entries * prog),
      delta: eD ? `${eD.text} ${t('ya.ana.vsBefore')}` : undefined, dc: eD && !eD.up ? 'var(--ya-red-600)' : undefined,
      cap: X.gl_nights > 0 ? tp('ya.gl.a.t.entriesCap', X.gl_nights, { nights: n(X.gl_nights), people: n(X.people) }) : t('ya.gl.a.t.none'),
      values: d.nights.map((x) => x.entries),
    },
    {
      kind: 'ring', label: t('ya.gl.a.t.showup'), value: X.showup !== null ? pct(X.showup * prog) : '—',
      delta: sD !== null ? pts(sD) : undefined, dc: sD !== null && sD < 0 ? 'var(--ya-red-600)' : undefined,
      cap: X.gl_nights === 0 ? t('ya.gl.a.t.none') : X.showup !== null ? tp('ya.gl.a.t.showupCap', X.scan_nights, { n: n(X.scan_nights) }) : X.scan_nights > 0 ? t('ya.gl.a.t.small') : t('ya.gl.a.t.noScan'),
      ring: X.showup ?? 0,
    },
    {
      kind: 'stack', label: t('ya.gl.a.t.share'), value: X.free_share !== null ? pct(X.free_share * prog) : '—',
      delta: fD !== null ? pts(fD) : undefined, dc: undefined,
      cap: X.gl_nights === 0 ? t('ya.gl.a.t.none') : X.free_share !== null ? t('ya.gl.a.t.shareCap') : X.scan_nights > 0 ? t('ya.gl.a.t.small') : t('ya.gl.a.t.noScan'),
      parts: X.free_share !== null ? [{ w: X.free_share, c: GL_COLORS.free }, { w: 100 - X.free_share, c: GL_COLORS.paid }] : [],
      legL: X.free_share !== null ? t('ya.gl.a.t.shareL', { pct: pct(X.free_share) }) : '', legR: X.free_share !== null ? t('ya.gl.a.t.shareR', { pct: pct(100 - X.free_share) }) : '',
    },
    {
      kind: 'hb', label: t('ya.gl.a.t.conv'), value: n(C.converted * prog),
      delta: convR !== null ? t('ya.gl.a.t.convRate', { pct: pct(convR) }) : undefined,
      cap: caps.money && C.revenue !== null && C.converted > 0 ? t('ya.gl.a.t.convRev', { v: eur(C.revenue) }) : C.eligible > 0 ? tp('ya.gl.a.t.convCap', C.eligible, { n: n(C.eligible) }) : t('ya.gl.a.t.none'),
      hb: convR ?? 0, hbL: C.median_days !== null && C.converted > 0 ? tp('ya.gl.a.t.convDays', C.median_days, { n: n(C.median_days) }) : t('ya.gl.a.t.convBar'),
    },
  ];

  const todo: { big: number; t: string; s: string; cta: string; to: string }[] = [];
  if (d.loyal > 0) todo.push({ big: d.loyal, t: t('ya.gl.a.do.loyalT'), s: t('ya.gl.a.do.loyalS'), cta: t('ya.gl.a.do.loyalCta'), to: R.campaignNew });
  if (d.noshow > 0) todo.push({ big: d.noshow, t: t('ya.gl.a.do.noshowT'), s: t('ya.gl.a.do.noshowS'), cta: t('ya.gl.a.do.see'), to: R.clients });
  if (d.conv_all > 0) todo.push({ big: d.conv_all, t: t('ya.gl.a.do.convT'), s: t('ya.gl.a.do.convS'), cta: t('ya.gl.a.do.see'), to: R.clients });

  return (
    <>
      {/* Héros : soirée par soirée */}
      <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)' }}>
        <CardHead title={t('ya.gl.a.heroT')} sub={t('ya.gl.a.heroS')} />
        {loading ? <ChartSkeleton height={220} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, ...fadeIn(rv) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,104px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>
                {n(X.entries * prog)}
                <span style={{ marginLeft: 12, fontSize: 'clamp(20px,2.4vw,28px)', letterSpacing: '-.02em', color: 'var(--ya-sand-500)' }}>{t('ya.gl.a.unit')}</span>
              </span>
              {f.cmp && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
                  {eD
                    ? <span style={{ fontSize: 17, fontWeight: 600, color: eD.up ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>{eD.text} {t(`ya.ana.per.vs.${f.period}`)}</span>
                    : <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--ya-sand-500)' }}>{t('ya.ana.noPrev')}</span>}
                </div>
              )}
            </div>
            {d.nights.length > 0
              ? <NightsBars d={d} go={go} T={T} />
              : <div style={{ padding: '22px 20px', borderRadius: 18, background: 'var(--ya-sand-50)', fontSize: 14.5, color: 'var(--ya-sand-600)' }}>{t('ya.gl.a.noNights')}</div>}
            {/* Sans soirée, la boîte « aucune soirée » suffit : pas de deuxième phrase vide. */}
            {d.nights.length > 0 && <Takeaway>{insight}</Takeaway>}
          </div>
        )}
      </section>

      {/* Tuiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {loading ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />) : tiles.map((x, i) => <Tile key={i} t={x} i={i} go={go} rv={rv} />)}
      </div>

      {/* Quelle liste marche + quand arrivent-ils */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ ...card, flex: '1 1 480px' }}>
          <CardHead title={t('ya.gl.lists.t')} sub={t('ya.gl.a.listsS')} />
          {loading ? <Sk h={220} r={16} /> : d.lists.length === 0 ? <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t('ya.gl.a.noNights')}</span> : (
            <div style={{ display: 'flex', flexDirection: 'column', ...fadeIn(rv, 80) }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 64px 84px 92px', gap: 12, padding: '0 4px 8px', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-400)', borderBottom: '1px solid var(--ya-sand-100)' }}>
                <span>{t('ya.gl.a.col.list')}</span><span style={{ textAlign: 'right' }}>{t('ya.gl.a.col.entries')}</span><span style={{ textAlign: 'right' }}>{t('ya.gl.a.col.showup')}</span><span style={{ textAlign: 'right' }}>{t('ya.gl.a.col.conv')}</span>
              </div>
              {d.lists.map((l) => (
                <div key={`${l.name}-${l.kind}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 64px 84px 92px', gap: 12, alignItems: 'center', padding: '12px 4px', borderBottom: '1px solid var(--ya-sand-100)' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <b style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name ?? t('ya.gl.lists.unnamed')}</b>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ya-sand-500)' }}><KindPill kind={l.kind} T={T} />{tp('ya.gl.a.listNights', l.nights, { n: n(l.nights) })}</span>
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 14.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{n(l.entries)}</span>
                  <span style={{ textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: l.showup === null ? 'var(--ya-sand-400)' : 'var(--ya-ink)' }}>{l.showup !== null ? pct(l.showup) : '—'}</span>
                  <span style={{ textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: l.conv > 0 ? 'var(--ya-green-700)' : 'var(--ya-sand-500)', fontWeight: l.conv > 0 ? 600 : 400 }} title={t('ya.gl.a.convTip', { a: n(l.conv), b: n(l.eligible) })}>
                    {l.conv_pct !== null ? pct(l.conv_pct) : l.conv > 0 ? n(l.conv) : '—'}
                  </span>
                </div>
              ))}
              <span style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.45, color: 'var(--ya-sand-500)' }}>{t('ya.gl.a.listsFoot', { min: DOOR_MIN_SCANS, pct: pct(DOOR_MIN_SHARE * 100) })}</span>
            </div>
          )}
        </section>
        {d.arrivals.slots.length > 0
          ? <ArrivalsCard a={d.arrivals} T={T} p={prog} delay={0} style={{ flex: '1 1 380px', borderRadius: 28, padding: 24, animation: 'none' }} />
          : (
            <section style={{ ...card, flex: '1 1 380px' }}>
              <CardHead title={t('ya.gl.arr.t')} sub={t('ya.gl.a.arrNone')} />
            </section>
          )}
      </div>

      {/* Profil */}
      {(d.profile.gl?.age_med != null || d.profile.gl?.female_pct != null) && (
        <WhoCard who={null} profile={d.profile} T={T} p={prog} delay={0} title={t('ya.gl.a.profileT')} style={{ borderRadius: 28, padding: 24, animation: 'none' }} />
      )}

      {/* Lot 6 : quotas, absents, détenteurs de liste, ce que vaut un invité */}
      <FreeDetail period={f.period} event={null} />

      {/* À faire */}
      {(todo.length > 0 || d.next) && (
        <section style={{ ...nightCard, display: 'flex', flexDirection: 'column', gap: 20, padding: 28, ...fadeIn(rv, 120) }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-text-on-night-2)' }}>{t('ya.gl.a.do.k')}</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t('ya.gl.a.do.t')}</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 14 }}>
            {todo.map((w, i) => (
              <Hv key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 20, borderRadius: 20, background: 'rgba(255,255,255,.06)', boxShadow: 'inset 0 0 0 1px var(--ya-border-night)', transition: 'background 160ms,transform 200ms cubic-bezier(.22,1,.36,1)' }} hover={{ background: 'rgba(255,255,255,.1)', transform: 'translateY(-2px)' }}>
                <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 48, lineHeight: 1, letterSpacing: '-.045em', fontVariantNumeric: 'tabular-nums' }}>{n(w.big * prog)}</span>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{w.t}</span>
                <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ya-text-on-night-2)', textWrap: 'pretty' }}>{w.s}</span>
                <div style={{ alignSelf: 'flex-start', marginTop: 'auto', paddingTop: 8 }}>
                  <BrandArrowButton
                    label={w.cta}
                    h={40}
                    onClick={() => navigate(w.to)}
                  />
                </div>
              </Hv>
            ))}
            {d.next && (
              <Hv key="next" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 20, borderRadius: 20, background: 'rgba(255,255,255,.06)', boxShadow: 'inset 0 0 0 1px var(--ya-border-night)', transition: 'background 160ms,transform 200ms cubic-bezier(.22,1,.36,1)' }} hover={{ background: 'rgba(255,255,255,.1)', transform: 'translateY(-2px)' }}>
                <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 48, lineHeight: 1, letterSpacing: '-.045em', fontVariantNumeric: 'tabular-nums' }}>{n(d.next.entries * prog)}</span>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{t('ya.gl.a.do.nextT', { title: d.next.title })}</span>
                <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ya-text-on-night-2)', textWrap: 'pretty' }}>
                  {`${tzWeek(T.locale, d.next.start_at, d.next.tz)} · ${d.next.today > 0 ? t('ya.gl.a.do.nextToday', { n: n(d.next.today) }) : t('ya.gl.a.do.nextS')}`}
                </span>
                <div style={{ alignSelf: 'flex-start', marginTop: 'auto', paddingTop: 8 }}>
                  <BrandArrowButton label={t('ya.gl.a.do.nextCta')} h={40} onClick={() => navigate(R.nightGuestList(d.next!.id))} />
                </div>
              </Hv>
            )}
          </div>
        </section>
      )}

    </>
  );
}

/** Une colonne par soirée : venus (rouge) sur inscrits ; gris si la porte n'a pas scanné. */
function NightsBars({ d, go, T }: { d: AnaGuestList; go: boolean; T: T }) {
  const { t, n, pct, locale } = T;
  const R = useTixRoutes();
  const [hov, setHov] = useState<{ i: number; x: number } | null>(null);
  const max = Math.max(1, ...d.nights.map((x) => x.entries));
  const H = 200;
  const gap = d.nights.length > 24 ? 4 : 8;
  const h = hov ? d.nights[hov.i] : null;
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div onMouseLeave={() => setHov(null)} style={{ display: 'flex', alignItems: 'flex-end', gap, height: H, borderBottom: '1px solid var(--ya-sand-200)' }}>
        {d.nights.map((x, i) => {
          const th = (x.entries / max) * 100;
          const cameH = x.scan_known && x.entries ? (x.came / x.entries) * 100 : 0;
          return (
            <Link
              key={x.id}
              to={R.nightGuestList(x.id)}
              onMouseEnter={(ev) => { const el = ev.currentTarget; const box = el.offsetParent as HTMLElement | null; setHov({ i, x: Math.max(110, Math.min((box?.clientWidth ?? 0) - 110, el.offsetLeft + el.offsetWidth / 2)) }); }}
              aria-label={`${x.title} · ${t('ya.gl.a.barAria', { n: n(x.entries), came: x.scan_known ? n(x.came) : '—' })}`}
              style={{ flex: '1 1 0', minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            >
              <span style={{ position: 'relative', display: 'block', width: '100%', maxWidth: 52, height: `${Math.max(2, th)}%`, borderRadius: '10px 10px 3px 3px', background: x.scan_known ? 'var(--ya-red-100)' : 'var(--ya-sand-200)', overflow: 'hidden', transform: `scaleY(${go ? 1 : 0})`, transformOrigin: 'bottom', transition: go ? `transform 650ms cubic-bezier(.22,1,.36,1) ${Math.min(i * 22, 600)}ms` : 'none', opacity: hov && hov.i !== i ? 0.5 : 1 }}>
                {x.scan_known && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${cameH.toFixed(1)}%`, background: 'linear-gradient(180deg,var(--ya-tangerine-500),var(--ya-red-500))' }} />}
              </span>
            </Link>
          );
        })}
      </div>
      {d.nights.length <= 12 ? (
        // Peu de soirées : la date sous chaque barre.
        <div style={{ display: 'flex', gap, fontFamily: 'var(--ya-font-mono)', fontSize: 11.5, color: 'var(--ya-sand-500)' }}>
          {d.nights.map((x) => <span key={x.id} style={{ flex: '1 1 0', minWidth: 0, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tzShort(locale, x.start_at, x.tz)}</span>)}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--ya-font-mono)', fontSize: 11.5, color: 'var(--ya-sand-500)' }}>
          <span>{tzShort(locale, d.nights[0].start_at, d.nights[0].tz)}</span>
          <span>{tzShort(locale, d.nights[d.nights.length - 1].start_at, d.nights[d.nights.length - 1].tz)}</span>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 13, color: 'var(--ya-sand-600)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 14, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg,var(--ya-tangerine-500),var(--ya-red-500))' }} />{t('ya.gl.a.legCame')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 14, borderRadius: '3px 3px 0 0', background: 'var(--ya-red-100)' }} />{t('ya.gl.a.legNo')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 14, borderRadius: '3px 3px 0 0', background: 'var(--ya-sand-200)' }} />{t('ya.gl.a.legUnknown')}</span>
      </div>
      {h && hov && (
        <div style={{ position: 'absolute', bottom: 70, left: hov.x, transform: 'translateX(-50%)', pointerEvents: 'none', background: 'var(--ya-tip-bg)', color: 'var(--ya-tip-fg)', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 1, whiteSpace: 'nowrap', boxShadow: 'var(--ya-shadow-md)', zIndex: 3 }}>
          <span style={{ fontSize: 12, color: 'var(--ya-text-on-night-2)' }}>{tzWeek(locale, h.start_at, h.tz)}</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{h.title}</span>
          <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>
            {!h.scan_known ? t('ya.gl.a.tipEntries', { n: n(h.entries) })
              : h.showup !== null ? t('ya.gl.a.tipKnown', { came: n(h.came), n: n(h.entries), pct: pct(h.showup) })
              : t('ya.gl.a.tipSmall', { came: n(h.came), n: n(h.entries) })}
          </span>
        </div>
      )}
    </div>
  );
}

function GlPeriodSkeleton() {
  return (
    <>
      <section style={{ ...card, padding: 'clamp(20px,2.4vw,32px)' }}><Sk h={30} w={260} /><Sk h={90} w={320} r={16} /><ChartSkeleton height={200} /></section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)}</div>
    </>
  );
}

/** Aucune inscription de guest list ni billet gratuit dans tout l'historique. */
function GlNever() {
  const { t } = useTixT();
  return (
    <>
      <section style={{ ...card, gap: 16, padding: 'clamp(24px,3vw,36px)', background: 'repeating-linear-gradient(135deg,var(--ya-sand-50) 0 10px,var(--ya-card) 10px 20px)' }}>
        <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.gl.k')}</span>
        <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 680 }}>{t('ya.gl.a.never.t')}</span>
        <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--ya-sand-600)', maxWidth: 620, textWrap: 'pretty' }}>{t('ya.gl.a.never.s')}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 12, maxWidth: 820 }}>
          {(['inv', 'free'] as const).map((k) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 18px', borderRadius: 18, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)' }}>
              <b style={{ fontSize: 15 }}>{t(`ya.gl.kind.${k}`)}</b>
              <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ya-sand-600)' }}>{t(`ya.gl.kind.${k}.s`)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
