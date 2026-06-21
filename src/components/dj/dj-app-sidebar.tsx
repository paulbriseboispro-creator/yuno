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
  LayoutDashboard, CalendarDays, MousePointerClick, BarChart2, User, LogOut, LifeBuoy,
} from 'lucide-react';

export function DJAppSidebar() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const groups: SidebarNavGroup[] = [
    {
      label: t('sidebar.group.overview'),
      items: [
        { title: t('dj.overview'), path: '/dj', icon: <LayoutDashboard /> },
        { title: t('dj.mySchedule'), path: '/dj/planning', icon: <CalendarDays /> },
      ],
    },
    {
      label: t('dj.nav.activity'),
      items: [
        { title: t('dj.links.tab'), path: '/dj/audience', icon: <MousePointerClick /> },
        { title: t('dj.myPayments'), path: '/dj/payments', icon: <BarChart2 /> },
      ],
    },
    {
      label: t('sidebar.group.settings'),
      items: [
        { title: t('dj.myProfile'), path: '/dj/profile', icon: <User /> },
      ],
    },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader className="h-14 justify-center">
        <SidebarMenuButton asChild>
          <Link to="/dj" className="gap-2.5">
            <img src="/yuno-icon-192.png" alt="Yuno" className="size-8 rounded-lg shrink-0" />
            <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="text-sm font-black tracking-widest" style={{ color: '#E8192C' }}>YUNO</span>
              <span className="text-[10px] text-muted-foreground -mt-0.5">{t('dj.spaceLabel')}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, i) => (
          <NavGroup key={`dj-group-${i}`} {...group} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-muted-foreground" size="sm">
              <a href="mailto:support@yunoapp.eu">
                <LifeBuoy />
                <span>{t('sidebar.helpSupport')}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} className="text-muted-foreground" size="sm">
              <LogOut />
              <span>{t('dj.logout')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
