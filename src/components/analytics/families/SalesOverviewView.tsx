/**
 * Ventes › Vue d'ensemble — la même vue pour le club et l'organisateur
 * (plan `docs/designs/ANALYTICS_SIMPLIFICATION_PLAN.md`, lot 3).
 *
 * Une question : « combien ont rapporté mes dernières soirées ? ». Toujours
 * dans cet ordre : la réponse en une phrase, quatre chiffres comparés aux
 * soirées d'avant, UN graphique (piloté par la tuile choisie), la liste qui
 * explique le pilier et le tableau soirée par soirée, puis le détail replié.
 * Le filtre de pilier (Tout · Billets · Tables · Bar · Guest list) garde la
 * MÊME anatomie : on lit tous les piliers de la même façon.
 *
 * Chiffres : `get_sales_overview` (période en SOIRÉES passées). L'argent des
 * soirées à venir n'est pas ici — une ligne renvoie vers elles.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSalesOverview } from '@/hooks/useSalesOverview';
import {
  AnalyticsLoading, AnswerLine, ChoicePills, DeltaBadge, EmptyAnswer, KpiRow, KpiTile, MoreDetail, RankedList,
  StackBar, UpdatedAt,
} from '@/components/analytics/kit';
import { KIT, useKpiFormat, useNumberFormat } from '@/components/analytics/kitFormat';
import { ReportCard, CardTitle } from '@/components/event-report/ui';
import {
  SALES_PERIODS, bestNight, chartSeries, metricValue, nightDeltas, pillarHasActivity, pillarKpis, pillarsFor,
  type SalesKpi, type SalesMetricKey, type SalesNight, type SalesOverview, type SalesPeriod, type SalesPillar,
} from '@/lib/salesOverview';

// Couleurs en hex : recharts les pose en attributs SVG (pas de var()).
const PILLAR_COLORS = { tickets: '#E8192C', tables: '#F2B23C', bar: '#38BDF8' } as const;
const AXIS = '#8B8B92';
const INK_BAR = '#9A9AA2';

/** Clés qu'on sait lire soirée par soirée (le temps de service n'en est pas). */
const PER_NIGHT: SalesMetricKey[] = [
  'revenue', 'rev_tickets', 'rev_tables', 'rev_bar', 'entries', 'customers', 'spendPerHead',
  'tickets', 'ticketPrice', 'fill', 'tables', 'tableSpend', 'tablePresence', 'bar_orders', 'barBasket',
  'gl_registered', 'gl_entered', 'glPresence',
];

