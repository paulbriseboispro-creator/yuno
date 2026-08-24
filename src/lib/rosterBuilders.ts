// Constructeurs de listes imprimables — un par pilier (guest list, tables VIP,
// billetterie). Chacun requête ses données FRAÎCHES au moment de l'export : la
// feuille imprimée à 23h50 doit contenir le nom ajouté à 23h48.
//
// Chaque constructeur renvoie un RosterDoc (voir rosterExport.ts) ; c'est le
// dialogue qui décide ensuite du rendu (porte / détail / tableur).
//
// Règle de confidentialité, appliquée ici et pas dans le rendu : le mode porte
// n'affiche jamais email, téléphone ni montant. Ces colonnes existent dans
// `columns` (donc dans le PDF détaillé et le CSV, destinés au club et à
// l'organisateur), mais `doorMetaKeys` ne les référence jamais.

import { supabase } from '@/integrations/supabase/client';
import { formatInTimeZone } from 'date-fns-tz';
import { getEventTimezone } from '@/lib/timezone';
import type { RosterDoc, RosterRow } from '@/lib/rosterExport';

export interface RosterEventInfo {
  id: string;
  title: string;
  start_at: string | null;
  timezone?: string | null;
  venueName?: string | null;
}

type Lang = 'en' | 'fr' | 'es';

const LOCALE_TAG: Record<Lang, string> = { fr: 'fr-FR', es: 'es-ES', en: 'en-GB' };

function eventSubtitle(ev: RosterEventInfo, lang: Lang): string {
  const parts: string[] = [];
  if (ev.start_at) {
    const tz = getEventTimezone(ev);
    const d = new Date(ev.start_at);
    const day = new Intl.DateTimeFormat(LOCALE_TAG[lang], {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz,
    }).format(d);
    parts.push(day.charAt(0).toUpperCase() + day.slice(1));
    parts.push(formatInTimeZone(d, tz, 'HH:mm'));
  }
  if (ev.venueName) parts.push(ev.venueName);
  return parts.join('  ·  ');
}

function fmtTime(iso: string | null | undefined, ev: RosterEventInfo): string {
  if (!iso) return '';
  try {
    return formatInTimeZone(new Date(iso), getEventTimezone(ev), 'HH:mm');
  } catch {
    return '';
  }
}

/**
 * Les montants de table_reservations sont en euros décimaux, pas en centimes.
 *
 * NB : `Intl` sépare les milliers par U+202F en fr-FR, un caractère absent de
 * l'encodage des polices PDF — c'est `toWinAnsi` (rosterExport.ts) qui le
 * neutralise au rendu. Ne pas « simplifier » cette normalisation : sans elle,
 * tout montant à quatre chiffres s'imprime en charabia.
 */
function money(amount: number | null | undefined, lang: Lang): string {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat(LOCALE_TAG[lang], { style: 'currency', currency: 'EUR' }).format(amount);
}

/**
 * PostgREST met les `in.(...)` dans l'URL : 36 caractères par uuid. Au-delà de
 * ~150 identifiants la requête dépasse les limites d'en-tête des passerelles et
 * revient en 414 — silencieusement, ici, puisque l'appelant retomberait sur une
 * liste au niveau acheteur. On découpe.
 */
async function inChunks<T>(ids: string[], size: number, run: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(...(await run(ids.slice(i, i + size))));
  }
  return out;
}

/** Plafond d'API Supabase par défaut : 1000 lignes. Une soirée peut dépasser. */
const ROW_CAP = 5000;

const EMPTY_LABEL: Record<Lang, string> = {
  fr: 'Aucune entree.',
  en: 'No entries.',
  es: 'Ninguna entrada.',
};

const FOOTNOTE: Record<Lang, string> = {
  fr: "Document confidentiel — données personnelles d'invités. À détruire après la soirée (RGPD).",
  en: 'Confidential — contains guests’ personal data. Destroy after the event (GDPR).',
  es: 'Documento confidencial — datos personales de invitados. Destruir tras la noche (RGPD).',
};

// ── Guest list ───────────────────────────────────────────────────────────────

