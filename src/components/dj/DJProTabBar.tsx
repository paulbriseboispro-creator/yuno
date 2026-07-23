import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Inbox, Wallet, User } from 'lucide-react';
import { BottomNavBar, type BottomNavBarItem } from '@/components/ui/bottom-nav-bar';
import { useLanguage } from '@/contexts/LanguageContext';
import { haptics } from '@/lib/haptics';
import { isProApp } from '@/lib/native';

/**
 * Navigation de l'espace DJ dans l'app Yuno Pro.
 *
 * Sur le web, l'espace DJ se pilote par la sidebar : neuf sections y tiennent
 * sans effort. Sur un téléphone, cette sidebar devient un tiroir qu'il faut
 * ouvrir à chaque saut — inacceptable comme navigation PRINCIPALE d'une app
 * native. Cette barre pose les cinq destinations qui portent le quotidien d'un
 * DJ (aperçu, planning, demandes de booking, cachets, profil) à portée de
 * pouce ; le tiroir reste accessible depuis l'en-tête pour le reste
 * (statistiques, liens, notifications, équipe, aide, déconnexion).
 *
 * Rendue uniquement dans l'app Pro : sur le web et dans l'app client, la
 * sidebar reste la seule navigation.
 */
export function DJProTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();

  if (!isProApp()) return null;

  const path = location.pathname.replace(/\/+$/, '') || '/';

  const items: BottomNavBarItem[] = [
    { key: 'overview', label: t('dj.tab.overview'), icon: LayoutDashboard, path: '/dj' },
    { key: 'planning', label: t('dj.tab.planning'), icon: CalendarDays, path: '/dj/planning' },
    { key: 'bookings', label: t('dj.tab.bookings'), icon: Inbox, path: '/dj/bookings' },
    { key: 'payments', label: t('dj.tab.payments'), icon: Wallet, path: '/dj/payments' },
    { key: 'profile', label: t('dj.tab.profile'), icon: User, path: '/dj/profile' },
  ].map(({ path: target, ...item }) => ({
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
