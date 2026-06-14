import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { v4 as uuidv4 } from 'uuid';
import { getBrowserId } from '@/lib/browserId';

const SESSION_KEY       = 'yuno_aff_session_id';
const SESSION_START_KEY = 'yuno_aff_session_start';
const VISITOR_ID_KEY    = 'yuno_aff_visitor_id';
const VISIT_NUMBER_KEY  = 'yuno_aff_visit_number';

function detectDevice(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function detectEntryType(path: string): string {
  if (/\/promo\//.test(path)) return 'member_linktree';
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

  useEffect(() => {
    if (!affiliateId) return;

    let sessionId = sessionStorage.getItem(SESSION_KEY);
    const scopeKey = [affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId].filter(Boolean).join('-');
    const storedScope = sessionStorage.getItem('yuno_aff_scope');

    if (!sessionId || storedScope !== scopeKey) {
      sessionId = uuidv4();
      sessionStorage.setItem(SESSION_KEY, sessionId);
      sessionStorage.setItem('yuno_aff_scope', scopeKey);
      sessionStorage.setItem(SESSION_START_KEY, String(Date.now()));
      startTimeRef.current = Date.now();
      trackPageView(sessionId, affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId, isOwner ?? false);
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

    const flushDuration = async (useKeepalive = false) => {
      const sid = sessionStorage.getItem(SESSION_KEY);
      if (!sid) return;
      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (durationSeconds < 1) return;

      const payload = {
        duration_seconds: durationSeconds,
        last_activity_at: new Date().toISOString(),
        scroll_depth_max: maxScrollRef.current,
      };

      if (useKeepalive) {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/affiliate_visitor_sessions?session_id=eq.${sid}&affiliate_id=eq.${encodeURIComponent(affiliateId)}`;
        fetch(url, {
          method: 'PATCH',
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
        supabase.from('affiliate_visitor_sessions')
          .update(payload)
          .eq('session_id', sid)
          .eq('affiliate_id', affiliateId)
          .then(() => {});
      }
    };

    const sendHeartbeat = () => {
      const sid = sessionStorage.getItem(SESSION_KEY);
      if (!sid) return;
      supabase.from('affiliate_live_pings').upsert({
        session_id: sid,
        affiliate_id: affiliateId,
        affiliate_member_id: affiliateMemberId || null,
        affiliate_event_id: affiliateEventId || null,
        affiliate_venue_id: affiliateVenueId || null,
        last_seen: new Date().toISOString(),
        page_path: window.location.pathname,
      }, { onConflict: 'session_id' }).then(() => {});
      flushDuration(false);
    };
    sendHeartbeat();
    heartbeatRef.current = window.setInterval(sendHeartbeat, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDuration(true);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => flushDuration(true));

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('scroll', handleScroll);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      flushDuration(false);
    };
  }, [affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId]);
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
    const params = new URLSearchParams(window.location.search);
    const referrer = document.referrer;
    const utmMedium = params.get('utm_medium');
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
      referrer: referrer || null,
      referrer_domain: extractDomain(referrer),
      referrer_category: categorizeReferrer(referrer, utmMedium, params),
      utm_source: params.get('utm_source'),
      utm_medium: utmMedium,
      utm_campaign: params.get('utm_campaign'),
      utm_content: params.get('utm_content'),
      utm_term: params.get('utm_term'),
      landing_page_full: window.location.href,
      entry_page: window.location.pathname,
      entry_page_type: detectEntryType(window.location.pathname),
      is_internal: isInternal,
    });
  } catch {}
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
  const params = new URLSearchParams(window.location.search);
  const referrer = document.referrer;
  const utmMedium = params.get('utm_medium');
  const visitorId = localStorage.getItem(VISITOR_ID_KEY);
  const visitNumber = parseInt(localStorage.getItem(VISIT_NUMBER_KEY) || '1', 10);
  return {
    device_type: detectDevice(),
    referrer_category: categorizeReferrer(referrer, utmMedium, params),
    utm_source: params.get('utm_source'),
    utm_medium: utmMedium,
    utm_campaign: params.get('utm_campaign'),
    visitor_id: visitorId,
    is_returning: visitNumber > 1,
  };
}

interface TrackClickParams {
  affiliateId: string;
  affiliateEventId: string;
  affiliateVenueId?: string | null;
  affiliateMemberId?: string | null;
  userId?: string | null;
  isInternal?: boolean;
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
}: TrackClickParams) {
  if (!affiliateId || !affiliateEventId) return;
  const attribution = getClickAttribution();
  supabase.from('affiliate_clicks').insert({
    affiliate_event_id: affiliateEventId,
    affiliate_id: affiliateId,
    affiliate_venue_id: affiliateVenueId ?? null,
    affiliate_member_id: affiliateMemberId ?? null,
    user_id: userId ?? null,
    browser_id: getBrowserId(),
    referrer: document.referrer || null,
    is_internal: isInternal,
    ...attribution,
  }).then(({ error }) => {
    if (error) console.error('[AffiliateClick] insert failed:', error.message);
  });
}