export function SalesOverviewView({
  venueId, organizerUserId, eventHref, eventsHref, accountingHref, renderDetail, canExport = true,
}: {
  venueId?: string | null;
  organizerUserId?: string | null;
  /** Lien vers le Rapport d'une soirée. */
  eventHref: (id: string) => string;
  /** Liste des soirées (pour l'argent déjà vendu des soirées à venir). */
  eventsHref: string;
  /** Page où vit le net versé (comptabilité). */
  accountingHref?: string;
  /** Le détail replié d'un pilier (composants hérités, chargés à l'ouverture). */
  renderDetail?: (pillar: SalesPillar, period: SalesPeriod) => ReactNode;
  /** Plan qui autorise l'export (club) ; l'organisateur exporte toujours. */
  canExport?: boolean;
}) {
  const { t } = useLanguage();
  const [period, setPeriod] = useState<SalesPeriod>(() => readPref('period', SALES_PERIODS, 'last4'));
  const [pillar, setPillar] = useState<SalesPillar>('all');
  const { data, loading, error, fetchedAt } = useSalesOverview({ venueId, organizerUserId }, period);

  const changePeriod = (p: SalesPeriod) => { setPeriod(p); writePref('period', p); };

  const pillars = data ? pillarsFor(data) : (['all', 'tickets', 'tables', 'guestList'] as SalesPillar[]);
  const activePillar = pillars.includes(pillar) ? pillar : 'all';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChoicePills<SalesPillar>
          label={t('so.pillarLabel')}
          value={activePillar}
          onChange={setPillar}
          options={pillars.map((p) => ({ value: p, label: t(`so.pillar.${p}`) }))}
        />
        <div className="flex flex-wrap items-center gap-3">
          <UpdatedAt at={fetchedAt} />
          {canExport && data && data.nights.length > 0 && (
            <button type="button" onClick={() => exportNightsCsv(data, t)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium"
              style={{ background: 'rgb(var(--ink)/0.05)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}>
              <Download className="h-3.5 w-3.5" aria-hidden />{t('so.export')}
            </button>
          )}
          <label className="sr-only" htmlFor="so-period">{t('so.periodLabel')}</label>
          <select
            id="so-period"
            value={period}
            onChange={(e) => changePeriod(e.target.value as SalesPeriod)}
            className="rounded-xl px-3 py-2 text-[12.5px] font-medium"
            style={{ background: 'rgb(var(--ink)/0.05)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}
          >
            {SALES_PERIODS.map((p) => <option key={p} value={p}>{t(`so.period.${p}`)}</option>)}
          </select>
        </div>
      </div>

      {loading && !data ? (
        <AnalyticsLoading rows={2} />
      ) : error || !data ? (
        <EmptyAnswer title={t(error === 'forbidden' ? 'so.err.forbidden' : 'so.err.load')} />
      ) : (
        <PillarBody
          key={activePillar}
          data={data}
          pillar={activePillar}
          eventHref={eventHref}
          eventsHref={eventsHref}
          accountingHref={accountingHref}
          renderDetail={renderDetail ? (p) => renderDetail(p, period) : undefined}
        />
      )}
    </div>
  );
}

function PillarBody({ data, pillar, eventHref, eventsHref, accountingHref, renderDetail }: {
  data: SalesOverview; pillar: SalesPillar;
  eventHref: (id: string) => string; eventsHref: string; accountingHref?: string;
  renderDetail?: (pillar: SalesPillar) => ReactNode;
}) {
  const { t } = useLanguage();
  const fmt = useKpiFormat();
  const kpis = useMemo(() => pillarKpis(data, pillar), [data, pillar]);
  const chartable = kpis.filter((k) => PER_NIGHT.includes(k.key));
  const [chartKey, setChartKey] = useState<SalesMetricKey | null>(chartable[0]?.key ?? null);
  const cur = data.current;
  const prevN = data.previous?.nights ?? 0;
  const vs = prevN > 0 ? (prevN === 1 ? t('so.vs1') : t('so.vs').replace('{n}', String(prevN))) : undefined;

  const upcomingLine = <UpcomingLine data={data} eventsHref={eventsHref} />;

  if (cur.nights === 0) {
    return (
      <div className="space-y-4">
        <EmptyAnswer title={t('so.empty.none')} body={t('so.empty.noneBody')} />
        {upcomingLine}
      </div>
    );
  }
  if (!pillarHasActivity(cur, pillar)) {
    return (
      <div className="space-y-4">
        <EmptyAnswer title={t(`so.empty.${pillar}`)} body={t('so.empty.quietBody').replace('{nights}', nightsWord(t, cur.nights))} />
        {upcomingLine}
      </div>
    );
  }

  const activeKpi = kpis.find((k) => k.key === chartKey) ?? chartable[0];

  return (
    <div className="space-y-4">
      <AnswerLine><Answer data={data} pillar={pillar} /></AnswerLine>

      <KpiRow>
        {kpis.map((k) => (
          <KpiTile
            key={k.key}
            label={t(k.labelKey)}
            hint={t(k.hintKey)}
            value={fmt(k.value, k.format)}
            delta={<DeltaBadge current={k.value} previous={k.previous} format={k.format} lowerIsBetter={k.lowerIsBetter} vs={vs} />}
            active={activeKpi?.key === k.key}
            onSelect={PER_NIGHT.includes(k.key) ? () => setChartKey(k.key) : undefined}
          />
        ))}
      </KpiRow>

      {activeKpi && <NightsChart data={data} kpi={activeKpi} pillar={pillar} eventHref={eventHref} />}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <SideCard data={data} pillar={pillar} />
        <NightsTable data={data} pillar={pillar} eventHref={eventHref} />
      </div>

      {(pillar === 'all' && data.money && typeof cur.revenue === 'number') && (
        data.has_bar
          ? <NetLine revenue={cur.revenue} stripe={cur.stripe ?? 0} href={accountingHref} />
          // Organisateur : sa part dépend du partage avec les clubs — elle se
          // lit en comptabilité, qui l'applique soirée par soirée.
          : <NetLine revenue={cur.revenue} stripe={cur.stripe ?? 0} href={accountingHref} shareOnly />
      )}
      {upcomingLine}

      {renderDetail && (
        <MoreDetail label={t(`so.detail.${pillar}`)}>{renderDetail(pillar)}</MoreDetail>
      )}
    </div>
  );
}

// ─── La phrase-réponse ───────────────────────────────────────────────────────

function nightsWord(t: (k: string) => string, n: number) {
  return n === 1 ? t('so.nights.one') : t('so.nights.n').replace('{n}', String(n));
}

function Answer({ data, pillar }: { data: SalesOverview; pillar: SalesPillar }) {
  const { t } = useLanguage();
  const fmt = useKpiFormat();
  const { n, eur } = useNumberFormat();
  const cur = data.current;
  const prev = data.previous;
  const nights = nightsWord(t, cur.nights);
  const B = ({ children }: { children: ReactNode }) => <strong style={{ fontWeight: 650 }}>{children}</strong>;
  const fill = (tpl: string, parts: Record<string, ReactNode>) => {
    // Remplit « {x} » avec des nœuds React (chiffres en gras).
    const out: ReactNode[] = [];
    tpl.split(/(\{[a-zA-Z]+\})/g).forEach((chunk, i) => {
      const m = chunk.match(/^\{([a-zA-Z]+)\}$/);
      out.push(m && m[1] in parts ? <span key={i}>{parts[m[1]]}</span> : chunk);
    });
    return out;
  };

  let main: ReactNode[];
  let cmpKey: SalesMetricKey | null = null;
  switch (pillar) {
    case 'all':
      if (data.money && typeof cur.revenue === 'number') {
        main = fill(t('so.a.all'), {
          revenue: <B>{eur(cur.revenue)}</B>, nights,
          entries: <B>{n(cur.entries)}</B>,
          spend: <B>{fmt(metricValue(cur, 'spendPerHead'), 'eur')}</B>,
        });
        if (cur.entries === 0) main = fill(t('so.a.allNoEntries'), { revenue: <B>{eur(cur.revenue)}</B>, nights, customers: <B>{n(cur.customers)}</B> });
        cmpKey = 'revenue';
      } else {
        main = fill(t('so.a.allNoMoney'), { entries: <B>{n(cur.entries)}</B>, customers: <B>{n(cur.customers)}</B>, nights });
        cmpKey = 'entries';
      }
      break;
    case 'tickets': {
      const f = metricValue(cur, 'fill');
      main = fill(t(f === null ? 'so.a.ticketsNoFill' : 'so.a.tickets'), {
        tickets: <B>{n(cur.tickets)}</B>, nights, fill: <B>{fmt(f, 'pct')}</B>,
      });
      cmpKey = 'tickets';
      break;
    }
    case 'tables':
      main = fill(t('so.a.tables'), { tables: <B>{n(cur.tables)}</B>, nights, guests: <B>{n(cur.table_guests)}</B> });
      cmpKey = 'tables';
      break;
    case 'bar':
      main = fill(t(data.money ? 'so.a.bar' : 'so.a.barNoMoney'), {
        orders: <B>{n(cur.bar_orders)}</B>, nights, basket: <B>{fmt(metricValue(cur, 'barBasket'), 'eur')}</B>,
      });
      cmpKey = 'bar_orders';
      break;
    case 'guestList':
      main = fill(t('so.a.gl'), {
        registered: <B>{n(cur.gl_registered)}</B>, nights, presence: <B>{fmt(metricValue(cur, 'glPresence'), 'pct')}</B>,
      });
      cmpKey = 'gl_registered';
      break;
  }

  // La comparaison en mots, seulement s'il y a une référence et un écart.
  let cmp: ReactNode = null;
  if (cmpKey && prev && prev.nights > 0) {
    const a = metricValue(cur, cmpKey) ?? 0;
    const b = metricValue(prev, cmpKey) ?? 0;
    const diff = a - b;
    if (Math.abs(diff) > 0.5) {
      const money = cmpKey === 'revenue';
      const amount = <B>{money ? eur(Math.abs(diff)) : n(Math.abs(diff))}</B>;
      cmp = <> {fill(t(diff > 0 ? 'so.a.cmpUp' : 'so.a.cmpDown'), {
        amount, nights: prev.nights === 1 ? t('so.a.prev1') : t('so.a.prevN').replace('{n}', String(prev.nights)),
      })}</>;
    }
  }

  // La meilleure soirée, quand il y en a plusieurs.
  const bestKey: SalesMetricKey = pillar === 'all' ? (data.money ? 'revenue' : 'entries')
    : pillar === 'tickets' ? 'tickets' : pillar === 'tables' ? 'tables' : pillar === 'bar' ? (data.money ? 'rev_bar' : 'bar_orders') : 'gl_registered';
  const best = bestNight(data.nights, bestKey);
  const bestFmt = bestKey === 'revenue' || bestKey === 'rev_bar' ? 'eur' : 'n';

  return (
    <>
      {main}{cmp}
      {best && <> {fill(t('so.a.best'), { title: <B>{best.title}</B>, value: fmt(metricValue(best, bestKey), bestFmt) })}</>}
    </>
  );
}

// ─── Le graphique : une barre par soirée ─────────────────────────────────────

function NightsChart({ data, kpi, pillar, eventHref }: {
  data: SalesOverview; kpi: SalesKpi; pillar: SalesPillar; eventHref: (id: string) => string;
}) {
  const { t, language } = useLanguage();
  const fmt = useKpiFormat();
  const navigate = useNavigate();
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const open = (d: { id?: string }) => { if (d?.id) navigate(eventHref(d.id)); };
  // CA de « Tout » : empilé par pilier, pour voir d'où vient l'argent de chaque soirée.
  const stacked = pillar === 'all' && kpi.key === 'revenue';
  const stackKeys: SalesMetricKey[] = data.has_bar ? ['rev_tickets', 'rev_tables', 'rev_bar'] : ['rev_tickets', 'rev_tables'];
  const series = useMemo(
    () => chartSeries(data.nights, stacked ? stackKeys : [kpi.key]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.nights, kpi.key, stacked],
  );
  const rows = series.points.map((p) => ({ ...p.values, key: p.key, label: p.label, ts: p.ts, id: p.id }));
  const dateLabel = (ts: number) => new Intl.DateTimeFormat(locale, series.unit === 'month'
    ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }).format(new Date(ts));
  const title = t(series.unit === 'month' ? 'so.chart.month' : 'so.chart.night').replace('{metric}', t(kpi.labelKey));
  const stackLabels: Record<string, string> = { rev_tickets: t('so.pillar.tickets'), rev_tables: t('so.pillar.tables'), rev_bar: t('so.pillar.bar') };
  const colorOf = (k: string) => k === 'rev_tickets' ? PILLAR_COLORS.tickets : k === 'rev_tables' ? PILLAR_COLORS.tables : PILLAR_COLORS.bar;
  const clickable = series.unit === 'night';

  if (rows.length < 2) return null; // une seule soirée : les tuiles disent tout.

  return (
    <ReportCard>
      <CardTitle title={title} />
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={AXIS} strokeOpacity={0.15} />
            <XAxis dataKey="ts" tickFormatter={dateLabel} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickFormatter={(v: number) => fmt(v, kpi.format)} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
            <Tooltip
              cursor={{ fill: AXIS, fillOpacity: 0.08 }}
              contentStyle={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: KIT.T1, fontWeight: 600 }}
              labelFormatter={(_: unknown, payload: { payload?: { label?: string; ts?: number } }[]) => {
                const p = payload?.[0]?.payload;
                return p ? (series.unit === 'month' ? dateLabel(p.ts ?? 0) : `${p.label} · ${dateLabel(p.ts ?? 0)}`) : '';
              }}
              formatter={(v: number, name: string) => [fmt(v, kpi.format), stacked ? stackLabels[name] ?? name : t(kpi.labelKey)]}
            />
            {stacked
              ? stackKeys.map((k, i) => (
                <Bar key={k} dataKey={k} stackId="rev" fill={colorOf(k)} isAnimationActive={false}
                  radius={i === stackKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  cursor={clickable ? 'pointer' : undefined}
                  onClick={clickable ? open : undefined} />
              ))
              : (
                <Bar dataKey={kpi.key} fill={INK_BAR} radius={[4, 4, 0, 0]} isAnimationActive={false}
                  cursor={clickable ? 'pointer' : undefined}
                  onClick={clickable ? open : undefined} />
              )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2" style={{ fontSize: 12, color: KIT.T3 }}>
        {stacked ? (
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {stackKeys.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5" style={{ color: KIT.T2 }}>
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(k) }} />{stackLabels[k]}
              </span>
            ))}
          </span>
        ) : <span />}
        {clickable && <span>{t('so.chart.hint')}</span>}
      </div>
    </ReportCard>
  );
}

