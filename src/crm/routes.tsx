/**
 * Routes de la Console Yuno CRM. Appelé en ligne dans <Routes> (App.tsx) :
 * `{crmRoutes()}`. Une page nouvelle se déclare ici ET dans `shell/nav.ts`.
 */
import { Navigate, Route } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CRM_SMS_DISPLAY_LIVE } from './lib/sms';

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
const CrmPublicShell = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmPublicShell })));
const NotFoundScreen = lazyWithRetry(() => import('./errors/ErrorScreens').then((m) => ({ default: m.NotFoundScreen })));
const CrmBareLayout = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmBareLayout })));
const NightRedirect = lazyWithRetry(() => import('./pages/nights/NightsPage').then((m) => ({ default: m.NightRedirect })));
const InstagramPage = lazyWithRetry(() => import('./pages/instagram/InstagramPage'));
const SignupPagesPage = lazyWithRetry(() => import('./pages/signup/SignupPagesPage'));
const SignupWizardPage = lazyWithRetry(() => import('./pages/signup/SignupWizardPage'));
const SignupDetailPage = lazyWithRetry(() => import('./pages/signup/SignupDetailPage'));
const SignupDonePage = lazyWithRetry(() => import('./pages/signup/SignupDonePage'));
const AccountPage = lazyWithRetry(() => import('./pages/account/AccountPage'));
const YunitsPage = lazyWithRetry(() => import('./pages/yunits/YunitsPage'));
const NotificationsPage = lazyWithRetry(() => import('./pages/notifications/NotificationsPage'));
const SettingsPage = lazyWithRetry(() => import('./pages/settings/SettingsPage'));
const AnalyticsPage = lazyWithRetry(() => import('./pages/analytics/AnalyticsPage'));
const JourneyPage = lazyWithRetry(() => import('./pages/journey/JourneyPage'));
const AutomationsPage = lazyWithRetry(() => import('./pages/automations/AutomationsPage'));
const ScenarioEditorPage = lazyWithRetry(() => import('./pages/automations/scenarios/ScenarioEditorPage'));
const SmsOverviewPage = lazyWithRetry(() => import('./pages/sms/SmsOverviewPage'));
const SmsCampaignsPage = lazyWithRetry(() => import('./pages/sms/SmsCampaignsPage'));
const SmsTemplatesPage = lazyWithRetry(() => import('./pages/sms/SmsTemplatesPage'));
const SmsComposePage = lazyWithRetry(() => import('./pages/sms/compose/SmsComposePage'));
const SmsSendPage = lazyWithRetry(() => import('./pages/sms/send/SmsSendPage'));
const SmsResultPage = lazyWithRetry(() => import('./pages/sms/results/SmsResultPage'));
const SmsAnalysisPage = lazyWithRetry(() => import('./pages/sms/analysis/SmsAnalysisPage'));
const SmsSettingsPage = lazyWithRetry(() => import('./pages/sms/settings/SmsSettingsPage'));
const SmsSoonPage = lazyWithRetry(() => import('./pages/soon/SmsSoonPage'));
const PricingPage = lazyWithRetry(() => import('./pages/pricing/PricingPage'));

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
      {/* Scénarios : l'éditeur (flux vertical + inspecteur). */}
      <Route path="/crm/automations/scenarios/:id" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={<ScenarioEditorPage />} />
      </Route>
      {/* SMS « Bientôt » (CRM_SMS_DISPLAY_LIVE faux) : les éditeurs renvoient sur la page Bientôt. */}
      <Route path="/crm/sms/compose/:id" element={CRM_SMS_DISPLAY_LIVE ? <CrmGate><CrmBareLayout /></CrmGate> : <Navigate to="/crm/sms" replace />}>
        <Route index element={<SmsComposePage />} />
      </Route>
      <Route path="/crm/sms/send/:id" element={CRM_SMS_DISPLAY_LIVE ? <CrmGate><CrmBareLayout /></CrmGate> : <Navigate to="/crm/sms" replace />}>
        <Route index element={<SmsSendPage />} />
      </Route>
      {/* Tarifs : page PUBLIQUE (visiteurs comme abonnés), hors de la porte du compte. */}
      <Route path="/crm/tarifs" element={<PricingPage />} />
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
        <Route path="instagram" element={<InstagramPage />} />
        <Route path="signup-pages" element={<SignupPagesPage />} />
        <Route path="signup-pages/new" element={<SignupWizardPage />} />
        <Route path="signup-pages/:id" element={<SignupDetailPage />} />
        <Route path="signup-pages/:id/edit" element={<SignupWizardPage />} />
        <Route path="signup-pages/:id/published" element={<SignupDonePage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/:section" element={<AccountPage />} />
        <Route path="yunits" element={<YunitsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="analytics" element={<Navigate to="/crm/analytics/sales" replace />} />
        <Route path="analytics/:tab" element={<AnalyticsPage />} />
        <Route path="journey" element={<JourneyPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        {CRM_SMS_DISPLAY_LIVE ? (
          <>
            <Route path="sms" element={<SmsOverviewPage />} />
            <Route path="sms/campaigns" element={<SmsCampaignsPage />} />
            <Route path="sms/templates" element={<SmsTemplatesPage />} />
            <Route path="sms/results/:id" element={<SmsResultPage />} />
            <Route path="sms/analysis" element={<SmsAnalysisPage />} />
            <Route path="sms/settings" element={<SmsSettingsPage />} />
          </>
        ) : (
          <>
            <Route path="sms" element={<SmsSoonPage />} />
            <Route path="sms/*" element={<Navigate to="/crm/sms" replace />} />
          </>
        )}
      </Route>
      <Route path="/crm/*" element={<CrmPublicShell><NotFoundScreen /></CrmPublicShell>} />
    </>
  );
}
