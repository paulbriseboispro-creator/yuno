/**
 * Analyses › Ventes, une soirée choisie (lot 2 du plan combiné,
 * docs/designs/TICKETS_ANALYTICS_COMBINED_PLAN.md) : le rapport de soirée de
 * la Billetterie, dessiné comme les Analyses du CRM.
 *
 * - `NightHeader` : la soirée, son moment, la réponse en une phrase, « À
 *   retenir » et « Comparer avec ».
 * - `TargetCard` : l'objectif d'entrées (events.entry_target) et le rythme.
 * - `DoorCard` : la porte (tix_night_door) — présents, absents, CA par
 *   personne, arrivées par demi-heure ; « porte non mesurée » sinon.
 * - `LinesCard` : chaque tarif, formule ou liste, avec son stock et son état.
 *
 * Tout vient de `get_event_report` (déjà gardée, mêmes portes que l'Analytics
 * de la Billetterie) et de `tix_night_door` : aucune somme n'est faite ici, les
 * règles (phrase, objectif, rythme) sont celles de src/lib/eventReport.ts.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Hv } from '@/crm/ui/Hv';
import { useTixT } from '@/tickets/analytics/i18n';
import type { AnaPillar, TixNightDoor } from '@/tickets/analytics/data';
import {
  reportHasActivity, reportHeadline, targetStatus, todayD, visitSourceLabel,
  type EventReport, type ReportLine, type ReportTakeaway,
} from '@/lib/eventReport';
import { CardHead, Fill, Sk, StatePill, card, fadeIn } from './anaUi';

type T = ReturnType<typeof useTixT>;

const PHASE_STATE = { before: 'presale', live: 'tonight', after: 'past' } as const;

/** « J-6 », « Jour J ». */
function jLabel(t: T['t'], d: number): string {
  return d <= 0 ? t('ya.ana.jDay') : t('ya.ana.jMinus', { k: d });
}

/** « lundi 19 octobre » → « Lundi 19 octobre » (une seule majuscule). */
function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Heure dans le fuseau de la soirée (« 22:30 »). */
function hourIn(at: string, tz: string, locale: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz });
}

// ── En-tête : la soirée, la phrase, « À retenir », « Comparer avec » ─────

