// ─────────────────────────────────────────────────────────────────────────────
// Sections sur mesure des e-mails — les balises Yuno.
//
// Une section est du HTML écrit par le pro ou par son IA (via le MCP Yuno). Les
// balises lui donnent l'intelligence des blocs Yuno, résolue À L'ENVOI : titre
// et date de la soirée, prix d'appel, tarifs et « complet », line-up et photos,
// tables restantes, guest list, compte à rebours, prénom du destinataire, et
// les liens de vente — suivis (/l/<code>, yc=) ou marqués pour la billetterie
// connectée (utm_source=yuno-m-<campagne>). Le dessin est libre ; les données
// et l'attribution restent celles de Yuno.
//
// Syntaxe Handlebars, que les IA connaissent :
//   {{event.title}}  {{#if event.sold_out}}…{{else}}…{{/if}}
//   {{#each tickets}}{{name}} {{price}}{{/each}}   {{#unless x}}…{{/unless}}
// Les formes Mustache {{#x}}…{{/x}} et {{^x}}…{{/x}} sont comprises aussi.
// Toute valeur est échappée : il n'existe pas de {{{brut}}}.
//
// SOURCE UNIQUE, module pur (aucun import) : le front le ré-exporte
// (src/lib/email/smart.ts), le port Deno du rendu l'importe
// (email-studio-html.ts), le Worker MCP aussi (worker/mcp). L'aperçu du Studio,
// le contrôle du MCP et l'envoi disent donc exactement la même chose.
// Testé par src/lib/email/__tests__/smart.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { emailWords, formatEuroIn, type EmailWordsLang } from './email-words.ts';

export type SmartLang = 'fr' | 'en' | 'es';

export const SMART_LANGS: readonly SmartLang[] = ['fr', 'en', 'es'];

export function smartLang(v: unknown): SmartLang {
  return v === 'en' || v === 'es' ? v : 'fr';
}

/** Une ligne de tarif telle que les données live la portent. */
export interface SmartTicketRow { id?: string; n: string; s: string; p: string; out: boolean }
export interface SmartArtist { name: string; photo?: string | null }
export interface SmartPackRow { id?: string; n: string; s: string; p: string }
export interface SmartGuestList {
  freeBefore: string | null;
  includesDrink: boolean;
  remaining: number | null;
  soldOut?: boolean;
}

/**
 * Données live d'une soirée, forme commune à LiveEventData (front) et
 * StudioLiveEventData (Deno) : un objet de l'un ou de l'autre convient tel quel.
 */
export interface SmartEvent {
  title: string;
  startAt: string;
  timezone?: string | null;
  dateLabel?: string;
  venueLabel: string;
  coverUrl?: string | null;
  url: string;
  priceFromLabel?: string | null;
  tickets?: SmartTicketRow[];
  guestListOnly?: boolean;
  guestList?: SmartGuestList | null;
  tablesLeft?: number | null;
  tablesOpen?: boolean;
  tablePacks?: SmartPackRow[];
  tableZones?: SmartPackRow[];
  lineup?: SmartArtist[];
  trackedUrl?: string | null;
  entryTrackedUrl?: string | null;
  /** Soirée d'une billetterie connectée (Shotgun…) : pas de page Yuno. */
  external?: boolean;
}

export interface SmartRecipient {
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  lastEventTitle?: string | null;
  loyaltyPoints?: number | null;
  /** Yuno CRM (profil d'analyse, résolu par lot à l'envoi). */
  artistName?: string | null;
  firstNightTitle?: string | null;
  nightsCount?: number | null;
}

export interface SmartSocial {
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  x?: string;
  website?: string;
}

export interface SmartInput {
  /** Soirée de la section (son eventId, sinon celle de la campagne). */
  event?: SmartEvent | null;
  language?: SmartLang;
  now?: Date;
  recipient?: SmartRecipient | null;
  brand?: { name?: string | null; logoUrl?: string | null; city?: string | null } | null;
  social?: SmartSocial | null;
}

// ── Textes par langue ────────────────────────────────────────────────────────
// Les valeurs que les balises écrivent elles-mêmes : les MÊMES mots que les
// blocs Yuno natifs (_shared/email-words.ts), dans la langue de l'e-mail.

interface SmartWords {
  locale: string;
  lang: EmailWordsLang;
  priceFrom: (amount: string) => string;
  free: string;
  onRequest: string;
  tablesFrom: (amount: string) => string;
  tablesLeft: (n: number) => string;
  glFreeBefore: (t: string) => string;
  glFree: string;
  glDrink: string;
  glFull: string;
  glRemaining: (n: number) => string;
}

function smartWords(lang: SmartLang): SmartWords {
  const w = emailWords(lang);
  return {
    locale: w.locale,
    lang,
    priceFrom: w.priceFrom,
    free: w.free,
    onRequest: w.onRequest,
    tablesFrom: w.fromShort,
    tablesLeft: (n) => w.tablesLeft(n, TABLE_SCARCITY_THRESHOLD),
    glFreeBefore: w.glFreeBefore,
    glFree: w.glFreeEntry,
    glDrink: w.freeDrink,
    glFull: w.full,
    glRemaining: w.spotsLeft,
  };
}

/** Même seuil que les blocs Yuno : « plus que 3 tables » fait agir. */
const TABLE_SCARCITY_THRESHOLD = 3;

// ── Petits outils ────────────────────────────────────────────────────────────

