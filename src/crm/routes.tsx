/**
 * Routes de la Console Yuno CRM. Appelé en ligne dans <Routes> (App.tsx) :
 * `{crmRoutes()}`. Une page nouvelle se déclare ici ET dans `shell/nav.ts`.
 */
import { Navigate, Route } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const CrmGate = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmGate })));
const CrmLayout = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmLayout })));
const HomePage = lazyWithRetry(() => import('./pages/home/HomePage'));
const ClientsPage = lazyWithRetry(() => import('./pages/clients/ClientsPage'));
const SegmentsPage = lazyWithRetry(() => import('./pages/segments/SegmentsPage'));
const ImportsPage = lazyWithRetry(() => import('./pages/imports/ImportsPage'));
const NightsPage = lazyWithRetry(() => import('./pages/nights/NightsPage'));
const ConnectorsPage = lazyWithRetry(() => import('./pages/connectors/ConnectorsPage'));
const EmailsOverviewPage = lazyWithRetry(() => import('./pages/emails/EmailsOverviewPage'));
const EmailCampaignsPage = lazyWithRetry(() => import('./pages/emails/EmailCampaignsPage'));
const EmailTemplatesPage = lazyWithRetry(() => import('./pages/emails/EmailTemplatesPage'));
const EmailStudioPage = lazyWithRetry(() => import('./pages/emails/studio/EmailStudioPage'));
const EmailSendPage = lazyWithRetry(() => import('./pages/emails/send/EmailSendPage'));
const EmailResultPage = lazyWithRetry(() => import('./pages/emails/results/EmailResultPage'));
const EmailAnalysisPage = lazyWithRetry(() => import('./pages/emails/analysis/EmailAnalysisPage'));
const EmailSettingsPage = lazyWithRetry(() => import('./pages/emails/settings/EmailSettingsPage'));
const CrmBareLayout = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmBareLayout })));
const NightRedirect = lazyWithRetry(() => import('./pages/nights/NightsPage').then((m) => ({ default: m.NightRedirect })));
const InstagramSoonPage = lazyWithRetry(() => import('./pages/soon/InstagramSoonPage'));
const SignupPagesSoonPage = lazyWithRetry(() => import('./pages/soon/SignupPagesSoonPage'));
const AccountPage = lazyWithRetry(() => import('./pages/account/AccountPage'));
const YunitsPage = lazyWithRetry(() => import('./pages/yunits/YunitsPage'));
const NotificationsPage = lazyWithRetry(() => import('./pages/notifications/NotificationsPage'));
const SettingsPage = lazyWithRetry(() => import('./pages/settings/SettingsPage'));
const AnalyticsPage = lazyWithRetry(() => import('./pages/analytics/AnalyticsPage'));
const JourneyPage = lazyWithRetry(() => import('./pages/journey/JourneyPage'));

export function crmRoutes() {
  return (
    <>
      {/* Éditeurs plein écran : même garde et même portée, sans menu. */}
      <Route path="/crm/emails/studio/:id" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={<EmailStudioPage />} />
      </Route>
      <Route path="/crm/emails/send/:id" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={<EmailSendPage />} />
      </Route>
      <Route path="/crm" element={<CrmGate><CrmLayout /></CrmGate>}>
        <Route index element={<HomePage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="segments" element={<SegmentsPage />} />
        <Route path="imports" element={<ImportsPage />} />
        <Route path="nights" element={<NightsPage />} />
        <Route path="nights/past" element={<NightsPage />} />
        <Route path="nights/:id" element={<NightRedirect />} />
        <Route path="connectors" element={<ConnectorsPage />} />
        <Route path="emails" element={<EmailsOverviewPage />} />
        <Route path="emails/campaigns" element={<EmailCampaignsPage />} />
        <Route path="emails/templates" element={<EmailTemplatesPage />} />
        <Route path="emails/results/:id" element={<EmailResultPage />} />
        <Route path="emails/analysis" element={<EmailAnalysisPage />} />
        <Route path="emails/settings" element={<EmailSettingsPage />} />
        <Route path="instagram" element={<InstagramSoonPage />} />
        <Route path="signup-pages" element={<SignupPagesSoonPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/:section" element={<AccountPage />} />
        <Route path="yunits" element={<YunitsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="analytics" element={<Navigate to="/crm/analytics/sales" replace />} />
        <Route path="analytics/:tab" element={<AnalyticsPage />} />
        <Route path="journey" element={<JourneyPage />} />
        <Route path="*" element={<Navigate to="/crm" replace />} />
      </Route>
    </>
  );
}
