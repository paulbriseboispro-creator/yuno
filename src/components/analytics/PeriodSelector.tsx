/**
 * Le sélecteur de période des vues « toutes les soirées » : 24 h · 48 h · 7 jours
 * · 30 jours · 90 jours · Tout. Le même dans Ventes, Trafic et Communauté ; il
 * disparaît quand on regarde UNE soirée (la soirée est sa propre période).
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { Segmented } from '@/components/event-report/ui';
import { useAnalyticsPeriod } from '@/hooks/useAnalyticsPeriod';
import { PERIODS, type PeriodKey } from '@/lib/analyticsPeriod';

export function PeriodSelector() {
  const { t } = useLanguage();
  const [period, setPeriod] = useAnalyticsPeriod();
  return (
    <Segmented<PeriodKey>
      label={t('evl.period.label')}
      value={period}
      onChange={setPeriod}
      options={PERIODS.map((p) => ({ value: p, label: t(`evl.period.${p}`) }))}
    />
  );
}