export function escapeSmart(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function httpsUrl(u: unknown): string {
  const s = typeof u === 'string' ? u.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : '';
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** « À partir de 18 € » → { amount: « 18 € » } ; « Gratuit » → { free: true }. */
function parsePriceLabel(label: string | null | undefined): { amount: string; free: boolean } | null {
  const s = String(label || '').trim();
  if (!s) return null;
  const m = /(€?\s*\d[\d\s.,\u00a0]*\s*€?)\s*$/.exec(s);
  if (m) return { amount: m[1].trim(), free: false };
  return { amount: '', free: true };
}

function parseAmount(p: string): number | null {
  const m = /(\d[\d\s\u00a0]*(?:[.,]\d+)?)/.exec(String(p || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function euro(n: number, lang: EmailWordsLang = 'fr'): string {
  return formatEuroIn(n, lang);
}

/** Les quelques prix écrits en toutes lettres par les blocs Yuno, dans la langue de l'e-mail. */
function localizePrice(p: string, w: SmartWords): string {
  // Les données arrivent déjà dans la langue de l'e-mail ; une donnée en
  // français (aperçu sans langue, ancienne donnée) est traduite au passage.
  const s = String(p || '').trim();
  if (/^(gratuit|free|gratis)$/i.test(s)) return w.free;
  if (/^(sur demande|on request|bajo petici[oó]n)$/i.test(s)) return w.onRequest;
  const des = /^(?:dès|from|desde)\s+(.+)$/i.exec(s);
  if (des) return w.tablesFrom(des[1]);
  return s;
}

function initials(name: string): string {
  const words = String(name || '').split(/\s+/)
    .filter((x) => /[\p{L}\p{N}]/u.test(x) && !/^(b2b|b3b|vs\.?|x|feat\.?|ft\.?|&|and|et|y)$/i.test(x));
  return words.slice(0, 2).map((x) => (x.match(/[\p{L}\p{N}]/u) || [''])[0]).join('').toUpperCase() || '?';
}

/**
 * Page où l'on choisit sa place (billets, guest list publique, tables) : `/billets`
 * sur les formes d'URL qui la portent, l'intention en paramètre sur un lien
 * suivi (`/l/<code>`). Miroir de eventSelectionUrl (src/lib/email/live.ts).
 */
export function smartSelectionUrl(url: string, tracked: boolean): string {
  const raw = String(url || '');
  if (!raw) return raw;
  const i = raw.indexOf('?');
  const path = i === -1 ? raw : raw.slice(0, i);
  const query = i === -1 ? '' : raw.slice(i + 1);
  if (tracked) return `${raw}${query ? '&' : '?'}to=billets`;
  const deep = /\/events\/[^/?#]+\/[^/?#]+$/.test(path) || /\/club\/[^/?#]+\/event\/[^/?#]+$/.test(path);
  if (!deep) return raw;
  return `${path}/billets${query ? `?${query}` : ''}`;
}

function formatParts(startAt: string, tz: string, w: SmartWords) {
  const d = new Date(startAt);
  if (!Number.isFinite(d.getTime())) return null;
  const zone = tz || 'Europe/Paris';
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(w.locale, { ...o, timeZone: zone }).format(d);
    } catch {
      return new Intl.DateTimeFormat(w.locale, { ...o, timeZone: 'Europe/Paris' }).format(d);
    }
  };
  const weekday = fmt({ weekday: 'long' });
  const day = fmt({ day: 'numeric' });
  const month = fmt({ month: 'long' });
  const year = fmt({ year: 'numeric' });
  const time = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
  const longDate = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
  const short = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
  return { weekday, day, month, year, time, longDate, short };
}

// ── Les données d'une section ────────────────────────────────────────────────

/** Ce que lisent les balises d'une section, pour un destinataire. */
export function buildSmartData(input: SmartInput): Record<string, unknown> {
  const lang = smartLang(input.language);
  const w = smartWords(lang);
  const ev = input.event || null;
  const r = input.recipient || {};
  const now = input.now || new Date();

  const data: Record<string, unknown> = {
    first_name: (r.firstName || '').trim(),
    last_name: (r.lastName || '').trim(),
    city: (r.city || input.brand?.city || '').trim(),
    last_event: (r.lastEventTitle || '').trim(),
    loyalty_points: r.loyaltyPoints != null ? String(r.loyaltyPoints) : '',
    artist: (r.artistName || '').trim(),
    first_night: (r.firstNightTitle || '').trim(),
    nights: r.nightsCount != null && r.nightsCount > 0 ? r.nightsCount : '',
    venue_name: (input.brand?.name || '').trim(),
    brand: {
      name: (input.brand?.name || '').trim(),
      logo: httpsUrl(input.brand?.logoUrl),
      city: (input.brand?.city || '').trim(),
    },
    social: {
      instagram: httpsUrl(input.social?.instagram),
      tiktok: httpsUrl(input.social?.tiktok),
      facebook: httpsUrl(input.social?.facebook),
      x: httpsUrl(input.social?.x),
      website: httpsUrl(input.social?.website),
    },
  };

  if (!ev) {
    data.event = null;
    data.tickets = [];
    data.lineup = [];
    data.tables = { available: false, packs: [], zones: [] };
    data.guestlist = { available: false };
    data.countdown = { days: 0, hours: '00', minutes: '00', over: true };
    data.event_title = '';
    return data;
  }

  const external = !!ev.external;
  const tracked = !!ev.trackedUrl;
  const eventUrl = ev.trackedUrl || ev.url || '';
  const ticketsUrl = external ? (ev.url || '') : smartSelectionUrl(eventUrl, tracked);
  const tablesUrl = external ? '' : ticketsUrl;
  const glUrl = external ? '' : (ev.entryTrackedUrl || ticketsUrl);

  const parts = formatParts(ev.startAt, ev.timezone || 'Europe/Paris', w);
  const dateText = parts ? capitalize(`${parts.longDate} · ${parts.time}`) : (ev.dateLabel || '');

  const rows = Array.isArray(ev.tickets) ? ev.tickets : [];
  const tickets = rows.map((t) => ({
    name: t.n || '',
    detail: t.s || '',
    price: localizePrice(t.p, w),
    sold_out: !!t.out,
  }));
  const onSale = rows.some((t) => !t.out);
  const soldOut = rows.length > 0 && !onSale;

  const price = parsePriceLabel(ev.priceFromLabel);
  const priceFrom = !price ? '' : price.free ? w.free : w.priceFrom(price.amount);

  const lineup = (Array.isArray(ev.lineup) ? ev.lineup : [])
    .filter((a) => a && String(a.name || '').trim())
    .slice(0, 24)
    .map((a) => ({ name: String(a.name).trim(), photo: httpsUrl(a.photo), initials: initials(String(a.name)) }));

  const left = ev.tablesLeft;
  const tablesOpen = ev.tablesOpen !== false && left != null;
  const packs = (Array.isArray(ev.tablePacks) ? ev.tablePacks : []).map((p) => ({ name: p.n || '', detail: p.s || '', price: localizePrice(p.p, w) }));
  const zones = (Array.isArray(ev.tableZones) ? ev.tableZones : []).map((p) => ({ name: p.n || '', detail: p.s || '', price: localizePrice(p.p, w) }));
  const packAmounts = (Array.isArray(ev.tablePacks) ? ev.tablePacks : []).map((p) => parseAmount(p.p)).filter((n): n is number => n != null);
  const leftN = typeof left === 'number' ? Math.max(0, left) : 0;
  const leftLabel = !tablesOpen ? '' : w.tablesLeft(leftN);

  const gl = ev.guestList || null;
  const glClosed = !!gl && (!!gl.soldOut || gl.remaining === 0);
  let glSummary = '';
  if (gl) {
    const bits = [gl.freeBefore ? w.glFreeBefore(gl.freeBefore) : w.glFree];
    if (gl.includesDrink) bits.push(w.glDrink);
    if (glClosed) bits.push(w.glFull);
    else if (gl.remaining != null) bits.push(w.glRemaining(gl.remaining));
    glSummary = bits.join(' · ');
  }

  const start = new Date(ev.startAt).getTime();
  const diff = Number.isFinite(start) ? Math.max(0, start - now.getTime()) : 0;
  const pad = (n: number) => String(Math.max(0, n)).padStart(2, '0');

  data.event = {
    title: ev.title || '',
    date: dateText,
    date_short: parts ? parts.short : '',
    weekday: parts ? parts.weekday : '',
    day: parts ? parts.day : '',
    month: parts ? parts.month : '',
    year: parts ? parts.year : '',
    time: parts ? parts.time : '',
    venue: ev.venueLabel || '',
    cover: httpsUrl(ev.coverUrl),
    url: eventUrl,
    tickets_url: ticketsUrl,
    tables_url: tablesUrl,
    guestlist_url: glUrl,
    price_from: priceFrom,
    price: !price ? '' : price.free ? w.free : price.amount,
    on_sale: onSale,
    sold_out: soldOut,
    lineup: lineup.map((a) => a.name).join(' · '),
    external,
  };
  data.event_title = ev.title || '';
  data.tickets = tickets;
  data.lineup = lineup;
  data.tables = {
    available: tablesOpen && leftN > 0,
    sold_out: tablesOpen && leftN <= 0,
    left: tablesOpen ? leftN : 0,
    left_label: leftLabel,
    price_from: packAmounts.length ? w.tablesFrom(euro(Math.min(...packAmounts), w.lang)) : '',
    url: tablesUrl,
    packs: tablesOpen ? packs : [],
    zones: tablesOpen ? zones : [],
  };
  data.guestlist = {
    available: !!gl && !glClosed && !external,
    sold_out: glClosed,
    free_before: gl?.freeBefore || '',
    drink: !!gl?.includesDrink,
    remaining: gl && gl.remaining != null ? gl.remaining : '',
    summary: glSummary,
    url: glUrl,
  };
  data.countdown = {
    days: Math.floor(diff / 86_400_000),
    hours: pad(Math.floor((diff % 86_400_000) / 3_600_000)),
    minutes: pad(Math.floor((diff % 3_600_000) / 60_000)),
    over: diff <= 0,
  };
  return data;
}

// ── Référence des balises ────────────────────────────────────────────────────

export type SmartTagKind = 'text' | 'url' | 'image' | 'boolean' | 'number' | 'list';

export interface SmartTagDef { tag: string; kind: SmartTagKind; desc: string }

/** Ce que l'IA (kit MCP) et le pro (inspecteur du Studio) peuvent écrire. */
export const SMART_TAGS: readonly SmartTagDef[] = [
  { tag: 'event.title', kind: 'text', desc: 'Event title.' },
  { tag: 'event.date', kind: 'text', desc: 'Long date and time in the email language, event timezone ("Jeudi 9 octobre · 23:00").' },
  { tag: 'event.date_short', kind: 'text', desc: 'Short date ("jeu. 9 oct.").' },
  { tag: 'event.weekday', kind: 'text', desc: 'Weekday ("jeudi").' },
  { tag: 'event.day', kind: 'text', desc: 'Day of the month ("9").' },
  { tag: 'event.month', kind: 'text', desc: 'Month name ("octobre").' },
  { tag: 'event.year', kind: 'text', desc: 'Year ("2026").' },
  { tag: 'event.time', kind: 'text', desc: 'Start time ("23:00").' },
  { tag: 'event.venue', kind: 'text', desc: 'Venue and city ("Club — Madrid"), or the public address of the ticketing.' },
  { tag: 'event.cover', kind: 'image', desc: 'Event poster URL (https). Empty when the event has none: wrap it in {{#if event.cover}}.' },
  { tag: 'event.url', kind: 'url', desc: 'Event page, tracked (Yuno tracked link, or the connected ticketing page with Yuno UTM).' },
  { tag: 'event.tickets_url', kind: 'url', desc: 'Where people buy: the ticket selection page (tracked) or the connected ticketing page (Shotgun). Use it for the main buy button.' },
  { tag: 'event.tables_url', kind: 'url', desc: 'VIP table booking (Yuno ticketing only; empty for an external ticketing).' },
  { tag: 'event.guestlist_url', kind: 'url', desc: 'Free guest list signup form (Yuno only; empty for an external ticketing).' },
  { tag: 'event.price_from', kind: 'text', desc: 'Entry price hook ("À partir de 18 €", "Gratuit"); empty when no price is known or when sold out.' },
  { tag: 'event.price', kind: 'text', desc: 'Lowest open price alone ("18 €", "Gratuit").' },
  { tag: 'event.on_sale', kind: 'boolean', desc: 'At least one ticket tier still open.' },
  { tag: 'event.sold_out', kind: 'boolean', desc: 'Every ticket tier is sold out (or ticketing closed by hand). Use it to swap the buy button for a "Complet" message.' },
  { tag: 'event.lineup', kind: 'text', desc: 'Line-up names joined with " · ".' },
  { tag: 'event.external', kind: 'boolean', desc: 'The event sells on an external ticketing (Shotgun…): no Yuno tables or guest list.' },
  { tag: 'tickets', kind: 'list', desc: 'Ticket tiers, live: {{#each tickets}}{{name}} {{price}} {{detail}} {{#if sold_out}}…{{/if}}{{/each}}.' },
  { tag: 'lineup', kind: 'list', desc: 'Artists, live: {{#each lineup}}{{name}} {{photo}} {{initials}}{{/each}}. photo is an https URL or empty.' },
  { tag: 'tables.available', kind: 'boolean', desc: 'VIP tables open with at least one left.' },
  { tag: 'tables.sold_out', kind: 'boolean', desc: 'Tables open but none left.' },
  { tag: 'tables.left', kind: 'number', desc: 'Tables left.' },
  { tag: 'tables.left_label', kind: 'text', desc: 'Scarcity line ("Plus que 2 tables", "Dernière table").' },
  { tag: 'tables.price_from', kind: 'text', desc: 'Cheapest table pack ("dès 300 €").' },
  { tag: 'tables.url', kind: 'url', desc: 'Same as event.tables_url.' },
  { tag: 'tables.packs', kind: 'list', desc: 'Table packs: {{#each tables.packs}}{{name}} {{detail}} {{price}}{{/each}}.' },
  { tag: 'tables.zones', kind: 'list', desc: 'Table zones with their entry price: {{#each tables.zones}}{{name}} {{detail}} {{price}}{{/each}}.' },
  { tag: 'guestlist.available', kind: 'boolean', desc: 'A public guest list is open.' },
  { tag: 'guestlist.sold_out', kind: 'boolean', desc: 'The guest list is full or closed.' },
  { tag: 'guestlist.summary', kind: 'text', desc: '"Gratuit avant 00:30 · boisson offerte · 42 places restantes".' },
  { tag: 'guestlist.free_before', kind: 'text', desc: 'Free entry deadline ("00:30").' },
  { tag: 'guestlist.drink', kind: 'boolean', desc: 'A free drink is included.' },
  { tag: 'guestlist.remaining', kind: 'number', desc: 'Spots left, only when the organizer shows it.' },
  { tag: 'guestlist.url', kind: 'url', desc: 'Same as event.guestlist_url.' },
  { tag: 'countdown.days', kind: 'number', desc: 'Days until doors, computed when the email leaves.' },
  { tag: 'countdown.hours', kind: 'text', desc: 'Remaining hours, 2 digits.' },
  { tag: 'countdown.minutes', kind: 'text', desc: 'Remaining minutes, 2 digits.' },
  { tag: 'countdown.over', kind: 'boolean', desc: 'The event has started.' },
  { tag: 'first_name', kind: 'text', desc: 'Recipient first name, often unknown: {{#if first_name}}Salut {{first_name}}{{else}}Salut{{/if}}. Alias {{prénom}}.' },
  { tag: 'last_name', kind: 'text', desc: 'Recipient last name. Alias {{nom}}.' },
  { tag: 'artist', kind: 'text', desc: 'Yuno CRM: the artist the recipient saw most who plays this event, else their most seen non-resident artist, often empty: {{#if artist}}{{artist}} is back{{else}}The line-up is out{{/if}}. Alias {{artiste}}.' },
  { tag: 'first_night', kind: 'text', desc: 'Yuno CRM: title of the recipient\'s first night, often empty. Alias {{premiere_soiree}}.' },
  { tag: 'nights', kind: 'number', desc: 'Yuno CRM: number of nights the recipient came to, empty when unknown. Alias {{nb_soirees}}.' },
  { tag: 'city', kind: 'text', desc: 'Recipient city when known, else the account city. Alias {{ville}}.' },
  { tag: 'venue_name', kind: 'text', desc: 'Account (club or organizer) name. Alias {{nom_club}}.' },
  { tag: 'event_title', kind: 'text', desc: 'Same as event.title. Alias {{soirée}}.' },
  { tag: 'brand.name', kind: 'text', desc: 'Account name.' },
  { tag: 'brand.logo', kind: 'image', desc: 'Account logo URL (https), empty when none.' },
  { tag: 'social.instagram', kind: 'url', desc: 'Instagram link of the account, empty when none (also tiktok, facebook, x, website).' },
];

/** Champs d'un élément de liste, par liste. */
const LIST_ITEM_FIELDS: Record<string, readonly string[]> = {
  tickets: ['name', 'price', 'detail', 'sold_out'],
  lineup: ['name', 'photo', 'initials'],
  'tables.packs': ['name', 'detail', 'price'],
  'tables.zones': ['name', 'detail', 'price'],
};

/** Noms de premier niveau acceptés en français (et sans accents). */
const ROOT_ALIASES: Record<string, string> = {
  prenom: 'first_name', firstname: 'first_name', first_name: 'first_name',
  nom: 'last_name', lastname: 'last_name', last_name: 'last_name',
  ville: 'city', city: 'city',
  dernier_event: 'last_event', last_event: 'last_event',
  points_fidelite: 'loyalty_points', loyalty_points: 'loyalty_points',
  nom_club: 'venue_name', club: 'venue_name', venue_name: 'venue_name',
  soiree: 'event_title', event_title: 'event_title',
  artiste: 'artist', artist: 'artist',
  premiere_soiree: 'first_night', first_night: 'first_night',
  nb_soirees: 'nights', nights: 'nights',
};

const KNOWN_PATHS = new Set<string>([
  ...SMART_TAGS.map((t) => t.tag),
  'social.tiktok', 'social.facebook', 'social.x', 'social.website', 'brand.city',
  'event', 'tables', 'guestlist', 'countdown', 'brand', 'social',
  'last_event', 'loyalty_points',
]);

function normRoot(seg: string): string {
  const k = stripAccents(seg).toLowerCase();
  return ROOT_ALIASES[k] || seg;
}

/** Chemin canonique d'une balise (alias français résolus). */
export function canonicalTag(path: string): string {
  const p = path.trim();
  if (!p || p === 'this' || p === '.' || p.startsWith('@')) return p;
  const segs = p.split('.');
  segs[0] = normRoot(segs[0]);
  return segs.join('.');
}

// ── Analyse ──────────────────────────────────────────────────────────────────

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string; raw: string }
  | { t: 'block'; kind: 'if' | 'unless' | 'each' | 'section' | 'inverted'; path: string; body: Node[]; alt: Node[]; raw: string };

export interface SmartParseIssue { code: 'unclosed_block' | 'unexpected_close' | 'mismatched_close' | 'raw_html_tag'; tag: string }

interface Frame { node: Extract<Node, { t: 'block' }>; inAlt: boolean; name: string }

const TAG_RE = /\{\{(\{?)\s*([\s\S]*?)\s*(\}?)\}\}/g;

/** Découpe une section en arbre. Tolérant : une erreur est notée, jamais levée. */
export function parseSmart(template: string): { nodes: Node[]; issues: SmartParseIssue[] } {
  const root: Node[] = [];
  const stack: Frame[] = [];
  const issues: SmartParseIssue[] = [];
  const out = (): Node[] => {
    const top = stack[stack.length - 1];
    return top ? (top.inAlt ? top.node.alt : top.node.body) : root;
  };
  let last = 0;
  const src = String(template || '');
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(src)) !== null) {
    if (m.index > last) out().push({ t: 'text', v: src.slice(last, m.index) });
    last = m.index + m[0].length;
    const raw = m[0];
    if (m[1] === '{') issues.push({ code: 'raw_html_tag', tag: raw });
    const body = m[2].replace(/^~|~$/g, '').trim();
    if (!body || body.startsWith('!')) continue;
    if (body === 'else' || body === '^') {
      const top = stack[stack.length - 1];
      if (top) top.inAlt = true;
      else issues.push({ code: 'unexpected_close', tag: raw });
      continue;
    }
    const lead = body[0];
    if (lead === '#' || lead === '^') {
      const rest = body.slice(1).trim();
      const word = /^(if|unless|each|with)\s+([\s\S]+)$/.exec(rest);
      let kind: 'if' | 'unless' | 'each' | 'section' | 'inverted';
      let path: string;
      let name: string;
      if (lead === '^') { kind = 'inverted'; path = rest; name = rest; }
      else if (word) {
        kind = word[1] === 'each' ? 'each' : word[1] === 'unless' ? 'unless' : word[1] === 'with' ? 'section' : 'if';
        path = word[2].trim();
        name = word[1];
      } else { kind = 'section'; path = rest; name = rest; }
      const node: Extract<Node, { t: 'block' }> = { t: 'block', kind, path: canonicalTag(path), body: [], alt: [], raw };
      out().push(node);
      stack.push({ node, inAlt: false, name });
      continue;
    }
    if (lead === '/') {
      const name = body.slice(1).trim();
      const top = stack[stack.length - 1];
      if (!top) { issues.push({ code: 'unexpected_close', tag: raw }); continue; }
      if (top.name !== name && canonicalTag(top.name) !== canonicalTag(name)) {
        issues.push({ code: 'mismatched_close', tag: raw });
      }
      stack.pop();
      continue;
    }
    out().push({ t: 'var', path: canonicalTag(body), raw });
  }
  if (last < src.length) out().push({ t: 'text', v: src.slice(last) });
  for (const f of stack) issues.push({ code: 'unclosed_block', tag: f.node.raw });
  return { nodes: root, issues };
}

// ── Rendu ────────────────────────────────────────────────────────────────────

interface LoopFrame { index: number; first: boolean; last: boolean }

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return !!v;
}

