import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { v4 as uuidv4 } from 'uuid';

const SESSION_STORAGE_KEY = 'yuno_session_id';
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

function extractDomain(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function categorizeReferrer(referrer: string, utmMedium: string | null, urlParams: URLSearchParams): string {
  // QR code: yuno standard adds ?from=qr
  if (urlParams.get('from') === 'qr' || urlParams.get('utm_medium') === 'qr') return 'qr';
  if (utmMedium === 'email' || urlParams.get('from') === 'email') return 'email';
  if (urlParams.get('gclid')) return 'paid_search';
  if (urlParams.get('fbclid') || urlParams.get('utm_source') === 'meta') return 'paid_social';
  if (utmMedium === 'cpc' || utmMedium === 'paid') return 'paid';
  if (utmMedium === 'affiliate' || utmMedium === 'promoter') return 'affiliate';
  if (!referrer) return 'direct';

  const domain = extractDomain(referrer)?.toLowerCase() || '';
  if (/(google|bing|duckduckgo|yahoo|ecosia|qwant|baidu)\./.test(domain)) return 'search';
  if (/(instagram|facebook|fb\.com|tiktok|twitter|x\.com|snapchat|linkedin|pinterest|youtube|reddit|threads)/.test(domain)) return 'social';
  if (/(mail|gmail|outlook|yahoo\.mail)/.test(domain)) return 'email';
  if (/(yunoapp\.eu|yuno-bar-buddy)/.test(domain)) return 'internal';
  return 'referral';
}

function getOrCreateVisitorId(): { id: string; visitNumber: number; isReturning: boolean } {
  // Persistent across sessions (1 year via localStorage)
  let id = localStorage.getItem(VISITOR_ID_KEY);
  let visitNumber = parseInt(localStorage.getItem(VISIT_NUMBER_KEY) || '0', 10);
  const isReturning = !!id;
  if (!id) {
    id = uuidv4();
    localStorage.setItem(VISITOR_ID_KEY, id);
  }
  visitNumber += 1;
  localStorage.setItem(VISIT_NUMBER_KEY, String(visitNumber));
  return { id, visitNumber, isReturning };
}

function getConnectionType(): string | null {
  const conn = (navigator as any).connection;
  return conn?.effectiveType || null;
}

export const useVisitorTracking = (venueId?: string, eventId?: string, organizerUserId?: string) => {
  const startTimeRef = useRef<number>(Date.now());
  const heartbeatRef = useRef<number | null>(null);
  const maxScrollRef = useRef<number>(0);

  useEffect(() => {
    if (!venueId && !eventId && !organizerUserId) return;

    let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    const storedVenueId = sessionStorage.getItem(VENUE_STORAGE_KEY);
    const storedEventId = sessionStorage.getItem(EVENT_STORAGE_KEY);
    const storedOrgId = sessionStorage.getItem(ORG_STORAGE_KEY);

    const scopeChanged =
      (venueId && storedVenueId !== venueId) ||
      (eventId && storedEventId !== eventId) ||
      (organizerUserId && storedOrgId !== organizerUserId);

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

    const sendHeartbeat = async (stage: 'browsing' | 'cart' | 'checkout' | 'paid' = 'browsing') => {
      const sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!sid) return;
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('live_visitor_pings').upsert({
        session_id: sid,
        venue_id: venueId || null,
        event_id: eventId || null,
        organizer_user_id: organizerUserId || null,
        page_path: window.location.pathname,
        stage,
        user_id: user?.id || null,
        last_seen: new Date().toISOString(),
      }, { onConflict: 'session_id' });
    };

    sendHeartbeat();
    heartbeatRef.current = window.setInterval(() => sendHeartbeat(), 15000);

    const updateDuration = () => {
      const sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!sid) return;
      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (durationSeconds < 1) return;
      const scopeParam = venueId
        ? `&venue_id=eq.${encodeURIComponent(venueId)}`
        : organizerUserId
          ? `&organizer_user_id=eq.${encodeURIComponent(organizerUserId)}`
          : eventId
            ? `&event_id=eq.${encodeURIComponent(eventId)}`
            : '';
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/visitor_sessions?session_id=eq.${sid}${scopeParam}`;
      const body = JSON.stringify({
        duration_seconds: durationSeconds,
        last_activity_at: new Date().toISOString(),
        scroll_depth_max: maxScrollRef.current,
      });
      const headers = {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      };
      fetch(url, { method: 'PATCH', headers, body, keepalive: true }).catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') updateDuration();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', updateDuration);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', updateDuration);
      window.removeEventListener('scroll', handleScroll);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      updateDuration();
    };
  }, [venueId, eventId, organizerUserId]);

  const trackVisitor = async (sessionId: string) => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const referrer = document.referrer;
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
        user_id: user?.id || null,
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
      } catch {}
    } catch (error) {
      console.error('Error tracking visitor:', error);
    }
  };

  const updatePingStage = async (stage: 'browsing' | 'cart' | 'checkout' | 'paid', cartValueCents = 0) => {
    const sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sid) return;
    await supabase.from('live_visitor_pings').upsert({
      session_id: sid,
      venue_id: venueId || null,
      event_id: eventId || null,
      organizer_user_id: organizerUserId || null,
      page_path: window.location.pathname,
      stage,
      cart_value_cents: cartValueCents,
      last_seen: new Date().toISOString(),
    }, { onConflict: 'session_id' });
  };

  const trackEvent = async (eventType: string, target?: string, payload: Record<string, any> = {}) => {
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
    } catch {}
  };

  const trackAddToCart = async (cartValueCents = 0) => {
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) return;
    try {
      let query = supabase
        .from('visitor_sessions')
        .update({ added_to_cart: true, cart_value_cents: cartValueCents })
        .eq('session_id', sessionId);
      if (venueId) query = query.eq('venue_id', venueId);
      else if (organizerUserId) query = query.eq('organizer_user_id', organizerUserId);
      else if (eventId) query = query.eq('event_id', eventId);
      await query;
      await updatePingStage('cart', cartValueCents);
      await trackEvent('add_to_cart', null, { value_cents: cartValueCents });
    } catch (error) {
      console.error('Error tracking add to cart:', error);
    }
  };

  const trackCheckout = async (cartValueCents = 0) => {
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) return;
    try {
      let query = supabase
        .from('visitor_sessions')
        .update({ proceeded_to_checkout: true })
        .eq('session_id', sessionId);
      if (venueId) query = query.eq('venue_id', venueId);
      else if (organizerUserId) query = query.eq('organizer_user_id', organizerUserId);
      else if (eventId) query = query.eq('event_id', eventId);
      await query;
      await updatePingStage('checkout', cartValueCents);
      await trackEvent('checkout_started', null, { value_cents: cartValueCents });
    } catch (error) {
      console.error('Error tracking checkout:', error);
    }
  };

  const trackOrderComplete = async (orderId: string) => {
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) return;
    try {
      let query = supabase
        .from('visitor_sessions')
        .update({ completed_order: true, order_id: orderId })
        .eq('session_id', sessionId);
      if (venueId) query = query.eq('venue_id', venueId);
      else if (organizerUserId) query = query.eq('organizer_user_id', organizerUserId);
      else if (eventId) query = query.eq('event_id', eventId);
      await query;
      await updatePingStage('paid');
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
