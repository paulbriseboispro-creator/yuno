/**
 * Rubrique « Communication » : que dit Yuno, et est-ce que ça arrive ?
 * (`/admin/comms/*`). Réécrits au kit : Campagnes (index), Notifications
 * automatiques, Délivrabilité, Page bio. Les éditeurs (Email Studio, SMS,
 * formulaire push, recettes e-mail) restent dans leur cadre d'origine.
 * Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { SuiteFrame } from '../shell/frames';

const Campaigns = lazyWithRetry(() => import('./Campaigns'));
const Engine = lazyWithRetry(() => import('./Engine'));
const Deliverability = lazyWithRetry(() => import('./Deliverability'));
const Links = lazyWithRetry(() => import('./Links'));
const AdminMarketingEmailEditor = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingEmailEditor })));
const AdminMarketingEmailReport = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingEmailReport })));
const AdminMarketingTemplateEditor = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingTemplateEditor })));
const AdminMarketingAutomations = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingAutomations })));
const AdminMarketingSms = lazyWithRetry(() => import('@/pages/admin/AdminMarketingSms'));
const AdminPushNotifications = lazyWithRetry(() => import('@/pages/admin/AdminPushNotifications'));

export default function CommsRoutes() {
  return (
    <Routes>
      <Route index element={<Campaigns />} />
      <Route path="engine" element={<Engine />} />
      <Route path="deliverability" element={<Deliverability />} />
      <Route path="links" element={<Links />} />
      {/* Éditeurs hérités */}
      <Route path="email/new" element={<SuiteFrame><AdminMarketingEmailEditor /></SuiteFrame>} />
      <Route path="email/:id/edit" element={<SuiteFrame><AdminMarketingEmailEditor /></SuiteFrame>} />
      <Route path="email/:id/report" element={<SuiteFrame><AdminMarketingEmailReport /></SuiteFrame>} />
      <Route path="email/templates/:id" element={<SuiteFrame><AdminMarketingTemplateEditor /></SuiteFrame>} />
      <Route path="automations" element={<SuiteFrame><AdminMarketingAutomations /></SuiteFrame>} />
      <Route path="sms" element={<SuiteFrame><AdminMarketingSms /></SuiteFrame>} />
      <Route path="sms/:id" element={<SuiteFrame><AdminMarketingSms /></SuiteFrame>} />
      <Route path="push" element={<SuiteFrame><AdminPushNotifications /></SuiteFrame>} />
      <Route path="*" element={<Navigate to="/admin/comms" replace />} />
    </Routes>
  );
}
