// Constructeurs de pass.json — billets, guest list et tables VIP. Les trois
// partagent une seule grille (design « Yuno Wallet Ticket », 2026-09-04) :
//
//   en-tête   le wordmark yuno, SEUL. L'en-tête n'a de place que pour deux
//             libellés minuscules à côté du logo : « GRATUIT AVANT » s'y
//             faisait tronquer en « GRAT… ». Ces chiffres ont une colonne
//             entière dans le corps.
//   principal CLUB en label, TITRE en valeur — l'anatomie de l'event card du
//             design system public (§6.1) : club en kicker, titre en héros.
//   ligne 1   TYPE | le chiffre qui décide de la soirée pour ce pilier :
//             PORTES (billet), GRATUIT AVANT (guest list), TABLE (VIP).
//   ligne 2   DATE | PORTEUR
//   dos       référence, invitant / places / pack et convives selon le pilier,
//             club, adresse, line-up, genre, lien de gestion
//
// Deux règles de forme héritées du design, ne pas les défaire :
//  - Fond NOIR PLEIN #0A0A0A. `backgroundColor` est une couleur unie, Wallet
//    ne sait pas faire de dégradé : l'ancienne rampe noir→rouge était une
//    image `background.png` étirée, elle écrasait le QR et cassait le contraste
//    des labels. Le rouge n'est plus qu'un accent (les labels).
//  - Le rouge de marque #E8192C est LE labelColor des TROIS piliers. La table
//    VIP a porté un or #F2B23C pendant une itération : sur un pass déjà dense
//    en capitales, ça virait au mur jaune. Un seul accent, comme le dit le
//    design system public — c'est le contenu qui distingue les piliers, pas
//    la couleur.
//
// Deux layouts dans UN SEUL .pkpass, comme Apple le recommande :
//  - eventTicket classique — le socle, celui que rendent iOS 17 et antérieurs,
//    et celui qui pose le QR sur la FACE du pass (ce que scanne le videur).
//  - poster event ticket (iOS 18+) — l'affiche plein cadre. Il se déclenche
//    par `preferredStyleSchemes` ET par un jeu de balises sémantiques
//    complet ; s'il en manque une, Wallet retombe silencieusement sur le
//    classique. Les champs classiques restent donc OBLIGATOIRES : sans eux, le
//    pass s'affiche vide sur un vieil OS (« Ensure backward compatibility »).
//
// Le poster est derrière `WALLET_POSTER_LAYOUT=1`, éteint par défaut. Apple
// écrit noir sur blanc « Poster event tickets aren't compatible with tickets
// that require a QR code or barcode for entry » — et toute la porte Yuno est
// un scan de QR. Tant qu'un test sur un vrai iPhone iOS 18 n'a pas montré où
// atterrit le code-barres, on ne bascule pas la production sur un layout qui
// pourrait enterrer le QR sous un tap au milieu d'une file d'attente.
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
import { passArtwork } from './artwork.ts';

/** Ligne event embarquée (`events!inner(...)`) des selects ci-dessous. */
interface WalletEventRow {
  id?: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  venue_id: string | null;
  partner_venue_id: string | null;
  organizer_user_id?: string | null;
  location_name: string | null;
  location_city?: string | null;
  location_address?: string | null;
  location_is_secret: boolean | null;
  poster_url?: string | null;
  image_url?: string | null;
  music_genres: string[] | null;
  timezone?: string | null;
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
    holder_type: string | null;
    holder_label: string | null;
    dj_id: string | null;
    promoter_id: string | null;
    agency_id: string | null;
    organizer_user_id: string | null;
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
  in(column: string, values: unknown[]): WalletQuery<Row>;
  single(): PromiseLike<{ data: Row | null; error: unknown }>;
  maybeSingle(): PromiseLike<{ data: Row | null; error?: unknown }>;
  then<R>(cb: (r: { data: Row[] | null; error?: unknown }) => R): PromiseLike<R>;
}

