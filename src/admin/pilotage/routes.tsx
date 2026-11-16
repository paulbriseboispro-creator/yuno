/**
 * Rubrique « Pilotage » : comment va l'entreprise ? (`/admin/pilot/*`)
 * Lot 0 : écrans existants remontés tels quels. Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CrmFrame, SuiteFrame } from '../shell/frames';

const AdminCockpit = lazyWithRetry(() => import('@/pages/admin/AdminCockpit'));
const AdminGrowth = lazyWithRetry(() => import('@/pages/admin/AdminGrowth'));
const AdminProSignups = lazyWithRetry(() => import('@/pages/admin/AdminProSignups'));
const AdminProduct = lazyWithRetry(() => import('@/pages/admin/AdminProduct'));
const AdminAi = lazyWithRetry(() => import('@/pages/admin/AdminAi'));
const CrmCockpit = lazyWithRetry(() => import('@/crm/admin/pages/CockpitPage'));
const CrmAcquisition = lazyWithRetry(() => import('@/crm/admin/pages/AcquisitionPage'));
const CrmProduct = lazyWithRetry(() => import('@/crm/admin/pages/ProductPage'));

export default function PilotageRoutes() {
  return (
    <Routes>
      <Route index element={<SuiteFrame><AdminCockpit /></SuiteFrame>} />
      <Route path="growth" element={<SuiteFrame><AdminGrowth /></SuiteFrame>} />
      <Route path="signups" element={<SuiteFrame><AdminProSignups /></SuiteFrame>} />
      <Route path="product" element={<SuiteFrame><AdminProduct /></SuiteFrame>} />
      <Route path="ai" element={<SuiteFrame><AdminAi /></SuiteFrame>} />
      <Route path="crm" element={<CrmFrame><CrmCockpit /></CrmFrame>} />
      <Route path="crm-acquisition" element={<CrmFrame><CrmAcquisition /></CrmFrame>} />
      <Route path="crm-product" element={<CrmFrame><CrmProduct /></CrmFrame>} />
      <Route path="*" element={<Navigate to="/admin/pilot" replace />} />
    </Routes>
  );
}
