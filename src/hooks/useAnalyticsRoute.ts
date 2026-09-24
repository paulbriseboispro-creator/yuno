import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { pickEventId } from '@/hooks/useEventParam';
import {
  defaultView, needsCanonicalUrl, resolveAnalyticsRoute,
  type AnalyticsFamily, type AnalyticsRoute,
} from '@/lib/analyticsNav';

/**
 * La page d'Analytics affichée, lue dans l'URL (`?tab=&view=`) — voir
 * `src/lib/analyticsNav.ts`. Une ancienne adresse est réécrite en place
 * (`replace`), une navigation de l'utilisateur crée une entrée d'historique :
 * le bouton « retour » ramène à la page d'avant, pas à l'onglet d'avant.
 * La soirée choisie (`?event=`) suit l'utilisateur d'une page à l'autre.
 */
export function useAnalyticsRoute(): AnalyticsRoute & {
  go: (family: AnalyticsFamily, view?: string) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const view = searchParams.get('view');
  const hasEvent = !!pickEventId(searchParams.get('event'));
  const route = useMemo(() => resolveAnalyticsRoute(tab, view, hasEvent), [tab, view, hasEvent]);

  useEffect(() => {
    if (!needsCanonicalUrl(tab, view, route)) return;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', route.family);
      if (route.family === 'live') params.delete('view');
      else params.set('view', route.view);
      return params;
    }, { replace: true });
  }, [tab, view, route, setSearchParams]);

  const go = useCallback((family: AnalyticsFamily, nextView?: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', family);
      if (family === 'live') params.delete('view');
      else params.set('view', nextView ?? defaultView(family));
      return params;
    });
  }, [setSearchParams]);

  return { ...route, go };
}
