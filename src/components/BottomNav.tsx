import { Search, Heart, ShoppingBag, User, Building2, LucideIcon } from 'lucide-react';
import { NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';
import { motion, LayoutGroup, useReducedMotion } from 'framer-motion';
import { useVenueNav } from '@/contexts/VenueNavContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';

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

// Lozenge « liquid glass » (bottom nav Instagram iOS 26) qui glisse en ressort
// d'un onglet à l'autre via le partage de layout framer (layoutId). Verre rouge
// Yuno : rim spéculaire blanc en haut → corps teinté rouge → halo rouge autour.
// L'icône active passe en blanc pour ressortir franchement sur le verre rouge.
const GLASS_PILL_STYLE: React.CSSProperties = {
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(232,25,44,0.34) 48%, rgba(232,25,44,0.16) 100%)',
  border: '1px solid rgba(255,255,255,0.30)',
  boxShadow:
    'inset 0 1.5px 0.5px rgba(255,255,255,0.60), inset 0 -8px 14px rgba(232,25,44,0.22), 0 4px 14px rgba(0,0,0,0.35), 0 0 22px rgba(232,25,44,0.45)',
  backdropFilter: 'blur(8px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(8px) saturate(1.5)',
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
  const tabTap = reduceMotion ? { opacity: 0.6 } : { scale: 0.92 };
  // Le lozenge glisse en ressort ; reduced-motion → apparition en fondu, sans
  // déplacement (layoutId désactivé plus bas).
  const pillTransition = reduceMotion
    ? { duration: 0.2 }
    : { type: 'spring' as const, stiffness: 460, damping: 32, mass: 0.7 };

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
  // Mode Live : le bouton central porte un badge LIVE (statique — pas
  // d'animation en boucle, AMOLED/batterie) tant que la soirée est en cours.
  const { isLive } = useLiveMode();

  const handleClubClick = () => {
    if (isLive) {
      navigate('/live');
      return;
    }
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
          className="mx-auto max-w-lg px-3 pb-2.5"
          style={{ pointerEvents: 'auto' }}
        >
        <div
          className="relative flex items-end justify-around rounded-[26px] px-2 pt-1.5 pb-1.5"
          style={{
            // Capsule de verre flottante, façon liquid glass iOS 26 : très
            // translucide (0.58) + gros flou + saturation → le fond défile,
            // givré, derrière la barre. Rim spéculaire haut + ombre portée.
            background: 'rgba(14,14,18,0.58)',
            backdropFilter: 'blur(34px) saturate(1.9)',
            WebkitBackdropFilter: 'blur(34px) saturate(1.9)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 1px rgba(0,0,0,0.4), 0 10px 34px rgba(0,0,0,0.55), 0 2px 10px rgba(0,0,0,0.4)',
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
                        ? '0 0 22px rgba(255,46,46,0.6), 0 4px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)'
                        : '0 0 12px rgba(255,46,46,0.3), 0 4px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)',
                    }}
                  >
                    <Building2 className="h-[22px] w-[22px] text-primary-foreground" strokeWidth={2.2} />
                    {isLive && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full px-1.5 font-mono font-bold uppercase"
                        style={{
                          fontSize: 7.5,
                          letterSpacing: '0.1em',
                          lineHeight: '12px',
                          color: '#FFFFFF',
                          background: '#0A0A0A',
                          border: '1px solid #E8192C',
                        }}
                      >
                        LIVE
                      </span>
                    )}
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
                    className="relative flex flex-col items-center gap-0.5 py-1.5 px-2.5 rounded-2xl"
                    whileTap={tabTap}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    {/* Lozenge de verre actif — glisse d'un onglet à l'autre (layoutId) */}
                    {isActive && (
                      <motion.span
                        layoutId={reduceMotion ? undefined : 'bottomnav-glass'}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-2xl pointer-events-none"
                        style={GLASS_PILL_STYLE}
                        initial={reduceMotion ? { opacity: 0 } : false}
                        animate={reduceMotion ? { opacity: 1 } : undefined}
                        transition={pillTransition}
                      />
                    )}
                    {/* Red blur glow — desktop hover-capable only (évite le hover collant au tap) */}
                    {!isActive && (
                      <span className="absolute inset-0 rounded-2xl bg-primary/0 [@media(hover:hover)]:group-hover:bg-primary/15 blur-lg transition-colors duration-300 pointer-events-none" />
                    )}
                    <item.icon
                      className={cn(
                        "h-[22px] w-[22px] transition-colors duration-200 relative z-10",
                        isActive ? "text-white" : "text-muted-foreground group-hover:text-primary/80"
                      )}
                      strokeWidth={isActive ? 2.5 : 1.8}
                    />
                    <span
                      className={cn(
                        "font-mono leading-tight mt-0.5 transition-colors duration-200 relative z-10",
                        isActive ? "text-white font-bold" : "text-muted-foreground group-hover:text-primary/80 font-medium"
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
