import { Suspense, useEffect, useState } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LanguageProvider } from "./contexts/LanguageContext";
import { FavoritesProvider } from "./contexts/FavoritesContext";
import { VenueNavProvider } from "./contexts/VenueNavContext";
import { OnboardingGate } from "./components/OnboardingGate";
import { DashboardModeProvider } from "./contexts/DashboardModeContext";
const PlanGuard = lazyWithRetry(() => import("./components/PlanGuard").then(m => ({ default: m.PlanGuard })));
const RequireRole = lazyWithRetry(() => import("./components/RequireRole").then(m => ({ default: m.RequireRole })));
const OwnerRoute = lazyWithRetry(() => import("./components/OwnerRoute").then(m => ({ default: m.OwnerRoute })));
const BarmanRoute = lazyWithRetry(() => import("./components/BarmanRoute").then(m => ({ default: m.BarmanRoute })));
const BouncerRoute = lazyWithRetry(() => import("./components/BouncerRoute").then(m => ({ default: m.BouncerRoute })));
const DJRoute = lazyWithRetry(() => import("./components/DJRoute").then(m => ({ default: m.DJRoute })));
// Legacy OrganizerRoute removed — see OrgAppRoute.
const OrgAppRoute = lazyWithRetry(() => import("./components/OrgAppRoute").then(m => ({ default: m.OrgAppRoute })));
const PromoterRoute = lazyWithRetry(() => import("./components/PromoterRoute").then(m => ({ default: m.PromoterRoute })));
const AgencyRoute = lazyWithRetry(() => import("./components/AgencyRoute").then(m => ({ default: m.AgencyRoute })));
const AgencyAppLayout = lazyWithRetry(() => import("./pages/agency-app/AgencyAppLayout"));
const AgencyStart = lazyWithRetry(() => import("./pages/agency-app/AgencyStart"));
const AgencyDashboard = lazyWithRetry(() => import("./pages/agency-app/AgencyDashboard"));
const AgencyRoster = lazyWithRetry(() => import("./pages/agency-app/AgencyRoster"));
const AgencyClubs = lazyWithRetry(() => import("./pages/agency-app/AgencyClubs"));
const AgencyFinance = lazyWithRetry(() => import("./pages/agency-app/AgencyFinance"));
const AgencyGroups = lazyWithRetry(() => import("./pages/agency-app/AgencyGroups"));
const AgencyEvents = lazyWithRetry(() => import("./pages/agency-app/AgencyEvents"));
const AgencyAnalytics = lazyWithRetry(() => import("./pages/agency-app/AgencyAnalytics"));
const AgencyPromoterDetail = lazyWithRetry(() => import("./pages/agency-app/AgencyPromoterDetail"));
const AgencyStats = lazyWithRetry(() => import("./pages/agency-app/AgencyStats"));
const AgencyRules = lazyWithRetry(() => import("./pages/agency-app/AgencyRules"));
const OwnerAgencies = lazyWithRetry(() => import("./pages/OwnerAgencies"));
const AffiliateRoute = lazyWithRetry(() => import("./components/AffiliateRoute").then(m => ({ default: m.AffiliateRoute })));
const ManagerRoute = lazyWithRetry(() => import("./components/ManagerRoute").then(m => ({ default: m.ManagerRoute })));
const VipHostRoute = lazyWithRetry(() => import("./components/VipHostRoute").then(m => ({ default: m.VipHostRoute })));
const CloakroomRoute = lazyWithRetry(() => import("./components/CloakroomRoute").then(m => ({ default: m.CloakroomRoute })));
const OwnerPreviewLayout = lazyWithRetry(() => import("./components/OwnerPreviewLayout").then(m => ({ default: m.OwnerPreviewLayout })));
const OwnerLayout = lazyWithRetry(() => import("./components/OwnerLayout").then(m => ({ default: m.OwnerLayout })));
import { supabase } from "@/integrations/supabase/client";
import { uniqueChannel } from "@/lib/realtime";
import { useStore } from "@/store/useStore";
import { OfflineBanner } from "@/components/OfflineBanner";
import { NativeBridge } from "@/components/NativeBridge";
import { NativeStatusBarScrim } from "@/components/NativeStatusBarScrim";
import { SplashScreen } from "@/components/SplashScreen";
import { NativeProGate } from "@/components/NativeProGate";
import { ProAppGate } from "@/components/ProAppGate";
import { isProApp } from "@/lib/native";
import { PushClickTracker } from "@/components/PushClickTracker";
import { CelebrationHost } from "@/components/celebration/CelebrationHost";
import { DemoSwitcher } from "@/components/demo/DemoSwitcher";
import { PreviewModeProvider } from "@/contexts/PreviewModeContext";
import { LiveModeProvider } from "@/contexts/LiveModeContext";
import { PreviewModeBanner } from "@/components/PreviewModeBanner";
import "@/lib/previewGuard"; // installe l'intercepteur lecture seule (effet de bord)

// Lazy load all pages including VenuePage
const VenuePage = lazyWithRetry(() => import("./pages/VenuePage"));
const PreviewGate = lazyWithRetry(() => import("./pages/PreviewGate"));

