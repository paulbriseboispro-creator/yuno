// ─────────────────────────────────────────────────────────────────────────────
// Billetterie LIBRE (events.ticket_selling_mode = 'free').
//
// Une soirée en mode libre n'a pas de paliers qui s'enchaînent : une liste de
// billets, chacun avec son nom, son prix, sa quantité (vide = sans limite) et,
// en option, une boisson offerte et une heure limite d'entrée (entry_deadline,
// appliquée par la porte comme en mode Créneaux). Le pro décide
// billet par billet de deux choses seulement :
//   • quand on le VOIT   : tout de suite · à une date · caché
//   • quand on l'ACHÈTE  : tout de suite · à une date · plus tard (à la main)
//     (+ une fin de vente facultative)
//
// Colonnes (ticket_rounds) : hidden, visible_from, sale_starts_at,
// sale_ends_at, is_active (= « vente ouverte à la main »). Elles valent dans
// tous les modes mais restent à leur défaut hors du mode libre, où elles
// n'ont donc aucun effet.
//
// MIROIR EXACT : src/lib/freeTicketing.ts ⇄ supabase/functions/_shared/free-ticketing.ts
// (le checkout et les séries récurrentes l'embarquent). Les deux fichiers
// doivent rester identiques octet pour octet — src/lib/__tests__/freeTicketing.test.ts
// le vérifie. Aucun import ici : le même texte doit compiler sous Vite et Deno.
// ─────────────────────────────────────────────────────────────────────────────

/** Quantité « sans limite » (même valeur que le mode simple). */
export const UNLIMITED_TICKETS = 999999;
export const DEFAULT_EVENT_TZ = 'Europe/Paris';

export type FreeTicketPhase = 'hidden' | 'upcoming' | 'on_sale' | 'ended';
export type DisplayChoice = 'now' | 'at' | 'hidden';
export type SaleChoice = 'now' | 'at' | 'manual';

/** Les réglages d'un billet, en camelCase (lignes déjà mappées côté front). */
export interface FreeSchedule {
  isActive: boolean;
  hidden?: boolean | null;
  visibleFrom?: string | null;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
}

const ms = (iso?: string | null): number | null => {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
};

/**
 * Où en est un billet MAINTENANT. L'épuisement (capacité, « Complet ») se
 * juge à part : un billet épuisé garde sa phase, l'appelant le barre.
 */
export function ticketPhase(t: FreeSchedule, now: number = Date.now()): FreeTicketPhase {
  if (t.hidden) return 'hidden';
  const visibleFrom = ms(t.visibleFrom);
  if (visibleFrom !== null && now < visibleFrom) return 'hidden';
  const saleEnds = ms(t.saleEndsAt);
  if (saleEnds !== null && now >= saleEnds) return 'ended';
  if (!t.isActive) return 'upcoming';
  const saleStarts = ms(t.saleStartsAt);
  if (saleStarts !== null && now < saleStarts) return 'upcoming';
  return 'on_sale';
}

/** Même règle sur une ligne brute (snake_case) de ticket_rounds. */
export function rowPhase(
  row: { is_active: boolean; hidden?: boolean | null; visible_from?: string | null; sale_starts_at?: string | null; sale_ends_at?: string | null },
  now: number = Date.now(),
): FreeTicketPhase {
  return ticketPhase({
    isActive: row.is_active,
    hidden: row.hidden,
    visibleFrom: row.visible_from,
    saleStartsAt: row.sale_starts_at,
    saleEndsAt: row.sale_ends_at,
  }, now);
}

/**
 * Un billet caché (ou pas encore affiché) ne compte dans AUCUN prix public
 * « à partir de ». Lignes brutes : champs absents = billet listé.
 */
export function isRowListed(row: { hidden?: boolean | null; visible_from?: string | null }, now: number = Date.now()): boolean {
  if (row.hidden) return false;
  const v = ms(row.visible_from);
  return v === null || now >= v;
}

export function displayChoiceOf(t: FreeSchedule): DisplayChoice {
  if (t.hidden) return 'hidden';
  return t.visibleFrom ? 'at' : 'now';
}

export function saleChoiceOf(t: FreeSchedule): SaleChoice {
  if (!t.isActive) return 'manual';
  return t.saleStartsAt ? 'at' : 'now';
}

/** Colonnes à écrire depuis les deux choix du formulaire (dates en ISO UTC). */
export function scheduleColumns(input: {
  display: DisplayChoice;
  visibleFrom?: string | null;
  sale: SaleChoice;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
}): { hidden: boolean; visible_from: string | null; is_active: boolean; sale_starts_at: string | null; sale_ends_at: string | null } {
  return {
    hidden: input.display === 'hidden',
    visible_from: input.display === 'at' ? input.visibleFrom ?? null : null,
    is_active: input.sale !== 'manual',
    sale_starts_at: input.sale === 'at' ? input.saleStartsAt ?? null : null,
    sale_ends_at: input.saleEndsAt ?? null,
  };
}

