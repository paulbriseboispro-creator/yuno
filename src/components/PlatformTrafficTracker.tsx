import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initPlatformTrafficLifecycle, trackPlatformPageView } from '@/lib/platformTraffic';
import { captureFbclidFromUrl } from '@/lib/metaPixel';

/**
 * Mesure d'audience plateforme : une vue par changement de route, sur toute
 * surface publique/cliente (voir src/lib/platformTraffic.ts pour le périmètre
 * et le modèle sans cookie). Monté une seule fois dans le Router, à côté de
 * PushClickTracker. Ne rend rien.
 */
export default function PlatformTrafficTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    initPlatformTrafficLifecycle();
  }, []);

  // `search` volontairement hors deps : un changement de query seul (filtre,
  // onglet) n'est pas une nouvelle page vue.
  useEffect(() => {
    trackPlatformPageView(pathname, search);
    // Identifiant de clic Meta (?fbclid=) : gardé en mémoire, persisté seulement
    // après consentement publicité (src/lib/metaPixel.ts).
    captureFbclidFromUrl();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