export function NightHeader({ report, compare, door, compareId, onCompare, nights, rv }: {
  report: EventReport | null;
  compare: EventReport | null;
  door: TixNightDoor | null;
  compareId: string | null;
  onCompare: (id: string | null) => void;
  nights: { id: string; title: string; start_at: string; upcoming: boolean }[];
  rv: boolean;
}) {
  const T = useTixT();
  const { t, dShort, dLong } = T;
  if (!report) {
    return (
      <section style={{ ...card, gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><Sk h={64} w={64} r={16} /><div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}><Sk h={22} w="50%" /><Sk h={14} w="35%" /></div></div>
        <Sk h={28} w="80%" />
      </section>
    );
  }
  const ev = report.event;
  const d = todayD(report);
  const options = nights.filter((n) => n.id !== ev.id && new Date(n.start_at).getTime() < new Date(ev.startAt).getTime());
  return (
    <section style={{ ...card, gap: 18, padding: 'clamp(20px,2.4vw,28px)', ...fadeIn(rv) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 18px' }}>
        {ev.poster && <img src={ev.poster} alt="" style={{ width: 64, height: 64, flex: 'none', borderRadius: 16, objectFit: 'cover' }} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200, flex: '1 1 260px' }}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.025em', textWrap: 'balance' }}>{ev.title}</span>
            <StatePill state={PHASE_STATE[ev.phase]} label={t(`ya.nr.phase.${ev.phase}`)} />
            {ev.phase === 'before' && <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.06em', color: 'var(--ya-sand-500)' }}>{jLabel(t, d)}</span>}
          </span>
          <span style={{ fontSize: 13.5, color: 'var(--ya-sand-500)' }}>
            {capitalizeFirst(dLong(ev.startAt))}{ev.venueName ? ` · ${ev.venueName}` : ''}
          </span>
        </div>
        <label style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, maxWidth: '100%', fontSize: 13, color: 'var(--ya-sand-600)' }}>
          <span style={{ whiteSpace: 'nowrap' }}>{t('ya.nr.compareWith')}</span>
          <select
            value={compareId ?? ''}
            onChange={(e) => onCompare(e.target.value || null)}
            style={{ maxWidth: 'min(260px, 100%)', minWidth: 0, height: 34, padding: '0 10px', borderRadius: 99, border: 0, boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', background: 'var(--ya-card)', color: 'var(--ya-ink)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
          >
            <option value="">{t('ya.nr.compareNone')}</option>
            {compareId && !options.some((o) => o.id === compareId) && compare && <option value={compareId}>{compare.event.title} · {dShort(compare.event.startAt)}</option>}
            {options.map((o) => <option key={o.id} value={o.id}>{o.title} · {dShort(o.start_at)}</option>)}
          </select>
        </label>
      </div>
      <p style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(19px,2vw,23px)', lineHeight: 1.3, letterSpacing: '-.015em', textWrap: 'pretty' }}>
        {answerText(report, compare, door, T)}
      </p>
      <Takeaways report={report} />
    </section>
  );
}

/** La première phrase, règle de reportHeadline (Billetterie). */
function answerText(r: EventReport, compare: EventReport | null, door: TixNightDoor | null, T: T): string {
  const { t, n, eur, eur2, dShort } = T;
  const h = reportHeadline(r, compare);
  // Le titre ET la date : une série compare souvent « La Nikoumouk » à « La Nikoumouk ».
  const ref = compare ? t('ya.nr.refNight', { t: compare.event.title, d: dShort(compare.event.startAt) }) : '';
  if (h.kind === 'empty') return t(h.phase === 'after' ? 'ya.nr.ans.emptyAfter' : 'ya.nr.ans.emptyBefore');
  if (h.kind === 'after') {
    const measured = door ? door.measured : h.entered > 0;
    const rev = h.revenue !== null && h.revenue > 0 ? t('ya.nr.ans.rev', { v: eur(h.revenue) }) : '';
    if (!measured) return `${t('ya.nr.ans.afterNoDoor', { e: n(h.expected) })}${rev}.`;
    const head = door?.money.per_head.revenue != null ? t('ya.nr.ans.head', { v: eur2(Number(door.money.per_head.revenue)) }) : '';
    const base = `${t('ya.nr.ans.after', { n: n(h.entered), e: n(h.expected) })}${rev}${head}.`;
    if (h.reference === null) return base;
    const diff = h.entered - h.reference;
    return `${base} ${t(diff > 0 ? 'ya.nr.ans.afterMore' : diff < 0 ? 'ya.nr.ans.afterLess' : 'ya.nr.ans.afterSame', { x: n(Math.abs(diff)), ref })}`;
  }
  const unit = t(`ya.nr.unit.${h.pillar}`);
  const j = jLabel(t, h.daysBefore);
  const base = h.capacity
    ? t('ya.nr.ans.sellCap', { n: n(h.sold), cap: n(h.capacity), unit, j })
    : t('ya.nr.ans.sell', { n: n(h.sold), unit, j });
  if (h.reference === null || !ref) return base;
  const diff = h.sold - h.reference;
  return `${base} ${t(diff > 0 ? 'ya.nr.ans.more' : diff < 0 ? 'ya.nr.ans.less' : 'ya.nr.ans.same', { x: n(Math.abs(diff)), ref })}`;
}

/** « À retenir » : 0 à 3 constats calculés par get_event_report, chacun avec son seuil. */
function Takeaways({ report }: { report: EventReport }) {
  const { t, n, pct } = useTixT();
  const { t: tMain } = useLanguage();
  const items = report.takeaways ?? [];
  if (!items.length || !reportHasActivity(report)) return null;
  const num = (v: string | number | null | undefined) => (typeof v === 'number' ? v : Number(v ?? 0));
  const text = (tk: ReportTakeaway) => {
    const p = tk.params;
    const key = tk.key === 'msg_drove' ? `ya.nr.tk.msg_drove.${p.kind === 'push' ? 'push' : 'email'}` : `ya.nr.tk.${tk.key}`;
    return t(key, {
      // Une conversion se lit au dixième : arrondie, 1,6 % devenait « 2 % ».
      pct: tk.key === 'low_conversion' ? pct(num(p.pct), 1) : pct(num(p.pct)),
      missing: n(num(p.missing)), visits: n(num(p.visits)), n: n(num(p.n)),
      title: String(p.title ?? ''), source: visitSourceLabel(String(p.source ?? ''), tMain),
    });
  };
  const dot = { good: 'var(--ya-green-500)', bad: 'var(--ya-red-500)', info: 'var(--ya-sand-400)' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 18px', borderRadius: 16, background: 'var(--ya-sand-50)' }}>
      <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.nr.takeaways')}</span>
      {items.map((tk) => (
        <span key={tk.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, lineHeight: 1.45 }}>
          <i style={{ flex: 'none', width: 8, height: 8, marginTop: 7, borderRadius: 99, background: dot[tk.tone] }} />
          {text(tk)}
        </span>
      ))}
    </div>
  );
}

/** Repères de la courbe J-21 → J (publication, nouveau tarif) : les envois de messages y sont déjà. */
export function reportMarks(report: EventReport | null, t: T['t']): { i: number; title: string }[] {
  if (!report?.markers) return [];
  return report.markers
    .filter((m) => m.kind === 'published' || m.kind === 'round')
    .map((m) => ({
      i: 21 - m.d,
      title: m.kind === 'published' ? t('ya.nr.mk.published') : m.label ? t('ya.nr.mk.round', { label: m.label }) : t('ya.nr.mk.roundBare'),
    }))
    .filter((m) => m.i >= 0 && m.i <= 21);
}

// ── Objectif d'entrées et rythme ─────────────────────────────────────────

export function TargetCard({ report, compare, rv, go }: { report: EventReport | null; compare: EventReport | null; rv: boolean; go: boolean }) {
  const { t, n, pct } = useTixT();
  const [target, setTarget] = useState<number | null>(report?.event.entryTarget ?? null);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const id = report?.event.id ?? null;
  useEffect(() => { setTarget(report?.event.entryTarget ?? null); }, [report?.event.entryTarget]);
  useEffect(() => {
    setEditing(false);
    setCanEdit(false);
    if (!id) return;
    let alive = true;
    // La même porte que l'écriture (club qui porte la soirée, organisateur et son équipe, partenaire).
    void supabase.rpc('can_set_event_entry_target', { p_event_id: id }).then(({ data }) => { if (alive) setCanEdit(data === true); });
    return () => { alive = false; };
  }, [id]);

  if (!report) return <section style={{ ...card, flex: '1 1 380px' }}><Sk h={22} w="45%" /><Sk h={160} r={16} /></section>;
  const status = targetStatus(report, compare, target);
  const after = report.event.phase === 'after';

  const save = async (value: number | null) => {
    setSaving(true);
    // null retire l'objectif (les types générés ignorent qu'un argument SQL peut être NULL).
    const { error } = await supabase.rpc('set_event_entry_target', { p_event_id: report.event.id, p_target: value as number });
    setSaving(false);
    if (error) { toast.error(t('ya.nr.tg.saveError')); return; }
    setTarget(value);
    setEditing(false);
  };
  const submit = () => {
    const v = Math.round(Number(draft));
    if (!Number.isFinite(v) || v < 1 || v > 100000) { toast.error(t('ya.nr.tg.invalid')); return; }
    void save(v);
  };

  const pill = (label: string, onClick: () => void, primary = false) => (
    <Hv as="button" type="button" onClick={onClick} disabled={saving} style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: primary ? 'var(--ya-ink)' : 'var(--ya-sand-100)', color: primary ? 'var(--ya-card)' : 'var(--ya-ink)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }} hover={{ filter: 'brightness(1.05)' }}>{label}</Hv>
  );

  let body: JSX.Element;
  if (editing) {
    body = (
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <input
          type="number" inputMode="numeric" min={1} max={100000} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          aria-label={t('ya.nr.tg.label')}
          style={{ width: 120, height: 40, padding: '0 14px', borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1px var(--ya-sand-300)', background: 'var(--ya-card)', color: 'var(--ya-ink)', fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
        />
        <span style={{ fontSize: 14, color: 'var(--ya-sand-600)' }}>{t('ya.nr.tg.unit')}</span>
        <Hv as="button" type="submit" disabled={saving} style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: 'var(--ya-gradient-brand)', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} hover={{ filter: 'brightness(1.05)' }}>{t('ya.nr.tg.save')}</Hv>
        {pill(t('ya.nr.tg.cancel'), () => setEditing(false))}
        {target !== null && pill(t('ya.nr.tg.remove'), () => void save(null))}
      </form>
    );
  } else if (status.kind === 'none') {
    // Sans objectif : le rythme seul, s'il dit quelque chose.
    const pace = targetStatus(report, compare, 1);
    const p = pace.kind === 'progress' ? pace.pace : null;
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-600)' }}>{t(after ? 'ya.nr.tg.noneAfter' : 'ya.nr.tg.none')}</p>
        {p && <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>{t('ya.nr.tg.paceOnly', { n: n(p.projected), ref: p.refTitle })}</p>}
        {canEdit && <div>{pill(t('ya.nr.tg.set'), () => { setDraft(''); setEditing(true); }, true)}</div>}
      </div>
    );
  } else {
    const ratio = (status.current / status.target) * 100;
    const reached = status.current >= status.target;
    const p = status.pace;
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 44, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{n(status.current)}</span>
          <span style={{ fontSize: 16, color: 'var(--ya-sand-500)' }}>/ {n(status.target)} {t(status.measure === 'entered' ? 'ya.nr.tg.entered' : 'ya.nr.tg.expected')}</span>
          <b style={{ marginLeft: 'auto', fontSize: 15, color: reached ? 'var(--ya-green-700)' : 'var(--ya-ink)' }}>{pct(ratio)}</b>
        </div>
        <Fill pct={ratio} go={go} h={12} bg={reached ? 'var(--ya-green-500)' : 'var(--ya-gradient-brand)'} />
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-700)' }}>
          {reached
            ? t(after ? 'ya.nr.tg.reachedAfter' : 'ya.nr.tg.reached')
            : after
              ? t('ya.nr.tg.missedAfter', { n: n(status.target - status.current) })
              : p
                ? t(p.projected >= status.target ? 'ya.nr.tg.paceAhead' : 'ya.nr.tg.paceBehind', { n: n(p.projected), ref: p.refTitle, x: n(Math.abs(status.target - p.projected)) })
                : t('ya.nr.tg.left', { n: n(status.target - status.current) })}
        </p>
        {canEdit && <div>{pill(t('ya.nr.tg.edit'), () => { setDraft(String(status.target)); setEditing(true); })}</div>}
      </div>
    );
  }
  return (
    <section style={{ ...card, flex: '1 1 380px', ...fadeIn(rv, 60) }}>
      <CardHead title={t('ya.nr.tg.title')} sub={t(after ? 'ya.nr.tg.subAfter' : 'ya.nr.tg.sub')} />
      {body}
    </section>
  );
}