const MISSING = Symbol('missing');

function lookup(path: string, stack: unknown[], loop: LoopFrame | null): unknown {
  if (path === 'this' || path === '.') return stack[stack.length - 1];
  if (path.startsWith('@')) {
    if (!loop) return undefined;
    if (path === '@index') return loop.index;
    if (path === '@first') return loop.first;
    if (path === '@last') return loop.last;
    return undefined;
  }
  const segs = path.split('.');
  for (let i = stack.length - 1; i >= 0; i--) {
    const ctx = stack[i];
    if (ctx && typeof ctx === 'object' && !Array.isArray(ctx) && Object.prototype.hasOwnProperty.call(ctx, segs[0])) {
      let v: unknown = (ctx as Record<string, unknown>)[segs[0]];
      for (let j = 1; j < segs.length; j++) {
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, segs[j])) {
          v = (v as Record<string, unknown>)[segs[j]];
        } else {
          return undefined;
        }
      }
      return v;
    }
  }
  return MISSING;
}

function renderNodes(nodes: Node[], stack: unknown[], loop: LoopFrame | null): string {
  let s = '';
  for (const n of nodes) {
    if (n.t === 'text') { s += n.v; continue; }
    if (n.t === 'var') {
      const v = lookup(n.path, stack, loop);
      // Balise inconnue : laissée visible (corrigeable), jamais du vide silencieux.
      if (v === MISSING) { s += n.raw; continue; }
      if (v == null || typeof v === 'boolean' || typeof v === 'object') continue;
      s += escapeSmart(v);
      continue;
    }
    const v = lookup(n.path, stack, loop);
    const val = v === MISSING ? undefined : v;
    if (n.kind === 'if') { s += renderNodes(truthy(val) ? n.body : n.alt, stack, loop); continue; }
    if (n.kind === 'unless' || n.kind === 'inverted') { s += renderNodes(!truthy(val) ? n.body : n.alt, stack, loop); continue; }
    if (Array.isArray(val)) {
      if (!val.length) { s += renderNodes(n.alt, stack, loop); continue; }
      val.forEach((item, i) => {
        s += renderNodes(n.body, [...stack, item], { index: i, first: i === 0, last: i === val.length - 1 });
      });
      continue;
    }
    if (n.kind === 'each') { s += renderNodes(n.alt, stack, loop); continue; }
    if (!truthy(val)) { s += renderNodes(n.alt, stack, loop); continue; }
    s += renderNodes(n.body, val && typeof val === 'object' ? [...stack, val] : stack, loop);
  }
  return s;
}

