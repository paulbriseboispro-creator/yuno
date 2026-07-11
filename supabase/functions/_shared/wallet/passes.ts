// Constructeurs de pass.json — billets (eventTicket) et tables VIP (generic).
// Chargent les données, résolvent la langue du client (D6) et assemblent le
// pass. La signature vit dans signer.ts ; les images dans assets.ts.
//
// Leviers lock-screen des passes statiques :
//  - relevantDate  = start_at   → le billet remonte sur l'écran verrouillé le soir J
//  - locations     = lat/lng du club → il remonte aussi en APPROCHANT du club
//  - expirationDate = end_at + 6h  → le pass se grise tout seul après la soirée
//
// Décision D2 : webServiceURL pointe dès l'émission vers le routeur /wallet de
// send-ticket-confirmation — les devices s'enregistrent dès maintenant, les
// pushes de mise à jour arriveront en Phase 5 sans réémettre les passes.
// deno-lint-ignore-file no-explicit-any
import { normalizeWalletLang, wl, type WalletLang } from './i18n.ts';

/** Client Supabase admin minimal (évite d'importer le SDK ici). */
interface AdminClient {
  from(table: string): any;
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
    backgroundColor: 'rgb(10,10,10)',
    foregroundColor: 'rgb(255,255,255)',
    labelColor: 'rgb(232,25,44)',
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
      events!inner(title, start_at, end_at, venue_id, partner_venue_id, location_name, location_city, location_is_secret)
    `)
    .eq('id', ticketId)
    .single();
  if (error || !ticket) throw new Error('Ticket not found');
  if (!ticket.qr_code) throw new Error('Ticket has no QR');

  const event = ticket.events as any;
  const venueId = event.venue_id ?? event.partner_venue_id;
  let venue: any = null;
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

  const round = (ticket.ticket_rounds as any)?.name || null;
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
    eventTicket: {
      primaryFields: [{ key: 'event', label: wl(lang, 'event'), value: event.title }],
      secondaryFields: [
        { key: 'venue', label: wl(lang, 'venue'), value: venueName },
        ...(event.start_at
          ? [{
              key: 'date',
              label: wl(lang, 'date'),
              value: event.start_at,
              dateStyle: 'PKDateStyleMedium',
              timeStyle: 'PKDateStyleShort',
            }]
          : []),
      ],
      auxiliaryFields: [
        ...(round ? [{ key: 'round', label: wl(lang, 'ticket'), value: round }] : []),
        { key: 'qty', label: wl(lang, 'persons'), value: String(ticket.quantity || 1) },
      ],
      backFields: [
        { key: 'ref', label: wl(lang, 'reference'), value: reference },
        ...(ticket.full_name ? [{ key: 'holder', label: wl(lang, 'holder'), value: ticket.full_name }] : []),
        { key: 'help', label: wl(lang, 'help'), value: 'https://yunoapp.eu/my-orders' },
      ],
    },
  };

  return { passJson, serial: `t-${ticket.id}`, userId: ticket.user_id, lang };
}

/** Réservation de table VIP — pass generic, QR = table_reservations.qr_code. */
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
      events!inner(title, start_at, end_at, venue_id, partner_venue_id, location_name, location_is_secret)
    `)
    .eq('id', reservationId)
    .single();
  if (error || !resa) throw new Error('Reservation not found');
  if (!resa.qr_code) throw new Error('Reservation has no QR');

  const event = resa.events as any;
  const venueId = event.venue_id ?? event.partner_venue_id;
  let venue: any = null;
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
    (resa.table_packs as any)?.name || (resa.table_zones as any)?.name || null;
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
    generic: {
      primaryFields: [{ key: 'event', label: wl(lang, 'event'), value: event.title }],
      secondaryFields: [
        { key: 'venue', label: wl(lang, 'venue'), value: venueName },
        ...(tableName ? [{ key: 'table', label: wl(lang, 'table'), value: tableName }] : []),
      ],
      auxiliaryFields: [
        ...(event.start_at
          ? [{
              key: 'date',
              label: wl(lang, 'date'),
              value: event.start_at,
              dateStyle: 'PKDateStyleMedium',
              timeStyle: 'PKDateStyleShort',
            }]
          : []),
        { key: 'guests', label: wl(lang, 'guests'), value: String(resa.guest_count || 1) },
      ],
      backFields: [
        { key: 'ref', label: wl(lang, 'reference'), value: reference },
        ...(resa.full_name ? [{ key: 'holder', label: wl(lang, 'holder'), value: resa.full_name }] : []),
        { key: 'help', label: wl(lang, 'help'), value: 'https://yunoapp.eu/my-orders' },
      ],
    },
  };

  return { passJson, serial: `v-${resa.id}`, userId: resa.user_id, lang };
}
