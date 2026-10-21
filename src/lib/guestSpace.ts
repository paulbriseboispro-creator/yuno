/**
 * L'ESPACE INVITÉ d'une soirée (`event_guest_passes`, plan
 * `docs/designs/EVENT_HOST_PASS_PLAN.md` §9, migrations 20261105200000 →
 * 20261108200000). Un club ou une organisation invités sur UNE soirée en collab
 * y suivent ventes, guest list, liens, argent et porte, avec un compte Yuno
 * SIMPLE rattaché à l'accès (décision de Paul, 21/10) : l'invitation `/h/<jeton>`
 * ne sert qu'à rattacher l'accès au compte, l'espace vit ensuite à
 * `/invite/<id de l'accès>`, gardé par la session. Les mots vivent dans
 * `guest-space-words.ts` (famille `guestSpace.*`).
 *
 * Règles pures partagées par l'espace et la Console, testées dans
 * `__tests__/guestSpace.test.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { marketCountry } from '@/lib/geo';
import { PRO_SIGNUP_ORIGIN } from '@/lib/proSignup';
import { PUBLIC_BASE_URL, partnerLinkUrl } from '@/lib/partnerLinks';
import {
  guestSpaceWords, toGuestSpaceLanguage, type GuestSpaceLanguage, type GuestSpaceWords,
} from '../../supabase/functions/_shared/guest-space-words';

export {
  GUEST_SPACE_LANGUAGES, GUEST_SPACE_WORDS_RAW, guestSpaceLocale, guestSpaceShareText, guestSpaceWords, toGuestSpaceLanguage,
} from '../../supabase/functions/_shared/guest-space-words';
export type { GuestSpaceLanguage, GuestSpaceWordKey, GuestSpaceWords } from '../../supabase/functions/_shared/guest-space-words';

/** L'invitation (jeton à usage unique) et l'espace (id de l'accès, session). */
export const GUEST_INVITE_PATH = '/h/';
export const GUEST_SPACE_PATH = '/invite/';
export type GuestKind = 'venue' | 'org';
export type GuestTab = 'home' | 'sales' | 'mkt' | 'money' | 'door' | 'info';
export const GUEST_TABS: GuestTab[] = ['home', 'sales', 'mkt', 'money', 'door', 'info'];

export const isGuestToken = (t: string | undefined | null): t is string => !!t && /^[0-9a-f]{32}$/.test(t);
export const isGuestPassId = (t: string | undefined | null): t is string =>
  !!t && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
/** Le lien d'INVITATION (réclamation par un compte). */
export const guestInviteUrl = (token: string, base: string = PUBLIC_BASE_URL) => `${base.replace(/\/+$/, '')}${GUEST_INVITE_PATH}${token}`;
/** L'adresse stable de l'espace (ouverte par le compte rattaché). */
export const guestSpacePath = (passId: string) => `${GUEST_SPACE_PATH}${passId}`;
export const guestSpaceUrl = (passId: string, base: string = PUBLIC_BASE_URL) => `${base.replace(/\/+$/, '')}${guestSpacePath(passId)}`;
export const guestLinkUrl = (code: string, base: string = PUBLIC_BASE_URL) => partnerLinkUrl(base, code);
export const doorInviteUrl = (token: string, base: string = PUBLIC_BASE_URL) => `${base.replace(/\/+$/, '')}/accept-staff-invitation?door=${token}`;

