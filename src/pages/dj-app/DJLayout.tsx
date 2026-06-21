import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { DJAppSidebar } from '@/components/dj/dj-app-sidebar';
import { DJDataProvider, useDJData } from '@/contexts/DJDataContext';
import { DJSpinner } from '@/components/dj/dj-ui';

function DJLayoutInner() {
  const { loading, dj } = useDJData();
  if (loading) return <DJSpinner />;
  // The provider redirects away when the user has no DJ profile; render nothing
  // in that brief window rather than a flash of empty chrome.
  if (!dj) return null;
  return (
    <SidebarProvider>
      <DJAppSidebar />
      <SidebarInset className="overflow-y-auto" style={{ background: '#000' }}>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function DJLayout() {
  return (
    <DJDataProvider>
      <DJLayoutInner />
    </DJDataProvider>
  );
}
