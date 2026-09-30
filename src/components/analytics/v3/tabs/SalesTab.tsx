/**
 * Ventes (spec §4.2) : pacing + statut + projection, paliers (quantité, CA,
 * remplissage, temps pour épuiser), part last-minute, délai d'achat, heatmap
 * jour × heure, petites courbes des soirées passées.
 */
import { useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Pacing, useAn3Sales, cardState, type An3Subject } from '@/hooks/useAn3';
import type { An3Pacing, An3Scope } from '@/lib/analytics/an3Types';
import type { An3Compare } from '@/lib/analytics/an3Nav';
import { an3Locale, compactMoney, compactNumber, pct } from '@/lib/analytics/an3Format';
import { deliverCsv } from '@/lib/analytics/an3Csv';
import { A3Answer, A3Card, A3Status, A3Swatch } from '../an3Ui';
import { A3, MAIN_CHART_H } from '../an3Tokens';
import { PacingChart } from '../charts/PacingChart';
import { HBarList } from '../charts/HBarList';
import { Heatmap } from '../charts/Heatmap';
import { SmallMultiples } from '../charts/SmallMultiples';

export function SalesTab({ scope, subject, compare, onOpenEvent, registerExport }: {
  scope: An3Scope; subject: An3Subject; compare: An3Compare; onOpenEvent: (id: string) => void; registerExport: (fn: (() => void) | null) => void;
}) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Sales(scope, subject);
  const pacing = useAn3Pacing(subject.eventId, compare);
  const data = q.data;
  const money = data?.money ?? false;
  const isEvent = !!subject.eventId;

  useEffect(() => {
    if (!data) { registerExport(null); return; }
    registerExport(() => {
      const header = [t('an3.col.round'), t('an3.col.price'), t('an3.col.tickets'), t('an3.col.sellThrough'), t('an3.col.hoursToSellOut'), ...(money ? [t('an3.col.revenue')] : [])];
      void deliverCsv('analytics-ventes', header, data.rounds.map((r) => [r.name, r.price, r.qty, r.sell_through, r.hours_to_sell_out, ...(money ? [r.revenue] : [])]));
    });
    return () => registerExport(null);
  }, [data, money, registerExport, t]);

  const heatSentence = useMemo(() => {
    if (!data || data.heatmap.total < 20) return null;
    const days = data.heatmap.by_weekday.slice().sort((a, b) => b.n - a.n);
    const hours = data.heatmap.by_hour.slice().sort((a, b) => b.n - a.n);
    if (!days.length || !hours.length) return null;
    const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(Date.UTC(2024, 0, days[0].w, 12)));
    // Bande de 3 h autour de l'heure la plus forte.
    const h = hours[0].h;
    const band = `${String(h).padStart(2, '0')}h–${String((h + 3) % 24).padStart(2, '0')}h`;
    return t('an3.heat.sentence').replace('{day}', dayName).replace('{band}', band).replace('{pct}', pct((days[0].n / data.heatmap.total) * 100, locale));
  }, [data, locale, t]);

  const lm = data?.last_minute;
  const lmPct = (n: number) => lm && lm.units >= 20 ? (n / lm.units) * 100 : null;

  return (
    <div className="flex flex-col gap-4">
      {isEvent && (
        <A3Card title={t('an3.pacing.title')} hint={t('an3.pacing.hint')}
          right={pacing.data && (pacing.data.status === 'good' || pacing.data.status === 'warn' || pacing.data.status === 'bad') ? <A3Status tone={pacing.data.status}>{t(`an3.pacing.status.${pacing.data.status}`)}</A3Status> : undefined}
          state={cardState(pacing, (d) => d.curve.some((p) => (p.tickets ?? 0) > 0) || d.compare.n > 0)} minHeight={MAIN_CHART_H + 96}
          empty={{ title: t('an3.pacing.emptyTitle'), body: t('an3.pacing.emptyBody') }} error={{ title: t('an3.state.errorTitle'), retry: () => pacing.refetch() }}>
          {pacing.data && (
            <>
              {pacing.data.forecast?.tickets != null && pacing.data.event.status !== 'past' && (
                <A3Answer>{forecastSentence(t, locale, pacing.data)}</A3Answer>
              )}
              <PacingChart data={pacing.data} metric="tickets" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                <A3Swatch color={A3.accent}>{pacing.data.event.title}</A3Swatch>
                {pacing.data.compare.n > 0 && <A3Swatch color={A3.ref}>{pacing.data.compare.n > 1 ? t('an3.pacing.legendMedian').replace('{n}', String(pacing.data.compare.n)) : `${pacing.data.compare.refs[0]?.title ?? ''} · ${new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(pacing.data.compare.refs[0]?.start_at ?? 0))}`}</A3Swatch>}
              </div>
            </>
          )}
        </A3Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <A3Card title={t('an3.sales.rounds')} state={cardState(q, (d) => d.rounds.length > 0)} minHeight={220}
          empty={{ title: t('an3.sales.roundsEmpty'), body: t('an3.sales.roundsEmptyBody') }} error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }}>
          {data && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead><tr>
                  {[t('an3.col.round'), t('an3.col.tickets'), t('an3.col.sellThrough'), t('an3.col.soldOutIn'), ...(money ? [t('an3.col.revenue')] : [])].map((h, i) => (
                    <th key={h} className={`py-2 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.rounds.map((r, i) => (
                    <tr key={r.id ?? `${r.name}-${i}`}>
                      <td className="py-2.5 px-2" style={{ borderBottom: `1px solid ${A3.faint}` }}>
                        <span className="inline-flex items-center gap-2" style={{ color: A3.t1 }}>
                          {r.name}
                          {r.status && <A3Status tone={r.status === 'sold_out' ? 'neutral' : r.status === 'on_sale' ? 'good' : 'neutral'}>{t(`an3.round.${r.status}`)}</A3Status>}
                          {r.rounds && r.rounds > 1 && <span className="text-[11px]" style={{ color: A3.t3 }}>× {r.rounds}</span>}
                        </span>
                        <span className="block text-[11.5px] tabular-nums" style={{ color: A3.t3 }}>{compactMoney(r.price, locale)}</span>
                      </td>
                      <td className="py-2.5 px-1.5 text-right tabular-nums whitespace-nowrap" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactNumber(r.qty, locale)}{r.cap ? <span className="text-[11px]" style={{ color: A3.t3 }}> / {compactNumber(r.cap, locale)}</span> : null}</td>
                      <td className="py-2.5 px-2 text-right" style={{ borderBottom: `1px solid ${A3.faint}` }}>
                        {r.sell_through != null ? (
                          <span className="inline-flex items-center gap-2 justify-end">
                            <span className="hidden lg:inline-block h-1.5 w-12 rounded-full overflow-hidden" style={{ background: A3.track }}><span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.sell_through)}%`, background: A3.accent }} /></span>
                            <span className="tabular-nums" style={{ color: A3.t1 }}>{pct(r.sell_through, locale)}</span>
                          </span>
                        ) : <span style={{ color: A3.t3 }}>—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: r.hours_to_sell_out != null ? A3.t1 : A3.t3, borderBottom: `1px solid ${A3.faint}` }}>{r.hours_to_sell_out != null ? hoursLabel(r.hours_to_sell_out, t) : (r.sold_out_rounds ? `${r.sold_out_rounds}/${r.rounds}` : '—')}</td>
                      {money && <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactMoney(r.revenue, locale)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </A3Card>

        <A3Card title={t('an3.sales.lastMinute')} hint={t('an3.sales.lastMinuteHint')} state={cardState(q, (d) => d.last_minute.units > 0)} minHeight={220}
          empty={{ title: t('an3.sales.noTickets') }}>
          {lm && (
            <div className="flex flex-col gap-3">
              <A3Answer>{lm.units >= 20 ? t('an3.sales.lastMinuteSentence').replace('{pct7}', pct(lmPct(lm.last_7d) ?? 0, locale)).replace('{pct48}', pct(lmPct(lm.last_48h) ?? 0, locale)).replace('{pctJ}', pct(lmPct(lm.day_of) ?? 0, locale)) : t('an3.sales.smallBase').replace('{n}', String(lm.units))}</A3Answer>
              <div className="grid grid-cols-3 gap-2">
                {([['last_7d', 'd7'], ['last_48h', 'h48'], ['day_of', 'dayJ']] as const).map(([k, lbl]) => (
                  <div key={k} className="rounded-xl px-3 py-2.5 flex flex-col gap-0.5 min-w-0" style={{ background: A3.faint, border: `1px solid ${A3.border}` }}>
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] truncate" style={{ color: A3.t3 }}>{t(`an3.sales.lm.${lbl}`)}</span>
                    <span className="tabular-nums text-[19px] font-semibold leading-none" style={{ color: A3.t1 }}>{lm.units >= 20 ? pct(lmPct(lm[k]) ?? 0, locale) : compactNumber(lm[k], locale)}</span>
                    <span className="text-[11px] tabular-nums" style={{ color: A3.t3 }}>{compactNumber(lm[k], locale)} {t('an3.unit.tickets')}</span>
                  </div>
                ))}
              </div>
              {data && data.lead_time.median_days != null && (
                <div>
                  <p className="m-0 mb-2 text-[12.5px]" style={{ color: A3.t2 }}>{t('an3.sales.leadMedian').replace('{d}', String(data.lead_time.median_days))}</p>
                  <HBarList rows={data.lead_time.buckets.map((b) => ({ key: b.key, label: t(`an3.sales.lead.${b.key}`), value: b.units, display: compactNumber(b.units, locale) }))} limit={6} />
                </div>
              )}
            </div>
          )}
        </A3Card>
      </div>

      <A3Card title={heatSentence ?? t('an3.heat.title')} hint={t('an3.heat.hint')} state={cardState(q, (d) => d.heatmap.total > 0)} minHeight={240}
        empty={{ title: t('an3.sales.noTickets') }}>
        {data && <Heatmap cells={data.heatmap.cells} total={data.heatmap.total} />}
      </A3Card>

      {!isEvent && (
        <A3Card title={t('an3.sales.smallMultiples')} hint={t('an3.sales.smallMultiplesHint')} state={cardState(q, (d) => d.small_multiples.length > 0)} minHeight={200}
          empty={{ title: t('an3.empty.noNightsTitle'), body: t('an3.empty.noNightsBody') }}>
          {data && <SmallMultiples rows={data.small_multiples} onSelect={onOpenEvent} />}
        </A3Card>
      )}
    </div>
  );
}

function hoursLabel(h: number, t: (k: string) => string): string {
  if (h < 48) return t('an3.unit.hours').replace('{n}', String(Math.round(h)));
  return t('an3.unit.days').replace('{n}', String(Math.round(h / 24)));
}

/** « À ce rythme, environ 71 billets… » — la fourchette n'est dite que si elle existe. */
function forecastSentence(t: (k: string) => string, locale: ReturnType<typeof an3Locale>, p: An3Pacing): string {
  const f = p.forecast!;
  const n = compactNumber(f.tickets ?? 0, locale);
  const low = f.tickets_low ?? f.tickets ?? 0, high = f.tickets_high ?? f.tickets ?? 0;
  const range = high > low ? t('an3.pacing.forecastRange').replace('{low}', compactNumber(low, locale)).replace('{high}', compactNumber(high, locale)) : '';
  return t('an3.pacing.forecast').replace('{n}', n).replace('{range}', range).replace('{share}', pct(f.share_sold_at_d ?? 0, locale)).replace('{d}', String(p.today_d)).replace(' ,', ',').replace('  ', ' ');
}
