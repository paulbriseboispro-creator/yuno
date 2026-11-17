/**
 * Rubrique « Madrid » (`/admin/madrid/*`) : la marketplace EXTERNE de Madrid,
 * soirées de clubs non clients dont le bouton sort vers une autre billetterie.
 * Aucune vente faite dans Yuno n'y est comptée, sauf sur « Effet sur Yuno ».
 * Définitions : docs/designs/ADMIN_MADRID.md. Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const VerdictPage = lazyWithRetry(() => import('./VerdictPage'));
const ClubsPage = lazyWithRetry(() => import('./ClubsPage'));
const AudiencePage = lazyWithRetry(() => import('./AudiencePage'));
const YunoPage = lazyWithRetry(() => import('./YunoPage'));
const SupplyPage = lazyWithRetry(() => import('./SupplyPage'));

export default function MadridRoutes() {
  return (
    <Routes>
      <Route index element={<VerdictPage />} />
      <Route path="clubs" element={<ClubsPage />} />
      <Route path="audience" element={<AudiencePage />} />
      <Route path="yuno" element={<YunoPage />} />
      <Route path="supply" element={<SupplyPage />} />
      <Route path="*" element={<Navigate to="/admin/madrid" replace />} />
    </Routes>
  );
}
