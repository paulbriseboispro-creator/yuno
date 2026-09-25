/**
 * « Où en sont mes ventes ? » — les chiffres de la soirée avec ce qui a bougé
 * aujourd'hui, puis le détail ligne par ligne : paliers de billets, formules
 * de table et parts de guest list dans UN tableau, chacune avec son statut et
 * sa jauge (le « Détail des ventes » de Shotgun, sur les trois piliers).
 */
import { Crown, Ticket, Users, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { FillBar } from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { fillPct, type PillarKey } from '@/lib/eventsSales';
import { conversionPct, type EventReport, type LineStatus, type ReportLine } from '@/lib/eventReport';
import { CardTitle, EmptyNote, ReportCard, StatCard } from './ui';

const PILLAR: Record<PillarKey, { icon: LucideIcon; color: string }> = {
  tickets: { icon: Ticket, color: 'var(--acc-ff7a82)' },
  tables: { icon: Crown, color: 'var(--acc-fcd34d)' },
  guestList: { icon: Users, color: 'var(--acc-34d399)' },
};

// Autant de colonnes que de cartes : jamais une case vide au bout de la rangée.
const LG_COLS: Record<number, string> = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' };

const STATUS_STYLE: Record<LineStatus, { bg: string; fg: string }> = {
  on_sale: { bg: 'rgba(52,211,153,0.12)', fg: 'var(--acc-34d399)' },
  sold_out: { bg: 'rgba(232,25,44,0.12)', fg: 'var(--acc-ff5c63)' },
  upcoming: { bg: 'rgba(245,158,11,0.12)', fg: 'var(--acc-f59e0b)' },
  closed: { bg: 'rgb(var(--ink)/0.06)', fg: KIT.T3 },
};

function lineName(line: ReportLine, t: (k: string) => string): string {
  if (line.name) return line.name;
  if (line.pillar === 'guestList') return t(`er.gl.${line.holderType ?? 'custom'}`);
  return '—';
}

export function ReportSales({ report }: { report: EventReport }) {
  const { t } = useLanguage();
  const { n, eur } = useNumberFormat();
  const { totals } = report;
  const conv = conversionPct(totals.visits.withOrder, totals.visits.total);
  // Après la soirée, « aujourd'hui » ne dit plus rien, et une ligne n'est plus
  // « en vente » : elle a fini complète ou fermée.
  const after = report.event.phase === 'after';
  const today = (v: number) => (after ? undefined : v);
  const lineStatus = (st: LineStatus): LineStatus => (after && st !== 'sold_out' ? 'closed' : st);
  // Une réservation hors formule (walk-in, placement) peut dépasser le nombre
  // de tables des formules : on n'affiche pas « 5 / 4 ».
  const ofCap = (done: number, cap: number | null | undefined) => (cap && done <= cap ? `${n(done)} / ${n(cap)}` : n(done));

  const cards = [
    totals.revenue && (totals.revenue.total > 0 || totals.tickets.enabled || totals.tables.enabled) && (
      <StatCard key="rev" label={t('er.stat.revenue')} hint={t('gl.revenue')} value={eur(totals.revenue.total)}
        sub={totals.drinks && totals.revenue.drinks > 0
          ? t('er.stat.revenueSplit').replace('{tickets}', eur(totals.revenue.tickets)).replace('{tables}', eur(totals.revenue.tables)).replace('{drinks}', eur(totals.revenue.drinks))
          : undefined}
        today={today(totals.revenue.today)} todayDisplay={eur(totals.revenue.today)} />
    ),
    (totals.tickets.enabled || totals.tickets.sold > 0) && (
      <StatCard key="tk" label={t('evs.tickets')} hint={t('gl.tickets')}
        value={ofCap(totals.tickets.sold, totals.tickets.capacity)}
        sub={t('er.stat.orders').replace('{n}', n(totals.tickets.orders))}
        today={today(totals.tickets.today)} pct={fillPct(totals.tickets.sold, totals.tickets.capacity)} soldOut={totals.tickets.soldOut} />
    ),
    (totals.tables.enabled || totals.tables.booked > 0) && (
      <StatCard key="tb" label={t('evs.tables')} hint={t('gl.tables')}
        value={ofCap(totals.tables.booked, totals.tables.capacity)}
        sub={t('er.stat.guests').replace('{n}', n(totals.tables.guests))}
        today={today(totals.tables.today)} pct={fillPct(totals.tables.booked, totals.tables.capacity)} soldOut={totals.tables.soldOut} />
    ),
    (totals.guestList.enabled || totals.guestList.registered > 0) && (
      <StatCard key="gl" label={t('evs.guestList')} hint={t('gl.guestList')}
        value={ofCap(totals.guestList.registered, totals.guestList.capacity)}
        today={today(totals.guestList.today)} pct={fillPct(totals.guestList.registered, totals.guestList.capacity)} soldOut={totals.guestList.soldOut} />
    ),
    <StatCard key="vis" label={t('evs.visits')} hint={t('gl.visits')} value={n(totals.visits.total)}
      sub={conv !== null ? t('er.stat.conversion').replace('{pct}', String(conv).replace('.', t('er.decimal'))) : undefined}
      today={today(totals.visits.today)} />,
  ].filter(Boolean);

  const byPillar: Record<PillarKey, ReportLine[]> = { tickets: [], tables: [], guestList: [] };
  for (const l of report.lines) byPillar[l.pillar].push(l);
  const showAmount = report.money;

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-2 gap-3 ${LG_COLS[cards.length] ?? 'lg:grid-cols-5'}`}>{cards}</div>

      <ReportCard>
        <CardTitle title={t('er.lines.title')} hint={t('er.lines.hint')} />
        {report.lines.length === 0 ? (
          <EmptyNote text={t('er.lines.empty')} />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ color: KIT.T3, fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  <th className="px-2 pb-2 text-left font-semibold">{t('er.col.line')}</th>
                  <th className="hidden px-2 pb-2 text-right font-semibold sm:table-cell">{t('er.col.price')}</th>
                  <th className="hidden px-2 pb-2 text-left font-semibold sm:table-cell">{t('er.col.status')}</th>
                  <th className="w-[28%] px-2 pb-2 text-left font-semibold">{t('er.col.sold')}</th>
                  {showAmount && <th className="px-2 pb-2 text-right font-semibold">{t('er.col.amount')}</th>}
                </tr>
              </thead>
              <tbody>
                {(['tickets', 'tables', 'guestList'] as const).flatMap((pillar) => byPillar[pillar].map((line) => {
                  const meta = PILLAR[pillar];
                  const Icon = meta.icon;
                  const pct = fillPct(line.sold, line.capacity);
                  const status = lineStatus(line.status);
                  const st = STATUS_STYLE[status];
                  return (
                    <tr key={`${pillar}:${line.id}`} style={{ borderTop: `1px solid rgb(var(--ink)/0.055)` }}>
                      <td className="px-2 py-2.5">
                        <span className="inline-flex min-w-0 items-center gap-2" style={{ color: KIT.T1, fontWeight: 560 }}>
                          <Icon className="h-3.5 w-3.5 flex-none" style={{ color: meta.color }} aria-hidden />
                          <span className="truncate">{lineName(line, t)}</span>
                        </span>
                        {/* Téléphone : le statut passe sous le nom (colonne masquée). */}
                        <span className="mt-1 flex items-center gap-2 sm:hidden">
                          <span className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: st.bg, color: st.fg }}>
                            {t(`er.status.${status}`)}
                          </span>
                          {line.price !== null && (
                            <span className="tabular-nums" style={{ color: KIT.T3, fontSize: 11.5 }}>{line.price > 0 ? eur(line.price) : t('er.free')}</span>
                          )}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap px-2 py-2.5 text-right tabular-nums sm:table-cell" style={{ color: KIT.T2 }}>
                        {line.price === null ? '' : line.price > 0 ? eur(line.price) : t('er.free')}
                      </td>
                      <td className="hidden px-2 py-2.5 sm:table-cell">
                        <span className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: st.bg, color: st.fg }}>
                          {t(`er.status.${status}`)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-3">
                          <span className="whitespace-nowrap tabular-nums" style={{ color: KIT.T1, fontWeight: 600 }}>
                            {n(line.sold)}{line.capacity !== null && <span style={{ color: KIT.T3, fontWeight: 500 }}> / {n(line.capacity)}</span>}
                          </span>
                          {line.capacity !== null && (
                            <div className="hidden flex-1 sm:block"><FillBar pct={pct} soldOut={status === 'sold_out'} /></div>
                          )}
                        </div>
                      </td>
                      {showAmount && (
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums" style={{ color: KIT.T1 }}>
                          {line.amount === null ? '' : eur(line.amount)}
                        </td>
                      )}
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        )}
      </ReportCard>
    </div>
  );
}
