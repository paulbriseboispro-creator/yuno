/**
 * Rubrique « Légal » : sommes-nous en règle ? (`/admin/legal/*`)
 * Lot 5 : dix écrans au kit, une question chacun. Des registres et des tableaux
 * de suivi, jamais un avis juridique. Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const OverviewPage = lazyWithRetry(() => import('./OverviewPage'));
const RequestsPage = lazyWithRetry(() => import('./RequestsPage'));
const ConsentsPage = lazyWithRetry(() => import('./ConsentsPage'));
const TermsPage = lazyWithRetry(() => import('./TermsPage'));
const SellersPage = lazyWithRetry(() => import('./SellersPage'));
const IncidentsPage = lazyWithRetry(() => import('./IncidentsPage'));
const ReportsPage = lazyWithRetry(() => import('./ReportsPage'));
const DocumentsPage = lazyWithRetry(() => import('./DocumentsPage'));
const AuditPage = lazyWithRetry(() => import('./AuditPage'));

export default function LegalRoutes() {
  return (
    <Routes>
      <Route index element={<OverviewPage />} />
      <Route path="requests" element={<RequestsPage />} />
      <Route path="consents" element={<ConsentsPage />} />
      <Route path="terms" element={<TermsPage />} />
      <Route path="sellers" element={<SellersPage />} />
      <Route path="incidents" element={<IncidentsPage />} />
      <Route path="reports" element={<ReportsPage />} />
      <Route path="documents" element={<DocumentsPage />} />
      <Route path="deadlines" element={<Navigate to="/admin/legal" replace />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="*" element={<Navigate to="/admin/legal" replace />} />
    </Routes>
  );
}
