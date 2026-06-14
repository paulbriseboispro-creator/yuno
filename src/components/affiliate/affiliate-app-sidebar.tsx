import { Link, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { NavGroup } from '@/components/nav-group';
import type { SidebarNavGroup } from '@/components/app-shared';
import { supabase } from '@/integrations/supabase/client';
import {
  LayoutDashboard, MapPin, CalendarDays, RefreshCw, BarChart2, LogOut, Settings,
  Users, Link2, Activity, CalendarRange, UserPlus, Bell, LifeBuoy,
} from 'lucide-react';

export type AffiliateRole = 'admin' | 'manager' | 'member';

function buildGroups(role: AffiliateRole): SidebarNavGroup[] {
  if (role === 'manager') {
    return [
      {
        label: "Vue d'ensemble",
        items: [
          { title: 'Mon équipe', path: '/affiliate/manager', icon: <Users /> },
          { title: 'Analytics', path: '/affiliate/analytics', icon: <BarChart2 /> },
        ],
      },
    ];
  }

  if (role === 'member') {
    return [
      {
        label: "Vue d'ensemble",
        items: [
          { title: 'Mon espace', path: '/affiliate/promoteur', icon: <LayoutDashboard /> },
          { title: 'Analytics', path: '/affiliate/analytics', icon: <BarChart2 /> },
        ],
      },
      {
        label: 'Ma promo',
        items: [
          { title: 'Mon Linktree', path: '/affiliate/promoteur/linktree', icon: <Link2 /> },
        ],
      },
      {
        label: 'Réglages',
        items: [
          { title: 'Mon profil', path: '/affiliate/promoteur/settings', icon: <Settings /> },
        ],
      },
    ];
  }

  // admin
  return [
    {
      label: "Vue d'ensemble",
      items: [
        { title: 'Accueil', path: '/affiliate', icon: <LayoutDashboard /> },
        { title: 'Cette semaine', path: '/affiliate/semaine', icon: <CalendarRange /> },
        { title: 'Analytics', path: '/affiliate/analytics', icon: <BarChart2 /> },
      ],
    },
    {
      label: 'Soirées & Clubs',
      items: [
        { title: 'Clubs', path: '/affiliate/venues', icon: <MapPin /> },
        { title: 'Soirées', path: '/affiliate/events', icon: <CalendarDays /> },
        { title: 'Récurrents', path: '/affiliate/recurring', icon: <RefreshCw /> },
      ],
    },
    {
      label: 'Équipe & Promo',
      items: [
        { title: 'Assignments', path: '/affiliate/assignments', icon: <UserPlus /> },
        { title: 'Équipe', path: '/affiliate/members', icon: <Users /> },
        { title: 'Suivi promoteurs', path: '/affiliate/suivi', icon: <Activity /> },
        { title: 'Notifications', path: '/affiliate/notifications', icon: <Bell /> },
      ],
    },
    {
      label: 'Réglages',
      items: [
        { title: 'Paramètres', path: '/affiliate/settings', icon: <Settings /> },
      ],
    },
  ];
}

export function AffiliateAppSidebar({ role }: { role: AffiliateRole }) {
  const navigate = useNavigate();
  const groups = buildGroups(role);
  const home = role === 'admin' ? '/affiliate' : role === 'manager' ? '/affiliate/manager' : '/affiliate/promoteur';
  const roleLabel = role === 'admin' ? 'Espace Affilié' : role === 'manager' ? 'Manager' : 'Espace Promoteur';

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader className="h-14 justify-center">
        <SidebarMenuButton asChild>
          <Link to={home} className="gap-2.5">
            <img src="/yuno-icon-192.png" alt="Yuno" className="size-8 rounded-lg shrink-0" />
            <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="text-sm font-black tracking-widest" style={{ color: '#E8192C' }}>YUNO</span>
              <span className="text-[10px] text-muted-foreground -mt-0.5">{roleLabel}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, i) => (
          <NavGroup key={`aff-group-${i}`} {...group} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-muted-foreground" size="sm">
              <a href="mailto:support@yunoapp.eu">
                <LifeBuoy />
                <span>Aide & support</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} className="text-muted-foreground" size="sm">
              <LogOut />
              <span>Déconnexion</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
