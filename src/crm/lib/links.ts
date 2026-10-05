/**
 * Liens de soirée Yuno CRM (story, bio, post…) — règles pures, testées.
 * Serveur : migration 20261006200000_crm_night_links.sql ; redirection :
 * worker/goLink.ts (qui importe `buildGoDestination` d'ici).
 *
 * Un lien = `yunoapp.eu/go/<code>`. Yuno compte le clic ; la redirection vers
 * Shotgun porte `utm_source=yuno-<code>`, que l'API Tickets rend sur chaque
 * billet acheté via ce lien. D'où les deux mesures, et seulement elles :
 * clics (Yuno) et billets / acheteurs (Shotgun).
 */

export type LinkPlatform = 'instagram' | 'tiktok' | 'whatsapp' | 'facebook' | 'snapchat' | 'other';
export type LinkPlacement = 'story' | 'bio' | 'post' | 'reel' | 'dm' | 'video' | 'group' | 'message' | 'event' | 'flyer' | 'partner' | 'link';

export interface LinkKind {
  platform: LinkPlatform;
  placement: LinkPlacement;
  /** Un lien par publication (story, post…) : chaque nouvelle en crée un. Sinon (bio) : on réutilise le lien existant. */
  perPost: boolean;
}

/** Miroir EXACT de `_crm_link_kind_ok` (SQL). */
export const LINK_KINDS: readonly LinkKind[] = [
  { platform: 'instagram', placement: 'story', perPost: true },
  { platform: 'instagram', placement: 'bio', perPost: false },
  { platform: 'instagram', placement: 'post', perPost: true },
  { platform: 'instagram', placement: 'reel', perPost: true },
  { platform: 'instagram', placement: 'dm', perPost: false },
  { platform: 'tiktok', placement: 'video', perPost: true },
  { platform: 'tiktok', placement: 'bio', perPost: false },
  { platform: 'whatsapp', placement: 'group', perPost: true },
  { platform: 'whatsapp', placement: 'message', perPost: false },
  { platform: 'facebook', placement: 'post', perPost: true },
  { platform: 'facebook', placement: 'event', perPost: false },
  { platform: 'snapchat', placement: 'story', perPost: true },
  { platform: 'other', placement: 'flyer', perPost: true },
  { platform: 'other', placement: 'partner', perPost: true },
  { platform: 'other', placement: 'link', perPost: true },
];

export const kindKey = (platform: string, placement: string) => `${platform}.${placement}`;

export function findKind(platform: string, placement: string): LinkKind | null {
  return LINK_KINDS.find((k) => k.platform === platform && k.placement === placement) ?? null;
}

/** Les quatre gestes du quotidien, en tête de l'écran. */
export const QUICK_KINDS: readonly LinkKind[] = [
  LINK_KINDS[0], // story Instagram
  LINK_KINDS[1], // bio Instagram
  LINK_KINDS[3], // reel Instagram
  LINK_KINDS[7], // groupe WhatsApp
];

export interface NightLink {
  id: string;
  code: string;
  label: string;
  platform: LinkPlatform;
  placement: LinkPlacement;
  source: string;
  created_at: string;
  archived: boolean;
  clicks: number;
  visitors: number;
  clicks_24h: number;
  last_click_at: string | null;
  mobile_pct: number | null;
  spark: number[];
  tickets: number;
  orders: number;
  revenue: number | null;
  buyers: number;
  new_buyers: number;
  first_sale_at: string | null;
  people: { email: string; name: string | null; tickets: number; is_new: boolean; at: string }[];
}

/** Numéro de la prochaine publication d'un même type (« Story 4 »). */
export function nextIndex(links: readonly Pick<NightLink, 'platform' | 'placement'>[], kind: LinkKind): number {
  return links.filter((l) => l.platform === kind.platform && l.placement === kind.placement).length + 1;
}

/** Lien déjà créé pour un emplacement unique (bio) : on le réutilise au lieu d'en créer un autre. */
export function reusableLink<T extends Pick<NightLink, 'platform' | 'placement' | 'archived'>>(links: readonly T[], kind: LinkKind): T | null {
  if (kind.perPost) return null;
  return links.find((l) => l.platform === kind.platform && l.placement === kind.placement && !l.archived) ?? null;
}

export const GO_HOST_PATH = '/go/';

