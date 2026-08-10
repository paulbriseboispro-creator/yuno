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
import type { SidebarNavGroup, SidebarNavItem } from '@/components/app-shared';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import {
  LayoutDashboard, CalendarDays, Link2, ListTree, ClipboardList, ScanLine,
  Wallet, Users, User, LogOut, Activity,
} from 'lucide-react';

/**
 * Sidebar de l'espace promoteur — même architecture que dj-app-sidebar. Les
 * entrées conditionnelles (scan, guest list, équipe) suivent les droits réels
 * du profil sélectionné : un outil auquel on n'a pas accès n'apparaît pas.
 */
export function PromoterAppSidebar() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { canScan, hasGuestListAccess, teamInfo } = usePromoterData();

  const activityItems: SidebarNavItem[] = [
    { title: t('promoter.linktreeTab'), path: '/promoter/linktree', icon: <ListTree /> },
  ];
  if (hasGuestListAccess) {
    activityItems.push({ title: t('promoterGuestlist.title'), path: '/promoter/guestlist', icon: <ClipboardList /> });
  }
  if (canScan) {
    activityItems.push({ title: t('promoterScan.title'), path: '/promoter/scan', icon: <ScanLine /> });
  }
  activityItems.push({ title: tt('Règlements', 'Payouts', 'Pagos'), path: '/promoter/payments', icon: <Wallet /> });
  if (teamInfo) {
    activityItems.push({ title: tt('Équipe', 'Team', 'Equipo'), path: '/promoter/team', icon: <Users /> });
  }

  const groups: SidebarNavGroup[] = [
    {
      label: t('sidebar.group.overview'),
      items: [
        { title: t('promoter.overview'), path: '/promoter', icon: <LayoutDashboard /> },
        { title: t('promoter.myEvents'), path: '/promoter/events', icon: <CalendarDays /> },
        { title: t('promoter.linkTools'), path: '/promoter/links', icon: <Link2 /> },
      ],
    },
    {
      label: tt('Activité', 'Activity', 'Actividad'),
      items: activityItems,
    },
    {
      label: t('sidebar.group.settings'),
      items: [
        { title: tt('Mon Profil', 'My Profile', 'Mi Perfil'), path: '/promoter/profile', icon: <User /> },
      ],
    },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    // Même tiroir mobile que l'app DJ : 15rem de large, panneau flottant détaché
    // des bords (mobileInset) pour ne pas recouvrir la barre de statut.
    <Sidebar collapsible="icon" variant="floating" mobileWidth="min(15rem, 78vw)" mobileInset>
      <SidebarHeader className="h-14 justify-center">
        <SidebarMenuButton asChild>
          <Link to="/promoter" className="gap-2.5">
            <img src="/yuno-icon-192.png" alt="Yuno" className="size-8 rounded-lg shrink-0" />
            <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="text-sm font-black tracking-widest" style={{ color: '#E8192C' }}>YUNO</span>
              <span className="text-[10px] text-muted-foreground -mt-0.5">{tt('Espace Promoteur', 'Promoter Space', 'Espacio Promotor')}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, i) => (
          <NavGroup key={`promoter-group-${i}`} {...group} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-muted-foreground" size="sm">
              <Link to="/profile">
                <Activity />
                <span>{t('sidebar.backToProfile')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} className="text-muted-foreground" size="sm">
              <LogOut />
              <span>{tt('Se déconnecter', 'Sign out', 'Cerrar sesión')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
