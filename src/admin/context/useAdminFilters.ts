/**
 * LE hook que toute page de l'admin lit pour sa période et sa portée démo.
 *
 *   const { period, range, includeDemo } = useAdminFilters();
 *   supabase.rpc('…', { p_days: range.days, p_include_demo: includeDemo })
 *
 * La période vit dans l'adresse (`?p=`) : un lien copié garde ce qu'on
 * regardait. La portée démo est l'interrupteur unique de la coquille
 * (AdminScope, mémorisé sur l'appareil). Une page ne filtre JAMAIS la démo
 * elle-même : elle passe `p_include_demo` à sa RPC.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdminScope } from '@/components/admin/AdminScope';
import { parseAdminPeriod, periodRange, DEFAULT_ADMIN_PERIOD, type AdminPeriod, type PeriodRange } from './period';

export interface AdminFilters {
  period: AdminPeriod;
  setPeriod: (p: AdminPeriod) => void;
  /** Bornes de la période et de la précédente, recalculées quand `period` change. */
  range: PeriodRange;
  includeDemo: boolean;
  setIncludeDemo: (v: boolean) => void;
}

export function useAdminFilters(): AdminFilters {
  const [sp, setSp] = useSearchParams();
  const period = parseAdminPeriod(sp.get('p'));
  const { includeDemo, setIncludeDemo } = useAdminScope();

  const setPeriod = useCallback((p: AdminPeriod) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      if (p === DEFAULT_ADMIN_PERIOD) next.delete('p');
      else next.set('p', p);
      return next;
    }, { replace: true });
  }, [setSp]);

  // `now` est figé à la minute : une page qui se re-rend ne relance pas ses
  // requêtes à chaque milliseconde.
  const minute = Math.floor(Date.now() / 60000);
  const range = useMemo(() => periodRange(period, new Date(minute * 60000)), [period, minute]);

  return { period, setPeriod, range, includeDemo, setIncludeDemo };
}
