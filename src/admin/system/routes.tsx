/**
 * Rubrique « Système » : est-ce que la machine tourne ? (`/admin/system/*`)
 * Lot 0 : écrans existants remontés tels quels. Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { DRINKS_PILLAR_LIVE } from '@/lib/drinksPillar';
import { CrmFrame, SuiteFrame } from '../shell/frames';

const AdminSystem = lazyWithRetry(() => import('@/pages/admin/AdminSystem'));
const AdminDrinkCatalog = lazyWithRetry(() => import('@/pages/admin/AdminDrinkCatalog'));
const CrmPlatform = lazyWithRetry(() => import('@/crm/admin/pages/PlatformPage'));
const CrmNightPlan = lazyWithRetry(() => import('@/crm/admin/pages/NightPlanAdminPage'));
const CrmSettings = lazyWithRetry(() => import('@/crm/admin/pages/SettingsPage'));

export default function SystemRoutes() {
  return (
    <Routes>
      <Route index element={<SuiteFrame><AdminSystem /></SuiteFrame>} />
      <Route path="crm" element={<CrmFrame><CrmPlatform /></CrmFrame>} />
      <Route path="crm/plan/:scope/:event" element={<CrmFrame><CrmNightPlan /></CrmFrame>} />
      <Route path="settings" element={<CrmFrame><CrmSettings /></CrmFrame>} />
      {/* Pilier boissons en pause (src/lib/drinksPillar.ts) : jamais au menu, l'adresse renvoie à Système. */}
      <Route path="drinks" element={DRINKS_PILLAR_LIVE ? <SuiteFrame><AdminDrinkCatalog /></SuiteFrame> : <Navigate to="/admin/system" replace />} />
      <Route path="*" element={<Navigate to="/admin/system" replace />} />
    </Routes>
  );
}