/** Résout les balises d'une section. Pur ; ne lève jamais. */
export function renderSmartTemplate(template: string, data: Record<string, unknown>): string {
  if (!template || template.indexOf('{{') === -1) return template || '';
  const { nodes } = parseSmart(template);
  return renderNodes(nodes, [data], null);
}

// ── Nettoyage ────────────────────────────────────────────────────────────────

const PAIRED_DROP = ['script', 'style', 'iframe', 'object', 'applet', 'noscript', 'template', 'svg', 'math', 'video', 'audio', 'canvas', 'select', 'textarea'];
const VOID_DROP = ['link', 'meta', 'base', 'frame', 'frameset', 'param', 'source', 'track', 'input', 'keygen', 'embed'];
const UNWRAP = ['form', 'button', 'label', 'fieldset'];
const URL_ATTRS = ['href', 'src', 'background', 'poster', 'action', 'cite', 'longdesc', 'lowsrc', 'dynsrc'];

/**
 * Le schéma d'une URL tel que le navigateur le lit : entités décodées, blancs
 * et caractères de contrôle ignorés (« java&#9;script: » reste `javascript:`).
 */
export function decodeForScheme(v: string): string {
  const decoded = v
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&(tab|newline);/gi, '');
  let out = '';
  for (const ch of decoded) if (ch.charCodeAt(0) > 0x1f && !/\s/.test(ch)) out += ch;
  return out.toLowerCase();
}

