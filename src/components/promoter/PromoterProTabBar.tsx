import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CalendarDays, Link2, ClipboardList, ScanLine, ListTree, User,
  type LucideIcon,
} from 'lucide-react';
import { BottomNavBar, type BottomNavBarItem } from '@/components/ui/bottom-nav-bar';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { haptics } from '@/lib/haptics';
import { isProApp } from '@/lib/native';

/**
 * Navigation de l'espace promoteur dans l'app Yuno Pro — pensée pour la
 * GESTION LIVE d'une soirée : promouvoir (liens), remplir (guest list),
 * faire entrer (scan). Les règlements, le linktree et le profil sont de la
 * gestion à froid : ils restent dans le tiroir.
 *
 * La barre s'adapte aux droits réels du profil sélectionné : Guest List et
 * Scan n'apparaissent que si le club les a ouverts ; les créneaux libérés
 * reviennent au Linktree puis au Profil, pour que la barre porte toujours
 * cinq destinations utiles.
 *
 * Rendue uniquement dans l'app Pro : sur le web et dans l'app client, la
 * sidebar reste la seule navigation.
 */
export function PromoterProTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { canScan, hasGuestListAccess } = usePromoterData();

  if (!isProApp()) return null;

  const path = location.pathname.replace(/\/+$/, '') || '/';

  const candidates: Array<{ key: string; label: string; icon: LucideIcon; path: string; show: boolean }> = [
    { key: 'overview', label: tt('Aperçu', 'Overview', 'Resumen'), icon: LayoutDashboard, path: '/promoter', show: true },
    { key: 'events', label: tt('Soirées', 'Events', 'Eventos'), icon: CalendarDays, path: '/promoter/events', show: true },
    { key: 'links', label: tt('Liens', 'Links', 'Enlaces'), icon: Link2, path: '/promoter/links', show: true },
    { key: 'guestlist', label: 'Guests', icon: ClipboardList, path: '/promoter/guestlist', show: hasGuestListAccess },
    { key: 'scan', label: 'Scan', icon: ScanLine, path: '/promoter/scan', show: canScan },
    // Remplissage quand les outils de porte sont fermés — la barre garde 5 entrées.
    { key: 'linktree', label: 'Linktree', icon: ListTree, path: '/promoter/linktree', show: true },
    { key: 'profile', label: tt('Profil', 'Profile', 'Perfil'), icon: User, path: '/promoter/profile', show: true },
  ];

  const items: BottomNavBarItem[] = candidates
    .filter(c => c.show)
    .slice(0, 5)
    .map(({ path: target, show: _show, ...item }) => ({
      ...item,
      isActive: path === target,
      onSelect: () => {
        haptics.selection();
        // Retaper l'onglet courant remonte en haut plutôt que de rejouer une
        // navigation vers la page déjà affichée.
        if (path === target) window.scrollTo({ top: 0, behavior: 'smooth' });
        else navigate(target);
      },
    }));

  return (
    // BottomNavBar porte déjà le repère <nav> : ce conteneur reste un div, sinon
    // deux repères de navigation imbriqués se disputent le même rôle.
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex justify-center px-3"
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.625rem)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ pointerEvents: 'auto' }}>
        <BottomNavBar items={items} className="max-w-[95vw]" />
      </div>
    </div>
  );
}
