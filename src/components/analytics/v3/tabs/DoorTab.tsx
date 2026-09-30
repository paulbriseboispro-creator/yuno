/**
 * Porte & tables (spec §4.5) : arrivées par 15 min, présence / no-show par
 * type, guest list → achat, revenu par personne présente, tables par zone.
 */
import { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Door, cardState, type An3Subject } from '@/hooks/useAn3';
import type { An3Scope } from '@/lib/analytics/an3Types';
import { an3Locale, compactMoney, compactNumber, formatValue, minutesSinceNoonLabel, pct } from '@/lib/analytics/an3Format';
import { deliverCsv } from '@/lib/analytics/an3Csv';
import { A3Answer, A3Card, A3Swatch } from '../an3Ui';
import { A3, MAIN_CHART_H } from '../an3Tokens';
import { ArrivalsCurve } from '../charts/ArrivalsCurve';
import { KpiCard } from '../KpiCard';

export function DoorTab({ scope, subject, registerExport }: { scope: An3Scope; subject: An3Subject; registerExport: (fn: (() => void) | null) => void }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Door(scope, subject);
  const data = q.data;
  const money = data?.money ?? false;

  useEffect(() => {
    if (!data) { registerExport(null); return; }
    registerExport(() => {
      const header = [t('an3.col.slot'), t('an3.col.entries'), t('an3.door.tickets'), t('an3.door.guestList'), t('an3.door.tables')];
      void deliverCsv('analytics-arrivees', header, data.arrivals.map((a) => [minutesSinceNoonLabel(a.m, locale), a.n, a.tickets, a.guest_list, a.tables]));
    });
    return () => registerExport(null);
  }, [data, registerExport, t, locale]);

  const peak = data?.marks.peak_m;
  const bt = data?.by_type;
  const types = bt ? [
    { key: 'tickets', label: t('an3.door.tickets'), rate: bt.tickets.rate, entered: bt.tickets.entered, expected: bt.tickets.expected },
    { key: 'guest_list', label: t('an3.door.guestList'), rate: bt.guest_list.rate, entered: bt.guest_list.entered, expected: bt.guest_list.expected },
    { key: 'tables', label: t('an3.door.tables'), rate: bt.tables.rate, entered: bt.tables.arrived, expected: bt.tables.booked },
  ] : [];

  return (
    <div className="flex flex-col gap-4">
      <A3Card
        title={peak != null ? t('an3.door.peakSentence').replace('{from}', minutesSinceNoonLabel(peak, locale)).replace('{to}', minutesSinceNoonLabel(peak + 15, locale)) : t('an3.door.arrivals')}
        hint={t('an3.door.arrivalsHint')}
        state={cardState(q, (d) => d.arrivals.length > 0)} minHeight={MAIN_CHART_H + 80}
        empty={{ title: t('an3.door.noScanTitle'), body: t('an3.door.noScanBody') }} error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }}>
        {data && (
          <>
            <ArrivalsCurve data={data} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
              <A3Swatch color={A3.accent}>{t('an3.door.tickets')}</A3Swatch>
              <A3Swatch color={A3.accentSoft}>{t('an3.door.guestList')}</A3Swatch>
              <A3Swatch color={A3.ref}>{t('an3.door.tables')}</A3Swatch>
              {data.marks.scanned_nights > 1 && <span className="text-[12px]" style={{ color: A3.t3 }}>{t('an3.door.perNightAvg').replace('{n}', String(data.marks.scanned_nights))}</span>}
            </div>
          </>
        )}
      </A3Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <A3Card title={t('an3.door.byType')} hint={t('an3.door.byTypeHint')} state={cardState(q, (d) => d.by_type.judged_nights > 0)} minHeight={200}
          empty={{ title: t('an3.door.noScanTitle'), body: t('an3.door.noScanBody') }}>
          {bt && (
            <ul className="m-0 p-0 list-none flex flex-col gap-3">
              {types.map((r) => (
                <li key={r.key} className="flex flex-col gap-1">
                  <span className="flex items-baseline justify-between text-[12.5px]">
                    <span style={{ color: A3.t1 }}>{r.label}</span>
                    <span className="tabular-nums" style={{ color: A3.t1, fontWeight: 600 }}>{r.rate != null ? pct(r.rate, locale) : '—'}<span className="ml-1.5 font-normal" style={{ color: A3.t3 }}>{compactNumber(r.entered, locale)} / {compactNumber(r.expected, locale)}</span></span>
                  </span>
                  <span className="block h-1.5 w-full rounded-full overflow-hidden" style={{ background: A3.track }}><span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.rate ?? 0)}%`, background: A3.accent }} /></span>
                  {r.rate != null && <span className="text-[11px]" style={{ color: A3.t3 }}>{t('an3.door.noShow').replace('{pct}', pct(100 - r.rate, locale))}</span>}
                </li>
              ))}
              <li className="text-[11px]" style={{ color: A3.t3 }}>{t('an3.door.judgedNights').replace('{n}', String(bt.judged_nights))}</li>
            </ul>
          )}
        </A3Card>

        <A3Card title={t('an3.door.perHead')} hint={t('an3.door.perHeadHint')} state={cardState(q, (d) => d.totals.scanned_nights > 0)} minHeight={200}
          empty={{ title: t('an3.door.noScanTitle'), body: t('an3.door.noScanBody') }}>
          {data && (
            <div className="grid grid-cols-2 gap-2">
              {money && <KpiCard spec={{ key: 'ph', label: t('an3.door.perHeadShort'), value: data.totals.per_head, reference: null, format: 'money', polarity: 'up', sub: t('an3.door.perHeadSub').replace('{in}', compactNumber(data.totals.entries, locale)) }} />}
              <KpiCard spec={{ key: 'entries', label: t('an3.kpi.entries'), value: data.totals.entries, reference: null, format: 'n', polarity: 'up', sub: t('an3.door.ofExpected').replace('{exp}', compactNumber(data.totals.expected, locale)) }} />
              <KpiCard spec={{ key: 'gl', label: t('an3.door.glToPaidShort'), hint: t('an3.door.glToPaidHint'), value: data.gl_to_paid.rate, reference: null, format: 'pct', polarity: 'up', sub: t('an3.door.glToPaidSub').replace('{n}', compactNumber(data.gl_to_paid.converted, locale)).replace('{all}', compactNumber(data.gl_to_paid.people, locale)) }} />
            </div>
          )}
        </A3Card>

        <A3Card title={t('an3.door.tablesTitle')} state={cardState(q, (d) => d.tables.totals.booked > 0 || d.tables.totals.requests > 0)} minHeight={200}
          empty={{ title: t('an3.door.noTables'), body: t('an3.door.noTablesBody') }}>
          {data && (
            <div className="flex flex-col gap-3">
              <A3Answer>
                {t('an3.door.tablesSentence').replace('{booked}', compactNumber(data.tables.totals.booked, locale)).replace('{arrived}', compactNumber(data.tables.totals.arrived, locale)).replace('{noshow}', compactNumber(data.tables.totals.no_show, locale))}
                {money && data.tables.totals.revenue != null && data.tables.totals.booked > 0 && ` ${t('an3.door.revenuePerTable').replace('{v}', compactMoney(data.tables.totals.revenue / data.tables.totals.booked, locale))}`}
              </A3Answer>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead><tr>
                    {[t('an3.col.zone'), t('an3.col.booked'), t('an3.col.arrived'), ...(money ? [t('an3.col.revenuePerTable'), t('an3.col.spendVsMin')] : [])].map((h, i) => (
                      <th key={h} className={`py-1.5 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {data.tables.zones.map((z) => (
                      <tr key={z.zone_id ?? z.zone}>
                        <td className="py-2 px-1.5" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{z.zone}</td>
                        <td className="py-2 px-1.5 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{z.booked}{z.requests > 0 && <span className="text-[11px]" style={{ color: A3.t3 }}> +{z.requests}</span>}</td>
                        <td className="py-2 px-1.5 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{z.arrived}{z.no_show > 0 && <span className="text-[11px]" style={{ color: A3.deltaDown }}> −{z.no_show}</span>}</td>
                        {money && <td className="py-2 px-1.5 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactMoney(z.revenue_per_table, locale)}</td>}
                        {money && <td className="py-2 px-1.5 text-right tabular-nums" style={{ color: z.spend_vs_min != null ? A3.t1 : A3.t3, borderBottom: `1px solid ${A3.faint}` }}>{z.spend_vs_min != null ? formatValue(z.spend_vs_min, 'ratio', locale) : '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {money && data.tables.zones.every((z) => z.spend_vs_min == null) && <p className="m-0 text-[11px]" style={{ color: A3.t3 }}>{t('an3.door.spendVsMinNote')}</p>}
            </div>
          )}
        </A3Card>
      </div>
    </div>
  );
}