/**
 * Ce que le PUBLIC voit d'une billetterie libre : les billets affichés, dans
 * l'ordre choisi par le pro, avec leur phase. Les billets cachés (ou pas encore
 * affichés) n'y sont pas ; un billet « Bientôt » ou « Vente terminée » y est.
 */
export function publicFreeTickets<T extends FreeSchedule & { position: number }>(
  tickets: T[],
  now: number = Date.now(),
): Array<{ ticket: T; phase: Exclude<FreeTicketPhase, 'hidden'> }> {
  return [...tickets]
    .sort((a, b) => a.position - b.position)
    .map((ticket) => ({ ticket, phase: ticketPhase(ticket, now) }))
    .filter((x): x is { ticket: T; phase: Exclude<FreeTicketPhase, 'hidden'> } => x.phase !== 'hidden');
}

/** « 12 oct. 20:00 » dans le fuseau de la soirée et la langue de l'écran. */
export function formatTicketDate(iso: string, tz: string = DEFAULT_EVENT_TZ, locale = 'fr-FR'): string {
  const at = ms(iso);
  if (at === null) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(at));
}

// ── Fuseau de la soirée (Intl seul : même code sous Vite et Deno) ────────────

interface LocalParts { y: number; m: number; d: number; hh: number; mm: number }

function localParts(epochMs: number, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour') % 24, mm: get('minute') };
}

/** Heure murale (y-m-d hh:mm) dans `tz` → instant UTC (ms). */
function zonedToUtc(p: LocalParts, tz: string): number {
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(guess, tz);
    const seenWall = Date.UTC(seen.y, seen.m - 1, seen.d, seen.hh, seen.mm);
    guess += wall - seenWall;
  }
  return guess;
}

const pad = (n: number) => String(n).padStart(2, '0');

// ── Modèles : dates RELATIVES au jour de la soirée ───────────────────────────
// Un modèle se rejoue sur n'importe quelle date : « visible dès J-7 à 20:00 »
// se garde en jours CALENDAIRES avant le jour de la soirée (fuseau de la
// soirée) + une heure murale. 0 = le jour même.

export interface RelativeTime { daysBefore: number; time: string }