/** Client Supabase admin minimal (évite d'importer le SDK ici). */
interface AdminClient {
  from(table: 'profiles'): WalletQuery<{
    preferred_language: string | null;
    organization_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  }>;
  from(table: 'tickets'): WalletQuery<WalletTicketRow>;
  from(table: 'table_reservations'): WalletQuery<WalletReservationRow>;
  from(table: 'guest_list_entries'): WalletQuery<WalletGuestListRow>;
  from(table: 'venues'): WalletQuery<WalletVenueRow>;
  from(table: 'organizer_profiles'): WalletQuery<{ display_name: string | null }>;
  from(table: 'event_djs'): WalletQuery<{ dj_id: string | null }>;
  from(table: 'djs_public'): WalletQuery<{ id: string; stage_name: string | null }>;
  from(table: 'agencies'): WalletQuery<{ name: string | null }>;
  from(table: 'promoters'): WalletQuery<{ user_id: string | null; promo_code: string | null }>;
  from(table: 'djs'): WalletQuery<{ stage_name: string | null }>;
}

export interface PassBuild {
  passJson: Record<string, unknown>;
  /** Images propres au pass (affiche de la soirée) — fusionnées aux images fixes. */
  assets: Record<string, Uint8Array>;
  serial: string;
  userId: string | null;
  lang: WalletLang;
}

const PASS_TYPE_ID = () => Deno.env.get('WALLET_PASS_TYPE_ID') ?? 'pass.eu.yunoapp.app';
const TEAM_ID = () => Deno.env.get('WALLET_TEAM_ID') ?? '';

/** Rouge de marque — labels des billets et de la guest list. */
const RED = 'rgb(232,25,44)';
/** Noir Yuno plein. Aucun dégradé : Wallet n'en fait pas. */
const BLACK = 'rgb(10,10,10)';

/**
 * Layout poster (iOS 18+). Éteint tant qu'un test device n'a pas confirmé que
 * le QR reste atteignable à la porte — voir l'en-tête de ce fichier.
 */
function posterEnabled(): boolean {
  return Deno.env.get('WALLET_POSTER_LAYOUT') === '1';
}

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

/**
 * Enseigne qui reçoit le public : le club s'il y en a un, sinon l'organisateur.
 * Même règle que les emails de confirmation (`resolveBrandName`) — le pass et
 * l'email doivent nommer le même hôte.
 */
async function resolveBrand(admin: AdminClient, event: WalletEventRow): Promise<string> {
  const venueId = event.venue_id ?? event.partner_venue_id ?? null;
  if (venueId) {
    const { data } = await admin.from('venues').select('name').eq('id', venueId).maybeSingle();
    if (data?.name) return data.name;
  }
  if (event.organizer_user_id) {
    const { data: org } = await admin
      .from('organizer_profiles').select('display_name').eq('user_id', event.organizer_user_id).maybeSingle();
    if (org?.display_name) return org.display_name;
    const { data: profile } = await admin
      .from('profiles').select('organization_name, first_name, last_name').eq('id', event.organizer_user_id).maybeSingle();
    const name = profile?.organization_name
      || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
    if (name) return name;
  }
  return 'Yuno';
}

/**
 * Line-up public de la soirée (`event_djs` → `djs_public`, la même porte que la
 * page événement). Sert au dos du pass ET aux `semantics.performerNames`, que
 * Wallet lit pour proposer la soirée sur l'écran verrouillé.
 */
async function resolveLineup(admin: AdminClient, eventId: string | null | undefined): Promise<string[]> {
  if (!eventId) return [];
  try {
    const { data: links } = await admin.from('event_djs').select('dj_id').eq('event_id', eventId);
    const ids = (links ?? []).map((l) => l.dj_id).filter(Boolean) as string[];
    if (ids.length === 0) return [];
    const { data: djs } = await admin.from('djs_public').select('id, stage_name').in('id', ids);
    return (djs ?? []).map((d) => d.stage_name).filter(Boolean) as string[];
  } catch {
    return [];
  }
}

/**
 * Adresse affichable — un lieu secret n'en révèle jamais.
 * La ville n'est ajoutée que si la rue ne la porte pas déjà : la moitié des
 * clubs saisissent « 62 rue X, 75008 Paris, France » dans le champ adresse, et
 * « …, France, Paris » se lit comme une erreur de saisie sur le pass.
 */
