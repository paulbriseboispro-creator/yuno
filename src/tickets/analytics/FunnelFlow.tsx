/**
 * Yuno Tickets › Analyses › Trafic : le tunnel d'achat en cinq étapes
 * (visite → choix → « Vos infos » → paiement Stripe → commande validée) et les
 * billets choisis pendant les visites, achetés ou non. Lu dans `funnel.flow`
 * de tix_ana_visits (migration 20261216100000), sur la période ET sur une
 * soirée. Des visites, jamais des euros (Trafic se compte en personnes).
 */
import { useState } from 'react';
import type { AnaVisits, FunnelChoice } from '@/tickets/analytics/data';
import { ticketDisplayName } from '@/lib/ticketGroups';
import { useTixT } from './i18n';
import { CardHead, Fill, card, fadeIn } from './anaUi';
import { Segmented } from './kit';
import { MIN_SAMPLE, rate } from './TrafficTab';
import { biggestLoss, choiceHighlights, flowPillars, flowRows, flowSteps, type FlowStep, type FlowView } from './funnelSteps';

type T = ReturnType<typeof useTixT>;

function selectedLabel(view: FlowView, t: T['t']): string {
  return view === 'all' ? t('ya.tv.fl.s.selected') : t(`ya.tv.fl.s.selected.${view}`);
}

