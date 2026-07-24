// Constructeurs de pass.json — billets et tables VIP (tous deux eventTicket :
// fond dégradé + wordmark blanc, en-tête type/formule, titre de soirée en héros
// sans label, puis club/date et heure/places). Chargent les données, résolvent
// la langue du client (D6) et assemblent le pass. La signature vit dans
// signer.ts ; les images dans assets.ts (régénérables via
// scripts/gen-wallet-assets.py).
//
// Leviers lock-screen des passes statiques :
//  - relevantDate  = start_at   → le billet remonte sur l'écran verrouillé le soir J
//  - locations     = lat/lng du club → il remonte aussi en APPROCHANT du club
//  - expirationDate = end_at + 6h  → le pass se grise tout seul après la soirée
//
// Décision D2 : webServiceURL pointe dès l'émission vers le routeur /wallet de
// send-ticket-confirmation — les devices s'enregistrent dès maintenant, les
// pushes de mise à jour arriveront en Phase 5 sans réémettre les passes.
import { normalizeWalletLang, wl, type WalletLang } from './i18n.ts';

/** Ligne event embarquée (`events!inner(...)`) des deux selects ci-dessous. */
interface WalletEventRow {
  title: string;
  start_at: string | null;
  end_at: string | null;
  venue_id: string | null;
  partner_venue_id: string | null;
  location_name: string | null;
  location_city?: string | null;
  location_is_secret: boolean | null;
  music_genres: string[] | null;
}

/** Ligne venues (latitude/longitude peuvent arriver en numeric → string). */
interface WalletVenueRow {
  name: string | null;
  address?: string | null;
  city?: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

interface WalletTicketRow {
  id: string;
  qr_code: string | null;
  reference_code: string | null;
  quantity: number | null;
  status: string | null;
  user_id: string | null;
  full_name: string | null;
  ticket_rounds: { name: string | null } | null;
  events: WalletEventRow;
}

/** Entrée de guest list — l'événement passe par la part (guest_lists). */
interface WalletGuestListRow {
  id: string;
  qr_code: string | null;
  reservation_code: string | null;
  status: string | null;
  user_id: string | null;
  full_name: string | null;
  entry_type: string | null;
  guest_lists: {
    free_before_time: string | null;
    includes_drink: boolean | null;
    events: WalletEventRow;
  };
}

interface WalletReservationRow {
  id: string;
  qr_code: string | null;
  reference_code: string | null;
  guest_count: number | null;
  status: string | null;
  user_id: string | null;
  full_name: string | null;
  table_packs: { name: string | null } | null;
  table_zones: { name: string | null } | null;
  events: WalletEventRow;
}

interface WalletQuery<Row> {
  select(columns: string): WalletQuery<Row>;
  eq(column: string, value: unknown): WalletQuery<Row>;
  single(): PromiseLike<{ data: Row | null; error: unknown }>;
  maybeSingle(): PromiseLike<{ data: Row | null; error?: unknown }>;
}

/** Client Supabase admin minimal (évite d'importer le SDK ici). */
interface AdminClient {
  from(table: 'profiles'): WalletQuery<{ preferred_language: string | null }>;
  from(table: 'tickets'): WalletQuery<WalletTicketRow>;
  from(table: 'table_reservations'): WalletQuery<WalletReservationRow>;
  from(table: 'guest_list_entries'): WalletQuery<WalletGuestListRow>;
  from(table: 'venues'): WalletQuery<WalletVenueRow>;
}

export interface PassBuild {
  passJson: Record<string, unknown>;
  serial: string;
  userId: string | null;
  lang: WalletLang;
}

const PASS_TYPE_ID = () => Deno.env.get('WALLET_PASS_TYPE_ID') ?? 'pass.eu.yunoapp.app';
const TEAM_ID = () => Deno.env.get('WALLET_TEAM_ID') ?? '';

/** Base du web service PassKit (routeur /wallet de CETTE fonction — D2). */
function webServiceBase(): string {
  const url = Deno.env.get('SUPABASE_URL') ?? 'https://fulawxvdlwtdlpkycixe.supabase.co';
  return `${url}/functions/v1/send-ticket-confirmation/wallet`;
}

async function resolveLang(admin: AdminClient, userId: string | null): Promise<WalletLang> {
  if (!userId) return 'fr';
  const { data } = await admin
    .from('profiles')
    .select('preferred_language')
    .eq('id', userId)
    .maybeSingle();
  return normalizeWalletLang(data?.preferred_language);
}

/** Champs communs aux deux styles de pass. */
function passShell(opts: {
  serial: string;
  description: string;
  authToken: string;
  qr: string;
  qrAlt: string | null;
  relevantDate: string | null;
  expirationDate: string | null;
  location: { lat: number; lng: number } | null;
  voided: boolean;
}): Record<string, unknown> {
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID(),
    teamIdentifier: TEAM_ID(),
    organizationName: 'Yuno',
    serialNumber: opts.serial,
    description: opts.description,
    backgroundColor: 'rgb(10,10,12)',
    foregroundColor: 'rgb(255,255,255)',
    // Rouge de marque éclairci : #E8192C pur tombe à ~2.9:1 sur le bas du
    // dégradé, les labels y deviennent illisibles. Cette teinte reste
    // identifiable Yuno et passe le seuil AA sur toute la hauteur du pass.
    labelColor: 'rgb(255,90,104)',
    sharingProhibited: true,
    ...(opts.voided ? { voided: true } : {}),
    ...(opts.relevantDate ? { relevantDate: opts.relevantDate } : {}),
    ...(opts.expirationDate ? { expirationDate: opts.expirationDate } : {}),
    ...(opts.location
      ? { locations: [{ latitude: opts.location.lat, longitude: opts.location.lng }] }
      : {}),
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: opts.qr,
        messageEncoding: 'iso-8859-1',
        ...(opts.qrAlt ? { altText: opts.qrAlt } : {}),
      },
    ],
    webServiceURL: webServiceBase(),
    authenticationToken: opts.authToken,
  };
}

