/**
 * Rubrique « Pros » : qui sont mes comptes et où en sont-ils ? (`/admin/pros/*`)
 * Lot 0 : écrans existants remontés tels quels. Le lot 2 réunit la liste et
 * la fiche de tous les comptes. Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CrmFrame, SuiteFrame } from '../shell/frames';

const AdminVenues = lazyWithRetry(() => import('@/pages/admin/AdminVenues'));
const AdminVenueDetail = lazyWithRetry(() => import('@/pages/admin/AdminVenueDetail'));
const AdminOrganizers = lazyWithRetry(() => import('@/pages/admin/AdminOrganizers'));
const AdminAgencies = lazyWithRetry(() => import('@/pages/admin/AdminAgencies'));
const AdminDemoAccess = lazyWithRetry(() => import('@/pages/admin/AdminDemoAccess'));
const AdminSupportAccess = lazyWithRetry(() => import('@/pages/admin/AdminSupportAccess'));
const CrmClients = lazyWithRetry(() => import('@/crm/admin/pages/ClientsPage'));
const CrmAccount = lazyWithRetry(() => import('@/crm/admin/pages/AccountPage'));
const CrmSales = lazyWithRetry(() => import('@/crm/admin/pages/SalesPage'));
const CrmInvite = lazyWithRetry(() => import('@/crm/admin/pages/InvitePage'));
const CrmDemo = lazyWithRetry(() => import('@/crm/admin/pages/DemoPage'));
const CrmSupport = lazyWithRetry(() => import('@/crm/admin/pages/SupportPage'));

export default function ProsRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="/admin/pros/venues" replace />} />
      <Route path="venues" element={<SuiteFrame><AdminVenues /></SuiteFrame>} />
      <Route path="venues/:venueId" element={<SuiteFrame><AdminVenueDetail /></SuiteFrame>} />
      <Route path="organizers" element={<SuiteFrame><AdminOrganizers /></SuiteFrame>} />
      <Route path="agencies" element={<SuiteFrame><AdminAgencies /></SuiteFrame>} />
      <Route path="demo" element={<SuiteFrame><AdminDemoAccess /></SuiteFrame>} />
      <Route path="support" element={<SuiteFrame><AdminSupportAccess /></SuiteFrame>} />
      <Route path="crm" element={<CrmFrame><CrmClients /></CrmFrame>} />
      <Route path="crm/:id" element={<CrmFrame><CrmAccount /></CrmFrame>} />
      <Route path="sales" element={<CrmFrame><CrmSales /></CrmFrame>} />
      <Route path="invite" element={<CrmFrame><CrmInvite /></CrmFrame>} />
      <Route path="crm-demo" element={<CrmFrame><CrmDemo /></CrmFrame>} />
      <Route path="crm-support" element={<CrmFrame><CrmSupport /></CrmFrame>} />
      <Route path="*" element={<Navigate to="/admin/pros/venues" replace />} />
    </Routes>
  );
}