export function PurchaseFunnelCard({ d, rv, go, prog }: { d: AnaVisits; rv: boolean; go: boolean; prog: number }) {
  const T = useTixT();
  const { t, tp, n, pct } = T;
  const flow = d.funnel.flow!;
  const pillars = flowPillars(flow);
  const [view, setView] = useState<FlowView>('all');
  const v: FlowView = view !== 'all' && !pillars.includes(view) ? 'all' : view;
  const s = flowSteps(flow, v);
  // La comparaison par pilier n'est pas servie : seule la vue « Tout » compare.
  const prev = v === 'all' ? flow.prev : null;
  const rows = flowRows(v);
  const top = Math.max(1, s.viewed);
  const conv = rate(s.purchased, s.viewed);
  const pConv = prev ? rate(prev.purchased, prev.viewed) : null;
  const dConv = conv !== null && pConv !== null ? conv - pConv : null;
  const loss = biggestLoss(s, rows);
  const label = (k: FlowStep) => (k === 'selected' ? selectedLabel(v, t) : t(`ya.tv.fl.s.${k}`));
  const fn = d.funnel;

  return (
    <section id="ya-funnel" style={{ ...card, gap: 18, scrollMarginTop: 84, ...fadeIn(rv, 120) }}>
      <CardHead
        title={t('ya.tv.fl.t')}
        sub={t('ya.tv.fl.sub')}
        right={pillars.length >= 2 ? (
          <Segmented<FlowView>
            size="sm"
            value={v}
            onChange={setView}
            ariaLabel={t('ya.tv.fl.t')}
            options={[{ value: 'all', label: t('ya.tv.fl.all') }, ...pillars.map((k) => ({ value: k as FlowView, label: t(`ya.tv.fl.p.${k}`) }))]}
          />
        ) : undefined}
      />
      {s.viewed === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.fnNone')}</p> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
          <div style={{ flex: '0 1 220px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: 'var(--ya-font-num)', fontWeight: 650, fontSize: 36, lineHeight: 0.95, letterSpacing: '-.025em', fontVariantNumeric: 'tabular-nums' }}>
              {conv !== null ? pct(conv * prog, 1) : n(s.purchased)}
            </span>
            <span style={{ fontSize: 14, color: 'var(--ya-sand-500)', lineHeight: 1.4 }}>{conv !== null ? t('ya.tv.fl.big') : t('ya.tv.fl.bigN')}</span>
            {dConv !== null && (
              <span style={{ fontSize: 13, fontWeight: 600, color: dConv >= 0 ? 'var(--ya-green-700)' : 'var(--ya-red-600)' }}>
                {`${dConv >= 0 ? '▲' : '▼'} ${t('ya.tv.pts', { n: T.n1(Math.abs(dConv)) })} ${t(flow.prev_kind === 'event' ? 'ya.tv.fl.vsEvent' : 'ya.tv.fl.vsPeriod')}`}
              </span>
            )}
          </div>
          <div style={{ flex: '1 1 440px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {rows.map((k, i) => {
              const val = s[k];
              const before = i > 0 ? s[rows[i - 1]] : null;
              const lost = before !== null ? before - val : 0;
              const share = s.viewed >= MIN_SAMPLE ? (val / s.viewed) * 100 : null;
              const pass = i >= 2 && before !== null && before >= MIN_SAMPLE ? (val / before) * 100 : null;
              const ghost = prev && prev.viewed >= MIN_SAMPLE && k !== 'viewed' ? (prev[k] / prev.viewed) * 100 : null;
              return (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, color: 'var(--ya-sand-700)' }}>
                      <span style={{ flex: 'none', width: 20, height: 20, borderRadius: 99, display: 'inline-grid', placeItems: 'center', fontSize: 11.5, fontWeight: 700, background: k === 'purchased' ? 'var(--ya-red-500)' : 'var(--ya-sand-100)', color: k === 'purchased' ? '#fff' : 'var(--ya-sand-700)' }}>{i + 1}</span>
                      <span>{label(k)}</span>
                    </span>
                    <span>
                      <b>{n(val)}</b>
                      {share !== null && <span style={{ color: 'var(--ya-sand-500)' }}>{` · ${t('ya.tv.fl.ofVisits', { p: pct(share, 1) })}`}</span>}
                    </span>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <Fill pct={Math.max(1.5, (val / top) * 100)} go={go} delay={i * 90} h={14} bg={k === 'purchased' ? 'var(--ya-gradient-brand)' : 'var(--ya-red-200)'} dur={900} />
                    {ghost !== null && (
                      <i aria-hidden style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${Math.min(100, ghost)}% - 1px)`, width: 2, borderRadius: 2, background: 'var(--ya-sand-500)' }} />
                    )}
                  </div>
                  {(() => {
                    const note = [
                      k === 'payment' ? t('ya.tv.fl.s.paymentS') : '',
                      pass !== null ? t('ya.tv.fl.pass', { p: pct(pass, 1) }) : '',
                      lost > 0 ? tp('ya.tv.fl.lost', lost, { n: n(lost) }) : '',
                    ].filter(Boolean).join(' · ');
                    return note ? <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--ya-sand-500)' }}>{note}</span> : null;
                  })()}
                  {k === 'payment' && s.details > s.payment && (
                    <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{tp('ya.tv.fl.detailsGap', s.details - s.payment, { n: n(s.details - s.payment) })}</span>
                  )}
                </div>
              );
            })}
            {prev && prev.viewed >= MIN_SAMPLE && (
              <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t(flow.prev_kind === 'event' ? 'ya.tv.fl.tick.event' : 'ya.tv.fl.tick.period')}</span>
            )}
          </div>
          {fn.failed > 0 && v === 'all' && (
            <div style={{ flex: '0 1 220px', alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 16, background: 'var(--ya-red-50)' }}>
              <b style={{ fontSize: 14.5 }}>{tp('ya.tv.fn.failed', fn.failed, { n: n(fn.failed) })}</b>
              {fn.reasons.map((r) => (
                <span key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5, color: 'var(--ya-sand-700)' }}>
                  <span>{t(`ya.tv.fail.${['network', 'validation', 'server', 'sold_out'].includes(r.reason) ? r.reason : 'other'}`)}</span><b>{n(r.n)}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {loss && (
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-700)', textWrap: 'pretty' }}>
          {t('ya.tv.fl.most', { a: t(`ya.tv.fl.short.${loss.from}`), b: t(`ya.tv.fl.short.${loss.to}`), n: n(loss.lost), of: n(loss.of), p: pct(loss.pct, 1) })}
        </p>
      )}
    </section>
  );
}

function choiceName(c: FunnelChoice): string {
  return c.pillar === 'tickets' ? ticketDisplayName(c.name, c.pack) : c.name;
}

export function ChoicesCard({ d, rv, go, ev = false }: { d: AnaVisits; rv: boolean; go: boolean; ev?: boolean }) {
  const T = useTixT();
  const { t, tp, n, pct, eur, dShort } = T;
  const choices = d.funnel.flow?.choices ?? [];
  const max = Math.max(1, ...choices.map((c) => Math.max(c.chosen, c.soldout_seen)));
  const anyOut = choices.some((c) => c.soldout_seen > 0);
  const { left, out } = choiceHighlights(choices);
  const cols = `minmax(210px,2fr) minmax(120px,1fr) 96px 96px minmax(205px,1.1fr) 92px${anyOut ? ' 96px' : ''}`;
  const [all, setAll] = useState(false);
  const shown = all ? choices : choices.slice(0, 12);
  const head = { fontSize: 12, color: 'var(--ya-sand-500)', fontWeight: 600 } as const;

  return (
    <section id="ya-choices" style={{ ...card, gap: 16, scrollMarginTop: 84, ...fadeIn(rv, 160) }}>
      <CardHead title={t('ya.tv.ch.t')} sub={t('ya.tv.ch.sub')} />
      {choices.length === 0 ? <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.ch.none')}</p> : (
        <>
          {(left || out) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-700)' }}>
              {left && <span>{tp('ya.tv.ch.topLeft', left.left, { name: choiceName(left), n: n(left.left), of: n(left.chosen), s: n(left.seats) })}</span>}
              {out && <span>{tp('ya.tv.ch.topOut', out.soldout_seen, { name: choiceName(out), n: n(out.soldout_seen) })}</span>}
            </div>
          )}
          <div style={{ overflowX: 'auto', margin: '0 -6px' }}>
            <div style={{ minWidth: anyOut ? 980 : 880, padding: '0 6px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, padding: '0 10px 8px', borderBottom: '1px solid var(--ya-sand-100)' }}>
                <span style={head}>{t('ya.tv.ch.c.name')}</span>
                <span style={head}>{t('ya.tv.ch.c.chosen')}</span>
                <span style={{ ...head, textAlign: 'right' }}>{t('ya.tv.ch.c.bought')}</span>
                <span style={{ ...head, textAlign: 'right' }}>{t('ya.tv.ch.c.left')}</span>
                <span style={head}>{t('ya.tv.ch.c.stop')}</span>
                <span style={{ ...head, textAlign: 'right' }}>{t('ya.tv.ch.c.seats')}</span>
                {anyOut && <span style={{ ...head, textAlign: 'right' }}>{t('ya.tv.ch.c.soldout')}</span>}
              </div>
              {shown.map((c, i) => {
                const br = rate(c.bought, c.chosen);
                const sub = [
                  c.pillar === 'tables' ? t('ya.tv.ch.table') : null,
                  c.price !== null && c.price !== undefined ? eur(Number(c.price)) : null,
                  ev ? null : `${c.event_title} · ${dShort(c.event_start)}`,
                ].filter(Boolean).join(' · ');
                return (
                  <div key={`${c.event_id}:${c.pillar}:${c.id}`} style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, alignItems: 'center', padding: '11px 10px', borderBottom: '1px solid var(--ya-sand-50)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={choiceName(c)}>{choiceName(c)}</b>
                      {sub && <span style={{ fontSize: 12, color: 'var(--ya-sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <b>{n(c.chosen)}</b>
                      <Fill pct={Math.max(c.chosen ? 2 : 0, (c.chosen / max) * 100)} go={go} delay={i * 50} h={6} bg="var(--ya-red-400)" dur={800} />
                    </span>
                    <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                      <b>{n(c.bought)}</b>
                      <span style={{ fontSize: 12, color: 'var(--ya-sand-500)' }}>{br !== null ? pct(br) : t('ya.tv.ch.of', { n: n(c.chosen) })}</span>
                    </span>
                    <b style={{ textAlign: 'right', color: c.left > 0 ? 'var(--ya-red-600)' : 'var(--ya-sand-400)' }}>{n(c.left)}</b>
                    <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', color: c.left > 0 ? 'var(--ya-sand-700)' : 'var(--ya-sand-400)' }}>
                      {c.left > 0 ? t('ya.tv.ch.stop', { a: n(c.at_choice), b: n(c.at_info), c: n(c.at_pay) }) : '—'}
                    </span>
                    <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{c.seats > 0 ? n(c.seats) : '—'}</span>
                    {anyOut && <span style={{ textAlign: 'right', color: 'var(--ya-sand-700)' }}>{c.soldout_seen > 0 ? n(c.soldout_seen) : '—'}</span>}
                  </div>
                );
              })}
            </div>
          </div>
          {choices.length > 12 && (
            <button type="button" onClick={() => setAll((x) => !x)} style={{ alignSelf: 'flex-start', height: 34, padding: '0 14px', border: 0, borderRadius: 12, background: 'var(--ya-sand-100)', color: 'var(--ya-ink)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
              {all ? t('ya.tv.ch.less') : t('ya.tv.ch.more', { n: n(choices.length) })}
            </button>
          )}
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ya-sand-500)' }}>{t('ya.tv.ch.foot')}</span>
        </>
      )}
    </section>
  );
}
