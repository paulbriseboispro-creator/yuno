/**
 * D'où vient une visite : la règle de `visitor_sessions.referrer_category`,
 * partagée entre la mesure de visites (`useVisitorTracking`) et le suivi du
 * tunnel d'une soirée (`eventFunnel.ts`) — une source se lit pareil dans le
 * Trafic « ma page » et dans le Trafic « par soirée ».
 */

export function extractDomain(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function categorizeReferrer(referrer: string, utmMedium: string | null, urlParams: URLSearchParams): string {
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
