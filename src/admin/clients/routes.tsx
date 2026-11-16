/**
 * Rubrique « Clients » : qui achète sur Yuno ? (`/admin/clients/*`)
 * Lot 0 : écrans existants remontés tels quels. Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { SuiteFrame } from '../shell/frames';

const AdminCustomers = lazyWithRetry(() => import('@/pages/admin/AdminCustomers'));
const AdminEvents = lazyWithRetry(() => import('@/pages/admin/AdminEvents'));
const AdminPeople = lazyWithRetry(() => import('@/pages/admin/AdminPeople'));
const AdminUserDetail = lazyWithRetry(() => import('@/pages/admin/AdminUserDetail'));

export default function ClientsRoutes() {
  return (
    <Routes>
      <Route index element={<SuiteFrame><AdminCustomers /></SuiteFrame>} />
      <Route path="events" element={<SuiteFrame><AdminEvents /></SuiteFrame>} />
      <Route path="people" element={<SuiteFrame><AdminPeople /></SuiteFrame>} />
      <Route path="people/:userId" element={<SuiteFrame><AdminUserDetail /></SuiteFrame>} />
      <Route path="*" element={<Navigate to="/admin/clients" replace />} />
    </Routes>
  );
}
