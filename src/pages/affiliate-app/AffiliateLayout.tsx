import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AffiliateAppSidebar, type AffiliateRole } from '@/components/affiliate/affiliate-app-sidebar';

export default function AffiliateLayout() {
  const { user } = useAuth();
  const [role, setRole] = useState<AffiliateRole | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Check affiliate admin first
      const { data: aff } = await supabase
        .from('affiliates')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (aff) { setRole('admin'); return; }

      // Check member role
      const { data: mem } = await supabase
        .from('affiliate_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (mem) {
        setRole((mem as any).role === 'manager' ? 'manager' : 'member');
      }
    })();
  }, [user]);

  // Avoid a flash of the wrong sidebar before the role resolves.
  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-2"
          style={{ borderColor: 'rgba(255,255,255,0.085) rgba(255,255,255,0.085) rgba(255,255,255,0.085) #E8192C' }} />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AffiliateAppSidebar role={role} />
      <SidebarInset className="overflow-y-auto" style={{ background: '#000' }}>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
