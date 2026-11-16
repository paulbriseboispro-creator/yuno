/**
 * Rubrique « Légal » : sommes-nous en règle ? (`/admin/legal/*`)
 * Lot 0 : écrans existants remontés tels quels ; les échéances vivent encore
 * dans la page Alertes (le lot 5 leur donne leur écran). Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CrmFrame, SuiteFrame } from '../shell/frames';

const CrmLegal = lazyWithRetry(() => import('@/crm/admin/pages/LegalPage'));
const AdminAlerts = lazyWithRetry(() => import('@/pages/admin/AdminAlerts'));
const AdminAuditLog = lazyWithRetry(() => import('@/pages/admin/AdminAuditLog'));

export default function LegalRoutes() {
  return (
    <Routes>
      <Route index element={<CrmFrame><CrmLegal /></CrmFrame>} />
      <Route path="deadlines" element={<SuiteFrame><AdminAlerts /></SuiteFrame>} />
      <Route path="audit" element={<SuiteFrame><AdminAuditLog /></SuiteFrame>} />
      <Route path="*" element={<Navigate to="/admin/legal" replace />} />
    </Routes>
  );
}
