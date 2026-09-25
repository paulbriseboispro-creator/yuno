/**
 * « Où en sont mes ventes ? » — les chiffres de la soirée avec ce qui a bougé
 * aujourd'hui, puis le détail ligne par ligne : paliers de billets, formules
 * de table et parts de guest list dans UN tableau, chacune avec son statut et
 * sa jauge (le « Détail des ventes » de Shotgun, sur les trois piliers).
 */
import { Crown, Ticket, Users, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ReactNode } from 'react';
import { BulletBar, FillBar, MetricHint, TodayDelta } from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { fillPct, type PillarKey } from '@/lib/eventsSales';
import { referenceFor, type EventReport, type LineStatus, type ReportLine } from '@/lib/eventReport';
import { CardTitle, EmptyNote, ReportCard } from './ui';
import { ReportTarget } from './ReportTarget';

const PILLAR: Record<PillarKey, { icon: LucideIcon; color: string }> = {
  tickets: { icon: Ticket, color: 'var(--acc-ff7a82)' },
  tables: { icon: Crown, color: 'var(--acc-fcd34d)' },
  guestList: { icon: Users, color: 'var(--acc-34d399)' },
};

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

export function ReportSales({ report, compare = null, projection }: {
  report: EventReport;
  /** Soirée de référence : son niveau devient le repère de chaque jauge. */
  compare?: EventReport | null;
  /** La ligne de prévision (club, avant la soirée). */
  projection?: ReactNode;
}) {
  const { t } = useLanguage();
  const { n, eur } = useNumberFormat();
  const { totals } = report;
  // Après la soirée, « aujourd'hui » ne dit plus rien, et une ligne n'est plus
  // « en vente » : elle a fini complète ou fermée.
  const after = report.event.phase === 'after';
  const lineStatus = (st: LineStatus): LineStatus => (after && st !== 'sold_out' ? 'closed' : st);
  // Une réservation hors formule (walk-in, placement) peut dépasser le nombre
  // de tables des formules : on n'affiche pas « 5 / 4 ».

  // Les jauges : vendu / capacité, avec le repère « où en était la soirée de
  // référence » (au même J-N avant la soirée, son total après). Remplace cinq
  // cartes qui redisaient chacune un morceau du tableau juste en dessous.
  const refLabel = compare ? t(after ? 'er.fill.refLabelAfter' : 'er.fill.refLabel').replace('{title}', compare.event.title) : undefined;
  const gauges = [
    (totals.tickets.enabled || totals.tickets.sold > 0) && {
      key: 'tk', label: t('evs.tickets'), value: totals.tickets.sold, cap: totals.tickets.capacity,
      ref: referenceFor(report, compare, 'tickets'), soldOut: totals.tickets.soldOut, today: totals.tickets.today,
    },
    (totals.tables.enabled || totals.tables.booked > 0) && {
      key: 'tb', label: t('evs.tables'), value: totals.tables.booked,
      cap: totals.tables.capacity && totals.tables.booked <= totals.tables.capacity ? totals.tables.capacity : null,
      ref: referenceFor(report, compare, 'tables'), soldOut: totals.tables.soldOut, today: totals.tables.today,
    },
    (totals.guestList.enabled || totals.guestList.registered > 0) && {
      key: 'gl', label: t('evs.guestList'), value: totals.guestList.registered, cap: totals.guestList.capacity,
      ref: referenceFor(report, compare, 'guests'), soldOut: totals.guestList.soldOut, today: totals.guestList.today,
    },
  ].filter(Boolean) as { key: string; label: string; value: number; cap: number | null; ref: number | null; soldOut: boolean; today: number }[];
  const rev = totals.revenue;

  const byPillar: Record<PillarKey, ReportLine[]> = { tickets: [], tables: [], guestList: [] };
  // Un pilier éteint sur la soirée n'étale pas ses formules à zéro (les packs
  // du club partenaire d'une soirée d'organisateur sans tables, par exemple) ;
  // une ligne qui a vendu reste, elle.
  const pillarOn: Record<PillarKey, boolean> = {
    tickets: totals.tickets.enabled, tables: totals.tables.enabled, guestList: totals.guestList.enabled,
  };
  const lines = report.lines.filter((l) => pillarOn[l.pillar] || l.sold > 0);
  for (const l of lines) byPillar[l.pillar].push(l);
  const showAmount = report.money;

  return (
    <div className="space-y-3">
      <ReportCard>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
          {rev && (rev.total > 0 || totals.tickets.enabled || totals.tables.enabled) && (
            <div className="min-w-[180px] lg:w-[220px]">
              <span className="inline-flex items-center gap-1" style={{ color: KIT.T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                {t('er.stat.revenue')}<MetricHint text={t('gl.revenue')} label={t('er.stat.revenue')} />
              </span>
              <div className="mt-1.5 tabular-nums" style={{ color: KIT.T1, fontSize: 'clamp(26px,2.8vw,34px)', fontWeight: 650, letterSpacing: '-0.025em', lineHeight: 1 }}>
                {eur(rev.total)}
              </div>
              <div className="mt-2 flex flex-col gap-1" style={{ fontSize: 12, color: KIT.T3 }}>
                {!after && rev.total > 0 && <TodayDelta value={rev.today} display={eur(rev.today)} />}
                {(rev.tables > 0 || rev.drinks > 0) && (
                  <span>
                    {[
                      rev.tickets > 0 && `${t('evs.tickets')} ${eur(rev.tickets)}`,
                      rev.tables > 0 && `${t('evs.tables')} ${eur(rev.tables)}`,
                      rev.drinks > 0 && `${t('owner.drinksTab')} ${eur(rev.drinks)}`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            </div>
          )}
          {gauges.length > 0 && (
            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              {gauges.map((g) => (
                <div key={g.key} className="flex flex-col gap-1">
                  <BulletBar label={g.label} value={g.value} display={n(g.value)} capacity={g.cap}
                    reference={g.ref} referenceLabel={refLabel} soldOut={g.soldOut} />
                  {!after && g.today > 0 && (
                    <span className="pl-[96px] text-[11.5px]" style={{ color: KIT.POS }}>
                      {t('ak.today').replace('{value}', `+${n(g.today)}`)}
                    </span>
                  )}
                </div>
              ))}
              {compare && gauges.some((g) => g.ref !== null && g.cap) && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: KIT.T3 }}>
                  <span className="inline-block h-3 w-[2px] rounded-full" style={{ background: KIT.T1 }} aria-hidden />
                  {refLabel}
                </span>
              )}
              <ReportTarget report={report} compare={compare} projection={projection} />
            </div>
          )}
        </div>
      </ReportCard>

      <ReportCard>
        <CardTitle title={t('er.lines.title')} hint={t('er.lines.hint')} />
        {lines.length === 0 ? (
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
