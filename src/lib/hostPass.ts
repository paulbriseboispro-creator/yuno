/**
 * L'accès « club hôte » d'une soirée (`host_pass`, plan
 * `docs/designs/EVENT_HOST_PASS_PLAN.md`, migration 20261105200000).
 *
 * Le club qui ACCUEILLE une soirée qu'il n'organise pas reçoit une page
 * privée /h/<jeton> : ventes, attendus, heures d'arrivée, son propre lien.
 * Sans compte, sans Console, sans conditions pro. Le nom visible est À NOMMER
 * par Paul : les mots vivent dans `host-pass-words.ts` (famille `hostPass.*`).
 *
 * Règles pures, partagées par la page publique et la Console, testées dans
 * `__tests__/hostPass.test.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { marketCountry } from '@/lib/geo';
import { PRO_SIGNUP_ORIGIN } from '@/lib/proSignup';
import { PUBLIC_BASE_URL, partnerLinkUrl } from '@/lib/partnerLinks';
import {
  hostPassWords, toHostPassLanguage, type HostPassLanguage, type HostPassWords,
} from '../../supabase/functions/_shared/host-pass-words';

export {
  HOST_PASS_LANGUAGES, HOST_PASS_WORD_KEYS, HOST_PASS_WORDS_RAW, hostPassLocale, hostPassShareText,
  hostPassWords, toHostPassLanguage,
} from '../../supabase/functions/_shared/host-pass-words';
export type { HostPassLanguage, HostPassWordKey, HostPassWords } from '../../supabase/functions/_shared/host-pass-words';

/** Chemin provisoire de la page (à confirmer par Paul, plan §8). */
export const HOST_PASS_PATH = '/h/';

export function isHostPassToken(token: string | undefined | null): token is string {
  return !!token && /^[0-9a-f]{32}$/.test(token);
}

