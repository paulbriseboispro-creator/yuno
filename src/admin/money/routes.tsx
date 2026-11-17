/**
 * Rubrique « Argent » : qu'a-t-on vendu, gagné, et que reste-t-il à régler ?
 * (`/admin/money/*`). Ventes, Commandes, À régler, Abonnements et Yunits,
 * Coûts et marge, tous au kit. Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const SalesPage = lazyWithRetry(() => import('./SalesPage'));
const OrdersPage = lazyWithRetry(() => import('./OrdersPage'));
const IssuesPage = lazyWithRetry(() => import('./IssuesPage'));
const CrmMoneyPage = lazyWithRetry(() => import('./CrmMoneyPage'));
const CostsPage = lazyWithRetry(() => import('./CostsPage'));

export default function MoneyRoutes() {
  return (
    <Routes>
      <Route index element={<SalesPage />} />
      <Route path="orders" element={<OrdersPage />} />
      <Route path="issues" element={<IssuesPage />} />
      <Route path="crm" element={<CrmMoneyPage />} />
      <Route path="costs" element={<CostsPage />} />
      <Route path="invoices" element={<Navigate to="/admin/money/costs?tab=invoices" replace />} />
      {/* Abonnements de la Suite : fonction coupée (SUBSCRIPTIONS_ENABLED), écran retiré ; ceux de Yuno CRM sont dans « CRM ». */}
      <Route path="subscriptions" element={<Navigate to="/admin/money/crm" replace />} />
      <Route path="*" element={<Navigate to="/admin/money" replace />} />
    </Routes>
  );
}
