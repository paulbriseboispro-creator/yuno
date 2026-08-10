import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Link2, Wallet, User } from 'lucide-react';
import { BottomNavBar, type BottomNavBarItem } from '@/components/ui/bottom-nav-bar';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { haptics } from '@/lib/haptics';
import { isProApp } from '@/lib/native';

/**
 * Navigation de l'espace promoteur dans l'app Yuno Pro.
 *
 * Sur le web, l'espace se pilote par la sidebar. Sur un téléphone, cette
 * sidebar devient un tiroir qu'il faut ouvrir à chaque saut — inacceptable
 * comme navigation PRINCIPALE d'une app native. Cette barre pose les cinq
 * destinations qui portent le quotidien d'un promoteur (aperçu, soirées,
 * liens de vente, règlements, profil) à portée de pouce ; le tiroir reste
 * accessible depuis l'en-tête pour le reste (linktree, scan, guest list,
 * équipe, déconnexion).
 *
 * Rendue uniquement dans l'app Pro : sur le web et dans l'app client, la
 * sidebar reste la seule navigation.
 */
export function PromoterProTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  if (!isProApp()) return null;

  const path = location.pathname.replace(/\/+$/, '') || '/';

  const items: BottomNavBarItem[] = [
    { key: 'overview', label: tt('Aperçu', 'Overview', 'Resumen'), icon: LayoutDashboard, path: '/promoter' },
    { key: 'events', label: tt('Soirées', 'Events', 'Eventos'), icon: CalendarDays, path: '/promoter/events' },
    { key: 'links', label: tt('Liens', 'Links', 'Enlaces'), icon: Link2, path: '/promoter/links' },
    { key: 'payments', label: tt('Paiements', 'Payments', 'Pagos'), icon: Wallet, path: '/promoter/payments' },
    { key: 'profile', label: tt('Profil', 'Profile', 'Perfil'), icon: User, path: '/promoter/profile' },
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