const GL_STATUS: Record<Lang, Record<string, string>> = {
  fr: { reserved: 'Inscrit', confirmed: 'Confirmé', entered: 'Entré', cancelled: 'Annulé' },
  en: { reserved: 'Signed up', confirmed: 'Confirmed', entered: 'Checked in', cancelled: 'Cancelled' },
  es: { reserved: 'Inscrito', confirmed: 'Confirmado', entered: 'Entró', cancelled: 'Cancelado' },
};

const GL_TYPE: Record<Lang, Record<string, string>> = {
  fr: { normal: 'Entrée', drink: 'Entrée + conso', table: 'Table' },
  en: { normal: 'Entry', drink: 'Entry + drink', table: 'Table' },
  es: { normal: 'Entrada', drink: 'Entrada + copa', table: 'Mesa' },
};

const GL_LABELS: Record<Lang, Record<string, string>> = {
  fr: { kind: 'Guest list', name: 'Nom', part: 'Part', type: 'Type', status: 'Statut', entered: 'Entrée', email: 'Email', phone: 'Téléphone', code: 'Code', guests: 'invités', in: 'entrés' },
  en: { kind: 'Guest list', name: 'Name', part: 'List', type: 'Type', status: 'Status', entered: 'Checked in', email: 'Email', phone: 'Phone', code: 'Code', guests: 'guests', in: 'checked in' },
  es: { kind: 'Guest list', name: 'Nombre', part: 'Lista', type: 'Tipo', status: 'Estado', entered: 'Entrada', email: 'Email', phone: 'Teléfono', code: 'Código', guests: 'invitados', in: 'entraron' },
};

/**
 * @param guestListIds  restreint à certaines parts (export d'une seule part) ;
 *                      omis = toute la soirée.
 */
export async function buildGuestListRoster(
  ev: RosterEventInfo,
  lang: Lang,
  guestListIds?: string[],
): Promise<RosterDoc> {
  const L = GL_LABELS[lang];

  let partQuery = supabase
    .from('guest_lists')
    .select('id, holder_label, holder_type')
    .eq('event_id', ev.id);
  if (guestListIds?.length) partQuery = partQuery.in('id', guestListIds);
  const { data: parts } = await partQuery;

  const ids = (parts ?? []).map((p) => p.id);
  const partLabel = new Map((parts ?? []).map((p) => [p.id, p.holder_label || p.holder_type || '']));

  let rows: RosterRow[] = [];
  if (ids.length) {
    const { data: entries } = await supabase
      .from('guest_list_entries')
      .select('id, guest_list_id, full_name, email, phone, entry_type, status, entry_scanned, entry_scanned_at, reservation_code')
      .in('guest_list_id', ids)
      .neq('status', 'cancelled')
      .order('full_name')
      .range(0, ROW_CAP - 1);

    rows = (entries ?? []).map((e) => ({
      name: e.full_name,
      part: partLabel.get(e.guest_list_id) ?? '',
      type: GL_TYPE[lang][e.entry_type ?? 'normal'] ?? e.entry_type ?? '',
      status: GL_STATUS[lang][e.status] ?? e.status,
      entered: e.entry_scanned ? (fmtTime(e.entry_scanned_at, ev) || '✓') : '',
      email: e.email ?? '',
      phone: e.phone ?? '',
      code: e.reservation_code ?? '',
    }));
  }

  const scanned = rows.filter((r) => r.entered).length;

  return {
    kind: L.kind,
    eventTitle: ev.title,
    eventSubtitle: eventSubtitle(ev, lang),
    nameKey: 'name',
    doorMetaKeys: ['part', 'type'],
    summary: [`${rows.length} ${L.guests}`, `${scanned} ${L.in}`],
    footnote: FOOTNOTE[lang],
    emptyLabel: EMPTY_LABEL[lang],
    columns: [
      { key: 'name', label: L.name, weight: 20 },
      { key: 'part', label: L.part, weight: 14 },
      { key: 'type', label: L.type, weight: 12 },
      { key: 'status', label: L.status, weight: 9 },
      { key: 'entered', label: L.entered, weight: 8 },
      { key: 'email', label: L.email, weight: 20 },
      { key: 'phone', label: L.phone, weight: 12 },
      { key: 'code', label: L.code, weight: 8 },
    ],
    rows,
  };
}

