import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parsePeriod, type PeriodKey } from '@/lib/analyticsPeriod';

/**
 * La période des vues « toutes les soirées », adressable par l'URL
 * (`?period=7d`) comme la soirée choisie (`?event=`) : un lien, un rechargement
 * ou un changement de famille la gardent. L'écrire remplace l'entrée
 * d'historique — « retour » ne rejoue pas chaque choix.
 */
export function useAnalyticsPeriod(): [PeriodKey, (next: PeriodKey) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = parsePeriod(searchParams.get('period'));
  const setPeriod = useCallback((next: PeriodKey) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('period', next);
      return params;
    }, { replace: true });
  }, [setSearchParams]);
  return [period, setPeriod];
}
