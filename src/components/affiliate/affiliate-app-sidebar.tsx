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
import { useLanguage } from '@/contexts/LanguageContext';
import {
  LayoutDashboard, MapPin, CalendarDays, RefreshCw, BarChart2, LogOut, Settings,
  Users, Link2, Activity, CalendarRange, UserPlus, Megaphone, LifeBuoy, Inbox, UserRound,
} from 'lucide-react';
import { Wordmark } from '@/components/brand/Wordmark';

export type AffiliateRole = 'admin' | 'manager' | 'member';

type T = (key: string) => string;

function buildGroups(role: AffiliateRole, t: T): SidebarNavGroup[] {
  if (role === 'manager') {
    return [
      {
        label: t('aff.nav.overview'),
        items: [
          { title: t('aff.nav.myTeam'), path: '/affiliate/manager', icon: <Users /> },
          { title: t('aff.nav.analytics'), path: '/affiliate/analytics', icon: <BarChart2 /> },
          { title: t('aff.nav.inbox'), path: '/affiliate/inbox', icon: <Inbox /> },
        ],
      },
    ];
  }

  if (role === 'member') {
    return [
      {
        label: t('aff.nav.overview'),
        items: [
          { title: t('aff.nav.mySpace'), path: '/affiliate/promoteur', icon: <LayoutDashboard /> },
          { title: t('aff.nav.analytics'), path: '/affiliate/analytics', icon: <BarChart2 /> },
          { title: t('aff.nav.inbox'), path: '/affiliate/inbox', icon: <Inbox /> },
        ],
      },
      {
        label: t('aff.nav.myPromo'),
        items: [
          { title: t('aff.nav.myLinktree'), path: '/affiliate/promoteur/linktree', icon: <Link2 /> },
        ],
      },
      {
        label: t('aff.nav.settingsGroup'),
        items: [
          { title: t('aff.nav.myProfile'), path: '/affiliate/promoteur/settings', icon: <Settings /> },
        ],
      },
    ];
  }

  // admin
  return [
    {
      label: t('aff.nav.overview'),
      items: [
        { title: t('aff.nav.home'), path: '/affiliate', icon: <LayoutDashboard /> },
        { title: t('aff.nav.week'), path: '/affiliate/semaine', icon: <CalendarRange /> },
        { title: t('aff.nav.analytics'), path: '/affiliate/analytics', icon: <BarChart2 /> },
        { title: t('aff.nav.inbox'), path: '/affiliate/inbox', icon: <Inbox /> },
      ],
    },
    {
      label: t('aff.nav.eventsClubs'),
      items: [
        { title: t('aff.nav.clubs'), path: '/affiliate/venues', icon: <MapPin /> },
        { title: t('aff.nav.events'), path: '/affiliate/events', icon: <CalendarDays /> },
        { title: t('aff.nav.recurring'), path: '/affiliate/recurring', icon: <RefreshCw /> },
      ],
    },
    {
      label: t('aff.nav.teamPromo'),
      items: [
        { title: t('aff.nav.assignments'), path: '/affiliate/assignments', icon: <UserPlus /> },
        { title: t('aff.nav.team'), path: '/affiliate/members', icon: <Users /> },
        { title: t('aff.nav.promoterTracking'), path: '/affiliate/suivi', icon: <Activity /> },
        { title: t('aff.nav.teamComms'), path: '/affiliate/notifications', icon: <Megaphone /> },
      ],
    },
    {
      label: t('aff.nav.settingsGroup'),
      items: [
        { title: t('aff.nav.settings'), path: '/affiliate/settings', icon: <Settings /> },
      ],
    },
  ];
}

export function AffiliateAppSidebar({ role }: { role: AffiliateRole }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const groups = buildGroups(role, t);
  const home = role === 'admin' ? '/affiliate' : role === 'manager' ? '/affiliate/manager' : '/affiliate/promoteur';
  const roleLabel = role === 'admin' ? t('aff.role.admin') : role === 'manager' ? t('aff.role.manager') : t('aff.role.member');

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
              <Wordmark height={14} tone="red" />
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
              <Link to="/affiliate/help">
                <LifeBuoy />
                <span>{t('aff.nav.help')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-muted-foreground" size="sm">
              <Link to="/profile">
                <UserRound />
                <span>{t('sidebar.backToProfile')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} className="text-muted-foreground" size="sm">
              <LogOut />
              <span>{t('aff.nav.signOut')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
