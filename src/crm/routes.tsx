/**
 * Routes de la Console Yuno CRM. Appelé en ligne dans <Routes> (App.tsx) :
 * `{crmRoutes()}`. Une page nouvelle se déclare ici ET dans `shell/nav.ts`.
 */
import { Navigate, Route } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const CrmGate = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmGate })));
const CrmLayout = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmLayout })));
const HomePage = lazyWithRetry(() => import('./pages/home/HomePage'));
const ClientsPage = lazyWithRetry(() => import('./pages/clients/ClientsPage'));
const SegmentsPage = lazyWithRetry(() => import('./pages/segments/SegmentsPage'));

export function crmRoutes() {
  return (
    <>
      <Route path="/crm" element={<CrmGate><CrmLayout /></CrmGate>}>
        <Route index element={<HomePage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="segments" element={<SegmentsPage />} />
        <Route path="*" element={<Navigate to="/crm" replace />} />
      </Route>
    </>
  );
}