function publicAddress(event: WalletEventRow, venue: WalletVenueRow | null): string | null {
  if (event.location_is_secret) return null;
  const street = venue?.address || event.location_address || null;
  const city = venue?.city || event.location_city || null;
  if (!street) return city;
  if (city && !street.toLowerCase().includes(city.toLowerCase())) return `${street}, ${city}`;
  return street;
}

interface ShellOpts {
  serial: string;
  description: string;
  authToken: string;
  qr: string;
  qrAlt: string | null;
  relevantDate: string | null;
  /** Fin RÉELLE de la soirée — fenêtre lock-screen, pas la péremption. */
  eventEnd: string | null;
  expirationDate: string | null;
  location: { lat: number; lng: number } | null;
  voided: boolean;
  labelColor: string;
  /** Soirée du pass — Wallet EMPILE les passes qui partagent cette valeur. */
  eventId: string | null;
}

/** Champs communs aux trois passes. */
function passShell(opts: ShellOpts): Record<string, unknown> {
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID(),
    teamIdentifier: TEAM_ID(),
    organizationName: 'Yuno',
    serialNumber: opts.serial,
    description: opts.description,
    // Noir plein : le fond du design. Pas d'image `background.png`.
    backgroundColor: BLACK,
    foregroundColor: 'rgb(255,255,255)',
    labelColor: opts.labelColor,
    sharingProhibited: true,
    // Quatre amis pour la même soirée = une pile dans Wallet, pas quatre
    // cartes éparpillées.
    ...(opts.eventId ? { groupingIdentifier: `yuno-event-${opts.eventId}` } : {}),
    ...(opts.voided ? { voided: true } : {}),
    // `relevantDate` est déprécié depuis iOS 18 mais reste le SEUL levier
    // lock-screen d'iOS 17 : les deux cohabitent dans le même pass.
    ...(opts.relevantDate ? { relevantDate: opts.relevantDate } : {}),
    ...(opts.relevantDate
      ? {
          relevantDates: [
            opts.eventEnd
              ? { startDate: opts.relevantDate, endDate: opts.eventEnd }
              : { date: opts.relevantDate },
          ],
        }
      : {}),
    ...(posterEnabled() ? { preferredStyleSchemes: ['posterEventTicket', 'eventTicket'] } : {}),
    // Bande basse du poster : le noir du design, pas le gris système.
    ...(posterEnabled() ? { footerBackgroundColor: BLACK } : {}),
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
 * ce soir » sur l'écran verrouillé, et le nom des artistes.
 */
function eventSemantics(opts: {
  eventName: string;
  venueName: string;
  venueRoom: string;
  city: string | null;
  startAt: string | null;
  endAt: string | null;
  location: { lat: number; lng: number } | null;
  address: string | null;
  performers: string[];
  admissionLevel: string | null;
  seats: { seatSection?: string; seatType?: string } | null;
}): Record<string, unknown> {
  return {
    semantics: {
      eventType: 'PKEventTypeLivePerformance',
      // Les CINQ balises que le layout poster exige pour une soirée live :
      // eventName, venueName, venueRoom, venueRegionName, performerNames. Il en
      // manque une → Wallet retombe sur le classique, sans un mot. D'où les
      // replis : une soirée sans salle nommée reprend l'enseigne, une soirée
      // sans line-up publié reprend l'enseigne comme « artiste ».
      eventName: opts.eventName,
      venueName: opts.venueName,
      venueRoom: opts.venueRoom,
      venueRegionName: opts.city || opts.venueName,
      performerNames: opts.performers.length ? opts.performers : [opts.venueName],
      ...(opts.address ? { venueAddress: opts.address } : {}),
      ...(opts.admissionLevel ? { admissionLevel: opts.admissionLevel } : {}),
      ...(opts.seats ? { seats: [opts.seats] } : {}),
      ...(opts.startAt ? { eventStartDate: opts.startAt } : {}),
      ...(opts.endAt ? { eventEndDate: opts.endAt } : {}),
      ...(opts.location
        ? { venueLocation: { latitude: opts.location.lat, longitude: opts.location.lng } }
        : {}),
    },
  };
}

/**
 * Section « Infos complémentaires » du layout poster — le seul endroit où
 * Wallet accepte du texte libre sur la FACE d'un poster event ticket. Le
 * line-up et le genre y vivent : c'est du contexte de soirée, pas de
 * l'information de porte. Absente du layout classique (Apple : « Only poster
 * event ticket passes support the Additional Info section »), donc on ne
 * l'émet que quand le poster est allumé.
 */
function additionalInfoFields(opts: {
  lang: WalletLang;
  lineup: string[];
  genre: string | null;
}) {
  if (!posterEnabled()) return {};
  const fields = [
    ...(opts.lineup.length
      ? [{ key: 'lineup', label: wl(opts.lang, 'lineup'), value: opts.lineup.join(' · ') }]
      : []),
    ...(opts.genre ? [{ key: 'genre', label: wl(opts.lang, 'genre'), value: opts.genre }] : []),
  ];
  return fields.length ? { additionalInfoFields: fields } : {};
}

/** end_at + 6h (marge afterparty), ou null si pas de fin connue. */
function expiration(endAt: string | null): string | null {
  if (!endAt) return null;
  const d = new Date(endAt);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 6 * 3600_000).toISOString();
}

