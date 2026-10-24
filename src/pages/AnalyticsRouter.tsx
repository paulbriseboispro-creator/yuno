/**
 * L'ancienne Analytics (`/owner/analytics`, `/organizer-app/analytics`,
 * `/manager/analytics`) est remplacée par les Analyses de Yuno Tickets
 * (src/tickets/analytics, lot 8 du plan combiné du 24/10). Son adresse reste
 * valable (liens partagés, alertes déjà émises, favoris) : elle renvoie vers la
 * page des Analyses qui répond à la même question (`analysesHrefFromLegacy`).
 */
import { Navigate, useLocation } from 'react-router-dom';
import { analysesHrefFromLegacy } from '@/lib/analyticsNav';

function LegacyAnalyticsRedirect() {
  const { pathname, search } = useLocation();
  const prefix = pathname.replace(/\/analytics\/?$/, '');
  return <Navigate to={analysesHrefFromLegacy(prefix, search)} replace />;
}

export default LegacyAnalyticsRedirect;
export { LegacyAnalyticsRedirect as OrgAnalyticsRoute };
