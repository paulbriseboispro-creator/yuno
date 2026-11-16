/**
 * Rubrique « Aujourd'hui » : qu'est-ce qui demande une décision ?
 * Montée à `/admin` (index) et `/admin/today/*`. Chemins RELATIFS.
 *   - index     : la file du jour (TodayHome, lot 1) ;
 *   - alerts    : toutes les alertes (écran hérité, dans son cadre) ;
 *   - feedback  : support et retours (réécrit avec le kit, lot 1).
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const TodayHome = lazyWithRetry(() => import('./TodayHome'));
const FeedbackPage = lazyWithRetry(() => import('./FeedbackPage'));
const AlertsPage = lazyWithRetry(() => import('./AlertsPage'));

export default function TodayRoutes() {
  return (
    <Routes>
      <Route index element={<TodayHome />} />
      <Route path="alerts" element={<AlertsPage />} />
      <Route path="feedback" element={<FeedbackPage />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
