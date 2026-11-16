/**
 * Rubrique « Aujourd'hui » : qu'est-ce qui demande une décision ?
 * Montée à `/admin` (index) et `/admin/today/*`. Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { SuiteFrame } from '../shell/frames';

const TodayHome = lazyWithRetry(() => import('./TodayHome'));
const AdminAlerts = lazyWithRetry(() => import('@/pages/admin/AdminAlerts'));
const AdminFeedback = lazyWithRetry(() => import('@/pages/admin/AdminFeedback'));

export default function TodayRoutes() {
  return (
    <Routes>
      <Route index element={<TodayHome />} />
      <Route path="alerts" element={<SuiteFrame><AdminAlerts /></SuiteFrame>} />
      <Route path="feedback" element={<SuiteFrame><AdminFeedback /></SuiteFrame>} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
