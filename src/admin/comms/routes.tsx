/**
 * Rubrique « Communication » : que dit Yuno, et est-ce que ça arrive ?
 * (`/admin/comms/*`). Lot 0 : écrans existants remontés tels quels.
 * Chemins RELATIFS.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { SuiteFrame } from '../shell/frames';

const AdminMarketing = lazyWithRetry(() => import('@/pages/admin/AdminMarketing'));
const AdminMarketingEmailEditor = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingEmailEditor })));
const AdminMarketingEmailReport = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingEmailReport })));
const AdminMarketingTemplateEditor = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingTemplateEditor })));
const AdminMarketingAutomations = lazyWithRetry(() => import('@/pages/admin/AdminMarketing').then((m) => ({ default: m.AdminMarketingAutomations })));
const AdminMarketingSms = lazyWithRetry(() => import('@/pages/admin/AdminMarketingSms'));
const AdminPushNotifications = lazyWithRetry(() => import('@/pages/admin/AdminPushNotifications'));
const AdminNotificationAutomations = lazyWithRetry(() => import('@/pages/admin/AdminNotificationAutomations'));
const AdminLinks = lazyWithRetry(() => import('@/pages/admin/AdminLinks'));

export default function CommsRoutes() {
  return (
    <Routes>
      <Route index element={<SuiteFrame><AdminMarketing /></SuiteFrame>} />
      <Route path="email/new" element={<SuiteFrame><AdminMarketingEmailEditor /></SuiteFrame>} />
      <Route path="email/:id/edit" element={<SuiteFrame><AdminMarketingEmailEditor /></SuiteFrame>} />
      <Route path="email/:id/report" element={<SuiteFrame><AdminMarketingEmailReport /></SuiteFrame>} />
      <Route path="email/templates/:id" element={<SuiteFrame><AdminMarketingTemplateEditor /></SuiteFrame>} />
      <Route path="automations" element={<SuiteFrame><AdminMarketingAutomations /></SuiteFrame>} />
      <Route path="sms" element={<SuiteFrame><AdminMarketingSms /></SuiteFrame>} />
      <Route path="sms/:id" element={<SuiteFrame><AdminMarketingSms /></SuiteFrame>} />
      <Route path="push" element={<SuiteFrame><AdminPushNotifications /></SuiteFrame>} />
      <Route path="engine" element={<SuiteFrame><AdminNotificationAutomations /></SuiteFrame>} />
      <Route path="links" element={<SuiteFrame><AdminLinks /></SuiteFrame>} />
      <Route path="*" element={<Navigate to="/admin/comms" replace />} />
    </Routes>
  );
}