// ── La porte ──────────────────────────────────────────────────────────────

export function DoorCard({ door, loading, rv, go }: { door: TixNightDoor | null; loading: boolean; rv: boolean; go: boolean }) {
  const T = useTixT();
  const { t, n, pct, eur2, dLong, locale } = T;
  const [hover, setHover] = useState<number | null>(null);
  if (loading || !door) return <section style={{ ...card, flex: '1.3 1 480px' }}><Sk h={22} w="35%" /><Sk h={200} r={16} /></section>;
  const rows: { k: 'tickets' | 'tables' | 'guestlist'; label: string }[] = [
    { k: 'tickets', label: t('ya.nr.door.tickets') },
    { k: 'tables', label: t('ya.nr.door.tables') },
    { k: 'guestlist', label: t('ya.nr.door.guestlist') },
  ];
  const shown = rows.filter((r) => (door.pillars[r.k]?.expected ?? 0) > 0 || (door.pillars[r.k]?.entered ?? 0) > 0);
  const presence = door.measured && door.expected >= 10 ? (door.entered / door.expected) * 100 : null;
  const after = !door.upcoming;
  const max = Math.max(1, ...door.arrivals.map((a) => a.n));
  const peak = door.arrivals.reduce<{ at: string; n: number } | null>((b, a) => (!b || a.n > b.n ? a : b), null);
  const slot = (at: string) => {
    const end = new Date(new Date(at).getTime() + 30 * 60_000).toISOString();
    return `${hourIn(at, door.tz, locale)}–${hourIn(end, door.tz, locale)}`;
  };

  const pillarRows = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {shown.map((r, i) => {
        const p = door.pillars[r.k];
        const pr = p.expected > 0 ? (p.entered / p.expected) * 100 : 0;
        return (
          <div key={r.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,150px) minmax(0,1fr) auto', gap: 14, alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid var(--ya-sand-100)' : 'none' }}>
            <span style={{ fontSize: 14, color: 'var(--ya-sand-600)' }}>{r.label}</span>
            {door.started ? <Fill pct={pr} go={go} delay={i * 90} h={8} bg="var(--ya-green-500)" /> : <span />}
            <b style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14.5, whiteSpace: 'nowrap' }}>
              {door.started ? `${n(p.entered)} / ${n(p.expected)}` : t('ya.nr.door.expectedN', { n: n(p.expected) })}
            </b>
          </div>
        );
      })}
    </div>
  );

  let body: JSX.Element;
  if (!door.started) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-600)' }}>{t('ya.nr.door.notYet', { date: dLong(door.start_at), n: n(door.expected) })}</p>
        {pillarRows}
      </div>
    );
  } else if (!door.measured) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--ya-sand-600)' }}>
          {door.entered > 0 ? t('ya.nr.door.notMeasured', { n: n(door.entered), e: n(door.expected) }) : t('ya.nr.door.noScan', { e: n(door.expected) })}
        </p>
        {pillarRows}
      </div>
    );
  } else {
    const absent = Math.max(0, door.expected - door.entered);
    const head = door.money.per_head.revenue;
    const stats: { l: string; v: string; c?: string }[] = [
      { l: t('ya.nr.door.present'), v: n(door.entered), c: presence !== null ? t('ya.nr.door.presentCap', { p: pct(presence), e: n(door.expected) }) : t('ya.nr.door.expectedN', { n: n(door.expected) }) },
      ...(after ? [{ l: t('ya.nr.door.absent'), v: n(absent), c: t('ya.nr.door.absentCap') }] : []),
      ...(head !== null && head !== undefined ? [{ l: t('ya.nr.door.perHead'), v: eur2(Number(head)), c: t('ya.nr.door.perHeadCap') }] : []),
    ];
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))`, gap: 12 }}>
          {stats.map((s) => (
            <div key={s.l} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 16, background: 'var(--ya-sand-50)', minWidth: 0 }}>
              <span style={{ fontSize: 13, color: 'var(--ya-sand-600)' }}>{s.l}</span>
              <b style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{s.v}</b>
              {s.c && <span style={{ fontSize: 12.5, lineHeight: 1.35, color: 'var(--ya-sand-500)' }}>{s.c}</span>}
            </div>
          ))}
        </div>
        {door.arrivals.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('ya.nr.door.arrivals')}</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }} onMouseLeave={() => setHover(null)}>
              {door.arrivals.map((a, i) => (
                <div key={a.at} onMouseEnter={() => setHover(i)} title={`${slot(a.at)} : ${n(a.n)}`}
                  style={{ flex: 1, minWidth: 6, height: `${Math.max(3, (a.n / max) * 100)}%`, borderRadius: '6px 6px 2px 2px', background: hover === i || a === peak ? 'var(--ya-gradient-brand)' : 'var(--ya-red-200)', transform: `scaleY(${go ? 1 : 0})`, transformOrigin: 'bottom', transition: go ? `transform 600ms ease-out ${i * 30}ms` : 'none', cursor: 'crosshair' }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--ya-font-mono)', fontSize: 10.5, color: 'var(--ya-sand-500)' }}>
              <span>{hourIn(door.arrivals[0].at, door.tz, locale)}</span>
              <span>{hourIn(door.arrivals[door.arrivals.length - 1].at, door.tz, locale)}</span>
            </div>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ya-sand-700)' }}>
              {hover !== null && door.arrivals[hover]
                ? t('ya.nr.door.slot', { s: slot(door.arrivals[hover].at), n: n(door.arrivals[hover].n) })
                : peak ? t('ya.nr.door.peak', { s: slot(peak.at), n: n(peak.n) }) : ''}
            </span>
          </div>
        )}
        {pillarRows}
        {door.undated > 0 && <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{t('ya.nr.door.undated', { n: n(door.undated) })}</span>}
      </div>
    );
  }
  return (
    <section style={{ ...card, flex: '1.3 1 480px', ...fadeIn(rv, 100) }}>
      <CardHead title={t('ya.nr.door.title')} sub={t(door.started ? 'ya.nr.door.sub' : 'ya.nr.door.subBefore')} />
      {body}
    </section>
  );
}

// ── Tarifs, formules, listes de la soirée ────────────────────────────────

const LINE_PILLAR: Record<AnaPillar, ReportLine['pillar'][] | null> = {
  all: ['tickets', 'tables', 'guestList'], tickets: ['tickets'], tables: ['tables'], guestlist: ['guestList'], refunds: null,
};

export function LinesCard({ report, pillar, money, rv, go }: { report: EventReport | null; pillar: AnaPillar; money: boolean; rv: boolean; go: boolean }) {
  const { t, tp, n, eur, eur2 } = useTixT();
  if (!report) return <section style={{ ...card, flex: '1.2 1 460px' }}><Sk h={22} w="40%" /><Sk h={220} r={16} /></section>;
  const keep = LINE_PILLAR[pillar] ?? [];
  const lines = report.lines.filter((l) => keep.includes(l.pillar));
  const status = (s: ReportLine['status']) => {
    const c = s === 'sold_out' ? ['var(--ya-red-50)', 'var(--ya-red-700)'] : s === 'on_sale' ? ['var(--ya-green-50)', 'var(--ya-green-700)'] : ['var(--ya-sand-100)', 'var(--ya-sand-600)'];
    return <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: c[0], color: c[1], whiteSpace: 'nowrap' }}>{t(`ya.nr.line.${s}`)}</span>;
  };
  const unit = (l: ReportLine, x: number) => (l.pillar === 'tables' ? tp('ya.ana.s.nTables', x, { n: n(x) }) : l.pillar === 'guestList' ? tp('ya.ana.nSignups', x, { n: n(x) }) : t('ya.ana.nTickets', { n: n(x) }));
  const name = (l: ReportLine) => l.name ?? t(l.pillar === 'guestList' ? 'ya.ana.gl.house' : 'ya.ana.s.tarNone');
  return (
    <section style={{ ...card, flex: '1.2 1 460px', gap: 14 }}>
      <CardHead title={t('ya.nr.line.title')} sub={t('ya.nr.line.sub')} />
      {lines.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.nr.line.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', ...fadeIn(rv, 100) }}>
          {lines.map((l, i) => {
            const fillP = l.capacity ? (l.sold / l.capacity) * 100 : null;
            // Une soirée passée ne vend plus rien : ce qui n'est pas complet est fermé.
            const st: ReportLine['status'] = report.event.phase === 'after' && l.status !== 'sold_out' ? 'closed' : l.status;
            return (
              <div key={`${l.pillar}:${l.id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1.2fr) minmax(0,1fr) auto', gap: 14, alignItems: 'center', padding: '11px 0', borderTop: i ? '1px solid var(--ya-sand-100)' : 'none' }}>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(l)}</span>
                    {status(st)}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{l.price === null ? '—' : Number(l.price) === 0 ? t('ya.ana.free') : eur2(Number(l.price))}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--ya-sand-600)', fontVariantNumeric: 'tabular-nums' }}>{l.capacity ? `${n(l.sold)} / ${n(l.capacity)}` : unit(l, l.sold)}</span>
                  <Fill pct={fillP ?? 0} go={go} delay={i * 70} h={6} bg={st === 'sold_out' ? 'var(--ya-red-500)' : l.pillar === 'tables' ? 'var(--ya-amber-500)' : 'var(--ya-red-200)'} />
                </span>
                <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 14.5, whiteSpace: 'nowrap' }}>{money && l.amount !== null ? eur(Number(l.amount)) : unit(l, l.sold)}</b>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
