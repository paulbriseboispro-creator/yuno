import { useNavigate, useLocation } from 'react-router-dom';
import { useCallback, useEffect } from 'react';

/**
 * Deterministic hierarchical back navigation.
 * Always returns the logical parent route — never uses browser history.
 */

const MAIN_TABS = ['/', '/favorites', '/my-orders', '/profile'];

function getParentPath(pathname: string): string | null {
  // Main tabs — no back arrow
  if (MAIN_TABS.includes(pathname)) return null;

  // /club/:slug/event/:id/tickets/:roundId      → /club/:slug/event/:id
  // /club/:slug/event/:id/table/:packId         → /club/:slug/event/:id
  // /club/:slug/event/:id/guestlist             → /club/:slug/event/:id
  // /club/:slug/event/:id/guestlist-checkout    → /club/:slug/event/:id
  const checkoutMatch = pathname.match(/^\/club\/([^/]+)\/event\/([^/]+)\/(tickets|table|guestlist-checkout|guestlist)/);
  if (checkoutMatch) return `/club/${checkoutMatch[1]}/event/${checkoutMatch[2]}`;

  // /club/:slug/event/:id → /club/:slug
  const eventMatch = pathname.match(/^\/club\/([^/]+)\/event\/[^/]+$/);
  if (eventMatch) return `/club/${eventMatch[1]}`;

  // /club/:slug/drinks/:cat → /club/:slug
  const drinksMatch = pathname.match(/^\/club\/([^/]+)\/drinks\/[^/]+$/);
  if (drinksMatch) return `/club/${drinksMatch[1]}`;

  // /club/:slug → map or explore depending on origin
  if (/^\/club\/[^/]+$/.test(pathname)) {
    const origin = sessionStorage.getItem('yuno_club_origin');
    return origin === 'map' ? '/map' : '/';
  }

  // Standalone event detail (organizer-led) → organizer profile if known, else home.
  if (/^\/event\/[^/]+$/.test(pathname)) {
    const orgSlug = sessionStorage.getItem('yuno_event_origin_org_slug');
    return orgSlug ? `/o/${orgSlug}` : '/';
  }

  // /o/:slug → home (never back to event to avoid infinite loop)
  if (/^\/o\/[^/]+$/.test(pathname)) return '/';

  // /dj/:slug → /
  if (/^\/dj\/[^/]+$/.test(pathname)) return '/';

  // /legal/:section → /settings
  if (/^\/legal\/[^/]+$/.test(pathname)) return '/settings';

  // /settings → /profile
  if (pathname === '/settings') return '/profile';

  // /auth → /
  if (pathname === '/auth') return '/';

  // /order-confirmation → /my-orders
  if (pathname === '/order-confirmation') return '/my-orders';

  // /order-qr or /order/:id/qr → /my-orders
  if (pathname.startsWith('/order-qr') || /^\/order\/[^/]+\/qr$/.test(pathname)) return '/my-orders';

  // /cart → stored last content page or /
  if (pathname === '/cart') {
    return sessionStorage.getItem('yuno_last_content_page') || '/';
  }

  // /verify-payment, /verify-ticket-payment, /verify-table-payment → /my-orders
  if (pathname.startsWith('/verify')) return '/my-orders';

  // /mfa-setup → /settings
  if (pathname === '/mfa-setup') return '/settings';

  // /assistant → /profile
  if (pathname === '/assistant') return '/profile';

  // Default fallback
  return '/';
}

export function useSmartBack() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Track last content page for cart/checkout back navigation
  useEffect(() => {
    const isContentPage = /^\/club\//.test(pathname) || /^\/dj\//.test(pathname) || pathname === '/';
    if (isContentPage) {
      sessionStorage.setItem('yuno_last_content_page', pathname);
    }
    // Clear club origin when leaving club pages
    if (!/^\/club\//.test(pathname)) {
      sessionStorage.removeItem('yuno_club_origin');
    }
  }, [pathname]);

  const parentPath = getParentPath(pathname);

  const goBack = useCallback(() => {
    if (parentPath) {
      navigate(parentPath);
    }
  }, [navigate, parentPath]);

  return {
    canGoBack: parentPath !== null,
    goBack,
    parentPath,
  };
}
