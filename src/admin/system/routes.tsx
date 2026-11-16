/**
 * Rubrique « Système » : est-ce que la machine tourne ? (`/admin/system/*`)
 * Santé technique, Interrupteurs, Offre et tarifs, Connecteurs, IA. Le plan
 * d'un prospect et le contenu des réglages de l'offre gardent leur écran
 * d'origine dans leur cadre. Chemins RELATIFS.
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { DRINKS_PILLAR_LIVE } from '@/lib/drinksPillar';
import { legacyAdminTarget } from '../redirects';
import { CrmFrame, SuiteFrame } from '../shell/frames';

const Health = lazyWithRetry(() => import('./Health'));
const Switches = lazyWithRetry(() => import('./Switches'));
const Pricing = lazyWithRetry(() => import('./Pricing'));
const Connectors = lazyWithRetry(() => import('./Connectors'));
const Ai = lazyWithRetry(() => import('./Ai'));
const AdminDrinkCatalog = lazyWithRetry(() => import('@/pages/admin/AdminDrinkCatalog'));
const CrmNightPlan = lazyWithRetry(() => import('@/crm/admin/pages/NightPlanAdminPage'));

/** Anciennes adresses de la rubrique (`crm`, `crm/plan/…`, `settings`) : leur nouvelle place. */
function LegacyHere() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={legacyAdminTarget(pathname, search, hash) ?? '/admin/system'} replace />;
}

export default function SystemRoutes() {
  return (
    <Routes>
      <Route index element={<Health />} />
      <Route path="switches" element={<Switches />} />
      <Route path="pricing" element={<Pricing />} />
      <Route path="connectors" element={<Connectors />} />
      <Route path="connectors/plan/:scope/:event" element={<CrmFrame><CrmNightPlan /></CrmFrame>} />
      <Route path="ai" element={<Ai />} />
      <Route path="crm/*" element={<LegacyHere />} />
      <Route path="settings" element={<LegacyHere />} />
      {/* Pilier boissons en pause (src/lib/drinksPillar.ts) : jamais au menu, l'adresse renvoie à Système. */}
      <Route path="drinks" element={DRINKS_PILLAR_LIVE ? <SuiteFrame><AdminDrinkCatalog /></SuiteFrame> : <Navigate to="/admin/system" replace />} />
      <Route path="*" element={<Navigate to="/admin/system" replace />} />
    </Routes>
  );
}
