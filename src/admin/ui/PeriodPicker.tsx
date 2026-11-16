import { useAdminT } from './i18n';
import { useAdminFilters } from '../context/useAdminFilters';
import { ADMIN_PERIODS } from '../context/period';

/** Le choix de période d'une page : 7 j, 30 j, 90 j, 12 mois. Écrit `?p=`. */
export function PeriodPicker() {
  const { t } = useAdminT();
  const { period, setPeriod } = useAdminFilters();
  return (
    <div className="a-seg" role="group" aria-label={t('adm.ui.period')}>
      {ADMIN_PERIODS.map((p) => (
        <button key={p} type="button" aria-pressed={p === period} onClick={() => setPeriod(p)}>
          {t(`adm.ui.period.${p}`)}
        </button>
      ))}
    </div>
  );
}
