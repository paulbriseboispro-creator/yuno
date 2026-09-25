import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { v4 as uuidv4 } from 'uuid';
import { getBrowserId } from '@/lib/browserId';
import { hasAnalyticsConsent, useConsent } from '@/lib/consent';
import { useAuth } from '@/hooks/useAuth';

const SESSION_KEY       = 'yuno_aff_session_id';
const SESSION_START_KEY = 'yuno_aff_session_start';
const VISITOR_ID_KEY    = 'yuno_aff_visitor_id';
const VISIT_NUMBER_KEY  = 'yuno_aff_visit_number';
// Par onglet : la visite en cours (compteur déjà incrémenté ?) et sa source
// d'arrivée, réutilisée par les pages suivantes et par les clics — sans ça,
// linktree → fiche soirée comptait une « deuxième visite » et perdait
// l'Instagram / l'UTM / le QR d'origine dès la première navigation.
const VISIT_STATE_KEY   = 'yuno_aff_visit_state';
const LANDING_ATTR_KEY  = 'yuno_aff_landing';

/** Serveur de développement / réseau local : jamais un visiteur réel. */
function isDevHost(): boolean {
  if (import.meta.env.DEV) return true;
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.)/.test(window.location.hostname);
}

function detectDevice(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function detectEntryType(path: string): string {
  if (/\/promo\//.test(path)) return 'member_linktree';
  if (/^\/rp\//.test(path)) return 'agency_page';
  if (/\/p\//.test(path)) return 'linktree';
  if (/\/affiliate-event\//.test(path)) return 'event_page';
  if (/\/affiliate-venue\//.test(path)) return 'venue_page';
  return 'event_page';
}

function extractDomain(url: string): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function categorizeReferrer(referrer: string, utmMedium: string | null, params: URLSearchParams): string {
  if (params.get('from') === 'qr' || params.get('utm_medium') === 'qr') return 'qr';
  if (utmMedium === 'email' || params.get('from') === 'email') return 'email';
  if (params.get('gclid')) return 'paid_search';
  if (params.get('fbclid') || params.get('utm_source') === 'meta') return 'paid_social';
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
  let id = localStorage.getItem(VISITOR_ID_KEY);
  // Une VISITE = un onglet : les pages suivantes du même onglet reprennent le
  // numéro de visite au lieu de l'incrémenter (le taux de « fidèles » était
  // gonflé par chaque navigation linktree → soirée).
  try {
    const state = JSON.parse(sessionStorage.getItem(VISIT_STATE_KEY) || 'null') as { visitNumber: number; isReturning: boolean } | null;
    if (id && state) return { id, visitNumber: state.visitNumber, isReturning: state.isReturning };
  } catch { /* état illisible : on recompte */ }
  const isReturning = !!id;
  if (!id) {
    id = uuidv4();
    localStorage.setItem(VISITOR_ID_KEY, id);
  }
  const visitNumber = parseInt(localStorage.getItem(VISIT_NUMBER_KEY) || '0', 10) + 1;
  localStorage.setItem(VISIT_NUMBER_KEY, String(visitNumber));
  sessionStorage.setItem(VISIT_STATE_KEY, JSON.stringify({ visitNumber, isReturning }));
  return { id, visitNumber, isReturning };
}

type LandingAttribution = {
  referrer: string | null;
  referrer_category: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

/** Source d'arrivée de la visite : celle de la PREMIÈRE page de l'onglet. */
function landingAttribution(): LandingAttribution {
  try {
    const stored = sessionStorage.getItem(LANDING_ATTR_KEY);
    if (stored) return JSON.parse(stored) as LandingAttribution;
  } catch { /* on recalcule */ }
  const params = new URLSearchParams(window.location.search);
  const referrer = document.referrer;
  const utmMedium = params.get('utm_medium');
  const attr: LandingAttribution = {
    referrer: referrer || null,
    referrer_category: categorizeReferrer(referrer, utmMedium, params),
    utm_source: params.get('utm_source'),
    utm_medium: utmMedium,
    utm_campaign: params.get('utm_campaign'),
    utm_content: params.get('utm_content'),
    utm_term: params.get('utm_term'),
  };
  try { sessionStorage.setItem(LANDING_ATTR_KEY, JSON.stringify(attr)); } catch { /* navigation privée */ }
  return attr;
}

function getConnectionType(): string | null {
  const conn = (navigator as any).connection;
  return conn?.effectiveType || null;
}

interface TrackingParams {
  affiliateId: string;
  affiliateMemberId?: string;
  affiliateEventId?: string;
  affiliateVenueId?: string;
  isOwner?: boolean;
}

export function useAffiliateVisitorTracking({
  affiliateId,
  affiliateMemberId,
  affiliateEventId,
  affiliateVenueId,
  isOwner,
}: TrackingParams) {
  const startTimeRef = useRef<number>(Date.now());
  const heartbeatRef = useRef<number | null>(null);
  const maxScrollRef = useRef<number>(0);
  // Mesure d'audience de la vitrine externe = analytics non nécessaire → gatée
  // au consentement (identifiant visiteur 1 an + pings « live »). L'attribution
  // d'une conversion (?via=) est un mécanisme SÉPARÉ, résolu en amont, et reste
  // hors périmètre de ce gate (code argent intouché).
  const { analytics: analyticsConsent } = useConsent();
  // On attend la session : sinon la vue du propriétaire partait avant que
  // `isOwner` soit connu, comptée comme un visiteur externe pour toujours.
  const { loading: authLoading } = useAuth();

  useEffect(() => {
    if (!analyticsConsent) return;
    if (!affiliateId) return;
    if (authLoading) return;

    let sessionId = sessionStorage.getItem(SESSION_KEY);
    const scopeKey = [affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId].filter(Boolean).join('-');
    const storedScope = sessionStorage.getItem('yuno_aff_scope');

    if (!sessionId || storedScope !== scopeKey) {
      sessionId = uuidv4();
      sessionStorage.setItem(SESSION_KEY, sessionId);
      sessionStorage.setItem('yuno_aff_scope', scopeKey);
      sessionStorage.setItem(SESSION_START_KEY, String(Date.now()));
      startTimeRef.current = Date.now();
      trackPageView(sessionId, affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId, !!isOwner || isDevHost());
    } else {
      const stored = sessionStorage.getItem(SESSION_START_KEY);
      startTimeRef.current = stored ? Number(stored) : Date.now();
    }

    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        const pct = Math.round((scrollTop / docHeight) * 100);
        if (pct > maxScrollRef.current) maxScrollRef.current = Math.min(pct, 100);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Les écritures de suivi passent par des RPC SECURITY DEFINER : les
    // UPDATE/UPSERT anonymes directs sont bloqués par RLS en prod (les
    // policies publiques d'UPDATE ont été retirées au hardening), ce qui
    // laissait durée, scroll et « en ligne » à zéro pour toujours.
    const flushDuration = async (useKeepalive = false) => {
      const sid = sessionStorage.getItem(SESSION_KEY);
      if (!sid) return;
      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (durationSeconds < 1) return;

      const payload = {
        p_session_id: sid,
        p_affiliate_id: affiliateId,
        p_duration_seconds: durationSeconds,
        p_scroll_depth: maxScrollRef.current,
      };

      if (useKeepalive) {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/flush_affiliate_session`;
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});
      } else {
        supabase.rpc('flush_affiliate_session', payload).then(() => {});
      }
    };

    const sendHeartbeat = () => {
      const sid = sessionStorage.getItem(SESSION_KEY);
      if (!sid) return;
      // Onglet en arrière-plan : ni « en ligne », ni durée qui grimpe.
      if (document.visibilityState === 'hidden') return;
      supabase.rpc('ping_affiliate_live', {
        p_session_id: sid,
        p_affiliate_id: affiliateId,
        p_member_id: affiliateMemberId || null,
        p_event_id: affiliateEventId || null,
        p_venue_id: affiliateVenueId || null,
        p_page_path: window.location.pathname,
      }).then(() => {});
      flushDuration(false);
    };
    sendHeartbeat();
    heartbeatRef.current = window.setInterval(sendHeartbeat, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDuration(true);
    };
    const handleBeforeUnload = () => flushDuration(true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('scroll', handleScroll);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      flushDuration(false);
    };
  }, [affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId, analyticsConsent, authLoading, isOwner]);
}

async function trackPageView(
  sessionId: string,
  affiliateId: string,
  affiliateMemberId?: string,
  affiliateEventId?: string,
  affiliateVenueId?: string,
  isInternal = false,
) {
  try {
    const landing = landingAttribution();
    const { id: visitorId, visitNumber, isReturning } = getOrCreateVisitorId();

    await supabase.from('affiliate_visitor_sessions').insert({
      session_id: sessionId,
      affiliate_id: affiliateId,
      affiliate_member_id: affiliateMemberId || null,
      affiliate_event_id: affiliateEventId || null,
      affiliate_venue_id: affiliateVenueId || null,
      visitor_id: visitorId,
      is_returning: isReturning,
      visit_number: visitNumber,
      device_type: detectDevice(),
      user_agent: navigator.userAgent,
      language: navigator.language,
      viewport_w: window.innerWidth,
      viewport_h: window.innerHeight,
      connection_type: getConnectionType(),
      referrer: landing.referrer,
      referrer_domain: extractDomain(landing.referrer ?? ''),
      referrer_category: landing.referrer_category,
      utm_source: landing.utm_source,
      utm_medium: landing.utm_medium,
      utm_campaign: landing.utm_campaign,
      utm_content: landing.utm_content,
      utm_term: landing.utm_term,
      landing_page_full: window.location.href,
      entry_page: window.location.pathname,
      entry_page_type: detectEntryType(window.location.pathname),
      is_internal: isInternal,
    });
  } catch { /* tracking best-effort : ne bloque jamais la navigation */ }
}

/**
 * Enrich an affiliate_clicks row with attribution data from the current session.
 */
export function getClickAttribution(): {
  device_type: string;
  referrer_category: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  visitor_id: string | null;
  is_returning: boolean;
} {
  // Source de la VISITE (première page de l'onglet), pas de la page courante :
  // après une navigation interne l'URL n'a plus ses utm / fbclid / from=qr.
  const landing = landingAttribution();
  const consent = hasAnalyticsConsent();
  const visitorId = consent ? localStorage.getItem(VISITOR_ID_KEY) : null;
  let isReturning = false;
  try {
    isReturning = !!(JSON.parse(sessionStorage.getItem(VISIT_STATE_KEY) || 'null') as { isReturning?: boolean } | null)?.isReturning;
  } catch { /* défaut : nouveau */ }
  return {
    device_type: detectDevice(),
    referrer_category: landing.referrer_category,
    utm_source: landing.utm_source,
    utm_medium: landing.utm_medium,
    utm_campaign: landing.utm_campaign,
    visitor_id: visitorId,
    is_returning: isReturning,
  };
}

interface TrackClickParams {
  affiliateId: string;
  /** Requis pour un clic billetterie ; null pour un clic « réserver » depuis une page club. */
  affiliateEventId?: string | null;
  affiliateVenueId?: string | null;
  affiliateMemberId?: string | null;
  userId?: string | null;
  isInternal?: boolean;
  clickType?: 'ticket' | 'booking';
}

/**
 * Record a ticket/CTA click on any affiliate surface (linktree, member linktree,
 * event page, venue page). Enriches the row with the current session's attribution
 * (device, referrer category, UTM, visitor id) so analytics can break clicks down
 * by source and campaign. Fire-and-forget — never blocks navigation.
 */
export function trackAffiliateClick({
  affiliateId,
  affiliateEventId,
  affiliateVenueId,
  affiliateMemberId,
  userId,
  isInternal = false,
  clickType = 'ticket',
}: TrackClickParams) {
  if (!affiliateId || (!affiliateEventId && !affiliateVenueId)) return;
  const attribution = getClickAttribution();
  supabase.from('affiliate_clicks').insert({
    affiliate_event_id: affiliateEventId ?? null,
    affiliate_id: affiliateId,
    affiliate_venue_id: affiliateVenueId ?? null,
    affiliate_member_id: affiliateMemberId ?? null,
    user_id: userId ?? null,
    // Identifiant navigateur (localStorage, 1 an) seulement avec le
    // consentement analytics : sans lui le clic reste compté, anonyme.
    browser_id: hasAnalyticsConsent() ? getBrowserId() : null,
    referrer: document.referrer || null,
    is_internal: isInternal || isDevHost(),
    click_type: clickType,
    ...attribution,
  }).then(({ error }) => {
    if (error) console.error('[AffiliateClick] insert failed:', error.message);
  });
}
