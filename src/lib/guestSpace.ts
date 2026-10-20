/**
 * L'ESPACE INVITÉ d'une soirée (`event_guest_passes`, plan
 * `docs/designs/EVENT_HOST_PASS_PLAN.md` §9, migrations 20261105200000 →
 * 240000). Un club ou une organisation invités sur UNE soirée en collab y
 * suivent ventes, guest list, liens, argent et porte, sans compte. Le nom
 * visible est À NOMMER par Paul : les mots vivent dans `guest-space-words.ts`
 * (famille `guestSpace.*`).
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

/** Chemin provisoire de l'espace (à confirmer par Paul). */
export const GUEST_SPACE_PATH = '/h/';
export type GuestKind = 'venue' | 'org';
export type GuestTab = 'home' | 'sales' | 'mkt' | 'money' | 'door' | 'info';
export const GUEST_TABS: GuestTab[] = ['home', 'sales', 'mkt', 'money', 'door', 'info'];

export const isGuestToken = (t: string | undefined | null): t is string => !!t && /^[0-9a-f]{32}$/.test(t);
export const guestSpaceUrl = (token: string, base: string = PUBLIC_BASE_URL) => `${base.replace(/\/+$/, '')}${GUEST_SPACE_PATH}${token}`;
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
  };
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
    mode: 'contract' | 'external';
    collector: string | null;
    collector_name: string | null;
    payment_terms_days?: number | null;
    my_share?: { tickets_pct: number | null; tables_pct: number | null; amount: number | null; declared?: boolean } | null;
    transfer?: { direction: 'in' | 'out'; amount: number; status: string; due_at?: string | null; reference?: string | null; iban_set?: boolean; id?: string | null } | null;
    statement?: { frozen: boolean; frozen_at: string | null; status: string | null } | null;
    response: 'approved' | 'contested' | null;
    response_reason: string | null;
    responded_at: string | null;
    statement_ready: boolean;
  };
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

export function rememberGuestClaim(token: string): void {
  try { localStorage.setItem(CLAIM_KEY, JSON.stringify({ token, at: Date.now() })); } catch { /* stockage indisponible */ }
}

export function readGuestClaim(maxAgeMs = 14 * 86400_000): string | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { token?: string; at?: number };
    if (!isGuestToken(v.token) || !v.at || Date.now() - v.at > maxAgeMs) return null;
    return v.token;
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

export const loadGuestSpace = (token: string) => rpc('get_event_guest_space', { p_token: token }) as Promise<GuestSpaceData>;
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

/** Email d'une invitation de porte (sans compte : le jeton de l'espace suffit). */
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
  language: GuestSpaceLanguage; token: string; show_revenue: boolean; opened_count: number;
  first_opened_at: string | null; last_opened_at: string | null; email_sent_count: number; email_sent_at: string | null;
  signup_clicks: number; revoked: boolean; created_at: string;
  share_tickets_pct: number | null; share_tables_pct: number | null;
  statement_response: 'approved' | 'contested' | null; statement_reason: string | null; statement_responded_at: string | null;
  places_requested: number | null; places_requested_at: string | null;
  guest_list: { places: number; registered: number } | null;
  links: number; link_clicks: number; link_sales: number;
  guest_party: string | null; claim_status: 'pending' | 'accepted' | 'recorded' | null; claimed_at: string | null;
  guest_party_name: string | null; guest_is_party: boolean; guest_invited: boolean;
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
