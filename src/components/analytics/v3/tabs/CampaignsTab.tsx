/**
 * Campagnes (spec §4.7) : par campagne email et push — envoyés, délivrés,
 * clics, commandes et CA attribués à 3 et 7 jours après le clic. Le taux
 * d'ouverture est affiché « partiel » (pixel : consentement requis, CNIL).
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Campaigns, cardState, type An3Subject } from '@/hooks/useAn3';
import type { An3Scope } from '@/lib/analytics/an3Types';
import { an3Locale, compactMoney, compactNumber, pct } from '@/lib/analytics/an3Format';
import { deliverCsv } from '@/lib/analytics/an3Csv';
import { A3Answer, A3Card, A3Status } from '../an3Ui';
import { A3 } from '../an3Tokens';

export function CampaignsTab({ scope, subject, registerExport, campaignsHref }: {
  scope: An3Scope; subject: An3Subject; registerExport: (fn: (() => void) | null) => void; campaignsHref?: string;
}) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Campaigns(scope, subject);
  const data = q.data;
  const money = data?.money ?? false;
  const [win, setWin] = useState<'3d' | '7d'>('7d');
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

  useEffect(() => {
    if (!data) { registerExport(null); return; }
    registerExport(() => {
      const header = [t('an3.col.campaign'), t('an3.col.date'), t('an3.col.sent'), t('an3.col.delivered'), t('an3.col.clicks'), t('an3.col.clickRate'), t('an3.col.orders3d'), t('an3.col.orders7d'), ...(money ? [t('an3.col.revenue3d'), t('an3.col.revenue7d')] : [])];
      void deliverCsv('analytics-campagnes', header, data.email.map((c) => [c.name ?? c.subject ?? '', c.sent_at.slice(0, 10), c.sent, c.delivered, c.clicks, c.click_rate, c.orders_3d, c.orders_7d, ...(money ? [c.revenue_3d, c.revenue_7d] : [])]));
    });
    return () => registerExport(null);
  }, [data, money, registerExport, t]);

  const orders = (c: { orders_3d: number; orders_7d: number }) => (win === '3d' ? c.orders_3d : c.orders_7d);
  const revenue = (c: { revenue_3d: number | null; revenue_7d: number | null }) => (win === '3d' ? c.revenue_3d : c.revenue_7d);
  const totalOrders = data ? data.email.reduce((s, c) => s + orders(c), 0) + data.push.reduce((s, c) => s + orders(c), 0) : 0;
  const totalRevenue = data && money ? data.email.reduce((s, c) => s + (revenue(c) ?? 0), 0) + data.push.reduce((s, c) => s + (revenue(c) ?? 0), 0) : null;

  const winPills = (
    <div className="inline-flex rounded-full p-0.5" style={{ background: A3.faint, border: `1px solid ${A3.border}` }} role="radiogroup">
      {(['3d', '7d'] as const).map((w) => (
        <button key={w} type="button" role="radio" aria-checked={win === w} onClick={() => setWin(w)} className="rounded-full px-2.5 py-1 text-[11.5px] font-medium min-h-[28px]"
          style={{ background: win === w ? A3.accentFaint : 'transparent', color: win === w ? A3.t1 : A3.t2 }}>{t(`an3.camp.win.${w}`)}</button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <A3Card title={t('an3.camp.email')} hint={t('an3.camp.emailHint')} right={winPills}
        state={cardState(q, (d) => d.email.length > 0)} minHeight={220}
        empty={{ title: t('an3.camp.emailEmpty'), body: t('an3.camp.emailEmptyBody'), action: campaignsHref ? <a href={campaignsHref} className="text-[12.5px] font-medium" style={{ color: A3.accent }}>{t('an3.aud.createCampaign')}</a> : undefined }}
        error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }}>
        {data && (
          <>
            <A3Answer>{t('an3.camp.sentence').replace('{n}', String(data.email.length)).replace('{orders}', compactNumber(totalOrders, locale)).replace('{win}', t(`an3.camp.win.${win}`))}{money && totalRevenue != null && totalRevenue > 0 && ` ${t('an3.camp.revenueSentence').replace('{v}', compactMoney(totalRevenue, locale))}`}</A3Answer>
            <div className="overflow-x-auto -mx-1 mt-2">
              <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead><tr>
                  {[t('an3.col.campaign'), t('an3.col.delivered'), t('an3.col.clicks'), t('an3.col.openPartial'), t('an3.col.orders'), ...(money ? [t('an3.col.revenue')] : [])].map((h, i) => (
                    <th key={h} className={`py-2 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.email.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 px-1.5" style={{ borderBottom: `1px solid ${A3.faint}` }}>
                        <span className="block truncate max-w-[260px]" style={{ color: A3.t1 }}>{c.name ?? c.subject ?? '—'}{c.automated && <A3Status tone="neutral">{t('an3.camp.auto')}</A3Status>}</span>
                        <span className="block text-[11px] tabular-nums" style={{ color: A3.t3 }}>{dateFmt.format(new Date(c.sent_at))} · {compactNumber(c.sent, locale)} {t('an3.col.sent').toLowerCase()}</span>
                      </td>
                      <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactNumber(c.delivered, locale)}</td>
                      <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactNumber(c.clickers, locale)}{c.click_rate != null && <span className="text-[11px]" style={{ color: A3.t3 }}> · {pct(c.click_rate, locale)}</span>}</td>
                      <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: A3.t3, borderBottom: `1px solid ${A3.faint}` }}>{c.open_rate_partial != null ? `${pct(c.open_rate_partial, locale)}*` : '—'}</td>
                      <td className="py-2.5 px-1.5 text-right tabular-nums font-semibold" style={{ color: orders(c) ? A3.t1 : A3.t3, borderBottom: `1px solid ${A3.faint}` }}>{compactNumber(orders(c), locale)}</td>
                      {money && <td className="py-2.5 px-1.5 text-right tabular-nums font-semibold" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactMoney(revenue(c), locale)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 mt-2 text-[11px]" style={{ color: A3.t3 }}>{t('an3.camp.openNote')}</p>
          </>
        )}
      </A3Card>

      <A3Card title={t('an3.camp.push')} hint={t('an3.camp.pushHint')} state={cardState(q, (d) => d.push.length > 0)} minHeight={180}
        empty={{ title: t('an3.camp.pushEmpty'), body: t('an3.camp.pushEmptyBody') }}>
        {data && (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead><tr>
                {[t('an3.col.campaign'), t('an3.col.sent'), t('an3.col.taps'), t('an3.col.orders'), ...(money ? [t('an3.col.revenue')] : [])].map((h, i) => (
                  <th key={h} className={`py-2 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.push.slice(0, 30).map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 px-1.5" style={{ borderBottom: `1px solid ${A3.faint}` }}>
                      <span className="block truncate max-w-[260px]" style={{ color: A3.t1 }}>{c.title ?? '—'}{c.automated && <A3Status tone="neutral">{t('an3.camp.auto')}</A3Status>}</span>
                      <span className="block text-[11px] tabular-nums" style={{ color: A3.t3 }}>{dateFmt.format(new Date(c.sent_at))}</span>
                    </td>
                    <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactNumber(c.sent, locale)}<span className="text-[11px]" style={{ color: A3.t3 }}> / {compactNumber(c.targeted, locale)}</span></td>
                    <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactNumber(c.taps, locale)}</td>
                    <td className="py-2.5 px-1.5 text-right tabular-nums font-semibold" style={{ color: orders(c) ? A3.t1 : A3.t3, borderBottom: `1px solid ${A3.faint}` }}>{compactNumber(orders(c), locale)}</td>
                    {money && <td className="py-2.5 px-1.5 text-right tabular-nums font-semibold" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactMoney(revenue(c), locale)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.push.length > 30 && <p className="m-0 mt-2 text-[11px]" style={{ color: A3.t3 }}>{t('an3.camp.pushMore').replace('{n}', String(data.push.length - 30))}</p>}
          </div>
        )}
      </A3Card>
    </div>
  );
}
