// Places nominatives d'un billet acheté pour plusieurs personnes
// (`ticket_attendees`) : un QR par personne, que chaque ami présente seul à
// la porte. Le QR du billet entier (e-mail, Wallet) reste valable et fait
// entrer toutes les places encore libres d'un coup.
//
// PUR et SANS IMPORT Deno : create-ticket-checkout l'appelle sur ses deux
// chemins (paiement Stripe réel et simulation démo, qui ne doivent jamais
// fabriquer des places différemment), et vitest le couvre
// (src/lib/__tests__/ticketPlaces.test.ts).
//
// Règles :
//  - un billet de N personnes a EXACTEMENT N places, ou aucune. La porte compte
//    une commande nominative place par place (`_door_headcount`) et rembourse
//    une place pour 1/N du billet : une place de trop ou de moins fausserait
//    les deux. Ce que le navigateur envoie ne décide donc ni du nombre, ni de
//    l'identité de l'acheteur ;
//  - un billet d'UNE personne n'a pas de place : son QR est la place ;
//  - un pack de groupe (`is_group`) garde son QR unique : une place y vaudrait
//    un groupe entier, que la porte compterait pour une personne ;
//  - la place 1 est l'acheteur, lue côté serveur ; les suivantes viennent du
//    formulaire. Un ami laissé sans nom devient « <acheteur> +k », lisible à
//    la porte dans les trois langues ;
//  - QR de la place k = `<QR du billet>-k`, convention déjà lue par la démo ;
//  - `created_at` avance d'une milliseconde par place : un insert en lot donne
//    à toutes la même heure, et le carrousel du client (trié par created_at)
//    montrerait les QR dans le désordre.

import { cleanNamePart } from "./guest-name.ts";

export const MAX_TICKET_PLACES = 50;
const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;

export interface PlacePerson {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
}

export interface TicketPlaceRow {
  full_name: string;
  email: string | null;
  phone: string | null;
  qr_code: string;
  created_at: string;
}

export interface TicketPlacesInput {
  /** QR du billet entier (`tickets.qr_code`). */
  ticketQr: string;
  quantity: unknown;
  isGroup: boolean;
  /** L'acheteur tel que le serveur le connaît (compte ou invité). */
  buyer: PlacePerson;
  /** Le formulaire : index 0 = l'acheteur, puis un ami par place. */
  attendees: unknown;
  /** Horloge de la première place (ms). */
  now?: number;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = cleanNamePart(value).slice(0, max).trim();
  return cleaned || null;
}

function personName(value: unknown): string | null {
  const name = text(value, MAX_NAME);
  return name && /\p{L}/u.test(name) ? name : null;
}

function personEmail(value: unknown): string | null {
  const email = text(value, MAX_EMAIL);
  if (!email || /\s/.test(email)) return null;
  return /^[^@]+@[^@]+\.[^@]+$/.test(email) ? email.toLowerCase() : null;
}

function personPhone(value: unknown): string | null {
  const phone = text(value, MAX_PHONE);
  return phone && /\d/.test(phone) ? phone : null;
}

/** Nombre de places à créer pour ce billet (0 = le QR du billet suffit). */
export function ticketPlaceCount(quantity: unknown, isGroup: boolean): number {
  if (isGroup) return 0;
  const n = typeof quantity === "number" ? quantity : Number.NaN;
  if (!Number.isInteger(n) || n < 2 || n > MAX_TICKET_PLACES) return 0;
  return n;
}

export function buildTicketPlaces(input: TicketPlacesInput): TicketPlaceRow[] {
  const count = ticketPlaceCount(input.quantity, input.isGroup);
  const ticketQr = typeof input.ticketQr === "string" ? input.ticketQr.trim() : "";
  if (count === 0 || !ticketQr) return [];

  const sent = Array.isArray(input.attendees) ? input.attendees as PlacePerson[] : [];
  const form = (i: number): PlacePerson => {
    const row = sent[i];
    return row && typeof row === "object" ? row : {};
  };

  const buyerEmail = personEmail(input.buyer.email);
  const buyerName = personName(input.buyer.fullName)
    ?? personName(form(0).fullName)
    ?? (buyerEmail ? buyerEmail.split("@")[0] : null)
    ?? "Guest";
  const start = typeof input.now === "number" && Number.isFinite(input.now) ? input.now : Date.now();

  const rows: TicketPlaceRow[] = [];
  for (let i = 0; i < count; i++) {
    const createdAt = new Date(start + i).toISOString();
    const qr = `${ticketQr}-${i + 1}`;
    if (i === 0) {
      rows.push({
        full_name: buyerName,
        email: buyerEmail,
        phone: personPhone(input.buyer.phone) ?? personPhone(form(0).phone),
        qr_code: qr,
        created_at: createdAt,
      });
      continue;
    }
    const friend = form(i);
    rows.push({
      full_name: personName(friend.fullName) ?? `${buyerName} +${i}`,
      email: personEmail(friend.email),
      phone: personPhone(friend.phone),
      qr_code: qr,
      created_at: createdAt,
    });
  }
  return rows;
}