/** true = une URL sans danger dans un e-mail (https, http, mailto, tel, ancre, relative, balise). */
export function safeEmailUrl(v: string): boolean {
  const raw = String(v || '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('{{')) return true;
  const d = decodeForScheme(raw);
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(d);
  if (!scheme) return true;
  return ['https', 'http', 'mailto', 'tel', 'cid'].includes(scheme[1]);
}

export interface SanitizeResult { html: string; removed: string[] }

/**
 * Retire d'une section ce qu'un e-mail ne doit jamais porter : script, style,
 * iframe, formulaire, svg, vidéo, attributs `on*`, URL `javascript:` /
 * `data:`… et l'enveloppe d'un document complet (on garde le corps).
 * Les commentaires conditionnels Outlook (`<!--[if mso]>`) restent.
 */
export function sanitizeSectionHtml(input: string): SanitizeResult {
  let h = String(input || '');
  const removed = new Set<string>();
  const note = (tag: string) => removed.add(tag);

  const body = /<body\b[^>]*>([\s\S]*?)(<\/body\s*>|$)/i.exec(h);
  if (body) { h = body[1]; note('document'); }
  h = h.replace(/<!doctype[^>]*>/gi, () => { note('document'); return ''; });
  h = h.replace(/<head\b[\s\S]*?<\/head\s*>/gi, () => { note('head'); return ''; });
  h = h.replace(/<\/?(html|head|body)\b[^>]*>/gi, () => { note('document'); return ''; });

  for (const tag of PAIRED_DROP) {
    h = h.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), () => { note(tag); return ''; });
    h = h.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), () => { note(tag); return ''; });
  }
  for (const tag of VOID_DROP) {
    h = h.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), () => { note(tag); return ''; });
  }
  for (const tag of UNWRAP) {
    h = h.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), () => { note(tag); return ''; });
  }

  // Attributs d'événement et d'exécution.
  h = h.replace(/\s(on[a-z]+|srcdoc|formaction|ping|xmlns:xlink|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (_m, a: string) => {
    note(`${a.toLowerCase().startsWith('on') ? 'on*' : a.toLowerCase()} attribute`);
    return '';
  });

  // URL dangereuses : neutralisées.
  const urlRe = new RegExp(`(\\s(?:${URL_ATTRS.join('|')})\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
  h = h.replace(urlRe, (m, pre: string, _all: string, dq?: string, sq?: string, bare?: string) => {
    const v = dq ?? sq ?? bare ?? '';
    if (safeEmailUrl(v)) return m;
    note('unsafe url');
    return /href/i.test(pre) ? `${pre}"#"` : '';
  });

  // CSS exécutable (vieux IE / Outlook) et url() dangereuses.
  h = h.replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:/gi, () => { note('css expression'); return ''; });
  h = h.replace(/url\(\s*(['"]?)\s*(javascript|vbscript|data)\s*:[^)]*\)/gi, () => { note('unsafe url'); return 'none'; });

  return { html: h, removed: [...removed] };
}

/**
 * Applique `fn` à chaque lien (`href`, y compris celui d'un bouton VML
 * Outlook). Les entités sont décodées avant, ré-échappées après.
 */
export function mapSectionLinks(html: string, fn: (url: string) => string): string {
  return String(html || '').replace(/(\shref\s*=\s*)("([^"]*)"|'([^']*)')/gi, (_m, pre: string, _all: string, dq?: string, sq?: string) => {
    const raw = (dq ?? sq ?? '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    if (!raw || raw.startsWith('#') || /^(mailto|tel):/i.test(raw)) return _m;
    const next = fn(raw);
    return `${pre}"${String(next).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
  });
}

