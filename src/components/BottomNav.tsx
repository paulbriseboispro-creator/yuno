import { Search, Heart, ShoppingBag, User, Building2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useVenueNav } from '@/contexts/VenueNavContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { BottomNavBar, type BottomNavBarItem } from '@/components/ui/bottom-nav-bar';

export function BottomNav({ mode = 'fixed' }: { mode?: 'fixed' | 'docked' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement | null>(null);
  const { currentVenueSlug } = useVenueNav();
  const { t } = useLanguage();
  const { isLive } = useLiveMode();

  // Preserve --bottom-nav-height CSS variable (les pages décalent leur contenu
  // via cette variable / pb-28).
  useEffect(() => {
    if (mode !== 'fixed') return;
    const update = () => {
      const el = navRef.current;
      if (!el) return;
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty('--bottom-nav-height', `${h}px`);
      }
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [mode]);

  const path = location.pathname;
  const isClubActive =
    path.startsWith('/club/') || path === '/map' || (isLive && path === '/live');

  const handleClubClick = () => {
    if (isLive) {
      navigate('/live');
      return;
    }
    if (currentVenueSlug) {
      const venueHome = `/club/${currentVenueSlug}`;
      if (path === venueHome) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        navigate(venueHome);
      }
    } else {
      navigate('/map');
    }
  };

  const items: BottomNavBarItem[] = [
    {
      key: 'explore',
      label: t('nav.exploreTab') || 'Explorer',
      icon: Search,
      isActive: path === '/',
      onSelect: () => navigate('/'),
    },
    {
      key: 'favorites',
      label: t('nav.favoritesTab') || 'Favoris',
      icon: Heart,
      isActive: path.startsWith('/favorites'),
      onSelect: () => navigate('/favorites'),
    },
    {
      key: 'club',
      label: t('nav.club') || 'Club',
      icon: Building2,
      isActive: isClubActive,
      onSelect: handleClubClick,
      dot: isLive,
    },
    {
      key: 'orders',
      label: t('nav.ordersTab') || 'Commandes',
      icon: ShoppingBag,
      isActive: path.startsWith('/my-orders'),
      onSelect: () => navigate('/my-orders'),
    },
    {
      key: 'profile',
      label: t('nav.profileTab') || 'Profil',
      icon: User,
      isActive: path.startsWith('/profile'),
      onSelect: () => navigate('/profile'),
    },
  ];

  return (
    <nav
      ref={navRef}
      aria-label="Navigation principale"
      className={cn(
        mode === 'fixed' ? 'fixed bottom-0 left-0 right-0' : 'w-full shrink-0',
        'z-50',
      )}
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.625rem)',
        pointerEvents: 'none',
      }}
    >
      <div className="mx-auto max-w-lg px-3" style={{ pointerEvents: 'auto' }}>
        <BottomNavBar items={items} className="w-full" />
      </div>
    </nav>
  );
}