// ── Tables VIP ───────────────────────────────────────────────────────────────

const VIP_LABELS: Record<Lang, Record<string, string>> = {
  fr: { kind: 'Tables VIP', client: 'Client', zone: 'Zone', table: 'Table', pack: 'Formule', guests: 'Pers.', arrival: 'Arrivée limite', minSpend: 'Min. dépense', deposit: 'Acompte', total: 'Total', phone: 'Téléphone', email: 'Email', code: 'Réf.', status: 'Statut', arrived: 'Arrivé', tables: 'tables', people: 'personnes' },
  en: { kind: 'VIP tables', client: 'Guest', zone: 'Zone', table: 'Table', pack: 'Package', guests: 'Pax', arrival: 'Arrival cutoff', minSpend: 'Min. spend', deposit: 'Deposit', total: 'Total', phone: 'Phone', email: 'Email', code: 'Ref.', status: 'Status', arrived: 'Arrived', tables: 'tables', people: 'people' },
  es: { kind: 'Mesas VIP', client: 'Cliente', zone: 'Zona', table: 'Mesa', pack: 'Fórmula', guests: 'Pers.', arrival: 'Hora límite', minSpend: 'Consumo mín.', deposit: 'Depósito', total: 'Total', phone: 'Teléfono', email: 'Email', code: 'Ref.', status: 'Estado', arrived: 'Llegó', tables: 'mesas', people: 'personas' },
};

/**
 * @param venueId  sert à résoudre les NOMS de tables : `assigned_table_id` est
 *                 un id du layout de `venue_floor_plans`, pas une clé étrangère
 *                 (voir la note « vip_tables est morte » du projet). Sans lui, la
 *                 colonne Table afficherait un uuid — inutilisable sur papier.
 *                 Résolution event-scopée d'abord, venue-level en repli, comme
 *                 useVipNight et la page de réservation publique.
 */
