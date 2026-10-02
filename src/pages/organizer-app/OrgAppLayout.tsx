import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { OrgAppSidebar } from '@/components/org-sidebar';
import { OrgAppHeader } from '@/components/org-app-header';
import { OrgOnboardingGuide } from '@/components/organizer-onboarding/OrgOnboardingGuide';
import { LegalConsentGate } from '@/components/LegalConsentGate';
import { CollabTrailBar } from '@/components/collab/CollabTrail';
import { useAuth } from '@/hooks/useAuth';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { useAccountProductFor } from '@/lib/crmProduct';
import { isCrmPathAllowed } from '@/components/crm/crmNav';

export default function OrgAppLayout() {
  const { user } = useAuth();
  const { organizerId } = useActingOrganizer();
  const { pathname } = useLocation();
  // Yuno CRM : une organisation qui garde sa billetterie n'ouvre pas les pages
  // de vente (billetterie, tables, porte, commandes, Stripe) — retour à l'accueil.
  const { isCrm, loading: productLoading } = useAccountProductFor({ organizerUserId: organizerId });
  if (isCrm && !productLoading && !isCrmPathAllowed(pathname, '/organizer-app')) {
    return <Navigate to="/organizer-app" replace />;
  }

  return (
    <SidebarProvider>
      <OrgAppSidebar />
      <SidebarInset className="overflow-y-auto" style={{ background: 'var(--sf-000000)' }}>
        <OrgAppHeader />
        {/* Outil ouvert depuis la page d'une collaboration : chemin de retour. */}
        <CollabTrailBar />
        <Outlet />
      </SidebarInset>
      {user && !isCrm && <OrgOnboardingGuide userId={user.id} />}
      <LegalConsentGate />
    </SidebarProvider>
  );
}
