import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShoppingBag, Users, Clock, Repeat, Hourglass, UserX, Lightbulb, CalendarClock,
  Layers, Plus, Crown, Shuffle, DoorOpen, Wine,
  ShieldCheck, GlassWater, ArrowUpCircle,
  Mail, MessageSquare, Wallet, Store, Gift,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePurchaseBehavior } from '@/hooks/usePurchaseBehavior';
import { dateRangeToWindow, type DateRange } from '@/hooks/useAnalyticsData';
import { AnalyticsAnchorNav, type AnchorSection } from '@/components/analytics/AnalyticsAnchorNav';
import { Heatmap } from '@/components/analytics/behaviorPrimitives';
import {
  BASKET_BANDS, LEAD_BUCKETS, buildInsights, fmtEur, fmtLeadHours, fmtNum, fmtPctLocale,
  heatmapMatrix, lastMinuteShare, peakSlot, ratio,
  type PbPillar, type PurchaseBehavior,
} from '@/lib/purchaseBehavior';

// ─── Design tokens (mêmes que la page Analytics) ──────────────────────────────
const RED = '#E8192C';
const POS = 'var(--acc-34d399)';
const GOLD = 'var(--acc-f2b23c)';
const BLUE = 'var(--acc-60a5fa)';
const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const FAINT = 'rgb(var(--ink)/0.06)';
const BORDER = 'rgb(var(--ink)/0.085)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

const PILLAR_COLOR: Record<PbPillar, string> = { tickets: RED, tables: GOLD, drinks: BLUE };

// ─── Primitives ───────────────────────────────────────────────────────────────
function Card({ title, sub, icon, right, children, className = '' }: {
  title?: string; sub?: string; icon?: React.ReactNode; right?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`relative overflow-hidden min-w-0 ${className}`}
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
      {(title || icon) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
                style={{ background: FAINT, border: `1px solid ${BORDER}`, color: T2 }}>{icon}</div>
            )}
            <div className="min-w-0">
              {title && <h3 className="m-0 text-[15px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>{title}</h3>}
              {sub && <p className="m-0 mt-0.5 text-xs" style={{ color: T3 }}>{sub}</p>}
            </div>
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function Zone({ id, icon, label, hint }: { id: string; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <div id={id} className="px-1 pt-3" style={{ scrollMarginTop: 84 }}>
      <div className="flex items-center gap-2">
        <span style={{ color: T2 }}>{icon}</span>
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: T2 }}>{label}</h3>
      </div>
      {hint && <p className="mt-1 text-xs" style={{ color: T3 }}>{hint}</p>}
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone = T1 }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-[0.06em]" style={{ color: T3 }}>
        <span style={{ color: T2 }}>{icon}</span>{label}
      </div>
      <div className="mt-2.5 text-[clamp(22px,2.4vw,28px)] font-[640] leading-none tabular-nums" style={{ color: tone, letterSpacing: '-0.025em' }}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs" style={{ color: T3 }}>{sub}</div>}
    </Card>
  );
}

