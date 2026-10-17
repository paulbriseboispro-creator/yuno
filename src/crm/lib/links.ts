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

/**
 * Ce que le pro peut CRÉER — miroir EXACT de `_crm_link_creatable` (SQL).
 * Seuls les emplacements où un lien se clique vraiment : Instagram = le sticker
 * d'une story ou le lien en bio (une légende de post ou de reel n'est pas
 * cliquable), TikTok = le lien en bio seulement. Les liens d'e-mail, de SMS et
 * de réponse Instagram ne se créent pas ici : Yuno les pose seul à l'envoi.
 */
export const LINK_KINDS: readonly LinkKind[] = [
  { platform: 'instagram', placement: 'story', perPost: true },
  { platform: 'instagram', placement: 'bio', perPost: false },
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

/**
 * Emplacements retirés de la création mais encore LUS : un lien déjà posé
 * (post, reel, DM, vidéo TikTok) garde son libellé et ses ventes.
 */
export const LEGACY_KINDS: readonly LinkKind[] = [
  { platform: 'instagram', placement: 'post', perPost: true },
  { platform: 'instagram', placement: 'reel', perPost: true },
  { platform: 'instagram', placement: 'dm', perPost: false },
  { platform: 'tiktok', placement: 'video', perPost: true },
];

export const kindKey = (platform: string, placement: string) => `${platform}.${placement}`;

export function findKind(platform: string, placement: string): LinkKind | null {
  return [...LINK_KINDS, ...LEGACY_KINDS].find((k) => k.platform === platform && k.placement === placement) ?? null;
}

/** Les quatre gestes du quotidien, en tête de l'écran (Instagram, TikTok, WhatsApp). */
export const QUICK_KINDS: readonly LinkKind[] = [
  LINK_KINDS[0], // story Instagram
  LINK_KINDS[1], // lien en bio Instagram
  LINK_KINDS[2], // lien en bio TikTok
  LINK_KINDS[3], // groupe WhatsApp
];

export interface NightLink {
  id: string;
  code: string;
  label: string;
  platform: LinkPlatform;
  placement: LinkPlacement;
  source: string;
  /** Capture de la story, jointe à la création (facultative). */
  image_url?: string | null;
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

export type SourceKind = 'link' | 'email' | 'sms' | 'dm' | 'shotgun' | 'direct' | 'social' | 'extmail' | 'search' | 'site' | 'offline';

/**
 * Famille d'une source, MIROIR EXACT de `_crm_ticket_source` (SQL, migration
 * 20261018100000) — même ordre de règles, mêmes expressions. Seule différence :
 * le SQL détaille un lien Yuno (`ys`, `yb`, `yt`) en lisant `tracked_links`,
 * ici tout lien Yuno rend `yl`.
 *
 * Shotgun écrit dans `utm_source` soit un mot (`instagram`, `newsletter`), soit
 * le DOMAINE qui a amené l'acheteur (`instagram.com`, `l.facebook.com`,
 * `ezapv.r.ag.d.sendibm3.com`) : le domaine est ramené à sa forme nue (schéma,
 * chemin, `www.`, `l.`, `m.`, `lm.` retirés) puis lu mot par mot.
 */
export type SourceFamily = 'yl' | 'em' | 'sm' | 'dm' | 'so' | 'sg' | 'ex' | 'se' | 'au' | 'di' | 'of';

const RE_SOCIAL_WORD = /(^|[^a-z0-9])(instagram|insta|ig|facebook|fb|messenger|tiktok|snapchat|threads|twitter|linkedin|youtube|pinterest|reddit|whatsapp|telegram|discord)([^a-z0-9]|$)/;
const RE_SOCIAL_HOST = /^(x\.com|t\.co|youtu\.be|lnkd\.in|pin\.it|wa\.me|t\.me)$/;
const RE_SHOTGUN_HOST = /(^|\.)shotgun\.(live|app|io|fr)$/;
const RE_EXT_MAIL = /(^|[^a-z0-9])(brevo|sendinblue|sendibm[0-9]*|mailchimp|list-manage|mcusercontent|mailerlite|mlsend|mailjet|klaviyo|sendgrid|substack|beehiiv|convertkit|hubspotemail|newsletters?|mailing|emailing|e?mail[0-9]*|webmail|zimbra|outlook|gmail|hotmail|roundcube)([^a-z0-9]|$)|android\.gm$/;
const RE_SEARCH = /(^|[^a-z0-9])(google|bing|duckduckgo|qwant|ecosia|yahoo|yandex|baidu|startpage|chatgpt|openai|perplexity)([^a-z0-9]|$)|(^|\.)(claude|mistral)\.ai$|(^|\.)copilot\.microsoft\.com$/;

/** Forme nue d'une source : `https://www.google.com/search?q=…` → `google.com`. */
export function sourceHost(src: string | null | undefined): string {
  return (src ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#:].*$/, '')
    .replace(/^((www[0-9]*|l|m|lm|mobile|web|mbasic|touch)\.)+/, '');
}

export function sourceFamily(src: string | null | undefined): SourceFamily {
  const s = (src ?? '').trim().toLowerCase();
  if (!s) return 'of';
  if (s === 'yuno' || s.startsWith('yuno-m-')) return 'em';
  if (s.startsWith('yuno-s-')) return 'sm';
  if (s.startsWith('yuno-d-')) return 'dm';
  if (s.startsWith('yuno-')) return 'yl';
  if (s === 'shotgun') return 'sg';
  if (s === 'direct') return 'di';
  const h = sourceHost(s);
  if (!h) return 'au';
  if (RE_SHOTGUN_HOST.test(h)) return 'sg';
  if (h === 'x' || RE_SOCIAL_HOST.test(h) || RE_SOCIAL_WORD.test(h)) return 'so';
  if (RE_EXT_MAIL.test(h)) return 'ex';
  if (RE_SEARCH.test(h)) return 'se';
  return 'au';
}

const KIND_OF: Record<SourceFamily, SourceKind> = {
  yl: 'link', em: 'email', sm: 'sms', dm: 'dm', so: 'social', sg: 'shotgun',
  ex: 'extmail', se: 'search', au: 'site', di: 'direct', of: 'offline',
};

/**
 * Famille d'une source pour l'affichage d'une soirée (`sourceFamily` en clair).
 * `yuno-<code>` = un lien Yuno ; `yuno-m-…` / `yuno-s-…` / `yuno-d-…` = un
 * e-mail, un SMS, une réponse Instagram de Yuno ; `yuno` seul = e-mails Yuno
 * d'avant la source par campagne ; `shotgun` = l'app ou le site Shotgun ;
 * `direct` = lien collé, messagerie ; rien = billet importé ou vendu hors ligne.
 */
export function sourceKind(src: string | null | undefined): SourceKind {
  return KIND_OF[sourceFamily(src)];
}

// Nom lisible d'une source, pour l'affichage seulement (jamais pour classer).
const SOURCE_BRANDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|[^a-z0-9])(instagram|insta|ig)([^a-z0-9]|$)/, 'Instagram'],
  [/(^|[^a-z0-9])(facebook|fb)([^a-z0-9]|$)/, 'Facebook'],
  [/(^|[^a-z0-9])messenger([^a-z0-9]|$)/, 'Messenger'],
  [/(^|[^a-z0-9])tiktok([^a-z0-9]|$)/, 'TikTok'],
  [/(^|[^a-z0-9])snapchat([^a-z0-9]|$)/, 'Snapchat'],
  [/(^|[^a-z0-9])(whatsapp)([^a-z0-9]|$)|^wa\.me$/, 'WhatsApp'],
  [/(^|[^a-z0-9])(twitter)([^a-z0-9]|$)|^(x|x\.com|t\.co)$/, 'X'],
  [/(^|[^a-z0-9])(brevo|sendinblue|sendibm[0-9]*)([^a-z0-9]|$)/, 'Brevo'],
  [/(^|[^a-z0-9])(mailchimp|list-manage|mcusercontent)([^a-z0-9]|$)/, 'Mailchimp'],
  [/(^|[^a-z0-9])(mailerlite|mlsend)([^a-z0-9]|$)/, 'MailerLite'],
  [/(^|[^a-z0-9])outlook([^a-z0-9]|$)/, 'Outlook'],
  [/(^|[^a-z0-9])gmail([^a-z0-9]|$)|android\.gm$/, 'Gmail'],
  [/^shotgun-e?mail$/, 'Shotgun'],
  [/(^|[^a-z0-9])google([^a-z0-9]|$)/, 'Google'],
  [/(^|[^a-z0-9])bing([^a-z0-9]|$)/, 'Bing'],
  [/(^|[^a-z0-9])(chatgpt|openai)([^a-z0-9]|$)/, 'ChatGPT'],
  [/(^|[^a-z0-9])perplexity([^a-z0-9]|$)/, 'Perplexity'],
];
export function sourceName(src: string | null | undefined): string {
  const h = sourceHost(src);
  for (const [re, name] of SOURCE_BRANDS) if (re.test(h)) return name;
  return h || (src ?? '').trim();
}

