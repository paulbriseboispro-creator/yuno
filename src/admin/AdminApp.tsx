/**
 * L'admin unique de Yuno (refonte du 16/11, docs/designs/ADMIN_REBUILD_PLAN.md).
 * Seul point de montage dans App.tsx : `<Route path="/admin/*" element={<AdminApp />} />`.
 *
 *   /admin/login            connexion (mot de passe + 2FA)
 *   /admin                  Aujourd'hui            src/admin/today
 *   /admin/pilot/*          Pilotage               src/admin/pilotage
 *   /admin/madrid/*         Madrid (marketplace)   src/admin/madrid
 *   /admin/pros/*           Pros                   src/admin/pros
 *   /admin/clients/*        Clients                src/admin/clients
 *   /admin/money/*          Argent                 src/admin/money
 *   /admin/comms/*          Communication          src/admin/comms
 *   /admin/legal/*          Légal                  src/admin/legal
 *   /admin/system/*         Système                src/admin/system
 *   tout le reste           ancienne adresse → redirection (src/admin/redirects.ts)
 *
 * Chaque rubrique est un chunk chargé à la demande : un lot qui travaille
 * dans `src/admin/<rubrique>/` ne touche ni ce fichier ni les autres rubriques.
 */
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './ui/admin.css';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useLocaleSection } from '@/contexts/LanguageContext';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { AdminScopeProvider } from '@/components/admin/AdminScope';
import { AdminRoot, AdminShell, PageLoading } from './shell/AdminShell';
import { AdminGuard } from './shell/AdminGuard';
import { legacyAdminTarget } from './redirects';
import { ADMIN_ROOT } from './nav';

const AdminLogin = lazyWithRetry(() => import('./shell/AdminLogin'));
const TodayRoutes = lazyWithRetry(() => import('./today/routes'));
const PilotageRoutes = lazyWithRetry(() => import('./pilotage/routes'));
const MadridRoutes = lazyWithRetry(() => import('./madrid/routes'));
const ProsRoutes = lazyWithRetry(() => import('./pros/routes'));
const ClientsRoutes = lazyWithRetry(() => import('./clients/routes'));
const MoneyRoutes = lazyWithRetry(() => import('./money/routes'));
const CommsRoutes = lazyWithRetry(() => import('./comms/routes'));
const LegalRoutes = lazyWithRetry(() => import('./legal/routes'));
const SystemRoutes = lazyWithRetry(() => import('./system/routes'));

/** Une ancienne adresse (favori, alerte déjà émise) : sa nouvelle place. */
function LegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={legacyAdminTarget(pathname, search, hash) ?? ADMIN_ROOT} replace />;
}

function Rubrics() {
  return (
    <AdminShell>
      <Routes>
        <Route index element={<TodayRoutes />} />
        <Route path="today/*" element={<TodayRoutes />} />
        <Route path="pilot/*" element={<PilotageRoutes />} />
        <Route path="madrid/*" element={<MadridRoutes />} />
        <Route path="pros/*" element={<ProsRoutes />} />
        <Route path="clients/*" element={<ClientsRoutes />} />
        <Route path="money/*" element={<MoneyRoutes />} />
        <Route path="comms/*" element={<CommsRoutes />} />
        <Route path="legal/*" element={<LegalRoutes />} />
        <Route path="system/*" element={<SystemRoutes />} />
        <Route path="*" element={<LegacyRedirect />} />
      </Routes>
    </AdminShell>
  );
}

export default function AdminApp() {
  // Le dictionnaire admin (chunk à part) doit être là avant le premier rendu.
  const dictReady = useLocaleSection('admin');
  const { pathname } = useLocation();
  if (!dictReady) return <AdminRoot><PageLoading /></AdminRoot>;
  // L'ancienne connexion de l'Admin CRM passe par la redirection AVANT la garde.
  if (pathname.startsWith('/admin/crm/login')) return <LegacyRedirect />;
  return (
    <AdminRoot>
      <AdminScopeProvider>
        <Routes>
          <Route path="login" element={<AdminLogin />} />
          <Route path="*" element={<AdminGuard><Rubrics /></AdminGuard>} />
        </Routes>
      </AdminScopeProvider>
    </AdminRoot>
  );
}
