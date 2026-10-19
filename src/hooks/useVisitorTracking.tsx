import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { v4 as uuidv4 } from 'uuid';
import { hasAudienceMeasurement, useConsent } from '@/lib/consent';
import { categorizeReferrer, entryReferrer, extractDomain } from '@/lib/referrerCategory';
import { VISIT_SESSION_KEY } from '@/lib/eventFunnel';

// Clé partagée avec le tunnel de la soirée (src/lib/eventFunnel.ts), qui la
// transmet au serveur pour poser l'étape de la visite.
const SESSION_STORAGE_KEY = VISIT_SESSION_KEY;
const VENUE_STORAGE_KEY = 'yuno_venue_id';
const EVENT_STORAGE_KEY = 'yuno_event_id';
const ORG_STORAGE_KEY = 'yuno_org_id';
const SESSION_START_KEY = 'yuno_session_start';
const VISITOR_ID_KEY = 'yuno_visitor_id';
const VISIT_NUMBER_KEY = 'yuno_visit_number';

function detectDeviceType(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function detectEntryPageType(path: string): string {
  if (/^\/event\//.test(path) || /^\/events\//.test(path)) return 'event_page';
  if (/^\/club\//.test(path) || /^\/venue\//.test(path)) return 'venue_page';
  if (/^\/dj\//.test(path)) return 'dj_profile';
  if (/^\/o\//.test(path) || /^\/organizer\//.test(path) || /^\/orga\//.test(path)) return 'organizer_profile';
  if (/^\/promoter\//.test(path) || /^\/promo\//.test(path)) return 'promoter_link';
  if (/^\/explore/.test(path)) return 'explore';
  if (/^\/map/.test(path)) return 'map';
  if (/^\/search/.test(path)) return 'search';
  if (path === '/' || path === '') return 'home';
  return 'other';
}

function getOrCreateVisitorId(): { id: string; visitNumber: number; isReturning: boolean } {
  // Persistent across sessions (1 year via localStorage)
  let id = localStorage.getItem(VISITOR_ID_KEY);
  // Traceur de 13 mois au plus (exemption CNIL de la mesure d'audience) : au-delà,
  // un nouvel identifiant, jamais prolongé par la visite.
  const bornAt = parseInt(localStorage.getItem(`${VISITOR_ID_KEY}__born`) || '0', 10);
  if (id && bornAt && Date.now() - bornAt > 13 * 30.5 * 24 * 3600 * 1000) { id = null; }
  if (id && !bornAt) localStorage.setItem(`${VISITOR_ID_KEY}__born`, String(Date.now()));
  let visitNumber = parseInt(localStorage.getItem(VISIT_NUMBER_KEY) || '0', 10);
  const isReturning = !!id;
  if (!id) {
    id = uuidv4();
    localStorage.setItem(VISITOR_ID_KEY, id);
    localStorage.setItem(`${VISITOR_ID_KEY}__born`, String(Date.now()));
    visitNumber = 0;
  }
  visitNumber += 1;
  localStorage.setItem(VISIT_NUMBER_KEY, String(visitNumber));
  return { id, visitNumber, isReturning };
}

function getConnectionType(): string | null {
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  return conn?.effectiveType || null;
}

/** Appel RPC en keepalive : survit à une navigation (paiement Stripe, fermeture). */
function rpcKeepalive(fn: string, args: Record<string, unknown>): void {
  try {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(args),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // une mesure ne bloque jamais une navigation
  }
}

interface VisitorTrackingOptions {
  /**
   * Pages du parcours d'achat (choix du billet, paiement, retour de paiement) :
   * elles CONTINUENT la visite de l'onglet au lieu d'en ouvrir une autre quand
   * leur portée diffère, et gardent la visite vivante dans la Vue en direct.
   * Une visite n'est créée que si l'onglet n'en a aucune (arrivée directe).
   */
  keepSession?: boolean;
}

export const useVisitorTracking = (venueId?: string, eventId?: string, organizerUserId?: string, options: VisitorTrackingOptions = {}) => {
  const keepSession = !!options.keepSession;
  const startTimeRef = useRef<number>(Date.now());
  const heartbeatRef = useRef<number | null>(null);
  const maxScrollRef = useRef<number>(0);
  // Mesure d'audience non nécessaire → gatée au consentement analytics. Tant
  // qu'il n'est pas accordé, aucun identifiant visiteur ni ping « live » n'est
  // posé. L'effet se relance dès que le consentement bascule (deps).
  const { analytics: analyticsConsent } = useConsent();

  useEffect(() => {
    // Mesure d'audience anonyme exemptée (src/lib/consent.ts) ; la PERSONNE
    // (user_id, points de contact) n'est rattachée qu'avec le consentement.
    if (!hasAudienceMeasurement()) return;
    if (!venueId && !eventId && !organizerUserId) return;

    let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    const storedVenueId = sessionStorage.getItem(VENUE_STORAGE_KEY);
    const storedEventId = sessionStorage.getItem(EVENT_STORAGE_KEY);
    const storedOrgId = sessionStorage.getItem(ORG_STORAGE_KEY);

    const scopeChanged = !(keepSession && sessionId) && (
      (venueId && storedVenueId !== venueId) ||
      (eventId && storedEventId !== eventId) ||
      (organizerUserId && storedOrgId !== organizerUserId));

    if (!sessionId || scopeChanged) {
      sessionId = scopeChanged ? uuidv4() : (sessionId || uuidv4());
      sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      if (venueId) sessionStorage.setItem(VENUE_STORAGE_KEY, venueId);
      if (eventId) sessionStorage.setItem(EVENT_STORAGE_KEY, eventId);
      if (organizerUserId) sessionStorage.setItem(ORG_STORAGE_KEY, organizerUserId);
      sessionStorage.setItem(SESSION_START_KEY, String(Date.now()));
      startTimeRef.current = Date.now();

      trackVisitor(sessionId);
    } else {
      const stored = sessionStorage.getItem(SESSION_START_KEY);
      startTimeRef.current = stored ? Number(stored) : Date.now();
    }

    // Scroll depth tracking
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        const pct = Math.round((scrollTop / docHeight) * 100);
        if (pct > maxScrollRef.current) maxScrollRef.current = Math.min(pct, 100);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    const sendHeartbeat = async () => {
      const sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!sid) return;
      // Écriture via RPC SECURITY DEFINER (plus d'UPDATE anonyme direct sur la
      // table : cf. migration 20260809200000). Le serveur borne les entrées et
      // impose user_id = auth.uid(). Le battement dit « en visite » : le serveur
      // garde l'étape la plus avancée de la visite (panier, paiement, achat),
      // posée par le tunnel et par la vente, jamais par cette page.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.rpc('ping_live_visitor' as any, {
        p_session_id: sid,
        p_venue_id: venueId || null,
        p_event_id: eventId || null,
        p_organizer_user_id: organizerUserId || null,
        p_page_path: window.location.pathname,
        p_stage: 'browsing',
      });
    };

    // Le battement est suspendu quand l'onglet passe en arrière-plan et repart au
    // retour au premier plan : inutile de pinger « live » un visiteur qui a
    // basculé sur une autre app (économie batterie/data en soirée).
    const startHeartbeat = () => {
      if (heartbeatRef.current) return;
      sendHeartbeat();
      heartbeatRef.current = window.setInterval(() => sendHeartbeat(), 15000);
    };
    const stopHeartbeat = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
    if (document.visibilityState !== 'hidden') startHeartbeat();

    // Durée, défilement, dernière activité : RPC en keepalive. L'ancien PATCH
    // direct sur la table ne touchait aucune ligne (un visiteur n'a pas le
    // droit de LIRE visitor_sessions) : plus aucune durée depuis août.
    const updateDuration = () => {
      const sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!sid) return;
      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (durationSeconds < 1) return;
      rpcKeepalive('touch_visitor_session', {
        p_session_id: sid,
        p_duration_seconds: durationSeconds,
        p_scroll_depth: maxScrollRef.current,
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        updateDuration();
        stopHeartbeat();
      } else {
        startHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', updateDuration);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', updateDuration);
      window.removeEventListener('scroll', handleScroll);
      stopHeartbeat();
      updateDuration();
    };
  }, [venueId, eventId, organizerUserId, analyticsConsent, keepSession]);

  const trackVisitor = async (sessionId: string) => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      // Le vrai référent, même quand la visite arrive par un lien suivi (/l/).
      const referrer = entryReferrer();
      const entryPage = window.location.pathname;
      const entryPageType = detectEntryPageType(entryPage);
      const deviceType = detectDeviceType();
      const referrerDomain = extractDomain(referrer);
      const utmMedium = urlParams.get('utm_medium');
      const referrerCategory = categorizeReferrer(referrer, utmMedium, urlParams);
      const { id: visitorId, visitNumber, isReturning } = getOrCreateVisitorId();

      const { data: { user } } = await supabase.auth.getUser();

      const sessionRow = {
        session_id: sessionId,
        venue_id: venueId || null,
        event_id: eventId || null,
        organizer_user_id: organizerUserId || null,
        referrer: referrer || null,
        referrer_domain: referrerDomain,
        referrer_category: referrerCategory,
        utm_source: urlParams.get('utm_source'),
        utm_medium: utmMedium,
        utm_campaign: urlParams.get('utm_campaign'),
        utm_term: urlParams.get('utm_term'),
        utm_content: urlParams.get('utm_content'),
        gclid: urlParams.get('gclid'),
        fbclid: urlParams.get('fbclid'),
        landing_page_full: window.location.href,
        user_agent: navigator.userAgent,
        device_type: deviceType,
        entry_page: entryPage,
        entry_page_type: entryPageType,
        user_id: analyticsConsent && user ? user.id : null,
        visitor_id: visitorId,
        is_returning: isReturning,
        visit_number: visitNumber,
        language: navigator.language,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        connection_type: getConnectionType(),
      };

      await supabase.from('visitor_sessions').insert(sessionRow);

      // Fire-and-forget geo enrichment (server resolves IP -> country/city)
      supabase.functions
        .invoke('geocode-address', { body: { session_id: sessionId } })
        .catch(() => {});

      // Attribution touchpoint (always track on first session of scope)
      try {
        if (analyticsConsent) {
        await supabase.from('attribution_touchpoints').insert({
          user_id: user?.id || null,
          visitor_id: visitorId,
          venue_id: venueId || null,
          event_id: eventId || null,
          organizer_user_id: organizerUserId || null,
          touch_type: isReturning ? 'return' : 'first',
          source: urlParams.get('utm_source') || referrerCategory,
          medium: utmMedium,
          campaign: urlParams.get('utm_campaign'),
          referrer_domain: referrerDomain,
        });
        }
      } catch { /* tracking best-effort : ne bloque jamais la navigation */ }
    } catch (error) {
      console.error('Error tracking visitor:', error);
    }
  };

  const trackEvent = async (eventType: string, target?: string, payload: Record<string, Json> = {}) => {
    const sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sid) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('visitor_events').insert({
        session_id: sid,
        venue_id: venueId || null,
        event_id: eventId || null,
        organizer_user_id: organizerUserId || null,
        user_id: user?.id || null,
        event_type: eventType,
        target: target || null,
        payload,
        page_path: window.location.pathname,
      });
    } catch { /* tracking best-effort : ne bloque jamais la navigation */ }
  };

  // Étapes d'une visite hors soirée (panier / paiement au bar). Le serveur
  // pose les drapeaux de la visite et l'étape du direct, jamais à reculons.
  // Un billet, une table ou une inscription passent par le tunnel de la soirée
  // (`capturePosthog` → `track_event_funnel`), qui fait de même.
  const trackAddToCart = async (cartValueCents = 0) => {
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) return;
    try {
      await supabase.rpc('track_visit_stage' as never, { p_session_id: sessionId, p_stage: 'cart', p_cart_value_cents: cartValueCents } as never);
      await trackEvent('add_to_cart', null, { value_cents: cartValueCents });
    } catch (error) {
      console.error('Error tracking add to cart:', error);
    }
  };

  const trackCheckout = async (cartValueCents = 0) => {
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) return;
    rpcKeepalive('track_visit_stage', { p_session_id: sessionId, p_stage: 'checkout', p_cart_value_cents: cartValueCents });
    await trackEvent('checkout_started', null, { value_cents: cartValueCents });
  };

  const trackOrderComplete = async (orderId: string, kind: 'ticket' | 'table' | 'order' = 'ticket') => {
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) return;
    try {
      // Filet du navigateur : l'achat d'un billet, d'une table ou d'une
      // inscription est relevé par la BASE au passage en payé (la vente porte
      // l'id de la visite). Ici, la même porte relie la vente à la visite et
      // complète une attribution « direct » — c'est le seul chemin d'une
      // commande du bar. Idempotent.
      await supabase.rpc('link_sale_session' as never, { p_session_id: sessionId, p_kind: kind, p_sale_id: orderId } as never);
      await trackEvent('order_completed', orderId);
    } catch (error) {
      console.error('Error tracking order complete:', error);
    }
  };

  return {
    trackAddToCart,
    trackCheckout,
    trackOrderComplete,
    trackEvent,
  };
};