export async function buildTableRoster(
  ev: RosterEventInfo,
  lang: Lang,
  venueId?: string | null,
): Promise<RosterDoc> {
  const L = VIP_LABELS[lang];

  const tableNames = new Map<string, string>();
  {
    let planRow: { layout?: unknown } | null = null;
    const { data: eventPlan } = await supabase
      .from('venue_floor_plans').select('layout').eq('event_id', ev.id).maybeSingle();
    planRow = eventPlan ?? null;
    if (!planRow && venueId) {
      const { data: venuePlan } = await supabase
        .from('venue_floor_plans').select('layout').eq('venue_id', venueId).is('event_id', null).maybeSingle();
      planRow = venuePlan ?? null;
    }
    const tables = (planRow?.layout as { tables?: { id: string; name: string }[] } | null)?.tables ?? [];
    tables.forEach((t) => { if (t?.id) tableNames.set(t.id, t.name); });
  }

  const { data } = await supabase
    .from('table_reservations')
    .select(`
      id, full_name, guest_first_name, guest_last_name, user_email, phone, guest_phone,
      guest_count, deposit, total_price, minimum_spend, status, reference_code,
      entry_scanned, entry_scanned_at, assigned_table_id, requested_table_id,
      table_zones(name),
      table_packs(name, arrival_deadline)
    `)
    .eq('event_id', ev.id)
    .eq('status', 'paid')
    .range(0, ROW_CAP - 1);

  const rows: RosterRow[] = (data ?? []).map((r) => {
    const zone = (r.table_zones as { name?: string } | null)?.name ?? '';
    const pack = r.table_packs as { name?: string; arrival_deadline?: string | null } | null;
    const name = r.full_name
      || [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ')
      || r.user_email
      || '';
    const tableId = r.assigned_table_id ?? r.requested_table_id ?? null;
    return {
      client: name,
      zone,
      table: tableId ? (tableNames.get(tableId) ?? '') : '',
      pack: pack?.name ?? '',
      guests: r.guest_count ?? '',
      arrival: pack?.arrival_deadline ? String(pack.arrival_deadline).slice(0, 5) : '',
      minSpend: money(r.minimum_spend, lang),
      deposit: money(r.deposit, lang),
      total: money(r.total_price, lang),
      phone: r.phone ?? r.guest_phone ?? '',
      email: r.user_email ?? '',
      code: r.reference_code ?? '',
      arrived: r.entry_scanned ? (fmtTime(r.entry_scanned_at, ev) || '✓') : '',
    };
  });

  // Tri par zone puis table : c'est l'ordre dans lequel un hôte VIP fait le tour
  // de la salle, pas l'ordre alphabétique des clients.
  rows.sort((a, b) =>
    String(a.zone ?? '').localeCompare(String(b.zone ?? ''), 'fr')
    || String(a.table ?? '').localeCompare(String(b.table ?? ''), 'fr', { numeric: true }),
  );

  const pax = rows.reduce((s, r) => s + (Number(r.guests) || 0), 0);

  return {
    kind: L.kind,
    eventTitle: ev.title,
    eventSubtitle: eventSubtitle(ev, lang),
    nameKey: 'client',
    doorMetaKeys: ['zone', 'table', 'guests', 'arrival'],
    summary: [`${rows.length} ${L.tables}`, `${pax} ${L.people}`],
    footnote: FOOTNOTE[lang],
    emptyLabel: EMPTY_LABEL[lang],
    columns: [
      { key: 'zone', label: L.zone, weight: 10 },
      { key: 'table', label: L.table, weight: 8 },
      { key: 'client', label: L.client, weight: 17 },
      { key: 'pack', label: L.pack, weight: 13 },
      { key: 'guests', label: L.guests, weight: 6, align: 'right' },
      { key: 'arrival', label: L.arrival, weight: 8 },
      { key: 'minSpend', label: L.minSpend, weight: 9, align: 'right' },
      { key: 'deposit', label: L.deposit, weight: 8, align: 'right' },
      { key: 'total', label: L.total, weight: 8, align: 'right' },
      { key: 'phone', label: L.phone, weight: 11 },
      { key: 'arrived', label: L.arrived, weight: 7 },
    ],
    rows,
  };
}

// ── Billetterie ──────────────────────────────────────────────────────────────

const TK_LABELS: Record<Lang, Record<string, string>> = {
  fr: { kind: 'Billetterie', buyer: 'Acheteur', attendee: 'Porteur', round: 'Tarif', qty: 'Qté', status: 'Statut', email: 'Email', phone: 'Téléphone', code: 'Réf.', scanned: 'Entrée', tickets: 'billets', places: 'places' },
  en: { kind: 'Ticketing', buyer: 'Buyer', attendee: 'Attendee', round: 'Tier', qty: 'Qty', status: 'Status', email: 'Email', phone: 'Phone', code: 'Ref.', scanned: 'Checked in', tickets: 'tickets', places: 'seats' },
  es: { kind: 'Entradas', buyer: 'Comprador', attendee: 'Asistente', round: 'Tarifa', qty: 'Cant.', status: 'Estado', email: 'Email', phone: 'Teléfono', code: 'Ref.', scanned: 'Entrada', tickets: 'entradas', places: 'plazas' },
};

const TK_STATUS: Record<Lang, Record<string, string>> = {
  fr: { paid: 'Payé', cancelled: 'Annulé', refunded: 'Remboursé' },
  en: { paid: 'Paid', cancelled: 'Cancelled', refunded: 'Refunded' },
  es: { paid: 'Pagado', cancelled: 'Cancelado', refunded: 'Reembolsado' },
};

/**
 * @param mode 'attendees' = une ligne par porteur nommé (la vraie liste de
 *             porte quand les billets sont nominatifs) ; 'buyers' = une ligne
 *             par achat, avec la quantité.
 */
export async function buildTicketRoster(
  ev: RosterEventInfo,
  lang: Lang,
  mode: 'buyers' | 'attendees' = 'attendees',
): Promise<RosterDoc> {
  const L = TK_LABELS[lang];

  const { data: tickets } = await supabase
    .from('tickets')
    .select('id, full_name, user_email, phone, quantity, status, reference_code, entry_scanned, entry_scanned_at, ticket_rounds(name)')
    .eq('event_id', ev.id)
    .eq('status', 'paid')
    .range(0, ROW_CAP - 1);

  const ticketList = tickets ?? [];
  const roundOf = (t: (typeof ticketList)[number]) =>
    (t.ticket_rounds as { name?: string } | null)?.name ?? '';

  let rows: RosterRow[];
  let seats: number;

  if (mode === 'attendees' && ticketList.length) {
    const attendees = await inChunks(
      ticketList.map((t) => t.id),
      100,
      async (batch) => {
        const { data } = await supabase
          .from('ticket_attendees')
          .select('id, ticket_id, full_name, email, phone, entry_scanned, entry_scanned_at')
          .in('ticket_id', batch);
        return data ?? [];
      },
    );

    const byTicket = new Map(ticketList.map((t) => [t.id, t]));
    rows = (attendees ?? []).map((a) => {
      const t = byTicket.get(a.ticket_id);
      return {
        attendee: a.full_name || t?.full_name || '',
        buyer: t?.full_name ?? '',
        round: t ? roundOf(t) : '',
        qty: 1,
        status: t ? (TK_STATUS[lang][t.status] ?? t.status) : '',
        email: a.email ?? t?.user_email ?? '',
        phone: a.phone ?? t?.phone ?? '',
        code: t?.reference_code ?? '',
        scanned: a.entry_scanned ? (fmtTime(a.entry_scanned_at, ev) || '✓') : '',
      };
    });
    seats = rows.length;

    // Billets sans porteur nommé (achats anciens ou non nominatifs) : on retombe
    // sur l'acheteur, sinon ces places disparaissent de la liste de porte.
    const covered = new Set((attendees ?? []).map((a) => a.ticket_id));
    for (const t of ticketList) {
      if (covered.has(t.id)) continue;
      rows.push({
        attendee: t.full_name ?? '',
        buyer: t.full_name ?? '',
        round: roundOf(t),
        qty: t.quantity ?? 1,
        status: TK_STATUS[lang][t.status] ?? t.status,
        email: t.user_email ?? '',
        phone: t.phone ?? '',
        code: t.reference_code ?? '',
        scanned: t.entry_scanned ? (fmtTime(t.entry_scanned_at, ev) || '✓') : '',
      });
      seats += t.quantity ?? 1;
    }
  } else {
    rows = ticketList.map((t) => ({
      attendee: t.full_name ?? '',
      buyer: t.full_name ?? '',
      round: roundOf(t),
      qty: t.quantity ?? 1,
      status: TK_STATUS[lang][t.status] ?? t.status,
      email: t.user_email ?? '',
      phone: t.phone ?? '',
      code: t.reference_code ?? '',
      scanned: t.entry_scanned ? (fmtTime(t.entry_scanned_at, ev) || '✓') : '',
    }));
    seats = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  }

  rows.sort((a, b) => String(a.attendee ?? '').localeCompare(String(b.attendee ?? ''), 'fr'));

  return {
    kind: L.kind,
    eventTitle: ev.title,
    eventSubtitle: eventSubtitle(ev, lang),
    nameKey: 'attendee',
    doorMetaKeys: ['round'],
    summary: [`${ticketList.length} ${L.tickets}`, `${seats} ${L.places}`],
    footnote: FOOTNOTE[lang],
    emptyLabel: EMPTY_LABEL[lang],
    columns: [
      { key: 'attendee', label: L.attendee, weight: 18 },
      { key: 'buyer', label: L.buyer, weight: 16 },
      { key: 'round', label: L.round, weight: 14 },
      { key: 'qty', label: L.qty, weight: 6, align: 'right' },
      { key: 'status', label: L.status, weight: 9 },
      { key: 'email', label: L.email, weight: 20 },
      { key: 'phone', label: L.phone, weight: 11 },
      { key: 'code', label: L.code, weight: 8 },
      { key: 'scanned', label: L.scanned, weight: 8 },
    ],
    rows,
  };
}