/** Une ligne « libellé ……… valeur » avec sa barre de part. */
function BarRow({ label, value, share, color = RED, icon, note }: {
  label: string; value: string; share: number | null; color?: string; icon?: React.ReactNode; note?: string;
}) {
  const pct = share != null && isFinite(share) ? Math.max(0, Math.min(1, share)) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-[13px] mb-1.5">
        <span className="flex items-center gap-1.5 min-w-0 truncate" style={{ color: T2 }}>
          {icon && <span style={{ color }}>{icon}</span>}{label}
        </span>
        <span className="tabular-nums whitespace-nowrap" style={{ color: T1 }}>
          {value}{note && <span style={{ color: T3 }}> · {note}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Colonnes verticales, une ou deux séries empilées. */
function Columns({ items, height = 132 }: {
  items: { key: string; label: string; a: number; b?: number; title: string }[];
  height?: number;
}) {
  const max = Math.max(1, ...items.map(i => i.a + (i.b ?? 0)));
  return (
    <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: height + 34 }}>
      {items.map(i => {
        const total = i.a + (i.b ?? 0);
        const hA = (i.a / max) * height;
        const hB = ((i.b ?? 0) / max) * height;
        return (
          <div key={i.key} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={i.title}>
            <div className="text-[11px] tabular-nums mb-1" style={{ color: total > 0 ? T2 : T3 }}>{total > 0 ? total : ''}</div>
            <div className="w-full flex flex-col justify-end rounded-t-md overflow-hidden" style={{ height }}>
              {hB > 0 && <div style={{ height: hB, background: GOLD, opacity: 0.9 }} />}
              <div style={{ height: Math.max(total > 0 ? 2 : 1, hA), background: total > 0 ? RED : FAINT }} />
            </div>
            <div className="mt-1.5 text-[10.5px] text-center leading-tight truncate w-full" style={{ color: T3 }}>{i.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: T3 }}>
          <span className="w-2 h-2 rounded-sm" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: 'rgb(var(--ink)/0.025)', border: `1px solid ${BORDER}` }}>
      <div className="text-[11.5px]" style={{ color: T3 }}>{label}</div>
      <div className="mt-1 text-lg font-[640] tabular-nums leading-tight" style={{ color: T1, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px]" style={{ color: T3 }}>{sub}</div>}
    </div>
  );
}

function Chips<K extends string>({ value, options, onChange }: {
  value: K; options: { key: K; label: string }[]; onChange: (k: K) => void;
}) {
  return (
    <div className="inline-flex gap-1 p-1 rounded-xl flex-wrap" style={{ background: 'rgb(var(--ink)/0.025)', border: `1px solid ${BORDER}` }}>
      {options.map(o => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className="px-2.5 py-1 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
          style={value === o.key ? { color: 'rgb(var(--ink))', background: 'rgb(var(--ink)/0.12)' } : { color: T3 }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[13px] py-6 text-center" style={{ color: T3 }}>{text}</p>;
}

// ─── Vue ──────────────────────────────────────────────────────────────────────
export function PurchaseBehaviorView({ venueId = null, organizerUserId = null, dateRange }: {
  venueId?: string | null;
  organizerUserId?: string | null;
  dateRange: DateRange;
}) {
  const { t, language } = useLanguage();
  const range = useMemo(() => dateRangeToWindow(dateRange), [dateRange]);
  const { data, loading, error } = usePurchaseBehavior({ venueId, organizerUserId }, range);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-36 rounded-[18px] animate-pulse" style={{ background: 'rgb(var(--ink)/0.03)', border: `1px solid ${BORDER}` }} />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return <Card><Empty text={error === 'forbidden' ? t('pb.forbidden') : t('pb.error')} /></Card>;
  }
  if (data.summary.transactions === 0 && data.summary.guestlist === 0 && data.funnel.sessions === 0) {
    return (
      <Card>
        <div className="py-8 text-center">
          <ShoppingBag className="w-8 h-8 mx-auto mb-3" style={{ color: T3 }} />
          <p className="text-[15px] font-semibold" style={{ color: T1 }}>{t('pb.empty.title')}</p>
          <p className="mt-1 text-[13px]" style={{ color: T3 }}>{t('pb.empty.body')}</p>
        </div>
      </Card>
    );
  }
  return <PurchaseBehaviorBody d={data} allTime={dateRange === 'alltime'} t={t} language={language} />;
}

function PurchaseBehaviorBody({ d, allTime, t, language }: {
  d: PurchaseBehavior; allTime: boolean; t: (k: string) => string; language: string;
}) {
  const [heatPillar, setHeatPillar] = useState<PbPillar | 'all'>('all');
  const [bandPillar, setBandPillar] = useState<PbPillar>('tickets');

  const eur = (v: number | null) => fmtEur(v, language);
  const num = (v: number | null, digits = 0) => fmtNum(v, language, digits);
  const pct = (v: number | null, digits = 0) => fmtPctLocale(v, language, digits);
  const fill = (key: string, n: number | string) => t(key).replace('{n}', String(n));

  const s = d.summary;
  const insights = buildInsights(d, t, language);
  const pillarsPresent = new Set(d.pillars.map(p => p.pillar));

  const ticketsPre = d.leadTime.reduce((a, b) => a + b.tickets, 0);
  const tablesPre = d.leadTime.reduce((a, b) => a + b.tables, 0);
  const heat = heatmapMatrix(d.heatmap, heatPillar);
  const peak = peakSlot(heat);

  const tix = d.crossSell.find(c => c.pillar === 'tickets');
  const tbl = d.crossSell.find(c => c.pillar === 'tables');
  const gls = d.crossSell.find(c => c.pillar === 'guestlist');

  const freqTotal = d.loyalty.frequency.reduce((a, f) => a + f.buyers, 0);
  const roundsUnits = d.rounds.reduce((a, r) => a + r.units, 0);
  const bands = BASKET_BANDS.map(b => ({ band: b, n: d.basketBands.find(x => x.pillar === bandPillar && x.band === b)?.n ?? 0 }));
  const bandsTotal = bands.reduce((a, b) => a + b.n, 0);

  const att = d.attendance;

  const sections: AnchorSection[] = [
    { id: 'pb-when', label: t('pb.zone.when'), icon: CalendarClock },
    { id: 'pb-howmuch', label: t('pb.zone.howMuch'), icon: Layers },
    { id: 'pb-extras', label: t('pb.zone.extras'), icon: Plus },
    { id: 'pb-who', label: t('pb.zone.who'), icon: Crown },
    { id: 'pb-attendance', label: t('pb.zone.attendance'), icon: DoorOpen },
  ];

  const rise = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="space-y-4">
      {/* Pas d'en-tête : la vue vit sous « Comment mes clients achètent-ils ? »
          (Analytics › Communauté › Achats), qui porte déjà la question. */}
      <AnalyticsAnchorNav sections={sections} />

      {/* ── Chiffres clés ────────────────────────────────────────────────── */}
      {/* Quatre chiffres : « acheteurs » et « dépense par client » vivent dans
          Communauté › Vue d'ensemble et Ventes (plan de simplification). */}
      <motion.div {...rise} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<ShoppingBag className="w-3.5 h-3.5" />} label={t('pb.kpi.basket')} value={eur(s.avgBasket)}
          sub={t('pb.kpi.basketSub')} />
        <Kpi icon={<Repeat className="w-3.5 h-3.5" />} label={t('pb.kpi.repeat')} value={pct(ratio(s.repeatBuyers, s.buyers))}
          sub={fill('pb.kpi.repeatSub', num(s.repeatBuyers))} tone={POS} />
        <Kpi icon={<Hourglass className="w-3.5 h-3.5" />} label={t('pb.kpi.lead')} value={fmtLeadHours(s.medianLeadHours, t)}
          sub={t('pb.kpi.leadSub')} />
        <Kpi icon={<UserX className="w-3.5 h-3.5" />} label={t('pb.kpi.guest')} value={pct(ratio(s.guestCheckouts, s.transactions))}
          sub={t('pb.kpi.guestSub')} />
      </motion.div>

      {/* ── À retenir ────────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <Card icon={<Lightbulb className="w-4 h-4" />} title={t('pb.insights')}>
          <ul className="grid sm:grid-cols-2 gap-2.5">
            {insights.map(i => (
              <li key={i.key} className="flex gap-2.5 text-[13.5px] leading-snug rounded-xl px-3.5 py-3"
                style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.18)', color: T1 }}>
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-none" style={{ background: RED }} />
                {i.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ═══ Quand achètent-ils ? ═════════════════════════════════════════ */}
      <Zone id="pb-when" icon={<CalendarClock className="w-4 h-4" />} label={t('pb.zone.when')} hint={t('pb.zone.whenHint')} />

      <div className="grid lg:grid-cols-2 gap-3">
        <Card icon={<Hourglass className="w-4 h-4" />} title={t('pb.lead.title')} sub={t('pb.lead.sub')}
          right={<Legend items={[{ color: RED, label: t('pb.pillar.tickets') }, ...(tablesPre > 0 ? [{ color: GOLD, label: t('pb.pillar.tables') }] : [])]} />}>
          {ticketsPre + tablesPre === 0 ? <Empty text={t('pb.none')} /> : (
            <>
              <Columns items={LEAD_BUCKETS.map(b => {
                const row = d.leadTime.find(x => x.bucket === b);
                return {
                  key: b, label: t(`pb.lead.${b}`), a: row?.tickets ?? 0, b: row?.tables ?? 0,
                  title: `${t(`pb.lead.${b}`)} — ${row?.tickets ?? 0} / ${row?.tables ?? 0}`,
                };
              })} />
              <div className="grid grid-cols-3 gap-2 mt-3">
                <Stat label={t('pb.lead.medianTickets')} value={fmtLeadHours(d.leadMedian.tickets, t)} />
                <Stat label={t('pb.lead.medianTables')} value={fmtLeadHours(d.leadMedian.tables, t)} />
                <Stat label={t('pb.lead.last72')} value={pct(lastMinuteShare(d.leadTime, 'tickets'))} sub={t('pb.lead.last72Sub')} />
              </div>
            </>
          )}
        </Card>

        <Card icon={<Clock className="w-4 h-4" />} title={t('pb.heat.title')}
          sub={peak ? t('pb.heat.peak').replace('{day}', t(`pb.day.${peak.day}`)).replace('{h}', String(peak.hour)) : t('pb.heat.sub')}
          right={
            <Chips<PbPillar | 'all'> value={heatPillar} onChange={setHeatPillar} options={[
              { key: 'all', label: t('pb.all') },
              ...(['tickets', 'tables', 'drinks'] as PbPillar[]).filter(p => pillarsPresent.has(p)).map(p => ({ key: p, label: t(`pb.pillar.${p}`) })),
            ]} />
          }>
          {peak ? <Heatmap matrix={heat} language={language} /> : <Empty text={t('pb.none')} />}
          <p className="mt-3 text-[11.5px]" style={{ color: T3 }}>{t('pb.heat.tz').replace('{tz}', d.tz)}</p>
        </Card>
      </div>

      {d.hasDrinks && pillarsPresent.has('drinks') && (
        <Card icon={<Wine className="w-4 h-4" />} title={t('pb.night.title')} sub={t('pb.night.sub')}>
          <div className="grid lg:grid-cols-[1.4fr,1fr] gap-4">
            {d.nightDrinks.length === 0 ? <Empty text={t('pb.none')} /> : (
              <Columns items={Array.from({ length: 10 }, (_, i) => i - 1).map(h => {
                const row = d.nightDrinks.find(x => x.h === h);
                const label = h < 0 ? t('pb.night.before') : h >= 8 ? '+8 h' : `+${h} h`;
                return { key: String(h), label, a: row?.orders ?? 0, title: `${label} — ${row?.orders ?? 0} · ${eur(row?.amount ?? 0)}` };
              })} />
            )}
            <div className="grid grid-cols-2 gap-2 content-start">
              <Stat label={t('pb.night.perNight')} value={num(d.drinkRhythm.avgOrdersPerNight, 1)} sub={t('pb.night.perNightSub')} />
              <Stat label={t('pb.night.again')} value={pct(d.drinkRhythm.multiOrderShare)} sub={t('pb.night.againSub')} />
              <Stat label={t('pb.night.spend')} value={eur(d.drinkRhythm.avgSpendPerNight)} sub={t('pb.night.spendSub')} />
              <Stat label={t('pb.night.firstDrink')} value={d.drinkRhythm.medianMinutesEntryToFirstDrink != null ? fill('pb.unit.minutes', Math.round(d.drinkRhythm.medianMinutesEntryToFirstDrink)) : '—'}
                sub={t('pb.night.firstDrinkSub')} />
            </div>
          </div>
        </Card>
      )}

      {/* ═══ Combien achètent-ils ? ═══════════════════════════════════════ */}
      <Zone id="pb-howmuch" icon={<Layers className="w-4 h-4" />} label={t('pb.zone.howMuch')} hint={t('pb.zone.howMuchHint')} />

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {pillarsPresent.has('tickets') && (
          <Card icon={<Users className="w-4 h-4" />} title={t('pb.group.tickets')} sub={fill('pb.group.ticketsSub', num(d.groupSize.avgTicketsPerOrder, 1))}>
            <div className="space-y-3">
              {d.groupSize.tickets.map(g => {
                const total = d.groupSize.tickets.reduce((a, x) => a + x.n, 0);
                return <BarRow key={g.bucket} label={t(`pb.group.t.${g.bucket}`)} value={num(g.n)} share={ratio(g.n, total)} note={pct(ratio(g.n, total))} />;
              })}
            </div>
          </Card>
        )}
        {pillarsPresent.has('tables') && (
          <Card icon={<Crown className="w-4 h-4" />} title={t('pb.group.tables')}
            sub={fill('pb.group.tablesSub', num(d.groupSize.avgGuestsPerTable, 1)).replace('{e}', eur(d.groupSize.avgPerHead))}>
            <div className="space-y-3">
              {d.groupSize.tables.map(g => {
                const total = d.groupSize.tables.reduce((a, x) => a + x.n, 0);
                return <BarRow key={g.bucket} label={fill('pb.group.people', g.bucket.replace('_', '–').replace('p', '+'))} value={num(g.n)} share={ratio(g.n, total)} color={GOLD} note={pct(ratio(g.n, total))} />;
              })}
            </div>
          </Card>
        )}
        {pillarsPresent.has('drinks') && (
          <Card icon={<GlassWater className="w-4 h-4" />} title={t('pb.group.drinks')} sub={fill('pb.group.drinksSub', num(d.groupSize.avgItemsPerOrder, 1))}>
            <div className="space-y-3">
              {d.groupSize.drinks.map(g => {
                const total = d.groupSize.drinks.reduce((a, x) => a + x.n, 0);
                return <BarRow key={g.bucket} label={t(`pb.group.d.${g.bucket}`)} value={num(g.n)} share={ratio(g.n, total)} color={BLUE} note={pct(ratio(g.n, total))} />;
              })}
            </div>
          </Card>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card icon={<ShoppingBag className="w-4 h-4" />} title={t('pb.bands.title')} sub={t('pb.bands.sub')}
          right={pillarsPresent.size > 1 ? (
            <Chips<PbPillar> value={bandPillar} onChange={setBandPillar}
              options={(['tickets', 'tables', 'drinks'] as PbPillar[]).filter(p => pillarsPresent.has(p)).map(p => ({ key: p, label: t(`pb.pillar.${p}`) }))} />
          ) : undefined}>
          {bandsTotal === 0 ? <Empty text={t('pb.none')} /> : (
            <div className="space-y-3">
              {bands.map(b => (
                <BarRow key={b.band} label={t(`pb.bands.${b.band}`)} value={num(b.n)} share={ratio(b.n, bandsTotal)}
                  color={PILLAR_COLOR[bandPillar]} note={pct(ratio(b.n, bandsTotal))} />
              ))}
            </div>
          )}
        </Card>

        <Card icon={<ArrowUpCircle className="w-4 h-4" />} title={t('pb.rounds.title')} sub={t('pb.rounds.sub')}>
          {roundsUnits === 0 ? <Empty text={t('pb.rounds.none')} /> : (
            <div className="space-y-3">
              {d.rounds.map(r => (
                <BarRow key={r.rank} label={t(`pb.rounds.r${Math.min(r.rank, 3)}`)} value={fill('pb.unit.tickets', num(r.units))}
                  share={ratio(r.units, roundsUnits)} note={pct(ratio(r.units, roundsUnits))} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ═══ Ce qu'ils prennent en plus ═══════════════════════════════════ */}
      <Zone id="pb-extras" icon={<Plus className="w-4 h-4" />} label={t('pb.zone.extras')} hint={t('pb.zone.extrasHint')} />

      <Card>
        {(() => {
          const a = d.attach;
          const rows: { key: string; icon: React.ReactNode; label: string; n: number; base: number; sub?: string; show: boolean; color?: string }[] = [
            { key: 'ins', icon: <ShieldCheck className="w-3.5 h-3.5" />, label: t('pb.extras.insurance'), n: a.insurance, base: a.ticketOrders, show: a.ticketOrders > 0 },
            { key: 'drink', icon: <GlassWater className="w-3.5 h-3.5" />, label: t('pb.extras.bundled'), n: a.bundledDrink, base: a.ticketOrders, show: a.ticketOrders > 0,
              sub: a.bundledDrink > 0 ? fill('pb.extras.redeemed', pct(ratio(a.bundledDrinkRedeemed, a.bundledDrink))) : undefined, color: BLUE },
            { key: 'up', icon: <ArrowUpCircle className="w-3.5 h-3.5" />, label: t('pb.extras.upgrades'), n: a.upgrades, base: a.ticketOrders, show: a.ticketOrders > 0 },
            { key: 'loyal', icon: <Gift className="w-3.5 h-3.5" />, label: t('pb.extras.loyalty'), n: a.loyaltyRewards, base: a.ticketOrders, show: a.loyaltyRewards > 0, color: POS },
            { key: 'nl', icon: <Mail className="w-3.5 h-3.5" />, label: t('pb.extras.newsletter'), n: a.newsletter, base: a.optinBase, show: a.optinBase > 0, color: POS },
            { key: 'sms', icon: <MessageSquare className="w-3.5 h-3.5" />, label: t('pb.extras.sms'), n: a.sms, base: a.optinBase, show: a.optinBase > 0, color: POS },
            { key: 'dep', icon: <Wallet className="w-3.5 h-3.5" />, label: t('pb.extras.deposit'), n: a.tableDeposit, base: a.tableOrders, show: a.tableOrders > 0, color: GOLD },
            { key: 'site', icon: <Store className="w-3.5 h-3.5" />, label: t('pb.extras.onSite'), n: a.tableOnSite, base: a.tableOrders, show: a.tableOrders > 0, color: GOLD },
          ];
          const visible = rows.filter(r => r.show);
          if (visible.length === 0) return <Empty text={t('pb.none')} />;
          return (
            <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
              {visible.map(r => (
                <BarRow key={r.key} icon={r.icon} label={r.label} color={r.color ?? RED}
                  value={pct(ratio(r.n, r.base))} share={ratio(r.n, r.base)}
                  note={r.sub ?? `${num(r.n)}/${num(r.base)}`} />
              ))}
            </div>
          );
        })()}
      </Card>

      {/* ═══ Qui achète ? ═════════════════════════════════════════════════ */}
      <Zone id="pb-who" icon={<Crown className="w-4 h-4" />} label={t('pb.zone.who')} hint={t('pb.zone.whoHint')} />

      <div className="grid lg:grid-cols-2 gap-3">
        <Card icon={<Repeat className="w-4 h-4" />} title={t('pb.who.freq')} sub={t('pb.who.freqSub')}>
          {freqTotal === 0 ? <Empty text={t('pb.none')} /> : (
            <div className="space-y-3">
              {d.loyalty.frequency.map(fr => (
                <BarRow key={fr.bucket} label={t(`pb.who.f.${fr.bucket}`)} value={num(fr.buyers)} share={ratio(fr.buyers, freqTotal)}
                  color={fr.bucket === '1' ? 'rgb(var(--ink)/var(--ink-a35,0.35))' : POS} note={pct(ratio(fr.buyers, freqTotal))} />
              ))}
            </div>
          )}
        </Card>

        <Card icon={<Users className="w-4 h-4" />} title={t('pb.who.split')} sub={allTime ? t('pb.who.splitAllTime') : t('pb.who.splitSub')}>
          <div className="grid grid-cols-2 gap-2">
            {!allTime && <Stat label={t('pb.who.new')} value={num(s.newBuyers)} sub={fill('pb.who.ofRevenue', pct(ratio(d.loyalty.newAmount, d.loyalty.newAmount + d.loyalty.returningAmount)))} />}
            {!allTime && <Stat label={t('pb.who.returning')} value={num(Math.max(0, s.buyers - s.newBuyers))} sub={fill('pb.who.ofRevenue', pct(ratio(d.loyalty.returningAmount, d.loyalty.newAmount + d.loyalty.returningAmount)))} />}
            <Stat label={t('pb.who.gap')} value={d.loyalty.medianDaysBetween != null ? fill('pb.unit.days', Math.round(d.loyalty.medianDaysBetween)) : '—'} sub={t('pb.who.gapSub')} />
            <Stat label={t('pb.who.top10')} value={pct(d.loyalty.top10Share)} sub={t('pb.who.top10Sub')} />
          </div>
        </Card>
      </div>

      {(tix || tbl || gls) && (
        <Card icon={<Shuffle className="w-4 h-4" />} title={t('pb.cross.title')} sub={d.hasDrinks ? t('pb.cross.sub') : t('pb.cross.subOrg')}>
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
            {d.hasDrinks && tix && tix.pairs > 0 && (
              <BarRow icon={<Wine className="w-3.5 h-3.5" />} label={t('pb.cross.ticketBar')} value={pct(ratio(tix.withDrinks, tix.pairs))}
                share={ratio(tix.withDrinks, tix.pairs)} color={BLUE}
                note={tix.drinkSpend != null ? fill('pb.cross.spend', eur(tix.drinkSpend)) : undefined} />
            )}
            {d.hasDrinks && tbl && tbl.pairs > 0 && (
              <BarRow icon={<Wine className="w-3.5 h-3.5" />} label={t('pb.cross.tableBar')} value={pct(ratio(tbl.withDrinks, tbl.pairs))}
                share={ratio(tbl.withDrinks, tbl.pairs)} color={BLUE}
                note={tbl.drinkSpend != null ? fill('pb.cross.spend', eur(tbl.drinkSpend)) : undefined} />
            )}
            {d.hasDrinks && gls && gls.pairs > 0 && (
              <BarRow icon={<Wine className="w-3.5 h-3.5" />} label={t('pb.cross.glBar')} value={pct(ratio(gls.withDrinks, gls.pairs))}
                share={ratio(gls.withDrinks, gls.pairs)} color={BLUE}
                note={gls.drinkSpend != null ? fill('pb.cross.spend', eur(gls.drinkSpend)) : undefined} />
            )}
            {tix && tix.pairs > 0 && (
              <BarRow icon={<Crown className="w-3.5 h-3.5" />} label={t('pb.cross.ticketTable')} value={pct(ratio(tix.withTable, tix.pairs))}
                share={ratio(tix.withTable, tix.pairs)} color={GOLD} note={`${num(tix.withTable)}/${num(tix.pairs)}`} />
            )}
            {gls && gls.pairs > 0 && (
              <BarRow icon={<Crown className="w-3.5 h-3.5" />} label={t('pb.cross.glTable')} value={pct(ratio(gls.withTable, gls.pairs))}
                share={ratio(gls.withTable, gls.pairs)} color={GOLD} note={`${num(gls.withTable)}/${num(gls.pairs)}`} />
            )}
          </div>
        </Card>
      )}

      {/* Canaux et passage à l'achat : dans le Rapport de soirée (« D'où
          viennent les ventes ? ») et Trafic › Ma page (conversion). */}

      {/* ═══ Achat ≠ venue ═════════════════════════════════════════════════ */}
      <Zone id="pb-attendance" icon={<DoorOpen className="w-4 h-4" />} label={t('pb.zone.attendance')} hint={t('pb.zone.attendanceHint')} />

      {att.nights === 0 ? (
        <Card><Empty text={t('pb.att.none')} /></Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          <Card icon={<DoorOpen className="w-4 h-4" />} title={t('pb.att.title')} sub={fill('pb.att.sub', num(att.nights))}>
            <div className="space-y-3">
              {att.ticketOrders > 0 && (
                <BarRow label={t('pb.pillar.tickets')} value={pct(ratio(att.ticketScanned, att.ticketOrders))}
                  share={ratio(att.ticketScanned, att.ticketOrders)} color={POS}
                  note={fill('pb.att.noShow', pct(ratio(att.ticketOrders - att.ticketScanned, att.ticketOrders)))} />
              )}
              {att.tableOrders > 0 && (
                <BarRow label={t('pb.pillar.tables')} value={pct(ratio(att.tableScanned, att.tableOrders))}
                  share={ratio(att.tableScanned, att.tableOrders)} color={GOLD}
                  note={fill('pb.att.noShow', pct(ratio(att.tableOrders - att.tableScanned, att.tableOrders)))} />
              )}
              {att.guestlist > 0 && (
                <BarRow label={t('pb.pillar.guestlist')} value={pct(ratio(att.guestlistScanned, att.guestlist))}
                  share={ratio(att.guestlistScanned, att.guestlist)} color={BLUE}
                  note={fill('pb.att.noShow', pct(ratio(att.guestlist - att.guestlistScanned, att.guestlist)))} />
              )}
            </div>
            <p className="mt-4 text-[11.5px]" style={{ color: T3 }}>{t('pb.att.note')}</p>
          </Card>
          <Card icon={<Hourglass className="w-4 h-4" />} title={t('pb.att.byLead')} sub={t('pb.att.byLeadSub')}>
            {att.byLead.every(b => b.orders === 0) ? <Empty text={t('pb.none')} /> : (
              <div className="space-y-3">
                {att.byLead.filter(b => b.orders > 0).map(b => (
                  <BarRow key={b.bucket} label={t(`pb.lead.${b.bucket}`)} value={pct(ratio(b.scanned, b.orders))}
                    share={ratio(b.scanned, b.orders)} color={POS} note={fill('pb.att.orders', num(b.orders))} />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <p className="px-1 pt-2 text-[11.5px] leading-relaxed" style={{ color: T3 }}>{t('pb.footnote')}</p>
    </div>
  );
}
