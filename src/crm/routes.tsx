/**
 * Routes de la Console Yuno CRM. Appelé en ligne dans <Routes> (App.tsx) :
 * `{crmRoutes()}`. Une page nouvelle se déclare ici ET dans `shell/nav.ts`.
 */
import { Navigate, Route } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const CrmGate = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmGate })));
const CrmLayout = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmLayout })));
const HomePage = lazyWithRetry(() => import('./pages/home/HomePage'));

export function crmRoutes() {
  return (
    <>
      <Route path="/crm" element={<CrmGate><CrmLayout /></CrmGate>}>
        <Route index element={<HomePage />} />
        <Route path="*" element={<Navigate to="/crm" replace />} />
      </Route>
    </>
  );
}
