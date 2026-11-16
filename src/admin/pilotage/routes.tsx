/**
 * Rubrique « Pilotage » : comment va l'entreprise ? (`/admin/pilot/*`)
 * Lot 4 : Vue d'ensemble, Acquisition, Rétention, Audience, Produit, réécrits
 * avec le kit. Les anciens Cockpits (Suite et CRM) disparaissent : leurs
 * adresses mènent à la vue d'ensemble. Chemins RELATIFS.
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { SuiteFrame } from '../shell/frames';

const OverviewPage = lazyWithRetry(() => import('./OverviewPage'));
const AcquisitionPage = lazyWithRetry(() => import('./AcquisitionPage'));
const RetentionPage = lazyWithRetry(() => import('./RetentionPage'));
const AudiencePage = lazyWithRetry(() => import('./AudiencePage'));
const ProductPage = lazyWithRetry(() => import('./ProductPage'));
const AdminProSignups = lazyWithRetry(() => import('@/pages/admin/AdminProSignups'));

/** Ancienne adresse de la rubrique → nouvelle, la requête suit (et la cible peut en poser une). */
function Moved({ to }: { to: string }) {
  const { search, hash } = useLocation();
  const [path, q = ''] = to.split('?');
  const sp = new URLSearchParams(q);
  new URLSearchParams(search).forEach((v, k) => sp.set(k, v));
  const s = sp.toString();
  return <Navigate to={`${path}${s ? `?${s}` : ''}${hash}`} replace />;
}

export default function PilotageRoutes() {
  return (
    <Routes>
      <Route index element={<OverviewPage />} />
      <Route path="acquisition" element={<AcquisitionPage />} />
      <Route path="retention" element={<RetentionPage />} />
      <Route path="audience" element={<AudiencePage />} />
      <Route path="product" element={<ProductPage />} />
      <Route path="signups" element={<SuiteFrame><AdminProSignups /></SuiteFrame>} />
      {/* Adresses du lot 0, remplacées. */}
      <Route path="growth" element={<Moved to="/admin/pilot/audience" />} />
      <Route path="ai" element={<Moved to="/admin/pilot/product?tab=ai" />} />
      <Route path="crm" element={<Moved to="/admin/pilot" />} />
      <Route path="crm-acquisition" element={<Moved to="/admin/pilot/acquisition" />} />
      <Route path="crm-product" element={<Moved to="/admin/pilot/product?tab=crm" />} />
      <Route path="*" element={<Navigate to="/admin/pilot" replace />} />
    </Routes>
  );
}
