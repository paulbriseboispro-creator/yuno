import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { OwnerOnboardingWidget } from '@/components/owner-onboarding/OwnerOnboardingWidget';
import { useOwnerVenueContext } from '@/contexts/OwnerVenueContext';

function OwnerLayoutInner() {
  const { venueId } = useOwnerVenueContext();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-y-auto">
        <Outlet />
      </SidebarInset>
      {venueId && <OwnerOnboardingWidget venueId={venueId} />}
    </SidebarProvider>
  );
}

export function OwnerLayout() {
  return <OwnerLayoutInner />;
}