export const SOURCE_ORDER: readonly SourceKind[] = ['link', 'email', 'sms', 'dm', 'social', 'shotgun', 'extmail', 'search', 'site', 'direct', 'offline'];

export interface SourceRow { source: string | null; tickets: number; orders: number; revenue: number | null }

export interface SourceGroup {
  kind: SourceKind;
  tickets: number;
  revenue: number | null;
  names: string[];
  /** Famille `link` seulement : billets par type de lien (`instagram.story`, `tiktok.bio`…), du plus vendeur au moins. */
  kinds: { key: string; tickets: number }[];
}

/**
 * Regroupe les sources d'une soirée par famille, dans l'ordre d'affichage.
 * Avec les liens de la soirée, la famille `link` se détaille par type : une
 * story Instagram et le lien en bio ne se confondent plus.
 */
export function groupSources(rows: readonly SourceRow[], links: readonly Pick<NightLink, 'source' | 'platform' | 'placement'>[] = []): SourceGroup[] {
  const bySrc = new Map(links.map((l) => [l.source.toLowerCase(), kindKey(l.platform, l.placement)]));
  const m = new Map<SourceKind, SourceGroup>();
  for (const r of rows) {
    const k = sourceKind(r.source);
    const g = m.get(k) ?? { kind: k, tickets: 0, revenue: r.revenue === null ? null : 0, names: [], kinds: [] };
    if (k === 'link') {
      const key = bySrc.get((r.source ?? '').toLowerCase()) ?? kindKey('other', 'link');
      const e = g.kinds.find((x) => x.key === key);
      if (e) e.tickets += r.tickets; else g.kinds.push({ key, tickets: r.tickets });
      g.kinds.sort((a, b) => b.tickets - a.tickets);
    }
    g.tickets += r.tickets;
    if (g.revenue !== null && r.revenue !== null) g.revenue += r.revenue;
    else g.revenue = null;
    if (k === 'social' || k === 'extmail' || k === 'search' || k === 'site') {
      const name = r.source ? sourceName(r.source) : '';
      if (name && !g.names.includes(name)) g.names.push(name);
    }
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
  if (src.kind === 'yl' || src.kind === 'ys' || src.kind === 'yb' || src.kind === 'yt') return src.label ? t('yc.cli.card.src.link', { name: src.label }) : t('yc.ana.src.yl');
  if (src.kind === 'em') return src.label ? t('yc.cli.card.src.email', { name: src.label }) : t('yc.ana.src.em');
  if (src.kind === 'so' && src.src) return t('yc.cli.card.src.social', { name: sourceName(src.src) });
  if ((src.kind === 'ex' || src.kind === 'se' || src.kind === 'au') && src.src) return sourceName(src.src);
  return t(`yc.ana.src.${src.kind}`);
}
