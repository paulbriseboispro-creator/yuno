import { useLocation } from 'react-router-dom';
import { AppSkeleton } from '@/components/DashboardSkeleton';
import { shouldShowLanding } from '@/lib/webHome';
import { ClientPageSkeleton } from './ClientPageSkeleton';
import { ExploreSkeleton } from './ExploreSkeleton';
import { VenuePageSkeleton } from './VenuePageSkeleton';
import { EventDetailsSkeleton } from './EventDetailsSkeleton';
import { TicketSelectionSkeleton } from './TicketSelectionSkeleton';
import { TicketCheckoutSkeleton } from './TicketCheckoutSkeleton';
import { TableCheckoutSkeleton } from './TableCheckoutSkeleton';
import { GuestListSignupSkeleton } from './GuestListSignupSkeleton';
import { GuestListCheckoutSkeleton } from './GuestListCheckoutSkeleton';
import { EventWaitlistSkeleton } from './EventWaitlistSkeleton';
import { CategoryDrinksSkeleton } from './CategoryDrinksSkeleton';
import { DJPublicSkeleton } from './DJPublicSkeleton';
import { DJEpkSkeleton } from './DJEpkSkeleton';
import { DJPastEventsSkeleton } from './DJPastEventsSkeleton';
import { OrganizerProfileSkeleton } from './OrganizerProfileSkeleton';
import { FavoritesPageSkeleton } from './FavoritesPageSkeleton';
import { OrdersSkeleton } from './OrdersSkeleton';
import { ProfileSkeleton } from './ProfileSkeleton';
import { CartSkeleton } from './CartSkeleton';
import { LoyaltyHubSkeleton } from './LoyaltyHubSkeleton';
import { OrderQRSkeleton } from './OrderQRSkeleton';
import { ClickCollectSkeleton } from './ClickCollectSkeleton';
import { OrderConfirmationSkeleton } from './OrderConfirmationSkeleton';
import { PostCheckoutUpsellSkeleton } from './PostCheckoutUpsellSkeleton';
import { LiveModeSkeleton } from './LiveModeSkeleton';
import { VipMenuSkeleton } from './VipMenuSkeleton';
import { WelcomeSkeleton } from './WelcomeSkeleton';

/* ============================================================
   RouteSkeleton — fallback Suspense conscient de l'URL.
   ------------------------------------------------------------
   Quand le chunk JS d'une page est encore en vol (démarrage à froid,
   lien partagé, push, bio Instagram), on dessine déjà LA silhouette de
   la page demandée — la même que la page affichera ensuite pendant sa
   requête. Avant : un dashboard pro avec sidebar (AppSkeleton) pour
   n'importe quelle fiche soirée ouverte depuis un lien. Le squelette
   pro reste réservé aux surfaces pro. Le tout entre en fondu après 90 ms
   (.yuno-skel-enter) : un chunk préchauffé ne fait clignoter personne.
   ============================================================ */

const PRO_PREFIXES = [
  '/owner', '/organizer-app', '/promoter', '/agency-app', '/agency/', '/affiliate',
  '/admin', '/barman', '/bouncer', '/cloakroom', '/vip-host', '/manager', '/staff',
  '/pro', '/dj/onboarding', '/dj/team',
];
const DJ_DASHBOARD = new Set(['planning', 'analytics', 'audience', 'payments', 'bookings', 'notifications', 'team', 'help', 'profile']);

function isProPath(path: string): boolean {
  if (PRO_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || (p.endsWith('/') && path.startsWith(p)))) {
    // /affiliate-event et /affiliate-venue sont des pages publiques.
    return !path.startsWith('/affiliate-event') && !path.startsWith('/affiliate-venue');
  }
  if (path === '/dj') return true;
  const dj = path.match(/^\/dj\/([^/]+)\/?$/);
  if (dj && DJ_DASHBOARD.has(dj[1])) return true;
  return false;
}

/** Suffixe du tunnel d'achat après l'identifiant de la soirée. */
function eventLeaf(rest: string[]): JSX.Element {
  switch (rest[0]) {
    case undefined: return <EventDetailsSkeleton />;
    case 'billets': return <TicketSelectionSkeleton />;
    case 'tickets': return <TicketCheckoutSkeleton />;
    case 'table': return <TableCheckoutSkeleton />;
    case 'guestlist': return <GuestListSignupSkeleton />;
    case 'guestlist-checkout': return <GuestListCheckoutSkeleton />;
    case 'waitlist': return <EventWaitlistSkeleton />;
    default: return <ClientPageSkeleton />;
  }
}

function pickRouteSkeleton(pathname: string): JSX.Element {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (isProPath(path)) return <AppSkeleton />;

  const seg = path.split('/').filter(Boolean);
  const [a, b, c] = seg;

  if (path === '/') return shouldShowLanding() ? <ClientPageSkeleton bare /> : <ExploreSkeleton />;
  if (a === 'explore') return <ExploreSkeleton />;

  if (a === 'club' && b) {
    if (!c) return <VenuePageSkeleton />;
    if (c === 'event' && seg[3]) return eventLeaf(seg.slice(4));
    if (c === 'drinks') return <CategoryDrinksSkeleton />;
    return <ClientPageSkeleton />;
  }
  if (a === 'events' && b && c) return eventLeaf(seg.slice(3));
  if (a === 'event' && b) return eventLeaf(seg.slice(2));
  if (a === 'dj' && b) {
    if (c === 'epk') return <DJEpkSkeleton />;
    if (c === 'past') return <DJPastEventsSkeleton />;
    return <DJPublicSkeleton />;
  }
  if (a === 'o' && b) return <OrganizerProfileSkeleton />;

  switch (a) {
    case 'favorites': return <FavoritesPageSkeleton />;
    case 'my-orders':
    case 'my-tickets': return <OrdersSkeleton />;
    case 'profile': return <ProfileSkeleton />;
    case 'cart': return <CartSkeleton />;
    case 'loyalty': return <LoyaltyHubSkeleton />;
    case 'click-collect': return <ClickCollectSkeleton />;
    case 'order-confirmation': return <OrderConfirmationSkeleton />;
    case 'live': return <LiveModeSkeleton />;
    case 'vip-menu': return <VipMenuSkeleton />;
    case 'welcome': return <WelcomeSkeleton />;
    case 'order':
      if (b === 'upsell') return <PostCheckoutUpsellSkeleton />;
      if (c === 'qr') return <OrderQRSkeleton />;
      return <ClientPageSkeleton />;
    // Pages sans liste (carte, landing, auth, vérification de paiement,
    // bio Instagram…) : seul le header, jamais des lignes qui ne viendront pas.
    case 'map':
    case 'home':
    case 'links':
    case 'auth':
    case 'verify-payment':
    case 'verify-ticket-payment':
    case 'verify-table-payment':
    case 'join':
    case 'preview':
    case 'claim':
    case 'l':
    case 'r':
      return <ClientPageSkeleton bare />;
    default:
      return <ClientPageSkeleton />;
  }
}

export function RouteSkeleton() {
  const { pathname } = useLocation();
  return <div className="yuno-skel-enter">{pickRouteSkeleton(pathname)}</div>;
}
