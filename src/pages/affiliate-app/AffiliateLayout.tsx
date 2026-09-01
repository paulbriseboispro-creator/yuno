import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AffiliateAppSidebar, type AffiliateRole } from '@/components/affiliate/affiliate-app-sidebar';
import { AgencyAppSidebar, type AgencyIdentity } from '@/components/agency/agency-app-sidebar';
import { AffiliateAppHeader } from '@/components/affiliate/affiliate-app-header';
import { AffiliateShellProvider, type AffiliateShell } from '@/contexts/AffiliateShellContext';
import { getAffiliateFeedConfig } from '@/lib/notifications';

export default function AffiliateLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const [shell, setShell] = useState<AffiliateShell | null>(null);
  const [agency, setAgency] = useState<AgencyIdentity | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Check affiliate admin first
      const { data: aff } = await supabase
        .from('affiliates')
        .select('id, agency_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (aff) {
        setShell({
          role: 'admin',
          affiliateId: aff.id,
          memberId: null,
          feedConfig: getAffiliateFeedConfig(`admin:${aff.id}`),
        });
        // Identité fusionnée : l'admin affilié EST un chef d'agence. On charge
        // l'agence liée pour la sidebar unifiée (auto-guérison si le trigger
        // de provisionnement a manqué cette ligne).
        let agencyId = aff.agency_id;
        if (!agencyId) {
          const { data: provisioned } = await supabase.rpc('provision_agency_for_affiliate', {
            p_affiliate_id: aff.id,
          });
          agencyId = (provisioned as string | null) ?? null;
        }
        if (agencyId) {
          const { data: ag } = await supabase
            .from('agencies')
            .select('name, logo_url, city')
            .eq('id', agencyId)
            .maybeSingle();
          if (ag) setAgency(ag);
        }
        return;
      }

      // Check member role
      const { data: mem } = await supabase
        .from('affiliate_members')
        .select('id, role, affiliate_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (mem) {
        const role: AffiliateRole = mem.role === 'manager' ? 'manager' : 'member';
        setShell({
          role,
          affiliateId: mem.affiliate_id,
          memberId: mem.id,
          // Les managers supervisent : ils lisent le flux de l'agence, comme
          // le chef. Les promoteurs lisent leur flux personnel.
          feedConfig: getAffiliateFeedConfig(
            role === 'manager' ? `admin:${mem.affiliate_id}` : `member:${mem.id}`
          ),
        });
      }
    })();
  }, [user]);

  // Avoid a flash of the wrong sidebar before the role resolves.
  if (!shell) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-2"
          style={{ borderColor: 'rgba(255,255,255,0.085) rgba(255,255,255,0.085) rgba(255,255,255,0.085) #E8192C' }} />
      </div>
    );
  }

  // L'index /affiliate n'est une destination pour personne : le cockpit du
  // chef d'agence est /agency-app (fusion), le manager vit sur /affiliate/manager
  // et le promoteur sur /affiliate/promoteur. Sans cet aiguillage, un membre
  // atterrissant ici (post-invitation, post-PIN, retour arrière) tombait sur
  // le dashboard admin, vide pour lui.
  if (location.pathname === '/affiliate') {
    if (shell.role === 'admin') return <Navigate to="/agency-app" replace />;
    if (shell.role === 'manager') return <Navigate to="/affiliate/manager" replace />;
    return <Navigate to="/affiliate/promoteur" replace />;
  }

  return (
    <AffiliateShellProvider value={shell}>
      <SidebarProvider>
        {shell.role === 'admin'
          ? <AgencyAppSidebar agency={agency} />
          : <AffiliateAppSidebar role={shell.role} />}
        <SidebarInset className="overflow-y-auto" style={{ background: '#000' }}>
          <AffiliateAppHeader />
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </AffiliateShellProvider>
  );
}