/** Plafond d'une section rendue (au-delà, Gmail coupe l'e-mail). */
export const SECTION_MAX_CHARS = 60_000;

/**
 * Rend une section pour un destinataire : balises résolues, puis nettoyage,
 * puis liens suivis (`track`). C'est LA fonction que le Studio, l'aperçu et
 * l'envoi appellent.
 */
export function renderSmartSection(code: string, data: Record<string, unknown>, track?: (url: string) => string): string {
  const resolved = renderSmartTemplate(String(code || '').slice(0, SECTION_MAX_CHARS * 2), data);
  const clean = mobileSafeHtml(sanitizeSectionHtml(resolved).html);
  return track ? mapSectionLinks(clean, track) : clean;
}

/**
 * Filet anti-débordement mobile pour du HTML écrit à la main ou par une IA.
 * Deux fautes récurrentes, corrigées à l'envoi comme à l'aperçu : un bloc en
 * `width:100%` qui porte aussi un `padding` (sans `box-sizing`, il dépasse de
 * son parent de la valeur du padding) et une largeur fixe de plus de 320 px
 * sans `max-width` (elle dépasse d'un téléphone de 375 px).
 */
export function mobileSafeHtml(html: string): string {
  return String(html || '').replace(/<(?!img\b)([a-z][a-z0-9]*)\b([^>]*?\sstyle\s*=\s*)("([^"]*)"|'([^']*)')([^>]*)>/gi,
    (m, tag: string, pre: string, _q: string, dq: string | undefined, sq: string | undefined, post: string) => {
      const style = dq ?? sq ?? '';
      let add = '';
      const full = /(^|;)\s*width\s*:\s*100%/i.test(style);
      if (full && /(^|;)\s*padding(-[a-z]+)?\s*:\s*[^;]*[1-9]/i.test(style) && !/box-sizing/i.test(style)) add += ';box-sizing:border-box';
      const px = /(^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style);
      if (px && Number(px[2]) > 320 && !/max-width/i.test(style)) add += ';max-width:100%;box-sizing:border-box';
      if (!add) return m;
      const q = dq !== undefined ? '"' : "'";
      return `<${tag}${pre}${q}${style.replace(/;?\s*$/, '')}${add}${q}${post}>`;
    });
}

// ── Ce qu'une section demande aux données ────────────────────────────────────

export interface SmartNeeds { event: boolean; lineup: boolean; tables: boolean; guestlist: boolean }

function collectPaths(nodes: Node[], into: string[]): void {
  for (const n of nodes) {
    if (n.t === 'var') into.push(n.path);
    if (n.t === 'block') {
      into.push(n.path);
      collectPaths(n.body, into);
      collectPaths(n.alt, into);
    }
  }
}

