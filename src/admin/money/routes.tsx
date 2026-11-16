/**
 * Rubrique « Argent » : qu'a-t-on vendu, gagné, et que reste-t-il à régler ?
 * (`/admin/money/*`). Lot 0 : écrans existants remontés tels quels.
 * Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CrmFrame, SuiteFrame } from '../shell/frames';

const AdminRevenue = lazyWithRetry(() => import('@/pages/admin/AdminRevenue'));
const AdminOrders = lazyWithRetry(() => import('@/pages/admin/AdminOrders'));
const AdminSubscriptions = lazyWithRetry(() => import('@/pages/admin/AdminSubscriptions'));
const CrmMoney = lazyWithRetry(() => import('@/crm/admin/pages/MoneyPage'));

export default function MoneyRoutes() {
  return (
    <Routes>
      <Route index element={<SuiteFrame><AdminRevenue /></SuiteFrame>} />
      <Route path="orders" element={<SuiteFrame><AdminOrders /></SuiteFrame>} />
      <Route path="crm" element={<CrmFrame><CrmMoney /></CrmFrame>} />
      {/* Abonnements de la Suite : fonctionnalité coupée, hors menu (entrée `hidden`). */}
      <Route path="subscriptions" element={<SuiteFrame><AdminSubscriptions /></SuiteFrame>} />
      <Route path="*" element={<Navigate to="/admin/money" replace />} />
    </Routes>
  );
}