const LOCALE: Record<WalletLang, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };

/**
 * La date et l'heure de l'en-tête sont des CHAÎNES, pas des champs de type
 * date. Deux raisons, et la seconde compte plus que la première :
 *
 *  1. Le design demande « 11 SEPT », pas « 11 septembre 2026 ». Aucun
 *     `dateStyle` PassKit ne donne jour + mois abrégé sans l'année.
 *  2. Un champ date est rendu par Wallet DANS LE FUSEAU DU TÉLÉPHONE. Un
 *     client qui atterrit à Madrid la veille verrait son billet parisien
 *     avancer d'une heure. Une soirée a lieu à l'heure du club, point — on
 *     formate donc nous-mêmes, au fuseau de l'événement.
 *
 * La pertinence (écran verrouillé, rappel « c'est ce soir ») ne passe pas par
 * ces champs mais par `relevantDates` et `semantics`, qui restent de vraies
 * dates.
 */
function inZone(lang: WalletLang, iso: string, tz: string | null | undefined, opts: Intl.DateTimeFormatOptions): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(LOCALE[lang], { ...opts, timeZone: tz || 'Europe/Paris' }).format(d);
  } catch {
    // Fuseau inconnu en base : on rend en UTC plutôt que de perdre le champ.
    try {
      return new Intl.DateTimeFormat(LOCALE[lang], opts).format(d);
    } catch {
      return null;
    }
  }
}

/** « 11 SEPT » — jour et mois abrégé, en capitales, jamais l'année. */
function shortDate(lang: WalletLang, iso: string, tz: string | null | undefined): string | null {
  const s = inZone(lang, iso, tz, { day: 'numeric', month: 'short' });
  return s ? s.replace(/\./g, '').toUpperCase() : null;
}