const SPANISH = new Set(['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'DO', 'GT', 'HN', 'SV', 'NI', 'CU', 'PR', 'AD']);
const FRENCH = new Set(['FR', 'BE', 'MC', 'LU', 'CH', 'MA', 'TN', 'DZ', 'SN', 'CI', 'RE', 'GP', 'MQ', 'GF', 'YT', 'NC', 'PF']);

/** La langue proposée pour l'espace : celle du pays de la soirée (Segovia → espagnol). */
export function guestLanguageForEvent(timezone: string | null | undefined, city?: string | null): GuestSpaceLanguage {
  const cc = marketCountry(timezone, city);
  if (cc && SPANISH.has(cc)) return 'es';
  if (cc && FRENCH.has(cc)) return 'fr';
  return 'en';
}

// ─── Données de l'espace (get_event_guest_space) ────────────────────────────

export type GuestPhase = 'before' | 'live' | 'after' | 'cancelled';
export type LineStatus = 'on_sale' | 'sold_out' | 'upcoming' | 'closed';

export interface GuestSpaceData {
  found: boolean;
  closed?: boolean;
  revoked?: boolean;
  language?: string;
  guest_name?: string;
  event_title?: string;
  guest?: {
    kind: GuestKind; name: string; contact_email: string | null; party: string | null;
    claim_status: 'pending' | 'accepted' | 'recorded' | null; party_name: string | null; places_requested: number | null;
    door_mode?: GuestDoorMode | null; account_email?: string | null;
  };
  pass_id?: string;
  /** Pas de session : l'espace s'ouvre après connexion. */
  sign_in?: boolean;
  show_revenue?: boolean;
  money_visible?: boolean;
  closes_at?: string;
  paul_whatsapp?: string | null;
  is_team?: boolean;
  is_demo?: boolean;
  now?: string;
  phase?: GuestPhase;
  viewer?: { member_level: number; signed_in: boolean };
  door_staff?: DoorStaffRow[] | null;
  event?: {
    title: string; start_at: string; end_at: string | null; timezone: string; poster_url: string | null;
    /** Visuels de la page soirée, tels quels (16:9, vidéo). */
    wide_url?: string | null; video_url?: string | null;
    location_name: string | null; location_city: string | null; location_address: string | null;
    organizer_name: string; organizer_avatar: string | null; event_mode: string | null;
    ticket_selling_mode: string | null; tables_enabled: boolean;
  };
  organizer_contact?: { email: string | null; phone: string | null; instagram: string | null };
  totals?: {
    tickets: { sold: number; paid: number; free: number; today: number; capacity: number | null; on_sale: number };
    tables: { booked: number; guests: number; today: number; capacity: number | null };
    guest_list: { registered: number; places: number | null; mine_places: number | null; mine_registered: number; mine_entered: number };
    expected: number;
    expected_today: number;
    entered: { tickets: number; tables: number; guest_list: number; last_10min: number };
    revenue: { total: number; today: number; tickets: number; tables: number } | null;
  };
  series?: { d: number; tickets: number; tables: number }[];
  series_before?: { tickets: number; tables: number };
  tickets?: { name: string; price: number | null; sold: number; capacity: number | null; entry_deadline: string | null; includes_drink: boolean; drink_cutoff: string | null; revenue: number | null; status: LineStatus }[];
  tables?: { name: string; price: number | null; sold: number; capacity: number | null; guests: number; revenue: number | null }[];
  guest_list_parts?: { name: string | null; places: number | null; registered: number; entered: number; mine: boolean }[];
  my_guests?: { id: string; name: string; entered: boolean; at: string }[];
  who_sells?: { key: string; kind: 'party' | 'me' | 'guest' | 'yuno' | 'direct'; name: string | null; tickets: number; tables: number; revenue: number | null }[];
  parties?: { key: string; name: string; kind: string; role: string }[];
  my_links?: { id: string; code: string; channel: string; active: boolean; clicks: number; tickets: number; tables: number; revenue: number | null }[];
  door?: { deadlines: string[]; drink_heads: number; drink_cutoff: string | null };
  figures?: {
    tickets_count: number; tickets_gross: number; tables_count: number; tables_gross: number;
    refunds: number; refunds_count: number; ca: number; stripe: number; net: number;
    net_tickets: number; net_tables: number; yuno_fees: number;
  } | null;
  money?: {
    mode: 'contract' | 'external' | 'guest_contract';
    collector: string | null;
    collector_name: string | null;
    payment_terms_days?: number | null;
    my_share?: { tickets_pct: number | null; tables_pct: number | null; amount: number | null; declared?: boolean } | null;
    transfer?: {
      direction: 'in' | 'out'; amount: number; status: string; due_at?: string | null; reference?: string | null; iban_set?: boolean; id?: string | null;
      iban_masked?: string | null; sent_at?: string | null; sent_reference?: string | null; received_at?: string | null; dispute_reason?: string | null;
    } | null;
    /** Contrat de soirée de l'invité (mode `guest_contract`). */
    contract?: GuestContract | null;
    statement?: { frozen: boolean; frozen_at: string | null; status: string | null } | null;
    response: 'approved' | 'contested' | null;
    response_reason: string | null;
    responded_at: string | null;
    statement_ready: boolean;
  };
}

export interface GuestContractTerms {
  tickets_pct: number; tables_pct: number; payment_terms_days: 7 | 15 | 30; bar_to_guest: boolean; note: string | null;
}
export interface GuestContract {
  status: 'proposed' | 'signed'; version: number; terms: GuestContractTerms; proposed_at: string | null;
  org_signer: string | null; signed_at: string | null; signer_name: string | null; signer_email: string | null;
  reference: string | null; hash: string | null;
}

export interface DoorStaffRow {
  id: string; name: string; email: string | null; phone: string | null; status: 'pending' | 'accepted' | 'revoked';
  invited_by_kind: 'guest' | 'organizer'; guest_name: string | null; created_at: string; accepted_at: string | null;
}

/** Jours calendaires entre aujourd'hui et le jour de la soirée, dans son fuseau. */
export function daysToNight(startAt: string, tz: string, now: Date = new Date()): number {
  const day = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return Date.parse(`${parts}T00:00:00Z`);
  };
  return Math.round((day(new Date(startAt)) - day(now)) / 86400_000);
}

/**
 * Le graphique : de J-(n-1) au jour J, billets par jour, tables par jour et
 * cumul (le cumul part des ventes plus anciennes que la fenêtre).
 */
export function salesSeries(
  series: { d: number; tickets: number; tables: number }[],
  before: { tickets: number; tables: number } | undefined,
  days = 22,
): { d: number; tickets: number; tables: number; cumul: number }[] {
  const byD = new Map(series.map((s) => [s.d, s]));
  // Les ventes plus anciennes que la fenêtre (jusqu'à J-60, puis avant) forment le départ du cumul.
  let cumul = (before?.tickets ?? 0) + series.filter((s) => s.d > days - 1).reduce((a, s) => a + s.tickets, 0);
  const out: { d: number; tickets: number; tables: number; cumul: number }[] = [];
  for (let d = days - 1; d >= 0; d -= 1) {
    const s = byD.get(d);
    const t = s?.tickets ?? 0;
    cumul += t;
    out.push({ d, tickets: t, tables: s?.tables ?? 0, cumul });
  }
  // Les ventes faites après le début (d < 0, la nuit même) comptent au jour J.
  const late = series.filter((s) => s.d < 0);
  if (late.length) {
    const last = out[out.length - 1];
    last.tickets += late.reduce((a, s) => a + s.tickets, 0);
    last.tables += late.reduce((a, s) => a + s.tables, 0);
    last.cumul += late.reduce((a, s) => a + s.tickets, 0);
  }
  return out;
}

/** Une vente arrivée par… : l'ordre d'affichage de « Qui fait vendre ». */
export function whoSellsRows(d: GuestSpaceData): { key: string; kind: 'party' | 'me' | 'guest' | 'yuno' | 'direct'; name: string; tickets: number; tables: number; revenue: number | null }[] {
  const raw = d.who_sells ?? [];
  const byKey = new Map(raw.map((r) => [r.key, r]));
  const out: { key: string; kind: 'party' | 'me' | 'guest' | 'yuno' | 'direct'; name: string; tickets: number; tables: number; revenue: number | null }[] = [];
  for (const p of d.parties ?? []) {
    const r = byKey.get(p.key);
    out.push({ key: p.key, kind: 'party', name: p.name, tickets: r?.tickets ?? 0, tables: r?.tables ?? 0, revenue: r?.revenue ?? null });
  }
  const me = raw.find((r) => r.kind === 'me');
  out.push({ key: 'me', kind: 'me', name: d.guest?.name ?? '', tickets: me?.tickets ?? 0, tables: me?.tables ?? 0, revenue: me?.revenue ?? null });
  for (const r of raw.filter((x) => x.kind === 'guest')) out.push({ ...r, name: r.name ?? '' });
  for (const k of ['yuno', 'direct'] as const) {
    const r = byKey.get(k);
    out.push({ key: k, kind: k, name: '', tickets: r?.tickets ?? 0, tables: r?.tables ?? 0, revenue: r?.revenue ?? null });
  }
  return out;
}

/** Les montants de la part de l'invité : le contrat d'abord, sinon la part déclarée. */
export function guestShareSummary(d: GuestSpaceData): { amount: number | null; ticketsPct: number | null; tablesPct: number | null; owedToGuest: boolean } | null {
  const m = d.money;
  if (!m?.my_share) return null;
  const s = m.my_share;
  const owedToGuest = m.transfer ? m.transfer.direction === 'in' : true;
  return { amount: s.amount ?? null, ticketsPct: s.tickets_pct ?? null, tablesPct: s.tables_pct ?? null, owedToGuest };
}

/** Le texte prêt à poster (marketing), dans la langue de l'espace. */
export function readyPostText(w: GuestSpaceWords, p: {
  date: string; event: string; place: string; price: string | null; drinkBefore: string | null; link: string;
}): string {
  return w('guestSpace.mkt.textBody', {
    date: p.date, event: p.event, place: p.place, price: p.price ?? '—',
    drink: p.drinkBefore ? w('guestSpace.mkt.textDrink', { time: p.drinkBefore }) : '', link: p.link,
  });
}

// ─── Conversion ─────────────────────────────────────────────────────────────

const CLAIM_KEY = 'yuno:guest-space-claim';

export function rememberGuestClaim(passId: string): void {
  try { localStorage.setItem(CLAIM_KEY, JSON.stringify({ passId, at: Date.now() })); } catch { /* stockage indisponible */ }
}

export function readGuestClaim(maxAgeMs = 14 * 86400_000): string | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { passId?: string; at?: number };
    if (!isGuestPassId(v.passId) || !v.at || Date.now() - v.at > maxAgeMs) return null;
    return v.passId;
  } catch {
    return null;
  }
}