export function toRelative(iso: string, eventStartIso: string, tz: string = DEFAULT_EVENT_TZ): RelativeTime | null {
  const at = ms(iso);
  const start = ms(eventStartIso);
  if (at === null || start === null) return null;
  const a = localParts(at, tz);
  const s = localParts(start, tz);
  const days = Math.round((Date.UTC(s.y, s.m - 1, s.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  return { daysBefore: days, time: `${pad(a.hh)}:${pad(a.mm)}` };
}

export function fromRelative(rel: RelativeTime, eventStartIso: string, tz: string = DEFAULT_EVENT_TZ): string | null {
  const start = ms(eventStartIso);
  const match = /^(\d{1,2}):(\d{2})/.exec(rel.time ?? '');
  if (start === null || !match || !Number.isFinite(rel.daysBefore)) return null;
  const s = localParts(start, tz);
  const day = new Date(Date.UTC(s.y, s.m - 1, s.d - Math.trunc(rel.daysBefore)));
  return new Date(zonedToUtc({
    y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate(),
    hh: Number(match[1]), mm: Number(match[2]),
  }, tz)).toISOString();
}

// ── Modèle d'une billetterie libre (ticket_presets.rounds, selling_mode 'free')

export interface FreePresetTicket {
  name: string;
  price: number;
  /** null = sans limite. */
  maxTickets: number | null;
  includesDrink: boolean;
  drinkDeadlineType?: 'hours_after_start' | 'fixed_time' | 'none' | null;
  drinkDeadlineHours?: number | null;
  drinkCutoffTime?: string | null;
  display: DisplayChoice;
  visibleAt?: RelativeTime | null;
  sale: SaleChoice;
  saleStartAt?: RelativeTime | null;
  saleEndAt?: RelativeTime | null;
  /** Heure limite d'entrée « HH:MM » (heure murale de la soirée), null = aucune. */
  entryDeadline?: string | null;
}

export interface FreeRoundRow {
  name: string;
  price: number;
  max_tickets: number;
  position: number;
  is_active: boolean;
  hidden?: boolean | null;
  visible_from?: string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  includes_drink?: boolean | null;
  drink_deadline_type?: string | null;
  drink_deadline_hours?: number | null;
  drink_cutoff_time?: string | null;
  entry_deadline?: string | null;
}

/** « HH:MM » valide, sinon null (une colonne time rend « HH:MM:SS »). */
export function normalizeEntryDeadline(v: unknown): string | null {
  const m = typeof v === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)/.exec(v) : null;
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Billets d'une soirée → contenu d'un modèle (dates rendues relatives). */
export function roundsToFreePreset(rows: FreeRoundRow[], eventStartIso: string, tz: string = DEFAULT_EVENT_TZ): FreePresetTicket[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const display: DisplayChoice = r.hidden ? 'hidden' : r.visible_from ? 'at' : 'now';
      const sale: SaleChoice = !r.is_active ? 'manual' : r.sale_starts_at ? 'at' : 'now';
      const drink = !!r.includes_drink;
      return {
        name: r.name,
        price: Number(r.price) || 0,
        maxTickets: r.max_tickets >= UNLIMITED_TICKETS ? null : r.max_tickets,
        includesDrink: drink,
        drinkDeadlineType: drink ? ((r.drink_deadline_type as FreePresetTicket['drinkDeadlineType']) ?? 'none') : null,
        drinkDeadlineHours: drink ? r.drink_deadline_hours ?? null : null,
        drinkCutoffTime: drink ? r.drink_cutoff_time ?? null : null,
        display,
        visibleAt: display === 'at' && r.visible_from ? toRelative(r.visible_from, eventStartIso, tz) : null,
        sale,
        saleStartAt: sale === 'at' && r.sale_starts_at ? toRelative(r.sale_starts_at, eventStartIso, tz) : null,
        saleEndAt: r.sale_ends_at ? toRelative(r.sale_ends_at, eventStartIso, tz) : null,
        entryDeadline: normalizeEntryDeadline(r.entry_deadline),
      };
    });
}

/** Contenu d'un modèle → lignes ticket_rounds à insérer sur une soirée. */
export function freePresetToRoundRows(
  tickets: FreePresetTicket[],
  eventId: string,
  eventStartIso: string,
  tz: string = DEFAULT_EVENT_TZ,
  startPosition = 0,
) {
  return tickets.map((p, index) => {
    const at = (rel?: RelativeTime | null) => (rel ? fromRelative(rel, eventStartIso, tz) : null);
    // Une date qu'on ne sait pas recalculer retombe sur « tout de suite »
    // pour l'affichage et sur « plus tard (à la main) » pour la vente : jamais
    // un billet mis en vente par accident.
    const visibleFrom = p.display === 'at' ? at(p.visibleAt) : null;
    const saleStarts = p.sale === 'at' ? at(p.saleStartAt) : null;
    const saleFallsBack = p.sale === 'at' && !saleStarts;
    const drink = !!p.includesDrink;
    return {
      event_id: eventId,
      name: p.name,
      price: Number(p.price) || 0,
      max_tickets: p.maxTickets && p.maxTickets > 0 ? p.maxTickets : UNLIMITED_TICKETS,
      last_tickets_threshold: 20,
      position: startPosition + index,
      ticket_type: 'standard',
      auto_activate: false,
      hidden: p.display === 'hidden',
      visible_from: visibleFrom,
      is_active: p.sale !== 'manual' && !saleFallsBack,
      sale_starts_at: saleStarts,
      sale_ends_at: at(p.saleEndAt),
      includes_drink: drink,
      drink_deadline_type: drink ? (p.drinkDeadlineType ?? 'none') : 'none',
      drink_deadline_hours: drink && p.drinkDeadlineType === 'hours_after_start' ? p.drinkDeadlineHours ?? 2 : null,
      drink_cutoff_time: drink && p.drinkDeadlineType === 'fixed_time' ? p.drinkCutoffTime ?? '02:00' : null,
      entry_deadline: normalizeEntryDeadline(p.entryDeadline) ? `${normalizeEntryDeadline(p.entryDeadline)}:00` : null,
    };
  });
}

/** Garde la forme d'un modèle lu en base (jsonb) : entrée inconnue = ignorée. */
export function normalizeFreePreset(raw: unknown): FreePresetTicket[] {
  if (!Array.isArray(raw)) return [];
  const rel = (v: unknown): RelativeTime | null => {
    const o = v as { daysBefore?: unknown; time?: unknown } | null;
    return o && typeof o.daysBefore === 'number' && typeof o.time === 'string' ? { daysBefore: o.daysBefore, time: o.time } : null;
  };
  const display = (v: unknown): DisplayChoice => (v === 'at' || v === 'hidden' ? v : 'now');
  const sale = (v: unknown): SaleChoice => (v === 'at' || v === 'manual' ? v : 'now');
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { name?: unknown }).name === 'string')
    .map((r) => ({
      name: String(r.name),
      price: Number(r.price) || 0,
      maxTickets: typeof r.maxTickets === 'number' && r.maxTickets > 0 && r.maxTickets < UNLIMITED_TICKETS ? r.maxTickets : null,
      includesDrink: r.includesDrink === true,
      drinkDeadlineType: (r.drinkDeadlineType as FreePresetTicket['drinkDeadlineType']) ?? null,
      drinkDeadlineHours: typeof r.drinkDeadlineHours === 'number' ? r.drinkDeadlineHours : null,
      drinkCutoffTime: typeof r.drinkCutoffTime === 'string' ? r.drinkCutoffTime : null,
      display: display(r.display),
      visibleAt: rel(r.visibleAt),
      sale: sale(r.sale),
      saleStartAt: rel(r.saleStartAt),
      saleEndAt: rel(r.saleEndAt),
      entryDeadline: normalizeEntryDeadline(r.entryDeadline),
    }));
}
