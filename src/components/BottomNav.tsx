import { Search, Heart, ShoppingBag, User, Building2, LucideIcon } from 'lucide-react';
import { NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useVenueNav } from '@/contexts/VenueNavContext';
import { useLanguage } from '@/contexts/LanguageContext';

interface RegularNavItem {
  type: 'link';
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}

interface ClubNavItem {
  type: 'club';
}

type NavItem = RegularNavItem | ClubNavItem;

export function BottomNav({ mode = 'fixed' }: { mode?: 'fixed' | 'docked' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement | null>(null);
  const { currentVenueSlug } = useVenueNav();
  const { t } = useLanguage();

  // Preserve --bottom-nav-height CSS variable
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

  const isClubActive = location.pathname.startsWith('/club/') || location.pathname === '/map';

  const handleClubClick = () => {
    if (currentVenueSlug) {
      const venueHome = `/club/${currentVenueSlug}`;
      if (location.pathname === venueHome) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        navigate(venueHome);
      }
    } else {
      navigate('/map');
    }
  };

  const navItems: NavItem[] = [
    { type: 'link', to: '/', icon: Search, label: t('nav.exploreTab') || 'Explorer', end: true },
    { type: 'link', to: '/favorites', icon: Heart, label: t('nav.favoritesTab') || 'Favoris' },
    { type: 'club' },
    { type: 'link', to: '/my-orders', icon: ShoppingBag, label: t('nav.ordersTab') || 'Commandes' },
    { type: 'link', to: '/profile', icon: User, label: t('nav.profileTab') || 'Profil' },
  ];

  return (
    <nav
      ref={navRef}
      aria-label="Navigation principale"
      className={cn(
        mode === 'fixed' ? 'fixed bottom-0 left-0 right-0' : 'w-full shrink-0',
        'z-50'
      )}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        pointerEvents: 'none',
      }}
    >
        <div
          className="mx-auto max-w-lg px-3 pb-2"
          style={{ pointerEvents: 'auto' }}
        >
        <div
          className="relative flex items-end justify-around rounded-2xl px-2 pt-1.5 pb-1.5"
          style={{
            background: 'rgba(14,14,16,0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 -1px 0 rgba(255,255,255,0.06), 0 -4px 24px rgba(0,0,0,0.6)',
          }}
        >
          {navItems.map((item, idx) => {
            if (item.type === 'club') {
              return (
                <button
                  key="club"
                  onClick={handleClubClick}
                  className="relative flex flex-col items-center outline-none min-w-[52px]"
                >
                  <motion.div
                    className="flex items-center justify-center rounded-full h-[48px] w-[48px] bg-primary"
                    whileTap={{ scale: 0.88 }}
                    whileHover={{ scale: 1.1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    style={{
                      marginTop: '-22px',
                      boxShadow: isClubActive
                        ? '0 0 18px rgba(255,46,46,0.5), 0 4px 12px rgba(0,0,0,0.4)'
                        : '0 0 10px rgba(255,46,46,0.25), 0 4px 12px rgba(0,0,0,0.4)',
                    }}
                  >
                    <Building2 className="h-[22px] w-[22px] text-primary-foreground" strokeWidth={2.2} />
                  </motion.div>
                  <span
                    className={cn(
                      "font-mono leading-tight mt-1",
                      isClubActive ? "text-primary font-bold" : "text-muted-foreground font-medium"
                    )}
                    style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase' }}
                  >
                    {t('nav.club') || 'Club'}
                  </span>
                </button>
              );
            }

            return (
              <RouterNavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="group relative flex flex-col items-center min-w-[52px]"
              >
                {({ isActive }) => (
                  <motion.div
                    className="relative flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl"
                    whileTap={{ scale: 0.88 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    {/* Red blur glow on hover (only when not active) */}
                    {!isActive && (
                      <span className="absolute inset-0 rounded-xl bg-primary/0 group-hover:bg-primary/15 blur-lg transition-all duration-300 pointer-events-none" />
                    )}
                    <item.icon
                      className={cn(
                        "h-[22px] w-[22px] transition-colors duration-200 relative z-10",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary/80"
                      )}
                      strokeWidth={isActive ? 2.4 : 1.8}
                    />
                    <span
                      className={cn(
                        "font-mono leading-tight mt-0.5 transition-colors duration-200 relative z-10",
                        isActive ? "text-primary font-bold" : "text-muted-foreground group-hover:text-primary/80 font-medium"
                      )}
                      style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase' }}
                    >
                      {item.label}
                    </span>
                  </motion.div>
                )}
              </RouterNavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
