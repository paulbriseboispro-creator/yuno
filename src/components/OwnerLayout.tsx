import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { OwnerOnboardingGuide } from '@/components/owner-onboarding/OwnerOnboardingGuide';
import { OwnerAssistant } from '@/components/owner/assistant/OwnerAssistant';
import { LegalConsentGate } from '@/components/LegalConsentGate';
import { useOwnerVenueContext } from '@/contexts/OwnerVenueContext';

function OwnerLayoutInner() {
  const { venueId } = useOwnerVenueContext();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-y-auto">
        <Outlet />
      </SidebarInset>
      {venueId && <OwnerOnboardingGuide venueId={venueId} />}
      {venueId && <OwnerAssistant />}
      <LegalConsentGate />
    </SidebarProvider>
  );
}

export function OwnerLayout() {
  return <OwnerLayoutInner />;
}
