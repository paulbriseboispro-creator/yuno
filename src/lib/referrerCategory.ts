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

// ── Le lien suivi (/l/<code>) ne doit pas devenir la source ─────────────────
// La page /l/ enregistre le clic puis recharge la soirée : sur la page
// d'arrivée, `document.referrer` vaut alors yunoapp.eu/l/…, et 2 visites sur 3
// d'Amoris (19/10) étaient classées « interne » (marketplace). La page /l/
// garde ici le VRAI référent (Instagram, rien pour WhatsApp…) et ajoute les UTM
// du lien à l'URL de la soirée.
const ENTRY_REFERRER_KEY = 'yuno_entry_ref';
const RELAY_RE = /^https?:\/\/(www\.)?(yunoapp\.eu|localhost(:\d+)?)\/l\//i;

/** À appeler par la page /l/ juste avant de rediriger. */
export function rememberEntryReferrer(referrer: string): void {
  try {
    sessionStorage.setItem(ENTRY_REFERRER_KEY, RELAY_RE.test(referrer) ? '' : referrer);
  } catch {
    // stockage indisponible : la source retombera sur « direct »
  }
}

/** Le référent de l'ARRIVÉE : le vrai, même quand la page vient d'un lien suivi. */
export function entryReferrer(): string {
  const ref = typeof document !== 'undefined' ? document.referrer || '' : '';
  if (!RELAY_RE.test(ref)) return ref;
  try {
    return sessionStorage.getItem(ENTRY_REFERRER_KEY) ?? '';
  } catch {
    return '';
  }
}

const SOCIAL_SOURCES = ['instagram', 'tiktok', 'facebook', 'whatsapp', 'snapchat', 'twitter', 'x', 'threads', 'youtube', 'linkedin'];
const EMAIL_SOURCES = ['newsletter', 'email', 'mail'];
const META_SOURCES = ['meta', 'meta_ads', 'facebook_ads'];
// Liens de partenaires, DJ, co-organisateurs, promoteurs : quelqu'un d'autre
// que l'hôte a partagé la soirée.
const AFFILIATE_MEDIUMS = ['affiliate', 'promoter', 'partner_link', 'dj_link', 'party_link'];

export function categorizeReferrer(referrer: string, utmMedium: string | null, urlParams: URLSearchParams): string {
  const utmSource = (urlParams.get('utm_source') || '').toLowerCase();
  const medium = (utmMedium || '').toLowerCase();
  // QR code: yuno standard adds ?from=qr
  if (urlParams.get('from') === 'qr' || medium === 'qr') return 'qr';
  if (medium === 'email' || medium === 'newsletter' || urlParams.get('from') === 'email' || EMAIL_SOURCES.includes(utmSource)) return 'email';
  if (urlParams.get('gclid')) return 'paid_search';
  // Publicité Meta = les liens de pub Yuno (utm_source meta). `fbclid` seul ne
  // dit rien : Instagram et Facebook l'ajoutent à TOUT lien cliqué, bio et
  // stories comprises — il classait du trafic gratuit en « payant ».
  if (META_SOURCES.includes(utmSource) || medium === 'paid_social') return 'paid_social';
  if (medium === 'cpc' || medium === 'paid') return 'paid';
  if (AFFILIATE_MEDIUMS.includes(medium)) return 'affiliate';
  if (SOCIAL_SOURCES.includes(utmSource)) return 'social';
  if (!referrer) return urlParams.get('fbclid') ? 'social' : 'direct';

  const domain = extractDomain(referrer)?.toLowerCase() || '';
  // Webmail avant moteurs : mail.google.com est un e-mail, pas une recherche.
  if (/(mail|gmail|outlook|yahoo\.mail)/.test(domain)) return 'email';
  if (/(google|bing|duckduckgo|yahoo|ecosia|qwant|baidu)\./.test(domain)) return 'search';
  if (/(instagram|facebook|fb\.com|tiktok|twitter|x\.com|snapchat|linkedin|pinterest|youtube|reddit|threads)/.test(domain)) return 'social';
  if (/(yunoapp\.eu|yuno-bar-buddy)/.test(domain)) return 'internal';
  return 'referral';
}