export function hostPassUrl(token: string, baseUrl: string = PUBLIC_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, '')}${HOST_PASS_PATH}${token}`;
}

export function hostPassLinkUrl(code: string, baseUrl: string = PUBLIC_BASE_URL): string {
  return partnerLinkUrl(baseUrl, code);
}

const SPANISH = new Set(['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'DO', 'GT', 'HN', 'SV', 'NI', 'CU', 'PR', 'AD']);
const FRENCH = new Set(['FR', 'BE', 'MC', 'LU', 'CH', 'MA', 'TN', 'DZ', 'SN', 'CI', 'RE', 'GP', 'MQ', 'GF', 'YT', 'NC', 'PF']);

/** La langue proposée pour la page : celle du pays de la soirée (Segovia → espagnol). */
export function hostPassLanguageForEvent(timezone: string | null | undefined, city?: string | null): HostPassLanguage {
  const cc = marketCountry(timezone, city);
  if (cc && SPANISH.has(cc)) return 'es';
  if (cc && FRENCH.has(cc)) return 'fr';
  return 'en';
}

// ─── Données de la page (get_event_host_pass) ───────────────────────────────

export type HostPassPhase = 'before' | 'live' | 'after' | 'cancelled';

export interface HostPassLine {
  name: string;
  price: number | null;
  sold: number;
  capacity: number | null;
  entry_deadline: string | null;
  includes_drink: boolean;
  status: 'on_sale' | 'sold_out' | 'upcoming' | 'closed';
}

export interface HostPassData {
  found: boolean;
  closed?: boolean;
  revoked?: boolean;
  cancelled?: boolean;
  language?: string;
  venue_name?: string;
  event_title?: string;
  contact_email?: string | null;
  show_revenue?: boolean;
  closes_at?: string;
  paul_whatsapp?: string | null;
  claim?: { status: 'pending' | 'accepted' | 'recorded' | null; venue_name: string | null } | null;
  is_team?: boolean;
  is_demo?: boolean;
  now?: string;
  phase?: HostPassPhase;
  event?: {
    title: string;
    start_at: string;
    end_at: string | null;
    timezone: string;
    poster_url: string | null;
    location_name: string | null;
    location_city: string | null;
    location_address: string | null;
    organizer_name: string;
    organizer_avatar: string | null;
    entry_target: number | null;
  };
  organizer_contact?: { email: string | null; phone: string | null; instagram: string | null };
  totals?: {
    paid: { n: number; today: number };
    free: { n: number; today: number };
    guest_list: { n: number; today: number; enabled: boolean };
    tables: { booked: number; guests: number; today: number; enabled: boolean };
    expected: number;
    expected_today: number;
    expected_3d: number;
    entered: number;
    door_measured: boolean;
    capacity: number | null;
    tickets_sold_out: boolean;
    revenue: { total: number; today: number } | null;
  };
  lines?: HostPassLine[];
  arrivals?: { deadline: string | null; heads: number }[];
  drink?: { heads: number; cutoff: string | null };
  series?: { d: number; people: number }[];
  series_before?: number;
  lineup?: string[];
  link?: { code: string; active: boolean; clicks: number; sales: number; people: number; revenue: number | null } | null;
  audience?: { people: number; returning: number; prior_events: number } | null;
}

/**
 * La réponse en une phrase, avant / pendant / après. Avant la soirée, l'écart
 * sur 3 jours n'est dit que s'il existe ; une porte non mesurée ne dit jamais
 * « 0 entrée ».
 */
export function hostPassHeadline(d: HostPassData, w: HostPassWords): string {
  const t = d.totals;
  if (!t) return '';
  if (d.phase === 'cancelled') return w('hostPass.page.cancelled');
  if (d.phase === 'live') {
    return t.entered > 0
      ? w('hostPass.page.answerLive', { entered: t.entered, expected: t.expected })
      : w('hostPass.page.answerLiveNoScan', { expected: t.expected });
  }
  if (d.phase === 'after') {
    return t.door_measured
      ? w('hostPass.page.answerAfter', { entered: t.entered, expected: t.expected })
      : w('hostPass.page.answerAfterNoScan', { expected: t.expected });
  }
  if (t.expected <= 0) return w('hostPass.page.answerEmpty');
  const base = t.expected === 1 ? w('hostPass.page.answerBeforeOne') : w('hostPass.page.answerBefore', { n: t.expected });
  const delta = Math.min(t.expected_3d, t.expected);
  // Tout vendu dans les 3 derniers jours : « N de plus qu'il y a 3 jours » répéterait N.
  return base + (delta > 0 && delta < t.expected ? w('hostPass.page.answerDelta', { d: delta }) : w('hostPass.page.answerFlat'));
}

/**
 * Les barres « places prises, jour par jour » : les `days` derniers jours
 * jusqu'au jour J (ou aujourd'hui avant la soirée), cases vides comprises.
 */
export function hostPassBars(series: { d: number; people: number }[], daysToEvent: number, days = 14): { d: number; people: number }[] {
  const byD = new Map(series.map((s) => [s.d, s.people]));
  const last = Math.max(0, daysToEvent);
  const out: { d: number; people: number }[] = [];
  for (let d = last + days - 1; d >= last; d -= 1) out.push({ d, people: byD.get(d) ?? 0 });
  return out;
}

/** Part de nouveaux visages, seulement à partir de 10 personnes (règle MIN_SAMPLE). */
export function hostPassNewFacesPct(a: HostPassData['audience']): number | null {
  if (!a || a.people < 10 || a.prior_events < 1) return null;
  return Math.round((100 * (a.people - a.returning)) / a.people);
}

// ─── Conversion ─────────────────────────────────────────────────────────────

const CLAIM_KEY = 'yuno:host-pass-claim';

/** Garde le jeton de la page pour le rattacher au compte une fois ouvert (même origine). */
export function rememberHostPassClaim(token: string): void {
  try { localStorage.setItem(CLAIM_KEY, JSON.stringify({ token, at: Date.now() })); } catch { /* stockage indisponible */ }
}

export function readHostPassClaim(maxAgeMs = 14 * 86400_000): string | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { token?: string; at?: number };
    if (!isHostPassToken(v.token) || !v.at || Date.now() - v.at > maxAgeMs) return null;
    return v.token;
  } catch {
    return null;
  }
}

export function forgetHostPassClaim(): void {
  try { localStorage.removeItem(CLAIM_KEY); } catch { /* ignore */ }
}

/** L'inscription pro pré-remplie : nom du club, email, langue, source `host_pass`. */
export function hostPassSignupUrl(lang: HostPassLanguage, p: { venueName?: string | null; email?: string | null; city?: string | null }): string {
  const path = lang === 'fr' ? '/fr/start' : lang === 'es' ? '/es/start' : '/start';
  const q = new URLSearchParams({ role: 'club', utm_source: 'host_pass', utm_medium: 'host_pass' });
  if (p.venueName) q.set('org', p.venueName.slice(0, 120));
  if (p.email) q.set('email', p.email);
  if (p.city) q.set('city', p.city.slice(0, 120));
  return `${PRO_SIGNUP_ORIGIN}${path}?${q.toString()}`;
}

export function hostPassWhatsappUrl(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// ─── RPC (Console de l'organisateur) ────────────────────────────────────────

export interface HostPassRow {
  id: string;
  venue_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  language: HostPassLanguage;
  token: string;
  show_revenue: boolean;
  opened_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  email_sent_count: number;
  email_sent_at: string | null;
  signup_clicks: number;
  whatsapp_clicks: number;
  revoked: boolean;
  created_at: string;
  link_code: string | null;
  link_clicks: number;
  link_sales: number;
  claim_status: 'pending' | 'accepted' | 'recorded' | null;
  claimed_at: string | null;
  claimed_venue_id: string | null;
  claimed_venue_name: string | null;
  claimed_is_party: boolean;
  claimed_invited: boolean;
}

/** Le code d'une erreur de RPC (`already_invited`, `demo_mismatch`…). */
export function hostPassErrorCode(err: unknown): string {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '').trim();
  return /([a-z_]+)$/.exec(msg)?.[1] ?? 'generic';
}

export function hostPassErrorText(code: string, w: HostPassWords): string {
  const key = `hostPass.err.${code}` as Parameters<HostPassWords>[0];
  try {
    const s = w(key);
    if (s) return s;
  } catch { /* clé inconnue */ }
  return w('hostPass.err.generic');
}

const rpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

export async function listHostPasses(eventId: string): Promise<{ canShowRevenue: boolean; passes: HostPassRow[] }> {
  const { data, error } = await rpc('list_event_host_passes', { p_event_id: eventId });
  if (error) throw error;
  const d = (data ?? {}) as { can_show_revenue?: boolean; passes?: HostPassRow[] };
  return { canShowRevenue: !!d.can_show_revenue, passes: d.passes ?? [] };
}

export async function createHostPass(p: {
  eventId: string; venueName: string; email?: string | null; phone?: string | null;
  language: HostPassLanguage; showRevenue: boolean;
}): Promise<{ id: string; token: string; show_revenue: boolean }> {
  const { data, error } = await rpc('create_event_host_pass', {
    p_event_id: p.eventId, p_venue_name: p.venueName, p_email: p.email || null, p_phone: p.phone || null,
    p_language: p.language, p_show_revenue: p.showRevenue,
  });
  if (error) throw error;
  return data as { id: string; token: string; show_revenue: boolean };
}

export async function updateHostPass(passId: string, p: { showRevenue?: boolean; revoked?: boolean; language?: HostPassLanguage }): Promise<void> {
  const { error } = await rpc('update_event_host_pass', {
    p_pass_id: passId, p_show_revenue: p.showRevenue ?? null, p_revoked: p.revoked ?? null, p_language: p.language ?? null,
  });
  if (error) throw error;
}

/** Envoie l'email d'invitation (edge `invite-organizer-collab`, action `host_pass`). */
export async function sendHostPassEmail(passId: string): Promise<{ email_sent: boolean }> {
  const { data, error } = await supabase.functions.invoke('invite-organizer-collab', {
    body: { kind: 'host_pass', pass_id: passId, origin: window.location.origin },
  });
  if (error) {
    let code = 'generic';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* corps illisible */ }
    throw new Error(code);
  }
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
  return data as { email_sent: boolean };
}

export async function claimHostPass(token: string): Promise<{ status: 'pending' | 'accepted' | 'recorded'; event_id: string }> {
  const { data, error } = await rpc('claim_event_host_pass', { p_token: token });
  if (error) throw error;
  return data as { status: 'pending' | 'accepted' | 'recorded'; event_id: string };
}

export function trackHostPass(token: string, action: 'signup' | 'whatsapp' | 'copy' | 'share'): void {
  void rpc('track_event_host_pass', { p_token: token, p_action: action }).catch(() => { /* mesure, jamais bloquant */ });
}

/** Mots de l'écran de l'organisateur, dans la langue de SA Console. */
export function hostPassUiWords(language: string | null | undefined): HostPassWords {
  return hostPassWords(toHostPassLanguage(language, 'fr'));
}