/** Les balises utilisées, dans l'ordre (alias résolus). */
export function smartPaths(code: string): string[] {
  if (!code || code.indexOf('{{') === -1) return [];
  const paths: string[] = [];
  collectPaths(parseSmart(code).nodes, paths);
  return paths;
}

/** La section lit-elle une soirée, son line-up, ses tables ? (données live à charger) */
export function smartNeeds(code: string): SmartNeeds {
  const paths = smartPaths(code);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  return {
    event: has(/^(event|tickets|lineup|tables|guestlist|countdown|event_title)(\.|$)/),
    lineup: has(/^lineup(\.|$)|^event\.lineup$/),
    tables: has(/^tables(\.|$)|^event\.tables_url$/),
    guestlist: has(/^guestlist(\.|$)|^event\.guestlist_url$/),
  };
}

// ── Contrôle qualité (MCP + Studio) ──────────────────────────────────────────

export type SmartIssueLevel = 'error' | 'warning';

export interface SmartIssue {
  code: string;
  level: SmartIssueLevel;
  message: string;
  /** Section concernée (index 0), absent = l'e-mail entier. */
  section?: number;
}

const SAFE_ITEM_PATHS = new Set(['this', '.', '@index', '@first', '@last']);

function lintPaths(nodes: Node[], lists: string[], out: Set<string>): void {
  for (const n of nodes) {
    if (n.t === 'text') continue;
    const p = n.path;
    const inList = lists.length > 0;
    const itemFields = inList ? (LIST_ITEM_FIELDS[lists[lists.length - 1]] || []) : [];
    const known = SAFE_ITEM_PATHS.has(p) || KNOWN_PATHS.has(p) || (inList && itemFields.includes(p.split('.')[0]));
    if (!known) out.add(p);
    if (n.t === 'block') {
      const isList = n.kind === 'each' || (n.kind === 'section' && !!LIST_ITEM_FIELDS[p]);
      lintPaths(n.body, isList && LIST_ITEM_FIELDS[p] ? [...lists, p] : lists, out);
      lintPaths(n.alt, lists, out);
    }
  }
}

