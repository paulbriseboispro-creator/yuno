import { useLanguage } from '@/contexts/LanguageContext';
import { useNumberFormat } from '@/components/analytics/kitFormat';

/** Met en forme l'abscisse d'une courbe (`key` de `fillAxis`) : « J-3 » pour une soirée, « 12 sept. » pour une période. */
export function useAxisLabel() {
  const { t } = useLanguage();
  const { locale } = useNumberFormat();
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (key: string): string => {
    if (key.startsWith('d')) {
      const d = Number(key.slice(1));
      return d > 0 ? t('er.day.before').replace('{n}', String(d)) : d === 0 ? t('er.day.j') : t('er.day.after').replace('{n}', String(-d));
    }
    const ms = Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
    return fmt.format(new Date(ms));
  };
}