export function goUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, '')}${GO_HOST_PATH}${code}`;
}

/** « yunoapp.eu/go/k5s54beg » : ce que le pro colle dans un sticker. */
export function goDisplay(base: string, code: string): string {
  return goUrl(base, code).replace(/^https?:\/\//, '');
}

export interface GoHit {
  url: string;
  source: string;
  medium?: string | null;
  campaign?: string | null;
}

/** URL de destination : la page Shotgun + la source du lien. Null si l'URL n'est pas https. */
export function buildGoDestination(hit: GoHit): string | null {
  let u: URL;
  try {
    u = new URL(hit.url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  u.searchParams.set('utm_source', hit.source);
  if (hit.medium) u.searchParams.set('utm_medium', hit.medium);
  u.searchParams.set('utm_campaign', hit.campaign || 'yuno');
  return u.toString();
}

// ── Sources que Shotgun rapporte pour une vente ─────────────────────────────

export type SourceKind = 'link' | 'email' | 'sms' | 'dm' | 'shotgun' | 'direct' | 'social' | 'site' | 'offline';

const SOCIAL = new Set(['instagram', 'ig', 'facebook', 'fb', 'tiktok', 'snapchat', 'twitter', 'x', 'threads', 'linkedin', 'youtube', 'pinterest', 'messenger']);

/**
 * Miroir de `_crm_ticket_source` (SQL) pour l'affichage d'une soirée.
 * `yuno-<code>` = un lien Yuno ; `yuno-m-…` / `yuno-s-…` / `yuno-d-…` = un
 * e-mail, un SMS, une réponse Instagram de Yuno ; `yuno` seul = e-mails Yuno
 * d'avant la source par campagne ; `shotgun` = l'app ou le site Shotgun ;
 * `direct` = lien collé, messagerie ; rien = billet importé ou vendu hors ligne.
 */
export function sourceKind(src: string | null | undefined): SourceKind {
  const s = (src ?? '').trim().toLowerCase();
  if (!s) return 'offline';
  if (s.startsWith('yuno-m-') || s === 'yuno') return 'email';
  if (s.startsWith('yuno-s-')) return 'sms';
  if (s.startsWith('yuno-d-')) return 'dm';
  if (s.startsWith('yuno-')) return 'link';
  if (s === 'shotgun') return 'shotgun';
  if (s === 'direct') return 'direct';
  if (SOCIAL.has(s)) return 'social';
  return 'site';
}

export const SOURCE_ORDER: readonly SourceKind[] = ['link', 'email', 'sms', 'dm', 'social', 'shotgun', 'site', 'direct', 'offline'];

export interface SourceRow { source: string | null; tickets: number; orders: number; revenue: number | null }

/** Regroupe les sources d'une soirée par famille, dans l'ordre d'affichage. */
export function groupSources(rows: readonly SourceRow[]): { kind: SourceKind; tickets: number; revenue: number | null; names: string[] }[] {
  const m = new Map<SourceKind, { kind: SourceKind; tickets: number; revenue: number | null; names: string[] }>();
  for (const r of rows) {
    const k = sourceKind(r.source);
    const g = m.get(k) ?? { kind: k, tickets: 0, revenue: r.revenue === null ? null : 0, names: [] };
    g.tickets += r.tickets;
    if (g.revenue !== null && r.revenue !== null) g.revenue += r.revenue;
    else g.revenue = null;
    if ((k === 'social' || k === 'site') && r.source && !g.names.includes(r.source)) g.names.push(r.source);
    m.set(k, g);
  }
  return SOURCE_ORDER.filter((k) => m.has(k)).map((k) => m.get(k)!);
}

/** En dessous, un taux ne veut rien dire (règle MIN_SAMPLE de metrics.ts). */
export const LINK_MIN_VISITORS = 10;

/** Part de visiteurs qui ont acheté (commandes / visiteurs), null sous le seuil. */
export function linkConversion(l: Pick<NightLink, 'visitors' | 'orders'>): number | null {
  if (l.visitors < LINK_MIN_VISITORS) return null;
  return Math.min(1, l.orders / l.visitors);
}

/** Le lien qui a vendu le plus, s'il a assez de visiteurs pour être lu. */
export function bestLink<T extends NightLink>(links: readonly T[]): T | null {
  const ok = links.filter((l) => l.tickets > 0 && l.visitors >= LINK_MIN_VISITORS);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => b.tickets - a.tickets || b.orders / b.visitors - a.orders / a.visitors)[0];
}

/**
 * État d'un lien, pour ne jamais afficher « 0 vente » quand on ne sait pas :
 * - `new` : aucun clic encore ;
 * - `waiting` : des clics, mais Shotgun n'a encore jamais renvoyé de vente
 *   portant une source de lien Yuno (sur tout l'espace) — on attend la preuve ;
 * - `clicks` : des clics, pas encore de vente rapportée ;
 * - `selling` : au moins une vente rapportée par Shotgun.
 */
export type LinkState = 'new' | 'waiting' | 'clicks' | 'selling';

export function linkState(l: Pick<NightLink, 'clicks' | 'tickets'>, confirmed: boolean): LinkState {
  if (l.tickets > 0) return 'selling';
  if (l.clicks === 0) return 'new';
  return confirmed ? 'clicks' : 'waiting';
}

/**
 * Phrase courte pour la source d'un achat (« Story 2 », « l'e-mail Line-up »,
 * « App et site Shotgun »…). `t` = traducteur de la Console.
 */
export function saleSourceText(
  src: { kind: string; label?: string | null; src?: string | null } | null | undefined,
  t: (k: string, v?: Record<string, string | number | null | undefined>) => string,
): string | null {
  if (!src) return null;
  if (src.kind === 'yl') return src.label ? t('yc.cli.card.src.link', { name: src.label }) : t('yc.ana.src.yl');
  if (src.kind === 'em') return src.label ? t('yc.cli.card.src.email', { name: src.label }) : t('yc.ana.src.em');
  if (src.kind === 'so' && src.src) return t('yc.cli.card.src.social', { name: src.src.charAt(0).toUpperCase() + src.src.slice(1) });
  if (src.kind === 'au' && src.src) return src.src;
  return t(`yc.ana.src.${src.kind}`);
}