/**
 * Balises sémantiques PassKit — ce que Wallet comprend du pass au-delà du texte
 * affiché : itinéraire vers le club dans Maps, météo du soir, rappel « c'est
 * ce soir » sur l'écran verrouillé. Aucune incidence visuelle sur la face du
 * pass, donc aucun risque de régression de mise en page.
 */
function eventSemantics(opts: {
  eventName: string;
  venueName: string;
  startAt: string | null;
  endAt: string | null;
  location: { lat: number; lng: number } | null;
}): Record<string, unknown> {
  return {
    semantics: {
      eventType: 'PKEventTypeLivePerformance',
      eventName: opts.eventName,
      venueName: opts.venueName,
      ...(opts.startAt ? { eventStartDate: opts.startAt } : {}),
      ...(opts.endAt ? { eventEndDate: opts.endAt } : {}),
      ...(opts.location
        ? { venueLocation: { latitude: opts.location.lat, longitude: opts.location.lng } }
        : {}),
    },
  };
}

/** end_at + 6h (marge afterparty), ou null si pas de fin connue. */
function expiration(endAt: string | null): string | null {
  if (!endAt) return null;
  const d = new Date(endAt);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 6 * 3600_000).toISOString();
}

/** Billet d'événement — pass eventTicket, QR = tickets.qr_code (scan porte). */
export async function buildTicketPass(
  admin: AdminClient,
  ticketId: string,
  authToken: string,
): Promise<PassBuild> {
  const { data: ticket, error } = await admin
    .from('tickets')
    .select(`
      id, qr_code, reference_code, quantity, status, user_id, full_name,
      ticket_rounds(name),
      events!inner(title, start_at, end_at, venue_id, partner_venue_id, location_name, location_city, location_is_secret, music_genres)
    `)
    .eq('id', ticketId)
    .single();
  if (error || !ticket) throw new Error('Ticket not found');
  if (!ticket.qr_code) throw new Error('Ticket has no QR');

  const event = ticket.events;
  const venueId = event.venue_id ?? event.partner_venue_id;
  let venue: WalletVenueRow | null = null;
  if (venueId) {
    const { data } = await admin
      .from('venues')
      .select('name, address, city, latitude, longitude')
      .eq('id', venueId)
      .maybeSingle();
    venue = data;
  }

  const lang = await resolveLang(admin, ticket.user_id);
  const venueName = venue?.name || event.location_name || 'Yuno';
  // Lieu secret : jamais de coordonnées sur le pass (l'adresse est révélée par
  // l'organisateur via son propre canal).
  const isSecret = !!event.location_is_secret;
  const location =
    !isSecret && venue?.latitude != null && venue?.longitude != null
      ? { lat: Number(venue.latitude), lng: Number(venue.longitude) }
      : null;

  const round = ticket.ticket_rounds?.name || null;
  const genre = Array.isArray(event.music_genres)
    ? event.music_genres.filter(Boolean).slice(0, 2).join(' · ') || null
    : null;
  const reference = ticket.reference_code || ticket.qr_code;

  const passJson = {
    ...passShell({
      serial: `t-${ticket.id}`,
      description: `${wl(lang, 'ticketDescription')} — ${event.title}`,
      authToken,
      qr: ticket.qr_code,
      qrAlt: ticket.reference_code || null,
      relevantDate: event.start_at || null,
      expirationDate: expiration(event.end_at),
      location,
      voided: ticket.status === 'refunded',
    }),
    ...eventSemantics({
      eventName: event.title,
      venueName,
      startAt: event.start_at || null,
      endAt: event.end_at || null,
      location,
    }),
    eventTicket: {
      // Type de billet (round) en en-tête, comme "BILLET / First Round".
      headerFields: round
        ? [{ key: 'type', label: wl(lang, 'ticket'), value: round }]
        : [],
      // Titre sans label : le nom de la soirée EST le héros du pass. Le libellé
      // « ÉVÉNEMENT » ne dit rien qu'on ne voie déjà, et coûte une ligne rouge
      // au-dessus du seul champ qui doit respirer.
      primaryFields: [{ key: 'event', value: event.title }],
      // Deux colonnes courtes : date et heure séparées, chacune tient sans
      // troncature là où « 2 juin 2026 à 11:00 » écrasait le nom du club.
      // `textAlignment` sur la colonne de droite : sans lui, Wallet cale le
      // bloc à droite mais le TEXTE à gauche dans le bloc — d'où le « 1 » qui
      // flottait sous « PLACES » au lieu de s'aligner sur le bord du pass.
      secondaryFields: [
        { key: 'venue', label: wl(lang, 'venue'), value: venueName },
        ...(event.start_at
          ? [{
              key: 'date',
              label: wl(lang, 'date'),
              value: event.start_at,
              dateStyle: 'PKDateStyleMedium',
              timeStyle: 'PKDateStyleNone',
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      auxiliaryFields: [
        ...(event.start_at
          ? [{
              key: 'time',
              label: wl(lang, 'arrival'),
              value: event.start_at,
              dateStyle: 'PKDateStyleNone',
              timeStyle: 'PKDateStyleShort',
            }]
          : []),
        {
          key: 'qty',
          label: wl(lang, 'persons'),
          value: String(ticket.quantity || 1),
          textAlignment: 'PKTextAlignmentRight',
        },
      ],
      // Le genre musical descend au dos : c'est du contexte, pas de
      // l'information de porte. La face avant garde trois lignes, pas quatre.
      backFields: [
        { key: 'ref', label: wl(lang, 'reference'), value: reference },
        ...(ticket.full_name ? [{ key: 'holder', label: wl(lang, 'holder'), value: ticket.full_name }] : []),
        ...(genre ? [{ key: 'genre', label: wl(lang, 'genre'), value: genre }] : []),
        { key: 'help', label: wl(lang, 'help'), value: 'https://yunoapp.eu/my-orders' },
      ],
    },
  };

  return { passJson, serial: `t-${ticket.id}`, userId: ticket.user_id, lang };
}

/** Réservation de table VIP — pass eventTicket, QR = table_reservations.qr_code. */
export async function buildVipPass(
  admin: AdminClient,
  reservationId: string,
  authToken: string,
): Promise<PassBuild> {
  const { data: resa, error } = await admin
    .from('table_reservations')
    .select(`
      id, qr_code, reference_code, guest_count, status, user_id, full_name,
      table_packs(name),
      table_zones(name),
      events!inner(title, start_at, end_at, venue_id, partner_venue_id, location_name, location_is_secret, music_genres)
    `)
    .eq('id', reservationId)
    .single();
  if (error || !resa) throw new Error('Reservation not found');
  if (!resa.qr_code) throw new Error('Reservation has no QR');

  const event = resa.events;
  const venueId = event.venue_id ?? event.partner_venue_id;
  let venue: WalletVenueRow | null = null;
  if (venueId) {
    const { data } = await admin
      .from('venues')
      .select('name, latitude, longitude')
      .eq('id', venueId)
      .maybeSingle();
    venue = data;
  }

  const lang = await resolveLang(admin, resa.user_id);
  const venueName = venue?.name || event.location_name || 'Yuno';
  const isSecret = !!event.location_is_secret;
  const location =
    !isSecret && venue?.latitude != null && venue?.longitude != null
      ? { lat: Number(venue.latitude), lng: Number(venue.longitude) }
      : null;

  const tableName =
    resa.table_packs?.name || resa.table_zones?.name || null;
  const genre = Array.isArray(event.music_genres)
    ? event.music_genres.filter(Boolean).slice(0, 2).join(' · ') || null
    : null;
  const reference = resa.reference_code || resa.qr_code;

  const passJson = {
    ...passShell({
      serial: `v-${resa.id}`,
      description: `${wl(lang, 'vipDescription')} — ${event.title}`,
      authToken,
      qr: resa.qr_code,
      qrAlt: resa.reference_code || null,
      relevantDate: event.start_at || null,
      expirationDate: expiration(event.end_at),
      location,
      voided: resa.status === 'refunded',
    }),
    ...eventSemantics({
      eventName: event.title,
      venueName,
      startAt: event.start_at || null,
      endAt: event.end_at || null,
      location,
    }),
    // Table VIP : même grille que le billet (fond dégradé + logo, titre héros,
    // formule en en-tête) — seul l'en-tête et le décompte d'invités changent.
    eventTicket: {
      headerFields: [
        { key: 'type', label: wl(lang, 'formula'), value: tableName || wl(lang, 'vipDescription') },
      ],
      primaryFields: [{ key: 'event', value: event.title }],
      secondaryFields: [
        { key: 'venue', label: wl(lang, 'venue'), value: venueName },
        ...(event.start_at
          ? [{
              key: 'date',
              label: wl(lang, 'date'),
              value: event.start_at,
              dateStyle: 'PKDateStyleMedium',
              timeStyle: 'PKDateStyleNone',
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      auxiliaryFields: [
        ...(event.start_at
          ? [{
              key: 'time',
              label: wl(lang, 'arrival'),
              value: event.start_at,
              dateStyle: 'PKDateStyleNone',
              timeStyle: 'PKDateStyleShort',
            }]
          : []),
        {
          key: 'guests',
          label: wl(lang, 'guests'),
          value: String(resa.guest_count || 1),
          textAlignment: 'PKTextAlignmentRight',
        },
      ],
      backFields: [
        { key: 'ref', label: wl(lang, 'reference'), value: reference },
        ...(resa.full_name ? [{ key: 'holder', label: wl(lang, 'holder'), value: resa.full_name }] : []),
        ...(genre ? [{ key: 'genre', label: wl(lang, 'genre'), value: genre }] : []),
        { key: 'help', label: wl(lang, 'help'), value: 'https://yunoapp.eu/my-orders' },
      ],
    },
  };

  return { passJson, serial: `v-${resa.id}`, userId: resa.user_id, lang };
}

/**
 * Entrée de guest list — pass eventTicket, QR = guest_list_entries.qr_code
 * (le videur scanne le même code que pour un billet payant).
 *
 * Deux différences avec un billet : l'heure limite d'entrée gratuite est LE
 * renseignement décisif (elle passe donc en en-tête), et la boisson offerte
 * dépend du type retenu à l'inscription, pas seulement du réglage de la part.
 */
export async function buildGuestListPass(
  admin: AdminClient,
  entryId: string,
  authToken: string,
): Promise<PassBuild> {
  const { data: entry, error } = await admin
    .from('guest_list_entries')
    .select(`
      id, qr_code, reservation_code, status, user_id, full_name, entry_type,
      guest_lists!inner(
        free_before_time, includes_drink,
        events!inner(title, start_at, end_at, venue_id, partner_venue_id, location_name, location_city, location_is_secret, music_genres)
      )
    `)
    .eq('id', entryId)
    .single();
  if (error || !entry) throw new Error('Guest list entry not found');
  if (!entry.qr_code) throw new Error('Guest list entry has no QR');

  const event = entry.guest_lists.events;
  const venueId = event.venue_id ?? event.partner_venue_id;
  let venue: WalletVenueRow | null = null;
  if (venueId) {
    const { data } = await admin
      .from('venues')
      .select('name, address, city, latitude, longitude')
      .eq('id', venueId)
      .maybeSingle();
    venue = data;
  }

  const lang = await resolveLang(admin, entry.user_id);
  const venueName = venue?.name || event.location_name || 'Yuno';
  // Lieu secret : jamais de coordonnées sur le pass (même règle que le billet).
  const isSecret = !!event.location_is_secret;
  const location =
    !isSecret && venue?.latitude != null && venue?.longitude != null
      ? { lat: Number(venue.latitude), lng: Number(venue.longitude) }
      : null;

  const entryType = entry.entry_type || 'normal';
  const typeLabel = entryType === 'table' ? wl(lang, 'entryVip')
    : entryType === 'drink' ? wl(lang, 'entryDrink')
    : wl(lang, 'entryNormal');
  // La boisson suit le type retenu ; `includes_drink` ne vaut que pour une part
  // sans ventilation (le club offre un verre à toute sa liste).
  const hasDrink = entryType === 'drink' || (entryType === 'normal' && !!entry.guest_lists.includes_drink);
  const freeBefore = entry.guest_lists.free_before_time?.substring(0, 5) || null;
  const genre = Array.isArray(event.music_genres)
    ? event.music_genres.filter(Boolean).slice(0, 2).join(' · ') || null
    : null;
  const reference = entry.reservation_code || entry.qr_code;

  const passJson = {
    ...passShell({
      serial: `g-${entry.id}`,
      description: `${wl(lang, 'guestListDescription')} — ${event.title}`,
      authToken,
      qr: entry.qr_code,
      qrAlt: entry.reservation_code || null,
      relevantDate: event.start_at || null,
      expirationDate: expiration(event.end_at),
      location,
      voided: entry.status === 'cancelled',
    }),
    ...eventSemantics({
      eventName: event.title,
      venueName,
      startAt: event.start_at || null,
      endAt: event.end_at || null,
      location,
    }),
    eventTicket: {
      headerFields: [{ key: 'kind', label: wl(lang, 'guestList'), value: typeLabel }],
      primaryFields: [{ key: 'event', value: event.title }],
      secondaryFields: [
        { key: 'venue', label: wl(lang, 'venue'), value: venueName },
        ...(event.start_at
          ? [{
              key: 'date',
              label: wl(lang, 'date'),
              value: event.start_at,
              dateStyle: 'PKDateStyleMedium',
              timeStyle: 'PKDateStyleNone',
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      auxiliaryFields: [
        // L'heure limite prime : passé cette heure, l'entrée n'est plus gratuite.
        ...(freeBefore
          ? [{ key: 'free', label: wl(lang, 'freeBefore'), value: freeBefore }]
          : []),
        ...(hasDrink
          ? [{
              key: 'drink',
              label: wl(lang, 'entryType'),
              value: wl(lang, 'entryDrink'),
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      backFields: [
        { key: 'ref', label: wl(lang, 'reference'), value: reference },
        ...(entry.full_name ? [{ key: 'holder', label: wl(lang, 'holder'), value: entry.full_name }] : []),
        ...(genre ? [{ key: 'genre', label: wl(lang, 'genre'), value: genre }] : []),
        { key: 'help', label: wl(lang, 'help'), value: 'https://yunoapp.eu/my-orders' },
      ],
    },
  };

  return { passJson, serial: `g-${entry.id}`, userId: entry.user_id, lang };
}
