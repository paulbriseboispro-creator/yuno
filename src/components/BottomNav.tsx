import { Search, Heart, ShoppingBag, User, Building2, LucideIcon } from 'lucide-react';
import { NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';
import { motion, LayoutGroup, useReducedMotion } from 'framer-motion';
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

// Lozenge de verre « liquid glass » (inspiré de la bottom nav Instagram iOS) :
// une pastille frostée qui glisse en ressort d'un onglet à l'autre via un
// partage de layout framer (layoutId). Verre neutre + halo rouge Yuno pour
// rester sur la marque tout en gardant l'icône rouge active bien lisible.
const GLASS_PILL_STYLE: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.045) 100%)',
  border: '1px solid rgba(255,255,255,0.16)',
  boxShadow:
    'inset 0 1px 0.5px rgba(255,255,255,0.30), inset 0 -8px 14px rgba(0,0,0,0.12), 0 3px 10px rgba(0,0,0,0.28), 0 0 16px rgba(232,25,44,0.22)',
};

export function BottomNav({ mode = 'fixed' }: { mode?: 'fixed' | 'docked' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement | null>(null);
  const { currentVenueSlug } = useVenueNav();
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  // Surface haute fréquence (onglets tapés des dizaines de fois/jour) → press
  // subtil, état par la couleur. Reduced-motion → léger fondu, pas de scale.
  const tabTap = reduceMotion ? { opacity: 0.6 } : { scale: 0.94 };
  // Le lozenge glisse en ressort ; reduced-motion → apparition en fondu, sans
  // déplacement (layoutId désactivé plus bas).
  const pillTransition = reduceMotion
    ? { duration: 0.2 }
    : { type: 'spring' as const, stiffness: 480, damping: 34, mass: 0.7 };

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
            // Verre plus translucide qu'avant (0.92 → 0.74) : le flou lit enfin
            // comme du givre, façon capsule Instagram. saturate ravive le fond.
            background: 'rgba(12,12,14,0.74)',
            backdropFilter: 'blur(28px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.08), 0 -1px 0 rgba(255,255,255,0.04), 0 -4px 24px rgba(0,0,0,0.6)',
          }}
        >
          <LayoutGroup id="bottom-nav">
          {navItems.map((item) => {
            if (item.type === 'club') {
              return (
                <button
                  key="club"
                  onClick={handleClubClick}
                  className="relative flex flex-col items-center outline-none min-w-[52px]"
                >
                  <motion.div
                    className="flex items-center justify-center rounded-full h-[48px] w-[48px] bg-primary"
                    whileTap={tabTap}
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
                    whileTap={tabTap}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    {/* Lozenge de verre actif — glisse d'un onglet à l'autre (layoutId) */}
                    {isActive && (
                      <motion.span
                        layoutId={reduceMotion ? undefined : 'bottomnav-glass'}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-xl pointer-events-none"
                        style={GLASS_PILL_STYLE}
                        initial={reduceMotion ? { opacity: 0 } : false}
                        animate={reduceMotion ? { opacity: 1 } : undefined}
                        transition={pillTransition}
                      />
                    )}
                    {/* Red blur glow — desktop hover-capable only (évite le hover collant au tap) */}
                    {!isActive && (
                      <span className="absolute inset-0 rounded-xl bg-primary/0 [@media(hover:hover)]:group-hover:bg-primary/15 blur-lg transition-colors duration-300 pointer-events-none" />
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
          </LayoutGroup>
        </div>
      </div>
    </nav>
  );
}