// ─── La carte qui explique le pilier ─────────────────────────────────────────

function SideCard({ data, pillar }: { data: SalesOverview; pillar: SalesPillar }) {
  const { t } = useLanguage();
  const { n, eur } = useNumberFormat();
  const fmtPct = useKpiFormat();
  const more = t('so.more');
  const less = t('so.less');
  const cur = data.current;

  if (pillar === 'all') {
    if (!data.money || !cur.revenue) {
      // Sans l'argent : qui est entré, par pilier.
      return (
        <ReportCard>
          <CardTitle title={t('so.side.entries')} hint={t('gl.entries')} />
          <StackBar format={(v) => n(v)} parts={[
            { key: 't', label: t('so.pillar.tickets'), value: cur.ticket_entries, color: PILLAR_COLORS.tickets },
            { key: 'g', label: t('so.pillar.guestList'), value: cur.gl_entered, color: '#A78BFA' },
            { key: 'b', label: t('so.pillar.tables'), value: Math.max(0, cur.entries - cur.ticket_entries - cur.gl_entered), color: PILLAR_COLORS.tables },
          ]} />
        </ReportCard>
      );
    }
    return (
      <ReportCard>
        <CardTitle title={t('so.side.mix')} hint={t('gl.revenue')} />
        <StackBar format={eur} parts={[
          { key: 't', label: t('so.pillar.tickets'), value: cur.rev_tickets ?? 0, color: PILLAR_COLORS.tickets },
          { key: 'tb', label: t('so.pillar.tables'), value: cur.rev_tables ?? 0, color: PILLAR_COLORS.tables },
          ...(data.has_bar ? [{ key: 'b', label: t('so.pillar.bar'), value: cur.rev_bar ?? 0, color: PILLAR_COLORS.bar }] : []),
        ]} />
      </ReportCard>
    );
  }

  let title = '';
  let rows: { key: string; label: ReactNode; value: string; note?: string; share: number }[] = [];
  if (pillar === 'tickets') {
    title = t('so.side.rounds');
    rows = data.rounds.map((r) => ({ key: r.name, label: r.name, value: `${n(r.sold)} ${t('so.u.tickets')}`, note: r.amount != null ? eur(r.amount) : undefined, share: r.sold }));
  } else if (pillar === 'tables') {
    title = t('so.side.packs');
    rows = data.packs.map((p) => ({ key: p.name, label: p.name, value: `${n(p.booked)} ${t('so.u.tables')}`, note: p.amount != null ? eur(p.amount) : `${n(p.guests)} ${t('so.u.guests')}`, share: p.booked }));
  } else if (pillar === 'bar') {
    title = t('so.side.products');
    rows = data.products.map((p) => ({ key: p.name, label: p.name, value: n(p.qty), note: p.amount != null ? eur(p.amount) : undefined, share: p.qty }));
  } else {
    title = t('so.side.holders');
    rows = data.holders.map((h) => ({
      key: `${h.kind}:${h.name}`,
      label: h.kind === 'club' ? t('so.holder.club') : h.kind === 'organizer' ? t('so.holder.organizer') : h.name,
      value: `${n(h.registered)} ${t('so.u.registered')}`,
      note: h.registered >= 10 ? `${fmtPct((h.entered / h.registered) * 100, 'pct')} ${t('so.u.came')}` : `${n(h.entered)} ${t('so.u.entered')}`,
      share: h.registered,
    }));
  }
  return (
    <ReportCard>
      <CardTitle title={title} />
      {rows.length === 0
        ? <p style={{ color: KIT.T3, fontSize: 13 }}>{t('so.side.none')}</p>
        : <RankedList rows={rows} moreLabel={more} lessLabel={less} />}
    </ReportCard>
  );
}

