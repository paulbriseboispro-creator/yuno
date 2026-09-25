import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { v4 as uuidv4 } from 'uuid';
import { getBrowserId } from '@/lib/browserId';
import { hasAnalyticsConsent, useConsent } from '@/lib/consent';
import { cameFromYuno, previousRoute } from '@/lib/affiliateOrigin';
import { useAuth } from '@/hooks/useAuth';
import { isLikelyBot } from '@/lib/botUserAgent';

const SESSION_KEY       = 'yuno_aff_session_id';
const SESSION_START_KEY = 'yuno_aff_session_start';
const VISITOR_ID_KEY    = 'yuno_aff_visitor_id';
const VISIT_NUMBER_KEY  = 'yuno_aff_visit_number';
const LAST_SEEN_KEY     = 'yuno_aff_last_seen';

// Une VISITE = une présence séparée de la précédente par plus de 30 min
// d'inactivité (définition usuelle de la mesure d'audience). Avant, chaque
// changement de page ouvrait une session et incrémentait le numéro de visite :
// la 2e page vue d'un premier visiteur le comptait déjà « fidèle » (354
// sessions pour 92 visiteurs chez Mad by Night, taux de fidèles gonflé).
const VISIT_GAP_MS = 30 * 60 * 1000;

function detectDevice(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function detectEntryType(path: string): string {
  if (/\/promo\//.test(path)) return 'member_linktree';
  // /rp/ = la page de l'agence dans Yuno : même rôle que le linktree /p/.
  // Sans ce cas, ses visites tombaient dans « page soirée ».
  if (/\/(p|rp)\//.test(path)) return 'linktree';
  if (/\/affiliate-event\//.test(path)) return 'event_page';
  if (/\/affiliate-venue\//.test(path)) return 'venue_page';
  return 'event_page';
}

function extractDomain(url: string): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function categorizeReferrer(referrer: string, utmMedium: string | null, params: URLSearchParams): string {
  // Amené par Yuno (Explore, recherche, carte, app native…) : voir
  // src/lib/affiliateOrigin.ts — c'est le chiffre « trafic apporté par Yuno ».
  if (cameFromYuno()) return 'internal';
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
  let visitNumber = parseInt(localStorage.getItem(VISIT_NUMBER_KEY) || '0', 10) || 0;
  const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
  const now = Date.now();
  if (!id) {
    id = uuidv4();
    localStorage.setItem(VISITOR_ID_KEY, id);
    visitNumber = 0;
  }
  // Nouvelle visite seulement après 30 min sans activité (ou la toute première).
  if (visitNumber === 0 || !lastSeen || now - lastSeen > VISIT_GAP_MS) visitNumber += 1;
  localStorage.setItem(VISIT_NUMBER_KEY, String(visitNumber));
  localStorage.setItem(LAST_SEEN_KEY, String(now));
  return { id, visitNumber, isReturning: visitNumber > 1 };
}

function touchLastSeen() {
  try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch { /* best-effort */ }
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
  // Page vue comptée SANS consentement (voir plus bas) : on garde son id pour
  // la reprendre si la personne accepte sur cette même page — sinon la même
  // vue serait comptée deux fois.
  const anonRef = useRef<{ scope: string; sessionId: string } | null>(null);
  // Mesure d'audience de la vitrine externe = analytics non nécessaire → gatée
  // au consentement (identifiant visiteur 1 an + pings « live »). L'attribution
  // d'une conversion (?via=) est un mécanisme SÉPARÉ, résolu en amont, et reste
  // hors périmètre de ce gate (code argent intouché).
  const { analytics: analyticsConsent } = useConsent();
  // Tant que la session n'est pas relue, on ne sait pas si le visiteur est
  // l'agence elle-même : sa visite partait comptée comme trafic extérieur.
  const { loading: authLoading } = useAuth();

  useEffect(() => {
    if (!affiliateId || authLoading) return;
    if (isLikelyBot()) return;

    const scopeKey = [affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId].filter(Boolean).join('-');

    // Sans consentement analytics : la page vue est COMPTÉE, anonymement —
    // aucun identifiant, rien lu ni écrit sur l'appareil, ni durée ni « en
    // ligne ». Le clic billetterie, lui, était déjà compté sans consentement :
    // les vues ne l'étant pas, le taux de clic dépassait 100 %. Les deux se
    // mesurent désormais sur la même base (voir aussi trackAffiliateClick).
    if (!analyticsConsent) {
      if (anonRef.current?.scope !== scopeKey) {
        const anonId = uuidv4();
        anonRef.current = { scope: scopeKey, sessionId: anonId };
        trackPageView(anonId, affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId, isOwner ?? false, false);
      }
      return;
    }

    let sessionId = sessionStorage.getItem(SESSION_KEY);
    const storedScope = sessionStorage.getItem('yuno_aff_scope');

    if (!sessionId || storedScope !== scopeKey) {
      const anon = anonRef.current?.scope === scopeKey ? anonRef.current : null;
      sessionId = anon?.sessionId ?? uuidv4();
      sessionStorage.setItem(SESSION_KEY, sessionId);
      sessionStorage.setItem('yuno_aff_scope', scopeKey);
      sessionStorage.setItem(SESSION_START_KEY, String(Date.now()));
      startTimeRef.current = Date.now();
      // Consentement donné sur cette page : la vue anonyme existe déjà, on
      // la reprend (durée, scroll) au lieu d'en créer une seconde.
      if (!anon) trackPageView(sessionId, affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId, isOwner ?? false, true);
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
      touchLastSeen();
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
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => flushDuration(true));

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('scroll', handleScroll);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      flushDuration(false);
    };
  }, [affiliateId, affiliateMemberId, affiliateEventId, affiliateVenueId, analyticsConsent, authLoading]);
}

async function trackPageView(
  sessionId: string,
  affiliateId: string,
  affiliateMemberId?: string,
  affiliateEventId?: string,
  affiliateVenueId?: string,
  isInternal = false,
  consented = true,
) {
  try {
    const params = new URLSearchParams(window.location.search);
    const referrer = document.referrer;
    const utmMedium = params.get('utm_medium');
    // Sans consentement : ni identifiant visiteur, ni empreinte de l'appareil.
    const visitor = consented ? getOrCreateVisitorId() : null;

    await supabase.from('affiliate_visitor_sessions').insert({
      session_id: sessionId,
      affiliate_id: affiliateId,
      affiliate_member_id: affiliateMemberId || null,
      affiliate_event_id: affiliateEventId || null,
      affiliate_venue_id: affiliateVenueId || null,
      visitor_id: visitor?.id ?? null,
      is_returning: visitor?.isReturning ?? false,
      visit_number: visitor?.visitNumber ?? null,
      device_type: detectDevice(),
      user_agent: consented ? navigator.userAgent : null,
      language: consented ? navigator.language : null,
      viewport_w: consented ? window.innerWidth : null,
      viewport_h: consented ? window.innerHeight : null,
      connection_type: consented ? getConnectionType() : null,
      // Page de l'app d'où vient le visiteur (linktree → soirée, Explore →
      // soirée…) : c'est ce qui relie une vue de soirée au linktree qui l'a
      // amenée.
      previous_path: previousRoute()?.slice(0, 300) ?? null,
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
  const params = new URLSearchParams(window.location.search);
  const referrer = document.referrer;
  const utmMedium = params.get('utm_medium');
  const consented = hasAnalyticsConsent();
  const visitorId = consented ? localStorage.getItem(VISITOR_ID_KEY) : null;
  const visitNumber = consented ? parseInt(localStorage.getItem(VISIT_NUMBER_KEY) || '1', 10) : 1;
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
  if (isLikelyBot()) return;
  const attribution = getClickAttribution();
  // Le clic se compte toujours (c'est l'action du visiteur vers la
  // billetterie du club), mais sans identifiant tant que la mesure d'audience
  // n'est pas acceptée : getBrowserId() écrivait un identifiant d'un an sur
  // l'appareil de quelqu'un qui avait refusé les cookies.
  const consented = hasAnalyticsConsent();
  supabase.from('affiliate_clicks').insert({
    affiliate_event_id: affiliateEventId ?? null,
    affiliate_id: affiliateId,
    affiliate_venue_id: affiliateVenueId ?? null,
    affiliate_member_id: affiliateMemberId ?? null,
    user_id: userId ?? null,
    browser_id: consented ? getBrowserId() : null,
    referrer: document.referrer || null,
    is_internal: isInternal,
    click_type: clickType,
    ...attribution,
  }).then(({ error }) => {
    if (error) console.error('[AffiliateClick] insert failed:', error.message);
  });
}