export function forgetGuestClaim(): void {
  try { localStorage.removeItem(CLAIM_KEY); } catch { /* ignore */ }
}

/** L'inscription pro pré-remplie (nom, email, langue, source `host_pass`). */
export function guestSignupUrl(lang: GuestSpaceLanguage, p: { kind: GuestKind; name?: string | null; email?: string | null }): string {
  const path = lang === 'fr' ? '/fr/start' : lang === 'es' ? '/es/start' : '/start';
  const q = new URLSearchParams({ role: p.kind === 'venue' ? 'club' : 'organizer', utm_source: 'host_pass', utm_medium: 'host_pass' });
  if (p.name) q.set('org', p.name.slice(0, 120));
  if (p.email) q.set('email', p.email);
  return `${PRO_SIGNUP_ORIGIN}${path}?${q.toString()}`;
}

export function whatsappHref(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// ─── Cloche de l'espace (sans compte, sans table : déduite de ce que l'espace lit) ──

export interface GuestNotification {
  id: string;
  at: string;
  tab: GuestTab;
  key: 'contract' | 'contractChanged' | 'contractSigned' | 'frozen' | 'transferSent' | 'transferReceived' | 'statementReady' | 'staffAccepted' | 'staffAdded';
  vars: Record<string, string | number>;
  /** Attend un geste de l'invité (signer, confirmer, valider). */
  action: boolean;
}

/**
 * Ce qui concerne l'invité, du plus récent au plus ancien. Rien n'est stocké
 * côté serveur : chaque ligne vient d'une date que l'espace lit déjà (contrat,
 * décompte, virement, staff de porte). « Non lu » = plus récent que la
 * dernière ouverture de la cloche sur CET appareil.
 */
export function guestNotifications(d: GuestSpaceData): GuestNotification[] {
  const out: GuestNotification[] = [];
  const m = d.money;
  const org = d.event?.organizer_name ?? '';
  const collector = m?.collector_name ?? org;
  const c = m?.mode === 'guest_contract' ? m.contract ?? null : null;
  if (c?.status === 'signed' && c.signed_at) {
    out.push({ id: `signed:${c.version}`, at: c.signed_at, tab: 'money', key: 'contractSigned', vars: { name: c.signer_name ?? '' }, action: false });
  } else if (c?.proposed_at) {
    out.push({
      id: `contract:${c.version}`, at: c.proposed_at, tab: 'money', key: c.version > 1 ? 'contractChanged' : 'contract',
      vars: { org, n: c.version }, action: c.status === 'proposed',
    });
  }
  if (m?.statement?.frozen && m.statement.frozen_at) {
    out.push({ id: 'frozen', at: m.statement.frozen_at, tab: 'money', key: 'frozen', vars: { amount: m.transfer?.amount ?? m.my_share?.amount ?? 0 }, action: false });
  }
  if (m?.transfer?.sent_at) {
    out.push({ id: 'sent', at: m.transfer.sent_at, tab: 'money', key: 'transferSent', vars: { org: collector }, action: m.transfer.status === 'sent' });
  }
  if (m?.transfer?.received_at) {
    out.push({ id: 'received', at: m.transfer.received_at, tab: 'money', key: 'transferReceived', vars: {}, action: false });
  }
  if (m?.mode === 'contract' && m.statement_ready && d.event) {
    out.push({ id: 'statement', at: d.event.end_at ?? d.event.start_at, tab: 'money', key: 'statementReady', vars: {}, action: !m.response });
  }
  for (const s of d.door_staff ?? []) {
    if (s.status === 'accepted' && s.accepted_at) out.push({ id: `staff:${s.id}`, at: s.accepted_at, tab: 'door', key: 'staffAccepted', vars: { name: s.name }, action: false });
    else if (s.invited_by_kind === 'organizer' && s.status !== 'revoked') out.push({ id: `staffadd:${s.id}`, at: s.created_at, tab: 'door', key: 'staffAdded', vars: { name: s.name, org }, action: false });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const seenKey = (token: string) => `yuno:guest-space-seen:${token}`;
export function readGuestSeen(token: string): string | null {
  try { return localStorage.getItem(seenKey(token)); } catch { return null; }
}
export function writeGuestSeen(token: string, at: string): void {
  try { localStorage.setItem(seenKey(token), at); } catch { /* navigation privée : la pastille revient, rien de grave */ }
}
/** La langue choisie par l'invité sur son appareil (sinon celle de l'organisateur). */
const langKey = (token: string) => `yuno:guest-space-lang:${token}`;
export function readGuestLang(token: string): GuestSpaceLanguage | null {
  try { const v = localStorage.getItem(langKey(token)); return v === 'en' || v === 'fr' || v === 'es' ? v : null; } catch { return null; }
}
export function writeGuestLang(token: string, lang: GuestSpaceLanguage): void {
  try { localStorage.setItem(langKey(token), lang); } catch { /* sans stockage, la langue tient le temps de la page */ }
}

// ─── Erreurs ────────────────────────────────────────────────────────────────

export function guestErrorCode(err: unknown): string {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '').trim();
  return /([a-z_]+)$/.exec(msg)?.[1] ?? 'generic';
}

export function guestErrorText(code: string, w: GuestSpaceWords): string {
  const key = `guestSpace.err.${code}` as Parameters<GuestSpaceWords>[0];
  const s = w(key);
  return s === key ? w('guestSpace.err.generic') : s;
}

// ─── RPC ────────────────────────────────────────────────────────────────────

const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await (supabase.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
  if (error) throw error;
  return data;
};

/** L'espace, par l'id de l'accès ; exige la session du compte rattaché (ou l'équipe de l'organisateur). */
export const loadGuestSpace = (passId: string) => rpc('get_event_guest_space', { p_token: passId }) as Promise<GuestSpaceData>;

// ─── Invitation (jeton à usage unique) et compte rattaché ───────────────────

export type GuestDoorMode = 'organizer' | 'guest' | 'both';
export interface GuestInvite {
  state: 'valid' | 'mine' | 'taken' | 'expired' | 'revoked' | 'closed' | 'not_found';
  pass_id?: string | null; language?: string; guest_name?: string; guest_kind?: GuestKind;
  invite_email?: string | null; inviter_name?: string; event_title?: string; event_start_at?: string;
  timezone?: string; poster_url?: string | null; location_name?: string | null; location_city?: string | null;
}
export interface MyGuestPass {
  pass_id: string; guest_name: string; guest_kind: GuestKind; event_title: string; event_start_at: string;
  poster_url: string | null; inviter_name: string | null;
}
export const loadGuestInvite = (token: string) => rpc('get_event_guest_pass_invite', { p_token: token }) as Promise<GuestInvite>;
export const redeemGuestInvite = (token: string) => rpc('redeem_event_guest_pass', { p_token: token }) as Promise<{ ok: boolean; pass_id: string }>;
export const loadMyGuestPasses = () => rpc('get_my_guest_passes', {}) as Promise<MyGuestPass[]>;
/** Le lien à partager : l'espace s'il est rattaché, sinon une invitation neuve (chaque appel en crée une). */
export const getGuestPassLink = (passId: string) =>
  rpc('get_event_guest_pass_link', { p_pass_id: passId }) as Promise<{ linked: boolean; pass_id: string; token?: string; account_email?: string }>;
export const resetGuestPassAccess = (passId: string) =>
  rpc('reset_event_guest_pass_access', { p_pass_id: passId }) as Promise<{ ok: boolean; pass_id: string; token: string }>;
export const setGuestPassDoor = (passId: string, mode: GuestDoorMode) => rpc('set_event_guest_pass_door', { p_pass_id: passId, p_mode: mode });
/** L'adresse à donner pour un accès : l'espace s'il est rattaché, sinon l'invitation. */
export function guestShareUrl(r: { linked: boolean; pass_id: string; token?: string }): string {
  return r.linked || !r.token ? guestSpaceUrl(r.pass_id) : guestInviteUrl(r.token);
}
export const addGuest = (token: string, name: string, plus: number) => rpc('guest_pass_add_guest', { p_token: token, p_name: name, p_plus: plus });
export const removeGuest = (token: string, entryId: string) => rpc('guest_pass_remove_guest', { p_token: token, p_entry_id: entryId });
export const requestPlaces = (token: string, places: number) => rpc('guest_pass_request_places', { p_token: token, p_places: places });
export const createGuestLink = (token: string, channel: string) => rpc('guest_pass_create_link', { p_token: token, p_channel: channel }) as Promise<{ id: string; code: string }>;
export const answerStatement = (token: string, response: 'approved' | 'contested', reason?: string) =>
  rpc('guest_pass_statement_response', { p_token: token, p_response: response, p_reason: reason ?? null });
export const guestInviteDoorStaff = (token: string, name: string, email: string | null, phone: string | null) =>
  rpc('guest_pass_invite_door_staff', { p_token: token, p_name: name, p_email: email, p_phone: phone }) as Promise<{ id: string; invite_token: string; email: string | null; phone: string | null }>;
export const guestRevokeDoorStaff = (token: string, id: string) => rpc('guest_pass_revoke_door_staff', { p_token: token, p_staff_id: id });
export const claimGuestSpace = (token: string) => rpc('claim_event_guest_pass', { p_token: token }) as Promise<{ status: 'pending' | 'accepted' | 'recorded'; event_id: string; party: string }>;
export function trackGuestSpace(token: string, action: 'signup' | 'whatsapp' | 'copy' | 'share'): void {
  void rpc('track_event_guest_pass', { p_token: token, p_action: action }).catch(() => { /* mesure, jamais bloquant */ });
}

/** Email d'une invitation de porte (par l'organisateur, ou par l'invité connecté : `passId` = son accès). */
export async function sendDoorInviteEmail(staffId: string, passToken: string | null): Promise<void> {
  const { data, error } = await supabase.functions.invoke('invite-organizer-collab', {
    body: { kind: 'door_staff', staff_id: staffId, pass_token: passToken },
  });
  if (error) {
    let code = 'generic';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* corps illisible */ }
    throw new Error(code);
  }
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
}

// ─── Console de l'organisateur ──────────────────────────────────────────────

export interface GuestPassRow {
  id: string; guest_kind: GuestKind; guest_name: string; contact_email: string | null; contact_phone: string | null;
  language: GuestSpaceLanguage; show_revenue: boolean; opened_count: number;
  /** Compte rattaché (réclamé) : son adresse, quand. Sinon l'invitation attend. */
  account_email: string | null; account_linked_at: string | null; invite_pending: boolean;
  door_mode: GuestDoorMode | null;
  first_opened_at: string | null; last_opened_at: string | null; email_sent_count: number; email_sent_at: string | null;
  signup_clicks: number; revoked: boolean; created_at: string;
  share_tickets_pct: number | null; share_tables_pct: number | null;
  statement_response: 'approved' | 'contested' | null; statement_reason: string | null; statement_responded_at: string | null;
  places_requested: number | null; places_requested_at: string | null;
  guest_list: { places: number; registered: number } | null;
  links: number; link_clicks: number; link_sales: number;
  guest_party: string | null; claim_status: 'pending' | 'accepted' | 'recorded' | null; claimed_at: string | null;
  guest_party_name: string | null; guest_is_party: boolean; guest_invited: boolean;
  contract_status: 'proposed' | 'signed' | 'cancelled' | null; contract_terms: GuestContractTerms | null; contract_version: number;
  contract_signed_at: string | null; contract_signer_name: string | null; contract_signer_email: string | null;
  statement_frozen_at: string | null; guest_iban: string | null; guest_iban_holder: string | null;
  transfer_reference: string | null; transfer_status: 'pending' | 'sent' | 'received' | 'disputed' | null;
  transfer_amount: number | null; transfer_due_at: string | null; transfer_sent_at: string | null;
  transfer_received_at: string | null; transfer_dispute_reason: string | null;
}

export async function listGuestPasses(eventId: string): Promise<{ canShowRevenue: boolean; passes: GuestPassRow[] }> {
  const d = (await rpc('list_event_guest_passes', { p_event_id: eventId })) as { can_show_revenue?: boolean; passes?: GuestPassRow[] };
  return { canShowRevenue: !!d?.can_show_revenue, passes: d?.passes ?? [] };
}

export const createGuestPass = (p: {
  eventId: string; kind: GuestKind; name: string; email?: string | null; phone?: string | null;
  language: GuestSpaceLanguage; showRevenue: boolean; places?: number | null;
  shareTicketsPct?: number | null; shareTablesPct?: number | null; guestParty?: string | null;
}) => rpc('create_event_guest_pass', {
  p_event_id: p.eventId, p_guest_kind: p.kind, p_guest_name: p.name, p_email: p.email || null, p_phone: p.phone || null,
  p_language: p.language, p_show_revenue: p.showRevenue, p_guest_list_places: p.places ?? null,
  p_share_tickets_pct: p.shareTicketsPct ?? null, p_share_tables_pct: p.shareTablesPct ?? null, p_guest_party: p.guestParty ?? null,
}) as Promise<{ id: string; token: string; show_revenue: boolean }>;

export const updateGuestPass = (passId: string, p: {
  showRevenue?: boolean; revoked?: boolean; language?: GuestSpaceLanguage; places?: number | null;
  shareTicketsPct?: number | null; shareTablesPct?: number | null; clearShares?: boolean;
}) => rpc('update_event_guest_pass', {
  p_pass_id: passId, p_show_revenue: p.showRevenue ?? null, p_revoked: p.revoked ?? null, p_language: p.language ?? null,
  p_guest_list_places: p.places ?? null, p_share_tickets_pct: p.shareTicketsPct ?? null,
  p_share_tables_pct: p.shareTablesPct ?? null, p_clear_shares: !!p.clearShares,
});

export const listEventDoorStaff = (eventId: string) => rpc('list_event_door_staff', { p_event_id: eventId }) as Promise<DoorStaffRow[]>;
export const inviteEventDoorStaff = (p: { eventId: string; name: string; email?: string | null; phone?: string | null; passId?: string | null }) =>
  rpc('invite_event_door_staff', { p_event_id: p.eventId, p_name: p.name, p_email: p.email || null, p_phone: p.phone || null, p_pass_id: p.passId ?? null }) as Promise<{ id: string; invite_token: string; email: string | null; phone: string | null }>;
export const revokeEventDoorStaff = (id: string) => rpc('revoke_event_door_staff', { p_staff_id: id });

// ─── Contrat de soirée de l'invité ──────────────────────────────────────────

/** L'organisateur propose (ou change) les termes : il signe en proposant. */
export const proposeGuestContract = (passId: string, t: GuestContractTerms) => rpc('set_event_guest_pass_contract', {
  p_pass_id: passId, p_tickets_pct: t.tickets_pct, p_tables_pct: t.tables_pct, p_payment_terms_days: t.payment_terms_days,
  p_bar_to_guest: t.bar_to_guest, p_note: t.note, p_cancel: false,
}) as Promise<{ ok: boolean; status: string; version: number }>;
export const cancelGuestContract = (passId: string) => rpc('set_event_guest_pass_contract', { p_pass_id: passId, p_cancel: true });
export const markGuestTransferSent = (passId: string, reference: string | null) =>
  rpc('mark_guest_pass_transfer_sent', { p_pass_id: passId, p_reference: reference });
export const signGuestContract = (passId: string, name: string, version: number) =>
  rpc('guest_pass_sign_contract', { p_token: passId, p_signer_name: name, p_version: version });
export const setGuestIban = (passId: string, iban: string, holder: string) =>
  rpc('guest_pass_set_iban', { p_token: passId, p_iban: iban, p_holder: holder });
export const confirmGuestTransfer = (token: string, received: boolean, reason?: string) =>
  rpc('guest_pass_confirm_transfer', { p_token: token, p_received: received, p_reason: reason ?? null });

/** IBAN : espaces tous les 4 caractères, majuscules (affichage seulement). */
export function formatIban(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})/g, '$1 ').trim();
}
/** Contrôle de clé IBAN (mod 97) avant l'envoi : le serveur, lui, ne vérifie que la forme. */
export function isValidIban(v: string): boolean {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let r = 0;
  for (const ch of moved) {
    const n = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const dgt of n) r = (r * 10 + Number(dgt)) % 97;
  }
  return r === 1;
}

/** Envoie l'email d'accès (edge `invite-organizer-collab`, action `guest_pass`). */
export async function sendGuestPassEmail(passId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('invite-organizer-collab', {
    body: { kind: 'guest_pass', pass_id: passId, origin: window.location.origin },
  });
  if (error) {
    let code = 'generic';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* corps illisible */ }
    throw new Error(code);
  }
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
}

/** Mots de l'écran de l'organisateur, dans la langue de SA Console. */
export function guestUiWords(language: string | null | undefined): GuestSpaceWords {
  return guestSpaceWords(toGuestSpaceLanguage(language, 'fr'));
}