// ─── Soirée par soirée ───────────────────────────────────────────────────────

function NightsTable({ data, pillar, eventHref }: { data: SalesOverview; pillar: SalesPillar; eventHref: (id: string) => string }) {
  const { t, language } = useLanguage();
  const fmt = useKpiFormat();
  const [open, setOpen] = useState(false);
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));

  type Col = { key: SalesMetricKey; label: string; format: 'eur' | 'n' | 'pct'; of?: (x: SalesNight) => string };
  const cols: Col[] = (() => {
    switch (pillar) {
      case 'all': return data.money
        ? [{ key: 'entries', label: t('m.entries'), format: 'n' }, { key: 'revenue', label: t('m.revenue'), format: 'eur' }]
        : [{ key: 'entries', label: t('m.entries'), format: 'n' }, { key: 'customers', label: t('m.customers'), format: 'n' }];
      case 'tickets': return [
        { key: 'tickets', label: t('so.col.sold'), format: 'n', of: (x) => x.ticket_cap ? `${fmt(x.tickets, 'n')} / ${fmt(x.ticket_cap, 'n')}` : fmt(x.tickets, 'n') },
        ...(data.money ? [{ key: 'rev_tickets' as SalesMetricKey, label: t('m.revenue'), format: 'eur' as const }] : []),
      ];
      case 'tables': return [
        { key: 'tables', label: t('so.pillar.tables'), format: 'n' },
        ...(data.money ? [{ key: 'rev_tables' as SalesMetricKey, label: t('m.revenue'), format: 'eur' as const }] : [{ key: 'tables' as SalesMetricKey, label: t('so.k.tableGuests'), format: 'n' as const, of: (x: SalesNight) => fmt(x.table_guests, 'n') }]),
      ];
      case 'bar': return [
        { key: 'bar_orders', label: t('so.k.barOrders'), format: 'n' },
        ...(data.money ? [{ key: 'rev_bar' as SalesMetricKey, label: t('m.revenue'), format: 'eur' as const }] : []),
      ];
      case 'guestList': return [
        { key: 'gl_registered', label: t('m.guestList'), format: 'n' },
        { key: 'gl_entered', label: t('m.entries'), format: 'n' },
      ];
    }
  })();
  const deltaKey = cols[cols.length - 1].key;
  const deltas = nightDeltas(data.nights, deltaKey);
  const rows = open ? data.nights : data.nights.slice(0, 7);
  const grid = `minmax(0,1fr) ${cols.map(() => 'minmax(64px,auto)').join(' ')} 64px`;

  return (
    <ReportCard>
      <CardTitle title={t('so.nightsTitle')} />
      <div className="overflow-x-auto">
        <div className="min-w-[360px]">
          <div className="grid gap-3 pb-2" style={{ gridTemplateColumns: grid, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: KIT.T3 }}>
            <span>{t('so.col.night')}</span>
            {cols.map((c) => <span key={c.label} className="text-right">{c.label}</span>)}
            <span className="text-right">{t('so.col.vsPrev')}</span>
          </div>
          {rows.map((x) => {
            const d = deltas.get(x.id) ?? null;
            return (
              <Link key={x.id} to={eventHref(x.id)} className="grid items-center gap-3 border-t py-2.5 transition-colors hover:bg-[rgb(var(--ink)/0.03)]"
                style={{ gridTemplateColumns: grid, borderColor: KIT.BORDER, fontSize: 13 }}>
                <span className="min-w-0">
                  <span className="block truncate" style={{ color: KIT.T1, fontWeight: 540 }}>{x.title}</span>
                  <span className="block" style={{ color: KIT.T3, fontSize: 11.5 }}>{date(x.start_at)}</span>
                </span>
                {cols.map((c) => (
                  <span key={c.label} className="text-right tabular-nums" style={{ color: KIT.T1 }}>
                    {c.of ? c.of(x) : fmt(metricValue(x, c.key), c.format)}
                  </span>
                ))}
                <span className="text-right tabular-nums" style={{ fontSize: 12, fontWeight: 600, color: d === null ? KIT.T3 : d >= 0 ? KIT.POS : 'var(--acc-ff5c63)' }}>
                  {d === null ? '—' : `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))} %`}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      {data.nights.length > 7 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-3 text-[12.5px] font-medium" style={{ color: KIT.T2 }}>
          {open ? t('so.less') : t('so.more').replace('{n}', String(data.nights.length))}
        </button>
      )}
    </ReportCard>
  );
}

// ─── Lignes de renvoi ────────────────────────────────────────────────────────

function NetLine({ revenue, stripe, href, shareOnly = false }: { revenue: number; stripe: number; href?: string; shareOnly?: boolean }) {
  const { t } = useLanguage();
  const { eur } = useNumberFormat();
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1" style={{ fontSize: 13, color: KIT.T2 }}>
      <span>{shareOnly
        ? t('so.netOrg')
        : t('so.net').replace('{net}', eur(Math.max(0, revenue - stripe))).replace('{stripe}', eur(stripe))}</span>
      {href && (
        <Link to={href} className="inline-flex items-center gap-1 font-medium" style={{ color: KIT.T1 }}>
          {t('so.netLink')}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </p>
  );
}

function UpcomingLine({ data, eventsHref }: { data: SalesOverview; eventsHref: string }) {
  const { t } = useLanguage();
  const { eur } = useNumberFormat();
  const u = data.upcoming;
  if (!u || u.nights === 0) return null;
  const text = u.amount != null && u.amount > 0
    ? t('so.upcoming').replace('{amount}', eur(u.amount)).replace('{n}', String(u.nights))
    : t('so.upcomingNoMoney').replace('{n}', String(u.nights));
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1" style={{ fontSize: 13, color: KIT.T2 }}>
      <span>{text}</span>
      <Link to={eventsHref} className="inline-flex items-center gap-1 font-medium" style={{ color: KIT.T1 }}>
        {t('so.upcomingLink')}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </p>
  );
}

// ─── Export : le tableau soirée par soirée, tel qu'à l'écran ─────────────────

function exportNightsCsv(data: SalesOverview, t: (k: string) => string) {
  const esc = (v: unknown) => {
    const x = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  const money = data.money;
  const head = [
    t('so.col.night'), 'Date', t('m.entries'), t('m.customers'), t('m.tickets'), t('m.tables'), t('m.guestList'),
    ...(money ? [t('m.revenue'), t('so.k.revTickets'), t('so.k.revTables'), ...(data.has_bar ? [t('so.k.revBar')] : [])] : []),
  ];
  const rows = data.nights.map((x) => [
    x.title, x.start_at.slice(0, 10), x.entries, x.customers, x.tickets, x.tables, x.gl_registered,
    ...(money ? [x.revenue, x.rev_tickets, x.rev_tables, ...(data.has_bar ? [x.rev_bar] : [])] : []),
  ]);
  const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `yuno-ventes-${data.period}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Préférence de période (par appareil) ────────────────────────────────────

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(`yuno:sales:${key}`) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
}
function writePref(key: string, v: string) {
  try { localStorage.setItem(`yuno:sales:${key}`, v); } catch { /* stockage refusé : sans importance */ }
}