/** « 23:30 » — 24h, au fuseau du club. */
function clockTime(lang: WalletLang, iso: string, tz: string | null | undefined): string | null {
  return inZone(lang, iso, tz, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Dos du pass — commun aux trois piliers. `holder` n'y descend QUE s'il n'est
 * pas déjà sur la face : le billet et la guest list portent PORTEUR en
 * auxiliaire, la table VIP donne ces deux colonnes au pack et aux convives.
 */
function backFields(opts: {
  lang: WalletLang;
  reference: string;
  holder: string | null;
  venue: string | null;
  address: string | null;
  lineup: string[];
  genre: string | null;
  /** Champs propres au pilier : places d'un billet groupé, pack et convives. */
  extra?: Array<{ key: string; label: string; value: string }>;
}) {
  const { lang } = opts;
  return [
    { key: 'ref', label: wl(lang, 'reference'), value: opts.reference },
    ...(opts.extra ?? []),
    ...(opts.holder ? [{ key: 'holder', label: wl(lang, 'holder'), value: opts.holder }] : []),
    ...(opts.venue ? [{ key: 'venue', label: wl(lang, 'venue'), value: opts.venue }] : []),
    ...(opts.address ? [{ key: 'address', label: wl(lang, 'address'), value: opts.address }] : []),
    ...(opts.lineup.length
      ? [{ key: 'lineup', label: wl(lang, 'lineup'), value: opts.lineup.join(' · ') }]
      : []),
    ...(opts.genre ? [{ key: 'genre', label: wl(lang, 'genre'), value: opts.genre }] : []),
    { key: 'help', label: wl(lang, 'help'), value: 'https://yunoapp.eu/my-orders' },
  ];
}

/**
 * Valeur de métadonnée : capitales. Le design system public passe toute donnée
 * factuelle — lieu, tag, formule — en capitales (§1). Jamais sur un nom de
 * personne : une identité n'est pas une métadonnée.
 */
function meta(v: string | null | undefined): string {
  return (v || '').toUpperCase();
}

/** Genre musical affichable (2 genres max), ou null. */
function genreOf(event: WalletEventRow): string | null {
  return Array.isArray(event.music_genres)
    ? event.music_genres.filter(Boolean).slice(0, 2).join(' · ') || null
    : null;
}

/** Coordonnées du club — jamais sur un lieu secret. */
function coordsOf(event: WalletEventRow, venue: WalletVenueRow | null) {
  return !event.location_is_secret && venue?.latitude != null && venue?.longitude != null
    ? { lat: Number(venue.latitude), lng: Number(venue.longitude) }
    : null;
}

/** Club de la soirée (venue hôte ou partenaire), ou null si soirée sans salle. */
async function loadVenue(admin: AdminClient, event: WalletEventRow): Promise<WalletVenueRow | null> {
  const venueId = event.venue_id ?? event.partner_venue_id;
  if (!venueId) return null;
  const { data } = await admin
    .from('venues')
    .select('name, address, city, latitude, longitude')
    .eq('id', venueId)
    .maybeSingle();
  return data;
}

/** Colonnes d'`events` lues par les trois passes. */
const EVENT_COLUMNS =
  'id, title, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, location_name, ' +
  'location_city, location_address, location_is_secret, poster_url, image_url, music_genres, timezone';

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
      events!inner(${EVENT_COLUMNS})
    `)
    .eq('id', ticketId)
    .single();
  if (error || !ticket) throw new Error('Ticket not found');
  if (!ticket.qr_code) throw new Error('Ticket has no QR');

  const event = ticket.events;
  const venue = await loadVenue(admin, event);
  const lang = await resolveLang(admin, ticket.user_id);
  const venueName = venue?.name || event.location_name || 'Yuno';
  const location = coordsOf(event, venue);
  const address = publicAddress(event, venue);
  const lineup = await resolveLineup(admin, event.id);
  const tz = event.timezone || null;
  const round = ticket.ticket_rounds?.name || wl(lang, 'entryNormal');
  const reference = ticket.reference_code || ticket.qr_code;
  const quantity = String(ticket.quantity || 1);

  const passJson = {
    ...passShell({
      serial: `t-${ticket.id}`,
      description: `${wl(lang, 'ticketDescription')} — ${event.title}`,
      authToken,
      qr: ticket.qr_code,
      qrAlt: ticket.reference_code || null,
      eventId: event.id ?? null,
      relevantDate: event.start_at || null,
      eventEnd: event.end_at || null,
      expirationDate: expiration(event.end_at),
      location,
      voided: ticket.status === 'refunded',
      labelColor: RED,
    }),
    ...eventSemantics({
      eventName: event.title,
      venueName,
      venueRoom: event.location_name || venueName,
      city: venue?.city || event.location_city || null,
      startAt: event.start_at || null,
      endAt: event.end_at || null,
      location,
      address,
      performers: lineup,
      admissionLevel: round,
      seats: null,
    }),
    eventTicket: {
      ...additionalInfoFields({ lang, lineup, genre: genreOf(event) }),
      headerFields: [],
      // Le club en kicker, le titre en héros — l'anatomie de l'event card du
      // design system public (§6.1). L'ancien label « SOIRÉE » ne disait rien
      // qu'on ne voie déjà, et l'en-tête n'a de place que pour deux libellés
      // minuscules : « GRATUIT AVANT » s'y faisait tronquer en « GRAT… ».
      primaryFields: [{ key: 'event', label: meta(venueName), value: event.title.toUpperCase() }],
      secondaryFields: [
        { key: 'type', label: wl(lang, 'type'), value: meta(round) },
        ...(event.start_at
          ? [{
              key: 'doors',
              label: wl(lang, 'doors'),
              value: clockTime(lang, event.start_at, tz) ?? '',
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      auxiliaryFields: [
        ...(event.start_at
          ? [{ key: 'date', label: wl(lang, 'date'), value: shortDate(lang, event.start_at, tz) ?? '' }]
          : []),
        ...(ticket.full_name
          ? [{
              key: 'holder',
              label: wl(lang, 'holderField'),
              value: ticket.full_name,
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      backFields: backFields({
        lang,
        reference,
        holder: null,
        venue: venueName,
        address,
        lineup,
        genre: genreOf(event),
        // « PLACES 1 » sur un billet individuel est du bruit ; un billet
        // groupé, lui, doit rester lisible — il se lit au dos.
        extra: Number(quantity) > 1
          ? [{ key: 'qty', label: wl(lang, 'persons'), value: quantity }]
          : [],
      }),
    },
  };

  return {
    passJson,
    assets: await passArtwork(event.poster_url || event.image_url, { poster: posterEnabled() }),
    serial: `t-${ticket.id}`,
    userId: ticket.user_id,
    lang,
  };
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
      events!inner(${EVENT_COLUMNS})
    `)
    .eq('id', reservationId)
    .single();
  if (error || !resa) throw new Error('Reservation not found');
  if (!resa.qr_code) throw new Error('Reservation has no QR');

  const event = resa.events;
  const venue = await loadVenue(admin, event);
  const lang = await resolveLang(admin, resa.user_id);
  const venueName = venue?.name || event.location_name || 'Yuno';
  const location = coordsOf(event, venue);
  const address = publicAddress(event, venue);
  const lineup = await resolveLineup(admin, event.id);
  const tz = event.timezone || null;
  const packName = resa.table_packs?.name || null;
  const zoneName = resa.table_zones?.name || null;
  const reference = resa.reference_code || resa.qr_code;

  const passJson = {
    ...passShell({
      serial: `v-${resa.id}`,
      description: `${wl(lang, 'vipDescription')} — ${event.title}`,
      authToken,
      qr: resa.qr_code,
      qrAlt: resa.reference_code || null,
      eventId: event.id ?? null,
      relevantDate: event.start_at || null,
      eventEnd: event.end_at || null,
      expirationDate: expiration(event.end_at),
      location,
      voided: resa.status === 'refunded',
      labelColor: RED,
    }),
    ...eventSemantics({
      eventName: event.title,
      venueName,
      venueRoom: zoneName || event.location_name || venueName,
      city: venue?.city || event.location_city || null,
      startAt: event.start_at || null,
      endAt: event.end_at || null,
      location,
      address,
      performers: lineup,
      admissionLevel: wl(lang, 'vipDescription'),
      seats: zoneName ? { seatSection: zoneName, seatType: packName || undefined } : null,
    }),
    eventTicket: {
      ...additionalInfoFields({ lang, lineup, genre: genreOf(event) }),
      // La zone remplace l'heure de portes : une table a un emplacement, et
      // c'est ce que l'hôte VIP demande à l'arrivée.
      headerFields: [],
      // Le club en kicker, le titre en héros — l'anatomie de l'event card du
      // design system public (§6.1). L'ancien label « SOIRÉE » ne disait rien
      // qu'on ne voie déjà, et l'en-tête n'a de place que pour deux libellés
      // minuscules : « GRATUIT AVANT » s'y faisait tronquer en « GRAT… ».
      primaryFields: [{ key: 'event', label: meta(venueName), value: event.title.toUpperCase() }],
      secondaryFields: [
        { key: 'type', label: wl(lang, 'type'), value: meta(wl(lang, 'vipDescription')) },
        // La zone prime sur l'heure : une table a un emplacement, et c'est ce
        // que l'hôte VIP demande à l'arrivée.
        ...(zoneName
          ? [{
              key: 'table',
              label: wl(lang, 'table'),
              // Le nom de zone est donné par le club (« Gold », « Carré VIP ») :
              // c'est un nom propre, on ne le passe pas en capitales.
              value: zoneName,
              textAlignment: 'PKTextAlignmentRight',
            }]
          : event.start_at
          ? [{
              key: 'arrival',
              label: wl(lang, 'arrival'),
              value: clockTime(lang, event.start_at, tz) ?? '',
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      auxiliaryFields: [
        ...(event.start_at
          ? [{ key: 'date', label: wl(lang, 'date'), value: shortDate(lang, event.start_at, tz) ?? '' }]
          : []),
        ...(resa.full_name
          ? [{
              key: 'holder',
              label: wl(lang, 'holderField'),
              value: resa.full_name,
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      backFields: backFields({
        lang,
        reference,
        holder: null,
        venue: venueName,
        address,
        lineup,
        genre: genreOf(event),
        // La face donne l'emplacement ; la formule et le nombre de convives
        // se lisent au dos, où ils tiennent en entier.
        extra: [
          ...(packName ? [{ key: 'pack', label: wl(lang, 'pack'), value: packName }] : []),
          { key: 'guests', label: wl(lang, 'guests'), value: String(resa.guest_count || 1) },
        ],
      }),
    },
  };

  return {
    passJson,
    assets: await passArtwork(event.poster_url || event.image_url, { poster: posterEnabled() }),
    serial: `v-${resa.id}`,
    userId: resa.user_id,
    lang,
  };
}

/**
 * Nom de QUI INVITE (part de guest list) — même arbre que l'email d'invitation.
 * Retombe sur l'enseigne : la part maison, c'est le club qui invite.
 */
async function resolveInviter(
  admin: AdminClient,
  part: WalletGuestListRow['guest_lists'],
  brand: string,
): Promise<string> {
  try {
    if (part.holder_type === 'dj' && part.dj_id) {
      const { data } = await admin.from('djs').select('stage_name').eq('id', part.dj_id).maybeSingle();
      if (data?.stage_name) return data.stage_name;
    }
    if (part.holder_type === 'promoter' && part.promoter_id) {
      const { data: promoter } = await admin
        .from('promoters').select('user_id, promo_code').eq('id', part.promoter_id).maybeSingle();
      if (promoter?.user_id) {
        const { data: profile } = await admin
          .from('profiles').select('first_name, last_name').eq('id', promoter.user_id).maybeSingle();
        const name = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
        if (name) return name;
      }
      if (promoter?.promo_code) return promoter.promo_code;
    }
    if (part.holder_type === 'organizer' && part.organizer_user_id) {
      const { data: profile } = await admin
        .from('profiles').select('first_name, last_name').eq('id', part.organizer_user_id).maybeSingle();
      const name = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
      if (name) return name;
    }
    if (part.holder_type === 'agency') {
      if (part.holder_label) return part.holder_label;
      if (part.agency_id) {
        const { data } = await admin.from('agencies').select('name').eq('id', part.agency_id).maybeSingle();
        if (data?.name) return data.name;
      }
    }
    if (part.holder_type === 'custom' && part.holder_label) return part.holder_label;
  } catch {
    // Une part dont le détenteur ne se résout pas reste une invitation valide.
  }
  return brand;
}

/**
 * Entrée de guest list — pass eventTicket, QR = guest_list_entries.qr_code
 * (le videur scanne le même code que pour un billet payant).
 *
 * Deux différences avec un billet : l'heure limite d'entrée gratuite est LE
 * renseignement décisif (elle passe donc en en-tête à la place des portes), et
 * la colonne « QUI INVITE » remplace le porteur secondaire.
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
        free_before_time, includes_drink, holder_type, holder_label,
        dj_id, promoter_id, agency_id, organizer_user_id,
        events!inner(${EVENT_COLUMNS})
      )
    `)
    .eq('id', entryId)
    .single();
  if (error || !entry) throw new Error('Guest list entry not found');
  if (!entry.qr_code) throw new Error('Guest list entry has no QR');

  const part = entry.guest_lists;
  const event = part.events;
  const venue = await loadVenue(admin, event);
  const lang = await resolveLang(admin, entry.user_id);
  const venueName = venue?.name || event.location_name || 'Yuno';
  const location = coordsOf(event, venue);
  const address = publicAddress(event, venue);
  const lineup = await resolveLineup(admin, event.id);
  const tz = event.timezone || null;
  const brand = await resolveBrand(admin, event);
  const inviter = await resolveInviter(admin, part, brand);

  const entryType = entry.entry_type || 'normal';
  // La boisson suit le type retenu ; `includes_drink` ne vaut que pour une part
  // sans ventilation (le club offre un verre à toute sa liste).
  const hasDrink = entryType === 'drink' || (entryType === 'normal' && !!part.includes_drink);
  const typeLabel = entryType === 'table' ? wl(lang, 'entryVip')
    : hasDrink ? wl(lang, 'entryDrink')
    : wl(lang, 'guestListDescription');
  const freeBefore = part.free_before_time?.substring(0, 5) || null;
  const reference = entry.reservation_code || entry.qr_code;

  const passJson = {
    ...passShell({
      serial: `g-${entry.id}`,
      description: `${wl(lang, 'guestListDescription')} — ${event.title}`,
      authToken,
      qr: entry.qr_code,
      qrAlt: entry.reservation_code || null,
      eventId: event.id ?? null,
      relevantDate: event.start_at || null,
      eventEnd: event.end_at || null,
      expirationDate: expiration(event.end_at),
      location,
      voided: entry.status === 'cancelled',
      labelColor: RED,
    }),
    ...eventSemantics({
      eventName: event.title,
      venueName,
      venueRoom: event.location_name || venueName,
      city: venue?.city || event.location_city || null,
      startAt: event.start_at || null,
      endAt: event.end_at || null,
      location,
      address,
      performers: lineup,
      admissionLevel: typeLabel,
      seats: null,
    }),
    eventTicket: {
      ...additionalInfoFields({ lang, lineup, genre: genreOf(event) }),
      // GRATUIT AVANT prime sur l'heure de portes : passé cette heure, l'entrée
      // n'est plus gratuite — c'est le seul chiffre qui change la soirée.
      headerFields: [],
      // Le club en kicker, le titre en héros — l'anatomie de l'event card du
      // design system public (§6.1). L'ancien label « SOIRÉE » ne disait rien
      // qu'on ne voie déjà, et l'en-tête n'a de place que pour deux libellés
      // minuscules : « GRATUIT AVANT » s'y faisait tronquer en « GRAT… ».
      primaryFields: [{ key: 'event', label: meta(venueName), value: event.title.toUpperCase() }],
      secondaryFields: [
        { key: 'type', label: wl(lang, 'type'), value: meta(typeLabel) },
        // GRATUIT AVANT prime : passé cette heure, l'entrée n'est plus
        // gratuite. C'est le seul chiffre qui change la soirée.
        ...(freeBefore
          ? [{
              key: 'free',
              label: wl(lang, 'freeBefore'),
              value: freeBefore,
              textAlignment: 'PKTextAlignmentRight',
            }]
          : event.start_at
          ? [{
              key: 'doors',
              label: wl(lang, 'doors'),
              value: clockTime(lang, event.start_at, tz) ?? '',
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      auxiliaryFields: [
        ...(event.start_at
          ? [{ key: 'date', label: wl(lang, 'date'), value: shortDate(lang, event.start_at, tz) ?? '' }]
          : []),
        ...(entry.full_name
          ? [{
              key: 'holder',
              label: wl(lang, 'holderField'),
              value: entry.full_name,
              textAlignment: 'PKTextAlignmentRight',
            }]
          : []),
      ],
      backFields: backFields({
        lang,
        reference,
        holder: null,
        venue: venueName,
        extra: [{ key: 'inviter', label: wl(lang, 'invitedBy'), value: inviter }],
        address,
        lineup,
        genre: genreOf(event),
      }),
    },
  };

  return {
    passJson,
    assets: await passArtwork(event.poster_url || event.image_url, { poster: posterEnabled() }),
    serial: `g-${entry.id}`,
    userId: entry.user_id,
    lang,
  };
}
