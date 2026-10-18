/**
 * Liens partenaires — un lien suivi et une page de stats par personne, pour
 * UNE soirée, sans compte (migration 20261017200000).
 *
 * Un lien partenaire est une ligne `tracked_links` qui porte `partner_name` et
 * un jeton secret (`partner_token`, posé par le serveur). Le jeton ouvre la
 * page publique /stats/<jeton>. Ce module garde les règles pures partagées par
 * la Console et la page publique.
 */

export const PARTNER_ROLES = ['promoter', 'dj', 'artist', 'ambassador', 'other'] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

/** Noms de canaux réservés (miroir du trigger tracked_links_partner_normalize). */
export const RESERVED_PARTNER_NAMES = [
  'instagram', 'tiktok', 'newsletter', 'facebook', 'whatsapp', 'flyer', 'snapchat', 'coorg',
] as const;

export const PARTNER_NAME_MAX = 60;
export const PARTNER_CODE_MIN = 3;
export const PARTNER_CODE_MAX = 40;

export function isPartnerRole(value: unknown): value is PartnerRole {
  return typeof value === 'string' && (PARTNER_ROLES as readonly string[]).includes(value);
}

export function cleanPartnerName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function isReservedPartnerName(raw: string): boolean {
  return (RESERVED_PARTNER_NAMES as readonly string[]).includes(cleanPartnerName(raw).toLowerCase());
}

/** « Sami B. », « Nuit Amoris » → « sami-b-nuit-amoris » (minuscules, chiffres, tirets). */
export function slugifyPart(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Code proposé pour /l/<code> : le prénom, la soirée, et un suffixe court qui
 * évite la collision avec un autre partenaire du même nom. Le pro peut le
 * réécrire ; `isValidPartnerCode` dit ce que la Console accepte.
 */
export function suggestPartnerCode(name: string, eventTitle: string, suffix: string): string {
  const who = slugifyPart(name).slice(0, 18).replace(/-+$/, '');
  const night = slugifyPart(eventTitle).slice(0, 16).replace(/-+$/, '');
  const tail = slugifyPart(suffix).slice(0, 4);
  return [who || 'partenaire', night, tail].filter(Boolean).join('-').slice(0, PARTNER_CODE_MAX);
}

export function isValidPartnerCode(code: string): boolean {
  return code.length >= PARTNER_CODE_MIN
    && code.length <= PARTNER_CODE_MAX
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code);
}

/** Ce que le champ « Code » accepte pendant la frappe (le tiret final est toléré). */
export function sanitizePartnerCodeInput(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, PARTNER_CODE_MAX);
}

export type ContactKind = 'phone' | 'email';

/** Le contact enregistré est un téléphone (« +33 6 … ») ou une adresse email. */
export function contactKindOf(contact: string | null | undefined): ContactKind | null {
  const v = (contact ?? '').trim();
  if (!v) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  if (v.replace(/\D/g, '').length >= 8) return 'phone';
  return null;
}

export function isValidPartnerContact(contact: string): boolean {
  const v = contact.trim();
  return v === '' || (v.length <= 120 && contactKindOf(v) !== null);
}

/** Lien PUBLIC de la page de stats — jamais `window.location.origin` (WebView = capacitor://). */
export function partnerPageUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/stats/${token}`;
}

export function partnerLinkUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/l/${code}`;
}

/** Message prêt à envoyer : le lien de vente et la page de stats. */
export function partnerShareMessage(template: string, vars: {
  name: string; event: string; link: string; page: string;
}): string {
  return template
    .replace(/\{name\}/g, vars.name)
    .replace(/\{event\}/g, vars.event)
    .replace(/\{link\}/g, vars.link)
    .replace(/\{page\}/g, vars.page);
}

/** Où envoyer le message : WhatsApp (chiffres seuls) ou email ; null sans contact utilisable. */
export function partnerSendHref(
  contact: string | null | undefined,
  subject: string,
  message: string,
): string | null {
  const kind = contactKindOf(contact);
  if (kind === 'email') {
    return `mailto:${encodeURIComponent((contact ?? '').trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  }
  if (kind === 'phone') {
    const digits = (contact ?? '').replace(/\D/g, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }
  return null;
}

/** Taux de conversion lisible, une décimale ; null sans clic. */
export function partnerConversion(sales: number, clicks: number): number | null {
  if (!clicks || clicks <= 0) return null;
  return Math.round((sales / clicks) * 1000) / 10;
}

/** Initiale de l'avatar d'un partenaire. */
export function partnerInitial(name: string): string {
  const clean = cleanPartnerName(name).replace(/^dj\s+/i, '');
  return (clean.charAt(0) || '?').toUpperCase();
}

/** Origine PUBLIQUE des liens partagés (jamais `window.location.origin`). */
export const PUBLIC_BASE_URL = (import.meta.env?.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';

/** Les deux liens à transmettre, le message prêt et où l'envoyer (WhatsApp / email). */
export function buildPartnerShare(
  row: { code: string; partner_name: string; partner_token: string; partner_contact: string | null },
  t: (key: string) => string,
  eventTitle?: string | null,
  baseUrl: string = PUBLIC_BASE_URL,
) {
  const link = partnerLinkUrl(baseUrl, row.code);
  const page = partnerPageUrl(baseUrl, row.partner_token);
  const message = partnerShareMessage(t('plink.shareMessage'), {
    name: row.partner_name.split(' ')[0], event: eventTitle ?? '', link, page,
  });
  const subject = t('plink.shareSubject').replace('{event}', eventTitle ?? '');
  return { link, page, message, href: partnerSendHref(row.partner_contact, subject, message) };
}

// ─── Page publique ──────────────────────────────────────────────────────────

export interface PartnerPageSale {
  kind: 'ticket' | 'table' | 'guestlist' | 'order';
  at: string;
  buyer: string | null;
  item: string | null;
  qty: number | null;
  amount: number | null;
}

export interface PartnerPageData {
  found: boolean;
  closed?: boolean;
  partner_name?: string;
  partner_role?: PartnerRole;
  event_title?: string;
  owner_name?: string | null;
  code?: string;
  is_active?: boolean;
  shows_revenue?: boolean;
  closes_at?: string;
  event?: {
    title: string;
    start_at: string;
    end_at: string | null;
    timezone: string;
    poster_url: string | null;
    location_name: string | null;
    location_city: string | null;
    host_name: string | null;
  };
  totals?: { clicks: number; sales: number; revenue: number | null };
  days?: { day: string; clicks: number }[];
  sales?: PartnerPageSale[];
}

/** Le jeton a la forme posée par le serveur (32 hexadécimaux) : sinon, pas d'appel. */
export function isPartnerToken(token: string | undefined | null): token is string {
  return !!token && /^[0-9a-f]{32}$/.test(token);
}
