/**
 * Rubrique « Pros » : qui sont mes comptes et où en sont-ils ? (`/admin/pros/*`)
 * Lot 2 : une liste et UNE fiche pour tous les comptes (clubs, organisateurs,
 * associations, agences, comptes Yuno CRM), prospects réunis, une porte pour
 * inviter, une page Démo, une page Accès assisté. Chemins RELATIFS.
 *
 * Les anciennes listes (Clubs, Organisateurs, Agences, Comptes CRM) sont
 * supprimées : leurs gestes vivent sur la fiche d'un pro, dans la liste des
 * invitations et dans Démo › Vitrines ; leurs adresses passent par
 * redirects.ts (liste filtrée).
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { legacyAdminTarget } from '../redirects';

const AccountsPage = lazyWithRetry(() => import('./AccountsPage'));
const AccountPage = lazyWithRetry(() => import('./AccountPage'));
const ProspectsPage = lazyWithRetry(() => import('./ProspectsPage'));
const InvitePage = lazyWithRetry(() => import('./InvitePage'));
const DemoPage = lazyWithRetry(() => import('./DemoPage'));
const SupportPage = lazyWithRetry(() => import('./SupportPage'));

/** Une adresse du lot 0 (`/admin/pros/venues/<id>`, `/admin/pros/crm/<clé>`…) : sa nouvelle place. */
function ProsLegacy() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={legacyAdminTarget(pathname, search, hash) ?? '/admin/pros'} replace />;
}

export default function ProsRoutes() {
  return (
    <Routes>
      <Route index element={<AccountsPage />} />
      <Route path="prospects" element={<ProspectsPage />} />
      <Route path="invite" element={<InvitePage />} />
      <Route path="demo" element={<DemoPage />} />
      <Route path="support" element={<SupportPage />} />
      {/* La fiche : `venue:<id>`, `org:<uuid>`, `agency:<uuid>`. Une clé illisible repart par ProsLegacy. */}
      <Route path=":key" element={<AccountPage />} />
      <Route path="*" element={<ProsLegacy />} />
    </Routes>
  );
}
