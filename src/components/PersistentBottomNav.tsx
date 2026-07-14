import { createContext, useCallback, useContext, useLayoutEffect, useId, useMemo, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { BottomNav } from '@/components/BottomNav';
import { isProApp } from '@/lib/native';

/* ============================================================
   PersistentBottomNav — la barre d'onglets vit AU-DESSUS du <Routes>.

   Avant : chaque page rendait son propre <BottomNav />. Résultat, à chaque
   navigation la barre se démontait puis se remontait — le ressort du label
   actif rejouait, et surtout elle DISPARAISSAIT tant que la page cible
   affichait son skeleton de chargement (Profil, Commandes, EventDetails...).
   D'où le sentiment de saccade.

   Maintenant : une seule instance, montée une fois pour toutes, qui survit
   aux changements de route. Sa visibilité se déduit de l'URL (ALLOWLIST) et
   les pages qui remplacent la barre par autre chose (CTA d'achat collant,
   nav « docked » sur les cartes plein écran) la masquent via
   useSuppressBottomNav().
   ============================================================ */

/* Routes B2C qui affichent la barre fixe. `end: true` par défaut dans
   matchPath : /club/:slug ne matche donc pas /club/:slug/promo, et
   /dj/:slug ne matche pas /dj/:slug/epk — les tunnels d'achat, l'auth,
   les dashboards pro et le staff restent sans barre. */
const NAV_ROUTES = [
  '/',
  '/events',
  '/clubs',
  '/djs',
  '/tickets',
  '/vip-tables',
  '/order-drinks',
  '/favorites',
  '/my-orders',
  '/profile',
  '/loyalty',
  '/map',
  '/welcome',
  '/club/:slug',
  '/club/:slug/drinks/:category',
  '/club/:slug/event/:eventId',
  '/events/:host/:eventSlug',
  '/dj/:slug',
  '/dj/:slug/past',
  '/o/:slug',
  '/affiliate-venue/:slug',
  '/affiliate-event/:slug',
] as const;

type SuppressionApi = {
  suppress: (id: string) => void;
  release: (id: string) => void;
};

const SuppressionContext = createContext<SuppressionApi | null>(null);
const SuppressedCountContext = createContext(0);

export function BottomNavVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [suppressors, setSuppressors] = useState<string[]>([]);

  const api = useMemo<SuppressionApi>(() => ({
    suppress: (id) => setSuppressors((prev) => (prev.includes(id) ? prev : [...prev, id])),
    release: (id) => setSuppressors((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : prev)),
  }), []);

  return (
    <SuppressionContext.Provider value={api}>
      <SuppressedCountContext.Provider value={suppressors.length}>
        {children}
      </SuppressedCountContext.Provider>
    </SuppressionContext.Provider>
  );
}

/**
 * Masque la barre globale tant que `active` est vrai. À utiliser par les pages
 * qui posent leur propre barre d'action à cet endroit de l'écran :
 * un CTA d'achat collant (EventDetails, AffiliateEventPage) ou une nav
 * « docked » dans un layout plein écran (ClubMap, Welcome en vue carte).
 *
 * useLayoutEffect (et non useEffect) : la bascule doit être commitée AVANT le
 * paint, sinon on voit une frame avec les deux barres superposées.
 *
 * Pendant une navigation (v7_startTransition), l'ancienne page reste montée
 * le temps que le chunk cible charge — d'où le compteur de suppresseurs
 * plutôt qu'un booléen : deux pages peuvent coexister un instant.
 */
export function useSuppressBottomNav(active: boolean) {
  const api = useContext(SuppressionContext);
  const id = useId();

  useLayoutEffect(() => {
    if (!api || !active) return;
    api.suppress(id);
    return () => api.release(id);
  }, [api, active, id]);
}

export function PersistentBottomNav() {
  const { pathname } = useLocation();
  const suppressedCount = useContext(SuppressedCountContext);

  // L'app staff (Yuno Pro) n'a pas de surface B2C.
  if (isProApp()) return null;
  if (suppressedCount > 0) return null;

  const onNavRoute = NAV_ROUTES.some((pattern) => matchPath(pattern, pathname));
  if (!onNavRoute) return null;

  return <BottomNav />;
}
