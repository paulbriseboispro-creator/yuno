/**
 * Phase 3 — cartes d'intelligence : segments RFM en langage club (avec
 * « Créer une campagne »), cohortes (mois de première soirée × mois 1, 2, 3, 6),
 * benchmarks Yuno anonymisés (au moins 5 clubs).
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Benchmarks, useAn3Cohorts, useAn3Rfm, cardState } from '@/hooks/useAn3';
import type { An3Scope } from '@/lib/analytics/an3Types';
import { an3Locale, compactMoney, compactNumber, pct } from '@/lib/analytics/an3Format';
import { A3Answer, A3Card } from './an3Ui';
import { A3 } from './an3Tokens';
import { HBarList } from './charts/HBarList';

export function RfmCard({ scope, campaignsHref }: { scope: An3Scope; campaignsHref?: string }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Rfm(scope);
  const d = q.data;
  return (
    <A3Card title={t('an3.rfm.title')} hint={t('an3.rfm.hint')} state={cardState(q, (x) => x.total >= 10)} minHeight={260}
      empty={{ title: t('an3.rfm.empty'), body: t('an3.rfm.emptyBody') }} error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }}>
      {d && (
        <div className="flex flex-col gap-3">
          <A3Answer>{t('an3.rfm.sentence').replace('{n}', compactNumber(d.total, locale)).replace('{pillars}', compactNumber((d.segments.find((s) => s.segment === 'pillars')?.n ?? 0) + (d.segments.find((s) => s.segment === 'loyal')?.n ?? 0), locale)).replace('{risk}', compactNumber(d.segments.find((s) => s.segment === 'at_risk')?.n ?? 0, locale))}</A3Answer>
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {d.segments.map((s) => (
              <li key={s.segment} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0"><span style={{ color: A3.t1 }}>{t(`an3.rfm.seg.${s.segment}`)}</span><span className="block text-[11px]" style={{ color: A3.t3 }}>{t(`an3.rfm.seg.${s.segment}.def`)}</span></span>
                  <span className="shrink-0 flex items-center gap-3 tabular-nums">
                    <span style={{ color: A3.t1, fontWeight: 600 }}>{compactNumber(s.n, locale)}</span>
                    {d.money && s.revenue != null && <span style={{ color: A3.t3 }}>{compactMoney(s.revenue, locale)}</span>}
                    {campaignsHref && s.n >= 10 && <a href={`${campaignsHref}?rfm=${s.raw.join(',')}`} className="text-[12px] font-medium min-h-[32px] inline-flex items-center" style={{ color: A3.accent }}>{t('an3.aud.createCampaign')}</a>}
                  </span>
                </div>
                <span className="block h-1.5 w-full rounded-full overflow-hidden" style={{ background: A3.track }}><span className="block h-full rounded-full" style={{ width: `${d.total ? (s.n / d.total) * 100 : 0}%`, background: A3.accent }} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </A3Card>
  );
}

export function CohortsCard({ scope }: { scope: An3Scope }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Cohorts(scope);
  const d = q.data;
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' });
  const cols: { key: 'r1' | 'r2' | 'r3' | 'r6'; label: string }[] = [{ key: 'r1', label: 'M1' }, { key: 'r2', label: 'M2' }, { key: 'r3', label: 'M3' }, { key: 'r6', label: 'M6' }];
  return (
    <A3Card title={t('an3.coh.title')} hint={t('an3.coh.hint')} state={cardState(q, (x) => x.rows.some((r) => !r.masked))} minHeight={260}
      empty={{ title: t('an3.coh.empty'), body: t('an3.coh.emptyBody') }} error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }}>
      {d && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead><tr>
              <th className="py-2 px-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{t('an3.coh.firstMonth')}</th>
              <th className="py-2 px-1.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{t('an3.col.customers')}</th>
              {cols.map((c) => <th key={c.key} className="py-2 px-1.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{c.label}</th>)}
            </tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.month}>
                  <td className="py-2 px-1.5" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{monthFmt.format(new Date(`${r.month}-01T12:00:00Z`))}</td>
                  <td className="py-2 px-1.5 text-right tabular-nums" style={{ color: r.masked ? A3.t3 : A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{r.masked ? t('an3.aud.masked').replace('{k}', '10') : compactNumber(r.people, locale)}</td>
                  {cols.map((c) => {
                    const v = r[c.key];
                    return (
                      <td key={c.key} className="py-2 px-1.5 text-right tabular-nums" style={{ borderBottom: `1px solid ${A3.faint}` }}>
                        {v == null ? <span style={{ color: A3.t3 }}>—</span>
                          : <span className="inline-block rounded-md px-1.5 py-0.5 min-w-[44px] text-center" style={{ background: `rgba(91,156,255,${(0.1 + 0.6 * Math.min(1, v / 100)).toFixed(2)})`, color: A3.t1 }}>{pct(v, locale)}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 mt-2 text-[11px]" style={{ color: A3.t3 }}>{t('an3.coh.note')}</p>
        </div>
      )}
    </A3Card>
  );
}

export function BenchmarksCard({ scope, mine }: { scope: An3Scope; mine: { attendance: number | null; fill: number | null; per_head: number | null } }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Benchmarks(scope);
  const d = q.data;
  const rows = d?.medians ? [
    { key: 'attendance', label: t('an3.kpi.attendance'), mine: mine.attendance, yuno: d.medians.attendance, fmt: (v: number) => pct(v, locale) },
    { key: 'fill', label: t('an3.bench.fill'), mine: mine.fill, yuno: d.medians.fill, fmt: (v: number) => pct(v, locale) },
    { key: 'per_head', label: t('an3.door.perHead'), mine: mine.per_head, yuno: d.medians.per_head, fmt: (v: number) => compactMoney(v, locale) },
  ] : [];
  return (
    <A3Card title={t('an3.bench.title')} hint={t('an3.bench.hint')} state={cardState(q, (x) => x.ready)} minHeight={200}
      empty={{ title: t('an3.bench.notYet'), body: t('an3.bench.notYetBody').replace('{n}', String(d?.contributors ?? 0)) }}>
      {d?.medians && (
        <HBarList rows={rows.flatMap((r) => [
          { key: `${r.key}-me`, label: `${r.label} · ${t('an3.bench.you')}`, value: r.mine ?? 0, display: r.mine != null ? r.fmt(r.mine) : '—' },
          { key: `${r.key}-yuno`, label: `${r.label} · ${t('an3.bench.median')}`, value: r.yuno ?? 0, display: r.yuno != null ? r.fmt(r.yuno) : '—' },
        ])} limit={6} />
      )}
    </A3Card>
  );
}
