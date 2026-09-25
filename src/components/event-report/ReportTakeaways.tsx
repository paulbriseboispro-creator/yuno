/**
 * « À retenir » du Rapport de soirée : 0 à 3 constats calculés par
 * `get_event_report` (migration 20260925170000), chacun avec son seuil de
 * volume. Un clic descend à la section qui le prouve.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { Takeaways } from '@/components/analytics/kit';
import { useKpiFormat } from '@/components/analytics/kitFormat';
import { visitSourceLabel, type EventReport, type ReportTakeaway } from '@/lib/eventReport';

const SECTION_ID: Record<NonNullable<ReportTakeaway['section']>, string> = {
  sales: 'er-sales', curve: 'er-trend', reach: 'er-reach', who: 'er-who',
};

export function ReportTakeaways({ report }: { report: EventReport }) {
  const { t } = useLanguage();
  const fmt = useKpiFormat();
  const items = report.takeaways ?? [];
  const num = (v: string | number | null | undefined) => (typeof v === 'number' ? v : Number(v ?? 0));
  const text = (tk: ReportTakeaway): string => {
    const p = tk.params;
    const key = tk.key === 'msg_drove' ? `er.tk.msg_drove.${p.kind === 'push' ? 'push' : 'email'}` : `er.tk.${tk.key}`;
    return t(key)
      .replace('{pct}', fmt(num(p.pct), 'pct'))
      .replace('{missing}', fmt(num(p.missing), 'n'))
      .replace('{visits}', fmt(num(p.visits), 'n'))
      .replace('{n}', fmt(num(p.n), 'n'))
      .replace('{title}', String(p.title ?? ''))
      .replace('{source}', visitSourceLabel(String(p.source ?? ''), t));
  };
  return (
    <Takeaways
      title={t('ak.takeaways')}
      openLabel={t('ak.takeawayOpen')}
      items={items.map((tk) => ({
        key: tk.key,
        tone: tk.tone,
        text: text(tk),
        onOpen: tk.section
          ? () => document.getElementById(SECTION_ID[tk.section!])?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          : undefined,
      }))}
    />
  );
}
