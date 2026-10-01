/**
 * La réponse du Rapport de soirée, en une phrase, avant tout graphique
 * (plan de simplification, lot 4). Avant et pendant : où en sont les ventes,
 * et où en était la soirée de référence au même J-N. Après : combien sont
 * venus, ce que la soirée a rapporté par tête, et l'écart avec la référence.
 */
import type { ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnswerLine } from '@/components/analytics/kit';
import { useKpiFormat, useNumberFormat } from '@/components/analytics/kitFormat';
import { attendancePct, spendPerHead } from '@/lib/metrics';
import { reportHeadline, type EventReport } from '@/lib/eventReport';

/** Remplit « {x} » d'un gabarit avec des nœuds (chiffres en gras). */
function fill(tpl: string, parts: Record<string, ReactNode>): ReactNode[] {
  return tpl.split(/(\{[a-zA-Z]+\})/g).map((chunk, i) => {
    const m = chunk.match(/^\{([a-zA-Z]+)\}$/);
    return m && m[1] in parts ? <span key={i}>{parts[m[1]]}</span> : chunk;
  });
}

const B = ({ children }: { children: ReactNode }) => <strong style={{ fontWeight: 650 }}>{children}</strong>;

export function ReportAnswer({ report, compare }: { report: EventReport; compare: EventReport | null }) {
  const { t } = useLanguage();
  const { n, eur } = useNumberFormat();
  const fmt = useKpiFormat();
  const h = reportHeadline(report, compare);
  if (h.kind === 'empty') return null;

  if (h.kind === 'selling') {
    const when = h.daysBefore === 0 ? t('er.a.today') : t('er.a.jDay').replace('{d}', String(h.daysBefore));
    const main = fill(t('er.a.selling'), {
      sold: <B>{n(h.sold)}</B>,
      unit: t(h.pillar === 'tickets' ? 'er.a.unitTickets' : h.pillar === 'tables' ? 'er.a.unitTables' : 'er.a.unitGuests'),
      when,
      cap: h.capacity ? t('er.a.sellingCap').replace('{cap}', n(h.capacity)) : '',
    });
    let ref: ReactNode = null;
    if (h.reference !== null && compare) {
      const diff = h.sold - h.reference;
      const title = <B>{compare.event.title}</B>;
      ref = <> {fill(t(diff > 0 ? 'er.a.refUp' : diff < 0 ? 'er.a.refDown' : 'er.a.refSame'), { diff: <B>{n(Math.abs(diff))}</B>, title })}</>;
    }
    return <AnswerLine>{main}{ref}</AnswerLine>;
  }

  // Après la soirée.
  if (h.entered === 0) {
    return <AnswerLine>{fill(t('er.a.noScan'), { expected: <B>{n(h.expected)}</B> })}</AnswerLine>;
  }
  const main = fill(t('er.a.after'), {
    entered: <B>{n(h.entered)}</B>,
    expected: n(h.expected),
    presence: fmt(attendancePct(h.entered, h.expected), 'pct'),
  });
  const money = h.revenue !== null && h.revenue > 0
    ? fill(t('er.a.afterMoney'), { revenue: <B>{eur(h.revenue)}</B>, spend: <B>{fmt(spendPerHead(h.revenue, h.entered), 'eur')}</B> })
    : null;
  let ref: ReactNode = null;
  if (h.reference !== null && compare) {
    const diff = h.entered - h.reference;
    if (diff !== 0) {
      ref = <> {fill(t(diff > 0 ? 'er.a.afterRefUp' : 'er.a.afterRefDown'), { diff: <B>{n(Math.abs(diff))}</B>, title: <B>{compare.event.title}</B> })}</>;
    }
  }
  return <AnswerLine>{main}{money}{ref}</AnswerLine>;
}