function attrValues(html: string, attr: string): string[] {
  const re = new RegExp(`\\s${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[2] ?? m[3] ?? '');
  return out;
}

export interface LintSectionOptions {
  /** Index de la section dans l'e-mail (pour le message). */
  index?: number;
  /** Une soirée est reliée (section ou campagne). */
  hasEvent?: boolean;
  /** Données de cette soirée telles que les balises les rendent (buildSmartData). */
  data?: Record<string, unknown> | null;
  /** URL publiques de la soirée (page, billetterie) : un lien écrit en dur vers elles perd le suivi. */
  eventUrls?: string[];
}

/**
 * Contrôle d'une section : balises inconnues ou mal fermées, éléments que les
 * clients mail ignorent ou que Yuno retire, images sans texte alternatif, liens
 * de vente écrits en dur (ventes non attribuées), pied de page dupliqué.
 * Les messages sont en anglais : ils sont lus par l'IA du pro.
 */
export function lintSmartSection(code: string, opt: LintSectionOptions = {}): SmartIssue[] {
  const issues: SmartIssue[] = [];
  const section = opt.index;
  const add = (lv: SmartIssueLevel, c: string, message: string) => issues.push({ code: c, level: lv, message, section });
  const src = String(code || '');
  if (!src.trim()) { add('error', 'empty_section', 'This section is empty.'); return issues; }
  if (src.length > SECTION_MAX_CHARS) {
    add('error', 'section_too_large', `This section is ${Math.round(src.length / 1000)} KB; keep each section under ${SECTION_MAX_CHARS / 1000} KB (Gmail clips heavy emails and hides the footer).`);
  }

  const { nodes, issues: parse } = parseSmart(src);
  for (const p of parse) {
    if (p.code === 'raw_html_tag') add('error', 'raw_tag', `Triple braces are not supported (${p.tag}): every Yuno tag is escaped, use {{…}}.`);
    else add('error', 'unbalanced_tag', `Block tag not closed properly: ${p.tag}. Close every {{#if}}/{{#each}}/{{#unless}} with its {{/if}}/{{/each}}/{{/unless}}.`);
  }
  const unknown = new Set<string>();
  lintPaths(nodes, [], unknown);
  for (const u of unknown) add('error', 'unknown_tag', `Unknown Yuno tag {{${u}}}. Use only the tags listed in get_email_design_kit (smart_tags).`);

  const needs = smartNeeds(src);
  if (needs.event && !opt.hasEvent) {
    add('error', 'event_tags_without_event', 'This section uses event tags but the draft has no event: pass "event" on the draft (or on the section).');
  }

  const removed = sanitizeSectionHtml(src).removed;
  if (removed.length) {
    add('warning', 'removed_elements', `Yuno strips these from emails: ${removed.join(', ')}. Use tables and inline styles only (no <style>, scripts, forms, SVG or video).`);
  }

  // Images.
  const imgs = src.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter((t) => !/\salt\s*=/i.test(t)).length;
  if (noAlt) add('warning', 'img_no_alt', `${noAlt} image(s) without alt text: many clients block images by default, the alt text is what people read.`);
  const noWidth = imgs.filter((t) => !/\swidth\s*=/i.test(t)).length;
  if (noWidth) add('warning', 'img_no_width', `${noWidth} image(s) without a width attribute: Outlook renders them at their natural size.`);
  const httpImg = attrValues(src, 'src').filter((u) => /^http:\/\//i.test(u.trim())).length;
  if (httpImg) add('warning', 'img_insecure', `${httpImg} image(s) served over http: use https URLs.`);
  if (/\{\{\s*event\.cover\s*\}\}/.test(src) && opt.data && !(opt.data.event as Record<string, unknown> | null)?.cover && !/\{\{#if\s+event\.cover\s*\}\}/.test(src)) {
    add('warning', 'cover_missing', 'The event has no poster: {{event.cover}} would render an empty image. Wrap it in {{#if event.cover}}…{{/if}}.');
  }

  // CSS que les clients mail ne suivent pas.
  if (/display\s*:\s*(flex|grid|inline-flex)/i.test(src)) add('warning', 'css_flex_grid', 'display:flex/grid is ignored by Outlook and many Gmail apps: build columns with tables.');
  if (/position\s*:\s*(absolute|fixed|sticky)/i.test(src)) add('warning', 'css_position', 'position:absolute/fixed is stripped by most email clients: layer with tables or background images instead.');
  if (/\sclass\s*=/i.test(src) && !/style\s*=/i.test(src)) add('warning', 'css_classes', 'Classes have no CSS in an email (styles are removed): put every style inline.');
  const wide = attrValues(src, 'width').map((x) => Number(String(x).replace(/px$/i, ''))).filter((n) => Number.isFinite(n) && n > 600);
  if (wide.length || /width\s*:\s*(6[0-9]{2}|[7-9]\d{2}|\d{4,})px/i.test(src)) add('warning', 'too_wide', 'Elements wider than 600 px overflow on mobile: the email container is 600 px.');

  if (/margin(-[a-z]+)?\s*:\s*[^;"']*-\d+(px)?/i.test(src)) add('warning', 'negative_margin', 'Negative margins push content outside its container on mobile: use the container padding instead.');
  if (/(^|[;"'\s])width\s*:\s*(3[2-9]\d|[4-5]\d{2})px/i.test(src)) add('warning', 'fixed_width_mobile', 'Fixed widths above 320 px overflow on a 375 px phone: use width:100% with max-width, never a fixed pixel width, for cards and boxes (Yuno adds max-width:100% as a safety net, check the preview).');
  if (/width\s*:\s*100%[^"']*padding\s*:/i.test(src) && !/box-sizing/i.test(src)) add('warning', 'width_100_padding', 'width:100% plus padding overflows its parent (the padding is added on top): put the padding on an inner <td> or add box-sizing:border-box.');

  // Liens.
  const hrefs = attrValues(src, 'href');
  const httpLinks = hrefs.filter((u) => /^http:\/\//i.test(u.trim())).length;
  if (httpLinks) add('warning', 'link_insecure', `${httpLinks} link(s) over http: use https.`);
  const eventUrls = (opt.eventUrls || []).map((u) => u.split('?')[0].replace(/\/+$/, '')).filter(Boolean);
  const hard = hrefs.filter((u) => {
    const base = u.trim().split('?')[0].replace(/\/+$/, '');
    return (base && eventUrls.includes(base)) || /^https?:\/\/(www\.)?yunoapp\.eu\/(event|events|club|l)\//i.test(u.trim());
  }).length;
  if (hard) add('warning', 'hardcoded_event_link', `${hard} link(s) to the event typed by hand: use {{event.tickets_url}} / {{event.url}} so clicks and sales are attributed to this email.`);
  if (/(unsubscribe|d[ée]sinscri|d[ée]sabonn|darse de baja|cancelar suscripci)/i.test(src)) {
    add('warning', 'own_unsubscribe', 'Yuno adds the legal footer with the unsubscribe link itself: remove yours to avoid two.');
  }

  // Données de la soirée.
  const d = opt.data;
  if (d && needs.lineup && Array.isArray(d.lineup) && d.lineup.length === 0 && !/\{\{#(if|each)\s+lineup/.test(src)) {
    add('warning', 'lineup_empty', 'The event has no line-up yet: guard the line-up with {{#if lineup}}…{{/if}}.');
  }
  if (d && needs.tables && !((d.tables as Record<string, unknown> | undefined)?.available) && !/\{\{#(if|unless)\s+tables\.available/.test(src)) {
    add('warning', 'tables_unavailable', 'This event has no VIP table on sale right now: wrap the tables part in {{#if tables.available}}…{{/if}}.');
  }
  return issues;
}

/** true = la section porte au moins un lien de vente suivi (balise). */
export function hasSmartSalesLink(code: string): boolean {
  return smartPaths(code).some((p) => /^(event\.(url|tickets_url|tables_url|guestlist_url)|tables\.url|guestlist\.url)$/.test(p));
}

export interface LintEmailInput {
  subject: string;
  subjectB?: string | null;
  preheader?: string | null;
  /** Une section porte au moins un lien suivi, ou un bloc Yuno natif est posé. */
  hasTrackedLink: boolean;
  /** Poids estimé du HTML rendu (caractères). */
  renderedChars?: number;
  /** Une section au moins contient du texte lisible (pas seulement des images). */
  hasText?: boolean;
}

/** Contrôles qui portent sur l'e-mail entier (objet, lien de vente, poids). */
export function lintEmail(input: LintEmailInput): SmartIssue[] {
  const out: SmartIssue[] = [];
  const add = (level: SmartIssueLevel, code: string, message: string) => out.push({ code, level, message });
  for (const [k, s] of [['subject', input.subject], ['subject_b', input.subjectB || '']] as const) {
    const v = String(s || '').trim();
    if (k === 'subject_b' && !v) continue;
    if (!v) add('error', 'subject_missing', 'The subject is empty.');
    else {
      if (v.length > 62) add('warning', `${k}_long`, `${k === 'subject' ? 'Subject' : 'Subject B'} is ${v.length} characters: mobile shows about 40 to 60.`);
      const letters = v.replace(/[^\p{L}]/gu, '');
      if (letters.length >= 8 && letters === letters.toUpperCase()) add('warning', `${k}_caps`, 'An all-caps subject looks like spam to filters and readers.');
      if (/!{2,}|\?{2,}|€{2,}|\${2,}/.test(v)) add('warning', `${k}_spammy`, 'Repeated punctuation or currency signs in the subject hurt deliverability.');
    }
  }
  if (!String(input.preheader || '').trim()) add('warning', 'preheader_missing', 'No preheader: the inbox will show the first words of the email instead. Write one that completes the subject.');
  if (!input.hasTrackedLink) add('warning', 'no_sales_link', 'No tracked sales link: add a button to {{event.tickets_url}} (or a Yuno block) so clicks and sales are attributed to this email.');
  if (input.hasText === false) add('warning', 'image_only', 'The email is almost only images: spam filters and image-blocking clients see an empty email. Keep the key message as live text.');
  if ((input.renderedChars || 0) > 95_000) add('error', 'email_too_large', `The email weighs about ${Math.round((input.renderedChars || 0) / 1000)} KB: Gmail clips emails above 102 KB and hides the footer. Shorten or merge sections.`);
  return out;
}

/** Texte visible d'une section (sans balises HTML), pour mesurer le texte vivant. */
export function sectionText(html: string): string {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
