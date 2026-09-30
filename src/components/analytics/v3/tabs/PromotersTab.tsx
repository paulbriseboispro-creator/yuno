/**
 * Promoteurs (spec §4.6) : leaderboard — clics, commandes, billets, ventes
 * attribuées, conversion, présence de leurs clients, part de nouveaux,
 * commission due. Tri par ventes attribuées.
 */
import { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Promoters, cardState, type An3Subject } from '@/hooks/useAn3';
import type { An3Promoter, An3Scope } from '@/lib/analytics/an3Types';
import { an3Locale, compactMoney, compactNumber, pct } from '@/lib/analytics/an3Format';
import { deliverCsv } from '@/lib/analytics/an3Csv';
import { A3Answer, A3Card } from '../an3Ui';
import { A3 } from '../an3Tokens';

export function PromotersTab({ scope, subject, registerExport }: { scope: An3Scope; subject: An3Subject; registerExport: (fn: (() => void) | null) => void }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Promoters(scope, subject);
  const data = q.data;
  const money = data?.money ?? false;

  useEffect(() => {
    if (!data) { registerExport(null); return; }
    registerExport(() => {
      const header = [t('an3.col.promoter'), t('an3.col.clicks'), t('an3.col.orders'), t('an3.col.tickets'), ...(money ? [t('an3.col.attributed')] : []), t('an3.col.conversion'), t('an3.col.attendance'), t('an3.col.newShare'), ...(money ? [t('an3.col.commissionDue')] : [])];
      void deliverCsv('analytics-promoteurs', header, data.promoters.map((p) => [p.name ?? '', p.clicks, p.orders, p.tickets, ...(money ? [p.attributed] : []), p.conversion, p.attendance, p.new_share, ...(money ? [p.commission_due] : [])]));
    });
    return () => registerExport(null);
  }, [data, money, registerExport, t]);

  const cols = [t('an3.col.promoter'), t('an3.col.clicks'), t('an3.col.orders'), t('an3.col.tickets'), ...(money ? [t('an3.col.attributed')] : []), t('an3.col.conversion'), t('an3.col.attendance'), t('an3.col.newShare'), ...(money ? [t('an3.col.commissionDue')] : [])];

  const cell = (v: string, dim = false, bold = false) => <span className="tabular-nums" style={{ color: dim ? A3.t3 : A3.t1, fontWeight: bold ? 600 : 400 }}>{v}</span>;
  const row = (p: An3Promoter) => [
    <span key="n" style={{ color: A3.t1 }}>{p.name || t('an3.promoter.unnamed')}{p.promo_code && <span className="ml-1.5 text-[11px]" style={{ color: A3.t3 }}>{p.promo_code}</span>}</span>,
    cell(compactNumber(p.clicks, locale)),
    cell(compactNumber(p.orders, locale)),
    cell(compactNumber(p.tickets, locale)),
    ...(money ? [cell(compactMoney(p.attributed, locale), p.attributed == null, true)] : []),
    cell(p.conversion != null ? pct(p.conversion, locale) : '—', p.conversion == null),
    cell(p.attendance != null ? pct(p.attendance, locale) : '—', p.attendance == null),
    cell(p.new_share != null ? pct(p.new_share, locale) : '—', p.new_share == null),
    ...(money ? [cell(compactMoney(p.commission_due, locale), !p.commission_due)] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <A3Card title={t('an3.promo.title')} hint={t('an3.promo.hint')} state={cardState(q, (d) => d.promoters.length > 0)} minHeight={260}
        empty={{ title: t('an3.promo.emptyTitle'), body: t('an3.promo.emptyBody') }} error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }}>
        {data && (
          <>
            <A3Answer>
              {t(data.totals.promoters === 1 ? 'an3.promo.sentenceOne' : 'an3.promo.sentence').replace('{n}', String(data.totals.promoters)).replace('{orders}', compactNumber(data.totals.orders, locale)).replace('{tickets}', compactNumber(data.totals.tickets, locale))}
              {money && data.totals.attributed != null && ` ${t('an3.promo.attributedSentence').replace('{v}', compactMoney(data.totals.attributed, locale))}`}
              {data.totals.judged >= 10 && ` ${t('an3.promo.presenceSentence').replace('{pct}', pct((data.totals.present / data.totals.judged) * 100, locale))}`}
            </A3Answer>
            <div className="hidden md:block overflow-x-auto -mx-1 mt-2">
              <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead><tr>{cols.map((h, i) => <th key={h} className={`py-2 px-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.promoters.map((p) => (
                    <tr key={p.id}>{row(p).map((c, i) => <td key={i} className={`py-2.5 px-2 ${i === 0 ? 'text-left' : 'text-right'}`} style={{ borderBottom: `1px solid ${A3.faint}` }}>{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden m-0 p-0 list-none flex flex-col gap-2 mt-2">
              {data.promoters.map((p) => (
                <li key={p.id} className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: A3.faint, border: `1px solid ${A3.border}` }}>
                  <span className="flex items-baseline justify-between gap-2 text-[13px]"><span style={{ color: A3.t1 }}>{p.name || t('an3.promoter.unnamed')}</span>{money && <span className="tabular-nums font-semibold" style={{ color: A3.t1 }}>{compactMoney(p.attributed, locale)}</span>}</span>
                  <span className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11.5px] tabular-nums" style={{ color: A3.t2 }}>
                    <span>{compactNumber(p.clicks, locale)} {t('an3.col.clicks').toLowerCase()}</span>
                    <span>{compactNumber(p.orders, locale)} {t('an3.col.orders').toLowerCase()}</span>
                    <span>{compactNumber(p.tickets, locale)} {t('an3.unit.tickets')}</span>
                    <span>{t('an3.col.conversion')} {p.conversion != null ? pct(p.conversion, locale) : '—'}</span>
                    <span>{t('an3.col.attendance')} {p.attendance != null ? pct(p.attendance, locale) : '—'}</span>
                    <span>{t('an3.col.newShare')} {p.new_share != null ? pct(p.new_share, locale) : '—'}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-2 text-[11px]" style={{ color: A3.t3 }}>{t('an3.promo.qualityNote')}</p>
          </>
        )}
      </A3Card>
    </div>
  );
}
