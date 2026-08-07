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
  LayoutDashboard, Inbox, Users, Layers, UserPlus, Activity, Megaphone, ShieldCheck,
  Building2, CalendarDays, TrendingUp, BarChart2, Wallet, MapPin, RefreshCw,
  Settings, Link2, LifeBuoy, UserRound, LogOut, CalendarRange, ClipboardList, Coins, Send, Store,
} from 'lucide-react';

export interface AgencyIdentity {
  name: string;
  logo_url: string | null;
  city: string | null;
}

type T = (key: string) => string;

/**
 * Sidebar UNIQUE de l'espace agence fusionné. Elle couvre les deux familles
 * de routes — /agency-app/* (clubs Yuno : contrats, ventes in-app, finance)
 * et /affiliate/* (clubs externes : catalogue, linktree, trafic) — pour que
 * le chef d'agence vive dans un seul cockpit, quel que soit le mode de
 * distribution d'un club.
 */
function buildGroups(t: T): SidebarNavGroup[] {
  return [
    {
      label: t('aff.nav.overview'),
      items: [
        { title: t('agc.nav.home'), path: '/agency-app', icon: <LayoutDashboard /> },
        { title: t('aff.nav.inbox'), path: '/agency-app/inbox', icon: <Inbox /> },
      ],
    },
    {
      label: t('agc.nav.teamGroup'),
      items: [
        { title: t('agc.nav.promoters'), path: '/agency-app/promoters', icon: <Users /> },
        { title: t('agc.nav.groups'), path: '/agency-app/groups', icon: <Layers /> },
        { title: t('agc.nav.guestlists'), path: '/agency-app/guest-lists', icon: <ClipboardList /> },
        { title: t('aff.nav.assignments'), path: '/affiliate/assignments', icon: <UserPlus /> },
        { title: t('aff.nav.promoterTracking'), path: '/affiliate/suivi', icon: <Activity /> },
        { title: t('aff.nav.teamComms'), path: '/affiliate/notifications', icon: <Megaphone /> },
        { title: t('agc.nav.announcements'), path: '/agency-app/announcements', icon: <Send /> },
        { title: t('agc.nav.rules'), path: '/agency-app/rules', icon: <ShieldCheck /> },
        { title: t('agc.nav.payTemplates'), path: '/agency-app/pay', icon: <Coins /> },
      ],
    },
    {
      label: t('agc.nav.yunoGroup'),
      items: [
        { title: t('agc.nav.contracts'), path: '/agency-app/clubs', icon: <Building2 /> },
        { title: t('agc.nav.events'), path: '/agency-app/events', icon: <CalendarDays /> },
        { title: t('agc.nav.salesStats'), path: '/agency-app/stats', icon: <TrendingUp /> },
        { title: t('agc.nav.charts'), path: '/agency-app/analytics', icon: <BarChart2 /> },
        { title: t('agc.nav.finance'), path: '/agency-app/finance', icon: <Wallet /> },
      ],
    },
    {
      label: t('agc.nav.externalGroup'),
      items: [
        { title: t('aff.nav.clubs'), path: '/affiliate/venues', icon: <MapPin /> },
        { title: t('aff.nav.events'), path: '/affiliate/events', icon: <CalendarDays /> },
        { title: t('aff.nav.week'), path: '/affiliate/semaine', icon: <CalendarRange /> },
        { title: t('aff.nav.recurring'), path: '/affiliate/recurring', icon: <RefreshCw /> },
        { title: t('agc.nav.trafficAnalytics'), path: '/affiliate/analytics', icon: <BarChart2 /> },
        { title: t('aff.nav.commissions'), path: '/affiliate/commissions', icon: <Coins /> },
      ],
    },
    {
      label: t('aff.nav.settingsGroup'),
      items: [
        { title: t('agc.nav.showcase'), path: '/agency-app/vitrine', icon: <Store /> },
        { title: t('agc.nav.agencyProfile'), path: '/agency-app/profile', icon: <Settings /> },
        { title: t('agc.nav.externalSettings'), path: '/affiliate/settings', icon: <Link2 /> },
      ],
    },
  ];
}

export function AgencyAppSidebar({ agency }: { agency: AgencyIdentity | null }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const groups = buildGroups(t);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader className="h-14 justify-center">
        <SidebarMenuButton asChild>
          <Link to="/agency-app" className="gap-2.5">
            {agency?.logo_url ? (
              <img src={agency.logo_url} alt={agency.name} className="size-8 rounded-lg shrink-0 object-cover" />
            ) : (
              <img src="/yuno-icon-192.png" alt="Yuno" className="size-8 rounded-lg shrink-0" />
            )}
            <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-black tracking-wide" style={{ color: '#E8192C' }}>
                {agency?.name ?? 'YUNO'}
              </span>
              <span className="text-[10px] text-muted-foreground -mt-0.5">
                {t('agc.role.label')}{agency?.city ? ` · ${agency.city}` : ''}
              </span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, i) => (
          <NavGroup key={`agc-group-${i}`} {...group} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-muted-foreground" size="sm">
              <Link to="/agency-app/help">
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
