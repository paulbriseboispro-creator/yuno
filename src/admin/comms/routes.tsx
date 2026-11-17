/**
 * Rubrique « Communication » : que dit Yuno, et est-ce que ça arrive ?
 * (`/admin/comms/*`). Tout est au kit sauf les éditeurs partagés avec la
 * Console des pros (Email Studio, éditeur SMS, recettes e-mail), qui gardent
 * leur cadre d'origine derrière une barre de retour.
 * Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { EditorFrame } from './EditorBar';

const Campaigns = lazyWithRetry(() => import('./Campaigns'));
const Engine = lazyWithRetry(() => import('./Engine'));
const Deliverability = lazyWithRetry(() => import('./Deliverability'));
const Links = lazyWithRetry(() => import('./Links'));
const Push = lazyWithRetry(() => import('./Push'));
const SmsEditor = lazyWithRetry(() => import('./SmsEditor'));
const AdminMarketingEmailEditor = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingEmailEditor })));
const AdminMarketingEmailReport = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingEmailReport })));
const AdminMarketingTemplateEditor = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingTemplateEditor })));
const AdminMarketingAutomations = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingAutomations })));

export default function CommsRoutes() {
  return (
    <Routes>
      <Route index element={<Campaigns />} />
      <Route path="engine" element={<Engine />} />
      <Route path="deliverability" element={<Deliverability />} />
      <Route path="links" element={<Links />} />
      <Route path="push" element={<Push />} />
      <Route path="sms" element={<SmsEditor />} />
      <Route path="sms/:id" element={<SmsEditor />} />
      {/* Éditeurs partagés avec la Console des pros : leur cadre d'origine, une entrée au kit */}
      <Route path="email/new" element={<EditorFrame><AdminMarketingEmailEditor /></EditorFrame>} />
      <Route path="email/:id/edit" element={<EditorFrame><AdminMarketingEmailEditor /></EditorFrame>} />
      <Route path="email/:id/report" element={<EditorFrame><AdminMarketingEmailReport /></EditorFrame>} />
      <Route path="email/templates/:id" element={<EditorFrame><AdminMarketingTemplateEditor /></EditorFrame>} />
      <Route path="automations" element={<EditorFrame channel="recipes"><AdminMarketingAutomations /></EditorFrame>} />
      <Route path="*" element={<Navigate to="/admin/comms" replace />} />
    </Routes>
  );
}
