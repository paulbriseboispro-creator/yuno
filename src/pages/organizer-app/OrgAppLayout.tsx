import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { OrgAppSidebar } from '@/components/org-sidebar';
import { OrgAppHeader } from '@/components/org-app-header';
import { OrgOnboardingWidget } from '@/components/organizer-onboarding/OrgOnboardingWidget';
import { useAuth } from '@/hooks/useAuth';

/**
 * Organizer dashboard shell — mirrors the Owner club dashboard architecture
 * (floating left sidebar + inset content) so the whole Yuno backoffice shares
 * one design language. The sticky header (sidebar toggle / language / profile)
 * lives at the layout level so every org page gets it, including the mobile
 * trigger that opens the off-canvas sidebar.
 */
export default function OrgAppLayout() {
  const { user } = useAuth();

  return (
    <SidebarProvider>
      <OrgAppSidebar />
      <SidebarInset className="overflow-y-auto" style={{ background: '#000' }}>
        <OrgAppHeader />
        <Outlet />
      </SidebarInset>
      {user && <OrgOnboardingWidget userId={user.id} />}
    </SidebarProvider>
  );
}
