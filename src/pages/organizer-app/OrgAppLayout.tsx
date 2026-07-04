import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { OrgAppSidebar } from '@/components/org-sidebar';
import { OrgAppHeader } from '@/components/org-app-header';
import { OrgOnboardingGuide } from '@/components/organizer-onboarding/OrgOnboardingGuide';
import { LegalConsentGate } from '@/components/LegalConsentGate';
import { useAuth } from '@/hooks/useAuth';

export default function OrgAppLayout() {
  const { user } = useAuth();

  return (
    <SidebarProvider>
      <OrgAppSidebar />
      <SidebarInset className="overflow-y-auto" style={{ background: '#000' }}>
        <OrgAppHeader />
        <Outlet />
      </SidebarInset>
      {user && <OrgOnboardingGuide userId={user.id} />}
      <LegalConsentGate />
    </SidebarProvider>
  );
}