// Lazy load all other routes to reduce initial bundle size
const Cart = lazyWithRetry(() => import("./pages/Cart"));
const MyOrders = lazyWithRetry(() => import("./pages/MyOrders"));
const Profile = lazyWithRetry(() => import("./pages/Profile"));
const OrderQR = lazyWithRetry(() => import("./pages/OrderQR"));
const Barman = lazyWithRetry(() => import("./pages/Barman"));
const ClickCollect = lazyWithRetry(() => import("./pages/ClickCollect"));
const Bouncer = lazyWithRetry(() => import("./pages/Bouncer"));
const OwnerDashboard = lazyWithRetry(() => import("./pages/OwnerDashboard"));
const OwnerOrders = lazyWithRetry(() => import("./pages/OwnerOrders"));
const OwnerMenu = lazyWithRetry(() => import("./pages/OwnerMenu"));
const OwnerStaff = lazyWithRetry(() => import("./pages/OwnerStaff"));
const OwnerEvents = lazyWithRetry(() => import("./pages/OwnerEvents"));
const OwnerTicketing = lazyWithRetry(() => import("./pages/OwnerTicketing"));
const OwnerTables = lazyWithRetry(() => import("./pages/OwnerTables"));
const OwnerVenue = lazyWithRetry(() => import("./pages/OwnerVenue"));
const OwnerAnalytics = lazyWithRetry(() => import("./pages/OwnerAnalytics"));
const OwnerPromoters = lazyWithRetry(() => import("./pages/OwnerPromoters"));
const OwnerPromoterDetail = lazyWithRetry(() => import("./pages/OwnerPromoterDetail"));
const OwnerPromoterAnnouncements = lazyWithRetry(() => import("./pages/OwnerPromoterAnnouncements"));
const OwnerPromoterFinance = lazyWithRetry(() => import("./pages/OwnerPromoterFinance"));
const OwnerPromoterTemplates = lazyWithRetry(() => import("./pages/OwnerPromoterTemplates"));
const OwnerPromoterTeams = lazyWithRetry(() => import("./pages/OwnerPromoterTeams"));
const OwnerPromoterEventView = lazyWithRetry(() => import("./pages/OwnerPromoterEventView"));
const OwnerDJs = lazyWithRetry(() => import("./pages/OwnerDJs"));
const OwnerDJDetail = lazyWithRetry(() => import("./pages/OwnerDJDetail"));
const OwnerManagers = lazyWithRetry(() => import("./pages/OwnerManagers"));
const OwnerCustomers = lazyWithRetry(() => import("./pages/OwnerCustomers"));
const OwnerInvoices = lazyWithRetry(() => import("./pages/OwnerInvoices"));
const OwnerAccounting = lazyWithRetry(() => import("./pages/OwnerAccounting"));
const OwnerLoyalty = lazyWithRetry(() => import("./pages/OwnerLoyalty"));
// Email Campaign Editor - Hidden for now, feature in development
// // const OwnerEmailCampaign = lazyWithRetry(() => import("./pages/OwnerEmailCampaign"));
const OwnerHypeAnalysis = lazyWithRetry(() => import("./pages/OwnerHypeAnalysis"));
const OwnerVipService = lazyWithRetry(() => import("./pages/OwnerVipService"));
const OwnerWaitlist = lazyWithRetry(() => import("./pages/OwnerWaitlist"));
const OwnerUpsell = lazyWithRetry(() => import("./pages/OwnerUpsell"));
const OwnerScarcity = lazyWithRetry(() => import("./pages/OwnerScarcity"));
const OwnerLiveNight = lazyWithRetry(() => import("./pages/OwnerLiveNight"));
const VenueLeaderboard = lazyWithRetry(() => import("./pages/VenueLeaderboard"));
const LoyaltyHub = lazyWithRetry(() => import("./pages/LoyaltyHub"));
const OwnerBilling = lazyWithRetry(() => import("./pages/OwnerBilling"));
const OwnerSmsCredits = lazyWithRetry(() => import("./pages/OwnerSmsCredits"));
const OwnerSmsCampaigns = lazyWithRetry(() => import("./pages/OwnerSmsCampaigns"));
const OwnerPush = lazyWithRetry(() => import("./pages/OwnerPush"));
const OwnerOnboarding = lazyWithRetry(() => import("./pages/OwnerOnboarding"));
const HelpCenter = lazyWithRetry(() => import("./pages/HelpCenter"));
const OwnerHelpCenter = lazyWithRetry(() => import("./pages/OwnerHelpCenter"));
const OwnerSupportRequest = lazyWithRetry(() => import("./pages/OwnerSupportRequest"));
const OwnerGuestList = lazyWithRetry(() => import("./pages/OwnerGuestList"));
const OwnerRefunds = lazyWithRetry(() => import("./pages/OwnerRefunds"));
const OwnerNotifications = lazyWithRetry(() => import("./pages/OwnerNotifications"));
const OwnerCampaigns = lazyWithRetry(() => import("./pages/OwnerCampaigns").then(m => ({ default: m.default })));
const OwnerCampaignEditor = lazyWithRetry(() => import("./pages/OwnerCampaigns").then(m => ({ default: m.OwnerCampaignEditor })));
const OwnerCampaignReport = lazyWithRetry(() => import("./pages/OwnerCampaigns").then(m => ({ default: m.OwnerCampaignReport })));
const Unsubscribe = lazyWithRetry(() => import("./pages/Unsubscribe"));
// Legacy organizer pages removed — replaced by OrgApp* + OrganizerPublicProfile.
const GuestListSignup = lazyWithRetry(() => import("./pages/GuestListSignup"));
const GuestListCheckout = lazyWithRetry(() => import("./pages/GuestListCheckout"));
const PromoterDashboard = lazyWithRetry(() => import("./pages/PromoterDashboard"));
const PromoterHub = lazyWithRetry(() => import("./pages/PromoterHub"));
const PromoterPublicRedirect = lazyWithRetry(() => import("./pages/PromoterPublicRedirect"));
const TrackedLinkRedirect = lazyWithRetry(() => import("./pages/TrackedLinkRedirect"));
const PromoterEventAnalysis = lazyWithRetry(() => import("./pages/PromoterEventAnalysis"));
const AcceptPlatformInvitation = lazyWithRetry(() => import("./pages/AcceptPlatformInvitation"));
const ClubInvitation = lazyWithRetry(() => import("./pages/ClubInvitation"));
// New standalone Organizer / BDE app (distinct from the legacy /organizer co-organization flow)
const OrgAppLayout = lazyWithRetry(() => import("./pages/organizer-app/OrgAppLayout"));
const OrgAppDashboard = lazyWithRetry(() => import("./pages/organizer-app/OrgAppDashboard"));
const OrgAppEventDetail = lazyWithRetry(() => import("./pages/organizer-app/OrgAppEventDetail"));
const OrgAppEventLive = lazyWithRetry(() => import("./pages/organizer-app/OrgAppEventLive"));
const OrgAppCheckin = lazyWithRetry(() => import("./pages/organizer-app/OrgAppCheckin"));
const OrgAppAnalytics = lazyWithRetry(() => import("./pages/organizer-app/OrgAppAnalytics"));
const OrgAppOrganization = lazyWithRetry(() => import("./pages/organizer-app/OrgAppOrganization"));
const OrgAppPayments = lazyWithRetry(() => import("./pages/organizer-app/OrgAppPayments"));
const OrgAppOnboarding = lazyWithRetry(() => import("./pages/organizer-app/OrgAppOnboarding"));
const OrgAppCollabHub = lazyWithRetry(() => import("./pages/organizer-app/OrgAppCollabHub"));
const OrgAppProfile = lazyWithRetry(() => import("./pages/organizer-app/OrgAppProfile"));
const OrgAppTeam = lazyWithRetry(() => import("./pages/organizer-app/OrgAppTeam"));
const OrgAppCustomers = lazyWithRetry(() => import("./pages/organizer-app/OrgAppCustomers"));
const OrgAppTables = lazyWithRetry(() => import("./pages/organizer-app/OrgAppTables"));
const OrgAppCampaigns = lazyWithRetry(() => import("./pages/organizer-app/OrgAppCampaigns").then(m => ({ default: m.default })));
const OrgAppCampaignEditor = lazyWithRetry(() => import("./pages/organizer-app/OrgAppCampaigns").then(m => ({ default: m.OrgAppCampaignEditor })));
const OrgAppCampaignReport = lazyWithRetry(() => import("./pages/organizer-app/OrgAppCampaigns").then(m => ({ default: m.OrgAppCampaignReport })));
const OrganizerHelpCenter = lazyWithRetry(() => import("./pages/OrganizerHelpCenter"));
const OrganizerPublicProfile = lazyWithRetry(() => import("./pages/OrganizerPublicProfile"));
const OwnerPartnerships = lazyWithRetry(() => import("./pages/OwnerPartnerships"));
const OwnerCollaborations = lazyWithRetry(() => import("./pages/OwnerCollaborations"));
const OwnerCollabEventDashboard = lazyWithRetry(() => import("./pages/OwnerCollabEventDashboard"));
const AcceptOrganizerInvitation = lazyWithRetry(() => import("./pages/AcceptOrganizerInvitation"));
const DJLayout = lazyWithRetry(() => import("./pages/dj-app/DJLayout"));
const DJOverview = lazyWithRetry(() => import("./pages/dj-app/DJOverview"));
const DJPlanning = lazyWithRetry(() => import("./pages/dj-app/DJPlanning"));
const DJAudience = lazyWithRetry(() => import("./pages/dj-app/DJAudience"));
const DJPayments = lazyWithRetry(() => import("./pages/dj-app/DJPayments"));
const DJProfile = lazyWithRetry(() => import("./pages/dj-app/DJProfile"));
const DJAnalytics = lazyWithRetry(() => import("./pages/dj-app/DJAnalytics"));
const DJNotifications = lazyWithRetry(() => import("./pages/dj-app/DJNotifications"));
const DJHelp = lazyWithRetry(() => import("./pages/dj-app/DJHelp"));
const DJTeam = lazyWithRetry(() => import("./pages/dj-app/DJTeam"));
const DJOnboarding = lazyWithRetry(() => import("./pages/dj-app/DJOnboarding"));
const DJTeamAccept = lazyWithRetry(() => import("./pages/dj-app/DJTeamAccept"));
const DJBookings = lazyWithRetry(() => import("./pages/dj-app/DJBookings"));
const BookDJPage = lazyWithRetry(() => import("./pages/BookDJPage"));
const DJPublicPage = lazyWithRetry(() => import("./pages/DJPublicPage"));
const DJPastEventsPage = lazyWithRetry(() => import("./pages/DJPastEventsPage"));
const DJEpkPage = lazyWithRetry(() => import("./pages/DJEpkPage"));
const ManagerDashboardPage = lazyWithRetry(() => import("./pages/ManagerDashboard"));
const VipHostDashboard = lazyWithRetry(() => import("./pages/VipHostDashboard"));
const CloakroomDashboard = lazyWithRetry(() => import("./pages/CloakroomDashboard"));
const VipMenu = lazyWithRetry(() => import("./pages/VipMenu"));
const MFASetup = lazyWithRetry(() => import("./pages/MFASetup"));
const MFADisableConfirm = lazyWithRetry(() => import("./pages/MFADisableConfirm"));
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const AuthHandoff = lazyWithRetry(() => import("./pages/AuthHandoff"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const EventDetails = lazyWithRetry(() => import("./pages/EventDetails"));
const TicketSelectionPage = lazyWithRetry(() => import("./pages/TicketSelection"));
const EventWaitlistPage = lazyWithRetry(() => import("./pages/EventWaitlistPage"));
const TicketCheckout = lazyWithRetry(() => import("./pages/TicketCheckout"));
const TableCheckout = lazyWithRetry(() => import("./pages/TableCheckout"));
const CategoryDrinks = lazyWithRetry(() => import("./pages/CategoryDrinks"));
const Favorites = lazyWithRetry(() => import("./pages/Favorites"));
const VerifyPayment = lazyWithRetry(() => import("./pages/VerifyPayment"));
const VerifyTicketPayment = lazyWithRetry(() => import("./pages/VerifyTicketPayment"));
const VerifyTablePayment = lazyWithRetry(() => import("./pages/VerifyTablePayment"));
const OrderConfirmation = lazyWithRetry(() => import("./pages/OrderConfirmation"));
const ClaimOrder = lazyWithRetry(() => import("./pages/ClaimOrder"));
const GuestFinalizeAccount = lazyWithRetry(() => import("./pages/GuestFinalizeAccount"));
const GuestDrinkCheckout = lazyWithRetry(() => import("./pages/GuestDrinkCheckout"));
const AcceptInvitation = lazyWithRetry(() => import("./pages/AcceptInvitation"));
const AcceptStaffInvitation = lazyWithRetry(() => import("./pages/AcceptStaffInvitation"));
const JoinViaLink = lazyWithRetry(() => import("./pages/JoinViaLink"));

const Welcome = lazyWithRetry(() => import("./pages/Welcome"));
const Explore = lazyWithRetry(() => import("./pages/Explore"));
const AllEventsPage = lazyWithRetry(() => import("./pages/AllEventsPage"));
const AllClubsPage = lazyWithRetry(() => import("./pages/AllClubsPage"));
const AllDJsPage = lazyWithRetry(() => import("./pages/AllDJsPage"));
const EventTicketsLanding = lazyWithRetry(() => import("./pages/EventTicketsLanding"));
const VipTablesLanding = lazyWithRetry(() => import("./pages/VipTablesLanding"));
const OrderDrinksLanding = lazyWithRetry(() => import("./pages/OrderDrinksLanding"));
const ClubMap = lazyWithRetry(() => import("./pages/ClubMap"));
const LiveMode = lazyWithRetry(() => import("./pages/LiveMode"));
const ProHome = lazyWithRetry(() => import("./pages/pro/ProHome"));
const Maintenance = lazyWithRetry(() => import("./pages/Maintenance"));
const Settings = lazyWithRetry(() => import("./pages/Settings"));
const LegalPage = lazyWithRetry(() => import("./pages/LegalPage"));
const YunoAssistantPage = lazyWithRetry(() => import("./pages/YunoAssistantPage"));

// Admin pages
const AdminLayout = lazyWithRetry(() => import("./pages/admin/AdminLayout"));
const AdminDashboard = lazyWithRetry(() => import("./pages/admin/AdminDashboard"));
const AdminVenues = lazyWithRetry(() => import("./pages/admin/AdminVenues"));
const AdminAnalytics = lazyWithRetry(() => import("./pages/admin/AdminAnalytics"));
const AdminSegmentation = lazyWithRetry(() => import("./pages/admin/AdminSegmentation"));
const AdminAccounting = lazyWithRetry(() => import("./pages/admin/AdminAccounting"));
const AdminFeedback = lazyWithRetry(() => import("./pages/admin/AdminFeedback"));
const AdminDrinkCatalog = lazyWithRetry(() => import("./pages/admin/AdminDrinkCatalog"));
const AdminEmailTemplates = lazyWithRetry(() => import("./pages/admin/AdminEmailTemplates"));
const AdminWaitlist = lazyWithRetry(() => import("./pages/admin/AdminWaitlist"));
const SetupPinPage = lazyWithRetry(() => import("./pages/SetupPinPage"));
const ResetPinPage = lazyWithRetry(() => import("./pages/ResetPinPage"));

const AdminPushNotifications = lazyWithRetry(() => import("./pages/admin/AdminPushNotifications"));
const AdminDirectory = lazyWithRetry(() => import("./pages/admin/AdminDirectory"));
const AdminUserDetail = lazyWithRetry(() => import("./pages/admin/AdminUserDetail"));
const AdminVenueDetail = lazyWithRetry(() => import("./pages/admin/AdminVenueDetail"));
const AdminOrders = lazyWithRetry(() => import("./pages/admin/AdminOrders"));
const AdminSubscriptions = lazyWithRetry(() => import("./pages/admin/AdminSubscriptions"));
const AdminPlatformInvitations = lazyWithRetry(() => import("./pages/admin/AdminPlatformInvitations"));
const AdminAffiliates = lazyWithRetry(() => import("./pages/admin/AdminAffiliates"));
const AdminEvents = lazyWithRetry(() => import("./pages/admin/AdminEvents"));
const AdminAuditLog = lazyWithRetry(() => import("./pages/admin/AdminAuditLog"));
const AdminDemoAccess = lazyWithRetry(() => import("./pages/admin/AdminDemoAccess"));
const AccountSuspended = lazyWithRetry(() => import("./pages/AccountSuspended"));

// Affiliate app pages
const AffiliateLayout = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateLayout"));
const AffiliateDashboard = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateDashboard"));
const AffiliateVenues = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateVenues"));
const AffiliateVenueForm = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateVenueForm"));
const AffiliateEvents = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateEvents"));
const AffiliateEventForm = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateEventForm"));
const AffiliateRecurring = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateRecurring"));
const AffiliateRecurringForm = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateRecurringForm"));
const AffiliateAnalytics = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateAnalytics"));
const AffiliateSettings = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateSettings"));
const AffiliateMembers = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateMembers"));
const AffiliatePromotersTracking = lazyWithRetry(() => import("./pages/affiliate-app/AffiliatePromotersTracking"));
const AffiliatePromoterDashboard = lazyWithRetry(() => import("./pages/affiliate-app/AffiliatePromoterDashboard"));
const AffiliatePromoterSettings = lazyWithRetry(() => import("./pages/affiliate-app/AffiliatePromoterSettings"));
const AffiliatePromoterLinktree = lazyWithRetry(() => import("./pages/affiliate-app/AffiliatePromoterLinktree"));
const AffiliateWeekCalendar = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateWeekCalendar"));
const AffiliateEventBrief = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateEventBrief"));
const AffiliateAssignments = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateAssignments"));
const AffiliateNotifications = lazyWithRetry(() => import("./pages/affiliate-app/AffiliateNotifications"));
const ManagerDashboard = lazyWithRetry(() => import("./pages/affiliate-app/ManagerDashboard"));
// Public affiliate pages
const AffiliateEventPage = lazyWithRetry(() => import("./pages/AffiliateEventPage"));
const AffiliateVenuePage = lazyWithRetry(() => import("./pages/AffiliateVenuePage"));
const AffiliateLinktree = lazyWithRetry(() => import("./pages/AffiliateLinktree"));
const PromoterLinktree = lazyWithRetry(() => import("./pages/PromoterLinktree"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

import { BrandedLoader } from './components/BrandedLoader';


// Branded loading fallback
const PageLoader = () => <BrandedLoader />;

// Component to check maintenance mode and bypass for super admins or password
function MaintenanceWrapper({ children }: { children: React.ReactNode }) {
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [hasBypass, setHasBypass] = useState(false);

  useEffect(() => {
    // Check for password bypass in sessionStorage
    const bypass = sessionStorage.getItem('maintenance_bypass');
    const bypassExpires = sessionStorage.getItem('maintenance_bypass_expires');
    
    if (bypass && bypassExpires) {
      const expiresAt = new Date(bypassExpires);
      if (expiresAt > new Date()) {
        setHasBypass(true);
      } else {
        sessionStorage.removeItem('maintenance_bypass');
        sessionStorage.removeItem('maintenance_bypass_expires');
      }
    }

    checkStatus();

    const channel = supabase
      .channel(uniqueChannel('app_settings_maintenance'))
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'app_settings',
        },
        () => {
          checkMaintenanceStatus();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const checkStatus = async () => {
    await Promise.all([
      checkMaintenanceStatus(),
      checkSuperAdminStatus(),
    ]);
  };

  const checkMaintenanceStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('maintenance_mode')
        .eq('id', 'global')
        .maybeSingle();

      if (!error && data) {
        setIsMaintenanceMode(data.maintenance_mode);
      }
    } catch (error) {
      console.error('Error checking maintenance status:', error);
    }
  };

  const checkSuperAdminStatus = async () => {
    try {
      const { data } = await supabase.rpc('is_super_admin');
      setIsSuperAdmin(data === true);
    } catch (error) {
      console.error('Error checking super admin status:', error);
    }
  };

  // Show children immediately - only redirect to maintenance if confirmed active
  if (isMaintenanceMode && !isSuperAdmin && !hasBypass) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Maintenance />
      </Suspense>
    );
  }

  return <>{children}</>;
}

// Global cart cleanup: remove items for past events on app startup
function CartCleanup() {
  const cart = useStore((s) => s.cart);
  const cleanExpiredItems = useStore((s) => s.cleanExpiredItems);

  useEffect(() => {
    const eventIds = [...new Set(cart.filter(i => i.eventId).map(i => i.eventId!))];
    if (eventIds.length === 0) return;
    supabase
      .from('events')
      .select('id, end_at')
      .in('id', eventIds)
      .then(({ data }) => {
        if (!data) return;
        const expired = data.filter(e => new Date(e.end_at) < new Date()).map(e => e.id);
        if (expired.length > 0) cleanExpiredItems(expired);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKeys={[location.pathname]}>
      {children}
    </ErrorBoundary>
  );
}

const App = () => (
  /* v7_startTransition : chaque navigation est enveloppée dans
     React.startTransition → quand la page cible est un chunk lazy pas encore
     chargé, React GARDE la page courante affichée au lieu de démonter vers le
     fallback Suspense (AppSkeleton). C'est ce qui donne le changement de page
     « natif » : jamais d'écran de chargement entre deux pages. */
  <BrowserRouter future={{ v7_startTransition: true }}>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <FavoritesProvider>
          <VenueNavProvider>
          <TooltipProvider>
            <PreviewModeProvider>
            {/* Écran de lancement animé (cold start natif / PWA) — se soulève
                pour révéler l'Explorer dès que l'app est prête. Auto-gaté :
                no-op sur le web classique et l'app Pro staff. */}
            <SplashScreen />
            {/* Surfaces B2C inactives dans l'app Yuno Pro (staff) */}
            {!isProApp() && <OnboardingGate />}
            <Toaster />
            <Sonner />
            {!isProApp() && <DemoSwitcher />}
            <PreviewModeBanner />
            <ScrollToTop />
            {!isProApp() && <CartCleanup />}
            <OfflineBanner />
            <NativeBridge />
            <NativeStatusBarScrim />
            <PushClickTracker />
            {/* Célébrations (confettis/overlay) des succès rares — écoute
                l'événement émis par src/lib/celebrate.ts. B2C uniquement. */}
            {!isProApp() && <CelebrationHost />}
            <LiveModeProvider>
            <MaintenanceWrapper>
              <RouteErrorBoundary>
              <Suspense fallback={<PageLoader />}>
              <ProAppGate>
              <NativeProGate>
              <Routes>
                {/* Yuno Pro (app staff) — accueil / sélecteur de rôle */}
                <Route path="/pro" element={<ProHome />} />
                {/* Explorer home page */}
                <Route path="/" element={<Explore />} />
                <Route path="/events" element={<AllEventsPage />} />
                <Route path="/clubs" element={<AllClubsPage />} />
                <Route path="/djs" element={<AllDJsPage />} />
                <Route path="/tickets" element={<EventTicketsLanding />} />
                <Route path="/vip-tables" element={<VipTablesLanding />} />
                <Route path="/order-drinks" element={<OrderDrinksLanding />} />
                <Route path="/map" element={<ClubMap />} />
                {/* Mode Live — takeover soirée après scan d'entrée (deep-link du push de bienvenue) */}
                <Route path="/live" element={<LiveMode />} />
                <Route path="/welcome" element={<Welcome />} />
                
                
                {/* Promoter public hub — direct render, no redirect */}
                <Route path="/promoteur/:promoCode" element={<PromoterHub />} />
                <Route path="/l/:code" element={<TrackedLinkRedirect />} />
                
                {/* Legacy /club/:slug/promo route — also renders PromoterHub */}
                <Route path="/club/:slug/promo" element={<PromoterHub />} />
                
                {/* Promoter event analysis */}
                <Route path="/promoter/event/:eventId" element={<PromoterEventAnalysis />} />
                
                {/* Dynamic venue page */}
                <Route path="/club/:slug" element={<VenuePage />} />
                <Route path="/club/:slug/event/:eventId" element={<EventDetails />} />
                <Route path="/club/:slug/event/:eventId/billets" element={<TicketSelectionPage />} />
                <Route path="/club/:slug/event/:eventId/waitlist" element={<EventWaitlistPage />} />
                <Route path="/club/:slug/event/:eventId/tickets/:roundId" element={<TicketCheckout />} />
                <Route path="/club/:slug/event/:eventId/table/:packId" element={<TableCheckout />} />
                <Route path="/club/:slug/event/:eventId/guestlist" element={<GuestListSignup />} />
                <Route path="/club/:slug/event/:eventId/guestlist-checkout" element={<GuestListCheckout />} />
                <Route path="/club/:slug/drinks/:category" element={<CategoryDrinks />} />
                <Route path="/club/:slug/leaderboard" element={<VenueLeaderboard />} />
                
                {/* DJ public page */}
                <Route path="/dj/:slug/epk" element={<DJEpkPage />} />
                <Route path="/dj/:slug/past" element={<DJPastEventsPage />} />
                <Route path="/dj/:slug" element={<DJPublicPage />} />
                
                {/* Legacy /org/:slug removed — public organizer profile lives at /o/:slug */}
                
                <Route path="/auth" element={<Auth />} />
                {/* Handoff de session app native → web (token magiclink en fragment) */}
                <Route path="/auth/handoff" element={<AuthHandoff />} />
                <Route path="/mfa-setup" element={<MFASetup />} />
                <Route path="/mfa-disable-confirm" element={<MFADisableConfirm />} />
                
                {/* Payment verification routes */}
                <Route path="/verify-payment" element={<VerifyPayment />} />
                <Route path="/verify-ticket-payment" element={<VerifyTicketPayment />} />
                <Route path="/verify-table-payment" element={<VerifyTablePayment />} />
                <Route path="/order-confirmation" element={<OrderConfirmation />} />
                <Route path="/claim" element={<ClaimOrder />} />
                <Route path="/guest/finalize" element={<GuestFinalizeAccount />} />
                
                {/* Invitation acceptance routes */}
                <Route path="/accept-dj-invitation" element={<AcceptInvitation />} />
                <Route path="/accept-promoter-invitation" element={<AcceptInvitation />} />
                <Route path="/accept-staff-invitation" element={<AcceptStaffInvitation />} />
                <Route path="/join" element={<JoinViaLink />} />
                {/* Aperçu démo verrouillé par mot de passe (lien de preview) */}
                <Route path="/preview" element={<PreviewGate />} />
                {/* Legacy /accept-organizer-invitation removed — org members now use /accept-platform-invitation */}
                <Route path="/accept-platform-invitation" element={<AcceptPlatformInvitation />} />
                <Route path="/club-invitation" element={<ClubInvitation />} />

                {/* Tunnel event propre /events/:host/:eventSlug/... (détail + billets/checkout/tables/guest list) */}
                <Route path="/events/:host/:eventSlug" element={<EventDetails />} />
                <Route path="/events/:host/:eventSlug/billets" element={<TicketSelectionPage />} />
                <Route path="/events/:host/:eventSlug/waitlist" element={<EventWaitlistPage />} />
                <Route path="/events/:host/:eventSlug/tickets/:roundId" element={<TicketCheckout />} />
                <Route path="/events/:host/:eventSlug/table/:packId" element={<TableCheckout />} />
                <Route path="/events/:host/:eventSlug/guestlist" element={<GuestListSignup />} />
                <Route path="/events/:host/:eventSlug/guestlist-checkout" element={<GuestListCheckout />} />
                {/* Anciennes URLs par UUID — conservées, redirigent vers l'URL propre au chargement */}
                <Route path="/event/:eventId" element={<EventDetails />} />

                {/* Standalone Organizer / BDE app */}
                <Route path="/organizer-app/onboarding" element={
                  <OrgAppRoute><OrgAppOnboarding /></OrgAppRoute>
                } />
                <Route path="/organizer-app" element={
                  <OrgAppRoute>
                    <DashboardModeProvider mode="organizer">
                      <OrgAppLayout />
                    </DashboardModeProvider>
                  </OrgAppRoute>
                }>
                  <Route index element={<OrgAppDashboard />} />
                  <Route path="events" element={<OwnerEvents />} />
                  <Route path="events/new" element={<Navigate to="/organizer-app/events" replace />} />
                  <Route path="events/:eventId" element={<OrgAppEventDetail />} />
                  <Route path="events/:eventId/live" element={<OrgAppEventLive />} />
                  <Route path="ticketing" element={<OwnerTicketing />} />
                  <Route path="tables" element={<OrgAppTables />} />
                  <Route path="orders" element={<OwnerOrders />} />
                  <Route path="djs" element={<OwnerDJs />} />
                  <Route path="djs/:djId" element={<OwnerDJDetail />} />
                  <Route path="book-dj" element={<BookDJPage />} />
                  <Route path="checkin" element={<OrgAppCheckin />} />
                  <Route path="analytics" element={<OrgAppAnalytics />} />
                  {/* Legacy split partner-clubs page → unified Collaborations hub (Partner clubs tab) */}
                  <Route path="partners" element={<Navigate to="/organizer-app/collaborations?tab=partners" replace />} />
                  <Route path="collaborations" element={<OrgAppCollabHub />} />
                  <Route path="profile" element={<OrgAppProfile />} />
                  <Route path="team" element={<OrgAppTeam />} />
                  <Route path="customers" element={<OrgAppCustomers />} />
                  <Route path="invoices" element={<OwnerInvoices />} />
                  <Route path="accounting" element={<OwnerAccounting />} />
                  <Route path="refunds" element={<OwnerRefunds />} />
                  <Route path="guest-list" element={<OwnerGuestList />} />
                  <Route path="promoters" element={<OwnerPromoters />} />
                  <Route path="promoters/templates" element={<OwnerPromoterTemplates />} />
                  <Route path="promoters/teams" element={<OwnerPromoterTeams />} />
                  <Route path="promoters/finance" element={<OwnerPromoterFinance />} />
                  <Route path="promoters/announcements" element={<OwnerPromoterAnnouncements />} />
                  <Route path="promoters/event/:eventId" element={<OwnerPromoterEventView />} />
                  <Route path="promoters/:id" element={<OwnerPromoterDetail />} />
                  <Route path="agencies" element={<OwnerAgencies />} />
                  <Route path="campaigns" element={<OrgAppCampaigns />} />
                  <Route path="campaigns/new" element={<OrgAppCampaignEditor />} />
                  <Route path="campaigns/:id/edit" element={<OrgAppCampaignEditor />} />
                  <Route path="campaigns/:id/report" element={<OrgAppCampaignReport />} />
                  <Route path="organization" element={<OrgAppOrganization />} />
                  <Route path="payments" element={<OrgAppPayments />} />
                  {/* Legacy Stripe onboarding return target (`?stripe=success|refresh`) → payments page */}
                  <Route path="settings" element={<OrgAppPayments />} />
                  <Route path="help" element={<OrganizerHelpCenter />} />
                  {/* Organizer inbox — same scope-aware page as /owner/notifications */}
                  <Route path="notifications" element={<OwnerNotifications />} />
                  {/* Help center "back" target — org dashboard is the index route */}
                  <Route path="dashboard" element={<Navigate to="/organizer-app" replace />} />
                </Route>

                {/* Standalone autonomous Agency app (promoter agency tenant) */}
                <Route path="/agency/start" element={<AgencyStart />} />
                <Route path="/agency-app" element={
                  <AgencyRoute>
                    <AgencyAppLayout />
                  </AgencyRoute>
                }>
                  <Route index element={<AgencyDashboard />} />
                  <Route path="promoters" element={<AgencyRoster />} />
                  <Route path="promoters/:userId" element={<AgencyPromoterDetail />} />
                  <Route path="clubs" element={<AgencyClubs />} />
                  <Route path="finance" element={<AgencyFinance />} />
                  <Route path="groups" element={<AgencyGroups />} />
                  <Route path="events" element={<AgencyEvents />} />
                  <Route path="analytics" element={<AgencyAnalytics />} />
                  <Route path="stats" element={<AgencyStats />} />
                  <Route path="rules" element={<AgencyRules />} />
                </Route>

                {/* Public organizer profile (slug-based) */}
                <Route path="/o/:slug" element={<OrganizerPublicProfile />} />

                <Route path="/owner/partnerships" element={<Navigate to="/owner/collaborations?tab=organizers" replace />} />
                <Route path="/accept-organizer-invitation" element={<AcceptOrganizerInvitation />} />

                {/* Public routes accessible to all authenticated users */}
                <Route path="/favorites" element={
                  <RequireRole allowedRoles={['client', 'barman', 'owner']}>
                    <Favorites />
                  </RequireRole>
                } />
                <Route path="/cart" element={<Cart />} />
                <Route path="/guest-checkout" element={<GuestDrinkCheckout />} />
                <Route path="/my-orders" element={<MyOrders />} />
                {/* Redirect /my-tickets to /my-orders?tab=tickets */}
                <Route path="/my-tickets" element={<Navigate to="/my-orders?tab=tickets" replace />} />
                <Route path="/profile" element={
                  <RequireRole allowedRoles={['client', 'barman', 'owner']}>
                    <Profile />
                  </RequireRole>
                } />
                <Route path="/settings" element={
                  <RequireRole allowedRoles={['client', 'barman', 'owner']}>
                    <Settings />
                  </RequireRole>
                } />
                <Route path="/loyalty" element={<LoyaltyHub />} />
                <Route path="/legal/:section" element={<LegalPage />} />
                <Route path="/assistant" element={<YunoAssistantPage />} />
                <Route path="/help" element={<HelpCenter />} />
                <Route path="/order/:orderId/qr" element={
                  <RequireRole allowedRoles={['client', 'barman', 'owner']}>
                    <OrderQR />
                  </RequireRole>
                } />
                
                {/* Barman routes */}
                <Route path="/barman" element={
                  <BarmanRoute>
                    <Barman />
                  </BarmanRoute>
                } />
                <Route path="/click-collect" element={
                  <BarmanRoute>
                    <ClickCollect />
                  </BarmanRoute>
                } />
                
                {/* Bouncer routes */}
                <Route path="/bouncer" element={
                  <BouncerRoute>
                    <Bouncer />
                  </BouncerRoute>
                } />
                
                {/* Promoter routes */}
                <Route path="/promoter" element={
                  <PromoterRoute>
                    <PromoterDashboard />
                  </PromoterRoute>
                } />

                {/* PIN setup & reset routes */}
                <Route path="/setup-pin" element={<SetupPinPage />} />
                <Route path="/reset-pin" element={<ResetPinPage />} />
                
                {/* Owner routes - standalone (no sidebar) */}
                <Route path="/owner/onboarding" element={
                  <OwnerRoute>
                    <OwnerOnboarding />
                  </OwnerRoute>
                } />

                {/* Owner routes - with sidebar layout */}
                <Route path="/owner" element={<OwnerRoute><OwnerLayout /></OwnerRoute>}>
                  <Route index element={<Navigate to="/owner/dashboard" replace />} />
                  <Route path="dashboard" element={<OwnerDashboard />} />
                  <Route path="analytics" element={<PlanGuard feature="analytics_basic"><OwnerAnalytics /></PlanGuard>} />
                  <Route path="live" element={<PlanGuard feature="live_night"><OwnerLiveNight /></PlanGuard>} />
                  <Route path="hype" element={<PlanGuard feature="hype_analysis"><OwnerHypeAnalysis /></PlanGuard>} />
                  <Route path="events" element={<OwnerEvents />} />
                  <Route path="ticketing" element={<OwnerTicketing />} />
                  <Route path="guest-list" element={<OwnerGuestList />} />
                  <Route path="tables" element={<PlanGuard feature="vip_tables_basic"><OwnerTables /></PlanGuard>} />
                  <Route path="djs" element={<PlanGuard feature="djs_orchestrate"><OwnerDJs /></PlanGuard>} />
                  <Route path="djs/:id" element={<OwnerDJDetail />} />
                  <Route path="book-dj" element={<PlanGuard feature="djs_connect"><BookDJPage /></PlanGuard>} />
                  <Route path="collaborations" element={<OwnerCollaborations />} />
                  <Route path="collab/event/:eventId" element={<OwnerCollabEventDashboard />} />
                  <Route path="scarcity" element={<OwnerScarcity />} />
                  <Route path="customers" element={<PlanGuard feature="clients_basic"><OwnerCustomers /></PlanGuard>} />
                  <Route path="loyalty" element={<PlanGuard feature="loyalty_crm"><OwnerLoyalty /></PlanGuard>} />
                  <Route path="campaigns" element={<PlanGuard feature="email_campaigns_promotional"><OwnerCampaigns /></PlanGuard>} />
                  <Route path="campaigns/new" element={<PlanGuard feature="email_campaigns_promotional"><OwnerCampaignEditor /></PlanGuard>} />
                  <Route path="campaigns/:id/edit" element={<PlanGuard feature="email_campaigns_promotional"><OwnerCampaignEditor /></PlanGuard>} />
                  <Route path="campaigns/:id/report" element={<PlanGuard feature="email_campaigns_promotional"><OwnerCampaignReport /></PlanGuard>} />
                  <Route path="sms" element={<OwnerSmsCredits />} />
                  <Route path="sms-campaigns" element={<OwnerSmsCampaigns />} />
                  <Route path="push" element={<OwnerPush />} />
                  <Route path="promoters" element={<PlanGuard feature="promoters_basic"><OwnerPromoters /></PlanGuard>} />
                  <Route path="promoters/announcements" element={<PlanGuard feature="promoters"><OwnerPromoterAnnouncements /></PlanGuard>} />
                  <Route path="promoters/finance" element={<PlanGuard feature="promoters"><OwnerPromoterFinance /></PlanGuard>} />
                  <Route path="promoters/templates" element={<PlanGuard feature="promoters"><OwnerPromoterTemplates /></PlanGuard>} />
                  <Route path="promoters/teams" element={<PlanGuard feature="promoters"><OwnerPromoterTeams /></PlanGuard>} />
                  <Route path="promoters/event/:eventId" element={<PlanGuard feature="promoters_basic"><OwnerPromoterEventView /></PlanGuard>} />
                  <Route path="promoters/:id" element={<PlanGuard feature="promoters_basic"><OwnerPromoterDetail /></PlanGuard>} />
                  <Route path="agencies" element={<PlanGuard feature="promoters"><OwnerAgencies /></PlanGuard>} />
                  <Route path="orders" element={<PlanGuard feature="orders_qr"><OwnerOrders /></PlanGuard>} />
                  <Route path="invoices" element={<PlanGuard feature="invoices_refunds"><OwnerInvoices /></PlanGuard>} />
                  <Route path="accounting" element={<PlanGuard feature="invoices_refunds"><OwnerAccounting /></PlanGuard>} />
                  <Route path="refunds" element={<OwnerRefunds />} />
                  <Route path="staff" element={<PlanGuard feature="staff_pin"><OwnerStaff /></PlanGuard>} />
                  <Route path="menu" element={<PlanGuard feature="menu"><OwnerMenu /></PlanGuard>} />
                  <Route path="venue" element={<OwnerVenue />} />
                  <Route path="billing" element={<OwnerBilling />} />
                  <Route path="vip-service" element={<PlanGuard feature="vip_service"><OwnerVipService /></PlanGuard>} />
                  <Route path="upsell" element={<PlanGuard feature="offers_upsell"><OwnerUpsell /></PlanGuard>} />
                  <Route path="managers" element={<OwnerManagers />} />
                  <Route path="waitlist" element={<OwnerWaitlist />} />
                  <Route path="notifications" element={<OwnerNotifications />} />
                  <Route path="help" element={<OwnerHelpCenter />} />
                  <Route path="support" element={<OwnerSupportRequest />} />
                </Route>

                <Route path="/unsubscribe" element={<Unsubscribe />} />

                {/* Owner preview — private client-facing preview, owner-only, no MFA */}
                <Route path="/owner/preview/:slug" element={<OwnerPreviewLayout />}>
                  <Route index element={<VenuePage />} />
                  <Route path="event/:eventId" element={<EventDetails />} />
                  <Route path="event/:eventId/billets" element={<TicketSelectionPage />} />
                  <Route path="event/:eventId/table/:packId" element={<TableCheckout />} />
                  <Route path="drinks/:category" element={<CategoryDrinks />} />
                </Route>

                {/* DJ app (sidebar layout + routed sections) */}
                <Route path="/dj" element={
                  <DJRoute>
                    <DJLayout />
                  </DJRoute>
                }>
                  <Route index element={<DJOverview />} />
                  <Route path="planning" element={<DJPlanning />} />
                  <Route path="analytics" element={<DJAnalytics />} />
                  <Route path="audience" element={<DJAudience />} />
                  <Route path="payments" element={<DJPayments />} />
                  <Route path="bookings" element={<DJBookings />} />
                  <Route path="notifications" element={<DJNotifications />} />
                  <Route path="team" element={<DJTeam />} />
                  <Route path="help" element={<DJHelp />} />
                  <Route path="profile" element={<DJProfile />} />
                </Route>

                {/* DJ onboarding (full-screen, no sidebar) + team-invite acceptance */}
                <Route path="/dj/onboarding" element={
                  <DJRoute>
                    <DJOnboarding />
                  </DJRoute>
                } />
                <Route path="/dj/team/accept" element={<DJTeamAccept />} />
                
                {/* Cloakroom routes */}
                <Route path="/cloakroom" element={
                  <CloakroomRoute>
                    <CloakroomDashboard />
                  </CloakroomRoute>
                } />
                
                {/* VIP Host routes */}
                <Route path="/vip-host" element={
                  <VipHostRoute>
                    <VipHostDashboard />
                  </VipHostRoute>
                } />
                
                {/* VIP Menu for customers (single QR per venue) */}
                <Route path="/vip-menu/:venueId" element={<VipMenu />} />
                
                {/* Manager routes - separate from owner with permission-based access */}
                <Route path="/manager" element={<Navigate to="/manager/dashboard" replace />} />
                <Route path="/manager/dashboard" element={
                  <ManagerRoute>
                    <ManagerDashboardPage />
                  </ManagerRoute>
                } />
                <Route path="/manager/orders" element={
                  <ManagerRoute>
                    <OwnerOrders />
                  </ManagerRoute>
                } />
                <Route path="/manager/events" element={
                  <ManagerRoute>
                    <OwnerEvents />
                  </ManagerRoute>
                } />
                <Route path="/manager/menu" element={
                  <ManagerRoute>
                    <OwnerMenu />
                  </ManagerRoute>
                } />
                <Route path="/manager/staff" element={
                  <ManagerRoute>
                    <OwnerStaff />
                  </ManagerRoute>
                } />
                <Route path="/manager/ticketing" element={
                  <ManagerRoute>
                    <OwnerTicketing />
                  </ManagerRoute>
                } />
                <Route path="/manager/tables" element={
                  <ManagerRoute>
                    <OwnerTables />
                  </ManagerRoute>
                } />
                <Route path="/manager/djs" element={
                  <ManagerRoute>
                    <OwnerDJs />
                  </ManagerRoute>
                } />
                <Route path="/manager/promoters" element={
                  <ManagerRoute>
                    <OwnerPromoters />
                  </ManagerRoute>
                } />
                <Route path="/manager/promoters/announcements" element={
                  <ManagerRoute>
                    <OwnerPromoterAnnouncements />
                  </ManagerRoute>
                } />
                <Route path="/manager/promoters/finance" element={
                  <ManagerRoute>
                    <OwnerPromoterFinance />
                  </ManagerRoute>
                } />
                <Route path="/manager/promoters/templates" element={
                  <ManagerRoute>
                    <OwnerPromoterTemplates />
                  </ManagerRoute>
                } />
                <Route path="/manager/promoters/teams" element={
                  <ManagerRoute>
                    <OwnerPromoterTeams />
                  </ManagerRoute>
                } />
                <Route path="/manager/promoters/event/:eventId" element={
                  <ManagerRoute>
                    <OwnerPromoterEventView />
                  </ManagerRoute>
                } />
                <Route path="/manager/promoters/:id" element={
                  <ManagerRoute>
                    <OwnerPromoterDetail />
                  </ManagerRoute>
                } />
                <Route path="/manager/djs/:id" element={
                  <ManagerRoute>
                    <OwnerDJDetail />
                  </ManagerRoute>
                } />
                <Route path="/manager/venue" element={
                  <ManagerRoute>
                    <OwnerVenue />
                  </ManagerRoute>
                } />
                <Route path="/manager/analytics" element={
                  <ManagerRoute>
                    <OwnerAnalytics />
                  </ManagerRoute>
                } />
                <Route path="/manager/customers" element={
                  <ManagerRoute>
                    <OwnerCustomers />
                  </ManagerRoute>
                } />
                <Route path="/manager/invoices" element={
                  <ManagerRoute>
                    <OwnerInvoices />
                  </ManagerRoute>
                } />
                <Route path="/manager/loyalty" element={
                  <ManagerRoute>
                    <OwnerLoyalty />
                  </ManagerRoute>
                } />
                <Route path="/manager/hype" element={
                  <ManagerRoute>
                    <OwnerHypeAnalysis />
                  </ManagerRoute>
                } />
                <Route path="/manager/upsell" element={
                  <ManagerRoute>
                    <OwnerUpsell />
                  </ManagerRoute>
                } />
                <Route path="/manager/guest-list" element={
                  <ManagerRoute>
                    <OwnerGuestList />
                  </ManagerRoute>
                } />
                <Route path="/manager/refunds" element={
                  <ManagerRoute>
                    <OwnerRefunds />
                  </ManagerRoute>
                } />
                <Route path="/manager/notifications" element={
                  <ManagerRoute>
                    <OwnerNotifications />
                  </ManagerRoute>
                } />
                <Route path="/manager/vip-service" element={
                  <ManagerRoute>
                    <OwnerVipService />
                  </ManagerRoute>
                } />
                {/* Legacy /manager/organizations* removed */}
                <Route path="/manager/scarcity" element={
                  <ManagerRoute>
                    <OwnerScarcity />
                  </ManagerRoute>
                } />
                <Route path="/manager/live" element={
                  <ManagerRoute>
                    <OwnerLiveNight />
                  </ManagerRoute>
                } />
                <Route path="/manager/help" element={
                  <ManagerRoute>
                    <OwnerHelpCenter />
                  </ManagerRoute>
                } />
                <Route path="/manager/support" element={
                  <ManagerRoute>
                    <OwnerSupportRequest />
                  </ManagerRoute>
                } />
                
                {/* Compte suspendu (public, hors guards) */}
                <Route path="/account-suspended" element={<AccountSuspended />} />

                {/* Admin routes */}
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="venues" element={<AdminVenues />} />
                  <Route path="analytics" element={<AdminAnalytics />} />
                  <Route path="segmentation" element={<AdminSegmentation />} />
                  <Route path="accounting" element={<AdminAccounting />} />
                  <Route path="feedback" element={<AdminFeedback />} />
                  <Route path="drinks" element={<AdminDrinkCatalog />} />
                  <Route path="emails" element={<AdminEmailTemplates />} />
                  <Route path="waitlist" element={<AdminWaitlist />} />
                  
                  <Route path="push" element={<AdminPushNotifications />} />
                  <Route path="directory" element={<AdminDirectory />} />
                  <Route path="directory/user/:userId" element={<AdminUserDetail />} />
                  <Route path="directory/venue/:venueId" element={<AdminVenueDetail />} />
                  <Route path="events" element={<AdminEvents />} />
                  <Route path="orders" element={<AdminOrders />} />
                  <Route path="subscriptions" element={<AdminSubscriptions />} />
                  <Route path="organizers" element={<AdminPlatformInvitations />} />
                  <Route path="affiliates" element={<AdminAffiliates />} />
                  <Route path="demo-access" element={<AdminDemoAccess />} />
                  <Route path="audit" element={<AdminAuditLog />} />
                </Route>

                {/* Affiliate app */}
                <Route path="/affiliate" element={
                  <AffiliateRoute>
                    <AffiliateLayout />
                  </AffiliateRoute>
                }>
                  <Route index element={<AffiliateDashboard />} />
                  <Route path="venues" element={<AffiliateVenues />} />
                  <Route path="venues/new" element={<AffiliateVenueForm />} />
                  <Route path="venues/:id/edit" element={<AffiliateVenueForm />} />
                  <Route path="events" element={<AffiliateEvents />} />
                  <Route path="events/new" element={<AffiliateEventForm />} />
                  <Route path="events/:id/edit" element={<AffiliateEventForm />} />
                  <Route path="recurring" element={<AffiliateRecurring />} />
                  <Route path="recurring/new" element={<AffiliateRecurringForm />} />
                  <Route path="recurring/:id/edit" element={<AffiliateRecurringForm />} />
                  <Route path="analytics" element={<AffiliateAnalytics />} />
                  <Route path="settings" element={<AffiliateSettings />} />
                  <Route path="members" element={<AffiliateMembers />} />
                  <Route path="suivi" element={<AffiliatePromotersTracking />} />
                  <Route path="semaine" element={<AffiliateWeekCalendar />} />
                  <Route path="assignments" element={<AffiliateAssignments />} />
                  <Route path="notifications" element={<AffiliateNotifications />} />
                  <Route path="events/:id/brief" element={<AffiliateEventBrief />} />
                  <Route path="manager" element={<ManagerDashboard />} />
                  {/* Promoter (affiliate_member) sub-routes */}
                  <Route path="promoteur" element={<AffiliatePromoterDashboard />} />
                  <Route path="promoteur/linktree" element={<AffiliatePromoterLinktree />} />
                  <Route path="promoteur/settings" element={<AffiliatePromoterSettings />} />
                </Route>

                {/* Public affiliate pages — accessible without auth */}
                <Route path="/affiliate-event/:slug" element={<AffiliateEventPage />} />
                <Route path="/affiliate-venue/:slug" element={<AffiliateVenuePage />} />
                <Route path="/p/:slug" element={<AffiliateLinktree />} />
                <Route path="/promo/:slug" element={<PromoterLinktree />} />

                <Route path="*" element={<NotFound />} />
              </Routes>
              </NativeProGate>
              </ProAppGate>
            </Suspense>
              </RouteErrorBoundary>
            </MaintenanceWrapper>
            </LiveModeProvider>
            </PreviewModeProvider>
          </TooltipProvider>
          </VenueNavProvider>
        </FavoritesProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </BrowserRouter>
);

export default App;
