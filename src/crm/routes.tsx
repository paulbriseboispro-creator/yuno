/**
 * Routes de la Console Yuno CRM. Appelé en ligne dans <Routes> (App.tsx) :
 * `{crmRoutes()}`. Une page nouvelle se déclare ici ET dans `shell/nav.ts`.
 */
import type { ReactElement } from 'react';
import { Navigate, Route } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CRM_MARKETING_LIVE } from './lib/marketing';

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
const EmailHealthPage = lazyWithRetry(() => import('./pages/emails/health/EmailHealthPage'));
const CrmPublicShell = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmPublicShell })));
const NotFoundScreen = lazyWithRetry(() => import('./errors/ErrorScreens').then((m) => ({ default: m.NotFoundScreen })));
const CrmBareLayout = lazyWithRetry(() => import('./shell/CrmLayout').then((m) => ({ default: m.CrmBareLayout })));
const NightRedirect = lazyWithRetry(() => import('./pages/nights/NightsPage').then((m) => ({ default: m.NightRedirect })));
const NightPlanPage = lazyWithRetry(() => import('./pages/nights/plan/NightPlanPage'));
const PlansPage = lazyWithRetry(() => import('./pages/plans/PlansPage'));
const PlanPage = lazyWithRetry(() => import('./pages/plans/PlanPage'));
const WeeklyReviewPage = lazyWithRetry(() => import('./pages/review/WeeklyReviewPage'));
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
const SmsAccessGate = lazyWithRetry(() => import('./pages/sms/SmsAccessGate').then((m) => ({ default: m.SmsAccessGate })));
const PricingPage = lazyWithRetry(() => import('./pages/pricing/PricingPage'));
const CrmPreviewGate = lazyWithRetry(() => import('./pages/preview/CrmPreviewGate'));

/** Pause du 2026-11-08 : un écran d'envoi renvoie à l'accueil (`lib/marketing.ts`). */
function mk(el: ReactElement) {
  return CRM_MARKETING_LIVE ? el : <Navigate to="/crm" replace />;
}

export function crmRoutes() {
  return (
    <>
      {/* Éditeurs plein écran : même garde et même portée, sans menu. */}
      <Route path="/crm/emails/studio/:id" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={mk(<EmailStudioPage />)} />
      </Route>
      <Route path="/crm/emails/send/:id" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={mk(<EmailSendPage />)} />
      </Route>
      {/* Scénarios : l'éditeur (flux vertical + inspecteur). */}
      <Route path="/crm/automations/scenarios/:id" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={mk(<ScenarioEditorPage />)} />
      </Route>
      {/* Plan de soirée (agents, lot A1) : un rapport plein écran, imprimable. */}
      <Route path="/crm/nights/:id/plan" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={mk(<NightPlanPage />)} />
      </Route>
      {/* SMS en bêta privée : un compte non ouvert est renvoyé sur la page de demande d'accès. */}
      <Route path="/crm/sms/compose/:id" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={mk(<SmsAccessGate redirect><SmsComposePage /></SmsAccessGate>)} />
      </Route>
      <Route path="/crm/sms/send/:id" element={<CrmGate><CrmBareLayout /></CrmGate>}>
        <Route index element={mk(<SmsAccessGate redirect><SmsSendPage /></SmsAccessGate>)} />
      </Route>
      {/* Tarifs : page PUBLIQUE (visiteurs comme abonnés), hors de la porte du compte. */}
      <Route path="/crm/tarifs" element={<PricingPage />} />
      {/* Entrée de la démo (Admin CRM › Démo) : mot de passe du lien, hors de la porte du compte. */}
      <Route path="/crm/preview" element={<CrmPreviewGate />} />
      <Route path="/crm" element={<CrmGate><CrmLayout /></CrmGate>}>
        <Route index element={<HomePage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="segments" element={<SegmentsPage />} />
        <Route path="imports" element={mk(<ImportsPage />)} />
        <Route path="nights" element={<NightsPage />} />
        <Route path="nights/past" element={<NightsPage />} />
        <Route path="nights/:id" element={<NightRedirect />} />
        <Route path="review" element={mk(<WeeklyReviewPage />)} />
        <Route path="plans" element={mk(<PlansPage />)} />
        <Route path="plans/:id" element={mk(<PlanPage />)} />
        <Route path="connectors" element={<ConnectorsPage />} />
        <Route path="emails" element={mk(<EmailsOverviewPage />)} />
        <Route path="emails/campaigns" element={mk(<EmailCampaignsPage />)} />
        <Route path="emails/templates" element={mk(<EmailTemplatesPage />)} />
        <Route path="emails/results/:id" element={mk(<EmailResultPage />)} />
        <Route path="emails/analysis" element={mk(<EmailAnalysisPage />)} />
        <Route path="emails/health" element={mk(<EmailHealthPage />)} />
        <Route path="emails/settings" element={mk(<EmailSettingsPage />)} />
        <Route path="instagram" element={mk(<InstagramPage />)} />
        <Route path="signup-pages" element={mk(<SignupPagesPage />)} />
        <Route path="signup-pages/new" element={mk(<SignupWizardPage />)} />
        <Route path="signup-pages/:id" element={mk(<SignupDetailPage />)} />
        <Route path="signup-pages/:id/edit" element={mk(<SignupWizardPage />)} />
        <Route path="signup-pages/:id/published" element={mk(<SignupDonePage />)} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/:section" element={<AccountPage />} />
        <Route path="yunits" element={mk(<YunitsPage />)} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="analytics" element={<Navigate to="/crm/analytics/sales" replace />} />
        <Route path="analytics/:tab" element={<AnalyticsPage />} />
        <Route path="journey" element={mk(<JourneyPage />)} />
        <Route path="automations" element={mk(<AutomationsPage />)} />
        {/* SMS en bêta privée : /crm/sms montre la demande d'accès tant que le compte n'est pas ouvert. */}
        <Route path="sms" element={mk(<SmsAccessGate><SmsOverviewPage /></SmsAccessGate>)} />
        <Route path="sms/campaigns" element={mk(<SmsAccessGate redirect><SmsCampaignsPage /></SmsAccessGate>)} />
        <Route path="sms/templates" element={mk(<SmsAccessGate redirect><SmsTemplatesPage /></SmsAccessGate>)} />
        <Route path="sms/results/:id" element={mk(<SmsAccessGate redirect><SmsResultPage /></SmsAccessGate>)} />
        <Route path="sms/analysis" element={mk(<SmsAccessGate redirect><SmsAnalysisPage /></SmsAccessGate>)} />
        <Route path="sms/settings" element={mk(<SmsAccessGate redirect><SmsSettingsPage /></SmsAccessGate>)} />
        <Route path="sms/*" element={<Navigate to="/crm/sms" replace />} />
      </Route>
      <Route path="/crm/*" element={<CrmPublicShell><NotFoundScreen /></CrmPublicShell>} />
    </>
  );
}
