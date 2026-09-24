import { Link, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { SidebarIdentity } from '@/components/sidebar-identity';
import { SidebarProThemeSwitch } from '@/components/ProThemeSwitch';

/**
 * Sidebar de l'espace promoteur — même architecture que dj-app-sidebar. Les
 * entrées conditionnelles (scan, guest list, équipe) suivent les droits réels
 * du profil sélectionné : un outil auquel on n'a pas accès n'apparaît pas.
 */
export function PromoterAppSidebar() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { canScan, hasGuestListAccess, teamInfo, promoter, scopeName } = usePromoterData();
  // Le promoteur se présente par son nom quand il l'a renseigné, sinon par
  // son code — c'est ainsi que ses clients le connaissent.
  const promoterName = promoter
    ? ([promoter.first_name, promoter.last_name].filter(Boolean).join(' ').trim() || `@${promoter.promo_code}`)
    : null;

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
        { title: t('promoter.overview'), path: '/promoter', icon: <LayoutDashboard />, exact: true },
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
      <SidebarIdentity
        to="/promoter"
        name={promoterName}
        logoUrl={promoter?.profile_image_url}
        subtitle={`${t('sidebar.space.promoter')} · ${scopeName}`}
      />

      <SidebarContent>
        {groups.map((group, i) => (
          <NavGroup key={`promoter-group-${i}`} {...group} />
        ))}
      </SidebarContent>

      <SidebarFooter>

        <SidebarProThemeSwitch />
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
