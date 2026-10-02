import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { OwnerOnboardingGuide } from '@/components/owner-onboarding/OwnerOnboardingGuide';
import { OwnerAssistant } from '@/components/owner/assistant/OwnerAssistant';
import { LegalConsentGate } from '@/components/LegalConsentGate';
import { CollabTrailBar } from '@/components/collab/CollabTrail';
import { useOwnerVenueContext } from '@/contexts/OwnerVenueContext';
import { useAccountProductFor } from '@/lib/crmProduct';
import { isCrmPathAllowed } from '@/components/crm/crmNav';

function OwnerLayoutInner() {
  const { venueId } = useOwnerVenueContext();
  const { pathname } = useLocation();
  // Yuno CRM : un club qui garde sa billetterie n'ouvre pas les pages de vente
  // (billetterie, tables, porte, commandes, Stripe) — retour à son accueil.
  const { isCrm, loading: productLoading } = useAccountProductFor({ venueId });
  if (isCrm && !productLoading && !isCrmPathAllowed(pathname, '/owner')) {
    return <Navigate to="/owner/dashboard" replace />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-y-auto">
        {/* Outil ouvert depuis la page d'une collaboration : chemin de retour. */}
        <CollabTrailBar />
        <Outlet />
      </SidebarInset>
      {venueId && !isCrm && <OwnerOnboardingGuide venueId={venueId} />}
      {venueId && <OwnerAssistant />}
      <LegalConsentGate />
    </SidebarProvider>
  );
}

export function OwnerLayout() {
  return <OwnerLayoutInner />;
}
