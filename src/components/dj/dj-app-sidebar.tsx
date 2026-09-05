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
import { makeDjT } from '@/i18n/djTranslate';
import {
  LayoutDashboard, CalendarDays, MousePointerClick, BarChart2, LineChart, Bell,
  Users, User, LogOut, LifeBuoy, Inbox,
} from 'lucide-react';
import { Wordmark } from '@/components/brand/Wordmark';

export function DJAppSidebar() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const tt = makeDjT(language);

  const groups: SidebarNavGroup[] = [
    {
      label: t('sidebar.group.overview'),
      items: [
        { title: t('dj.overview'), path: '/dj', icon: <LayoutDashboard /> },
        { title: t('dj.mySchedule'), path: '/dj/planning', icon: <CalendarDays /> },
        { title: tt('Statistiques', 'Analytics', 'Estadísticas'), path: '/dj/analytics', icon: <LineChart /> },
      ],
    },
    {
      label: t('dj.nav.activity'),
      items: [
        { title: tt('Réservations', 'Bookings', 'Reservas'), path: '/dj/bookings', icon: <Inbox /> },
        { title: t('dj.links.tab'), path: '/dj/audience', icon: <MousePointerClick /> },
        { title: t('dj.myPayments'), path: '/dj/payments', icon: <BarChart2 /> },
        { title: tt('Notifications', 'Notifications', 'Notificaciones'), path: '/dj/notifications', icon: <Bell /> },
      ],
    },
    {
      label: t('sidebar.group.settings'),
      items: [
        { title: t('dj.myProfile'), path: '/dj/profile', icon: <User /> },
        { title: tt('Équipe', 'Team', 'Equipo'), path: '/dj/team', icon: <Users /> },
      ],
    },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    // 18rem (défaut Sheet) couvrait ~3/4 d'un iPhone : trop large pour un tiroir
    // secondaire dans l'app Pro. 15rem suffit aux libellés et laisse voir la page.
    // mobileInset : panneau flottant détaché des bords — sans lui le Sheet pleine
    // hauteur recouvre la barre de statut (l'heure) sur iPhone.
    <Sidebar collapsible="icon" variant="floating" mobileWidth="min(15rem, 78vw)" mobileInset>
      <SidebarHeader className="h-14 justify-center">
        <SidebarMenuButton asChild>
          <Link to="/dj" className="gap-2.5">
            <img src="/yuno-icon-192.png" alt="Yuno" className="size-8 rounded-lg shrink-0" />
            <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <Wordmark height={14} tone="red" />
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
              <Link to="/dj/help">
                <LifeBuoy />
                <span>{t('sidebar.helpSupport')}</span>
              </Link>
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
