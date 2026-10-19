/**
 * Tickets d'une table : un par personne d'une réservation de 2 à 50 personnes
 * (table `table_reservation_guests`, créés par la base). N° 0 = le titulaire,
 * sous son nom ; n° k = « Invité k ». QR = QR de la réservation + « -<n°+1> ».
 * Une table d'une personne n'a pas de ticket à part : son QR est son ticket.
 *
 * PUR : partagé par la porte (videur, scan web), la liste de porte et l'écran
 * du client. Testé dans src/lib/__tests__/tableGuests.test.ts.
 */

export interface TableGuestTicket {
  guest_number: number;
  full_name: string | null;
}

/** Miroir de `_table_guest_ticket_count` (SQL) : 0 = le QR de la réservation suffit. */
export function tableGuestTicketCount(guestCount: number | null | undefined): number {
  const n = typeof guestCount === 'number' ? guestCount : Number.NaN;
  return Number.isInteger(n) && n >= 2 && n <= 50 ? n : 0;
}

/**
 * Nom d'un ticket de table. Le titulaire garde son nom (repli : celui de la
 * réservation) ; un invité s'appelle « Invité k ».
 * `guestWord(k)` rend « Invité k » dans la langue de l'écran.
 */
export function tableGuestName(
  ticket: TableGuestTicket,
  holder: string | null | undefined,
  guestWord: (k: number) => string,
): string {
  if (ticket.guest_number <= 0) {
    const name = (ticket.full_name || holder || '').trim();
    return name || guestWord(0);
  }
  return guestWord(ticket.guest_number);
}

/**
 * Libellé de porte : le titulaire par son nom, un invité par « Invité k · <titulaire> »
 * (le videur sait à quelle table il appartient).
 */
export function tableGuestDoorName(
  ticket: TableGuestTicket,
  holder: string | null | undefined,
  guestWord: (k: number) => string,
): string {
  const name = tableGuestName(ticket, holder, guestWord);
  const owner = (holder || '').trim();
  return ticket.guest_number > 0 && owner ? `${name} · ${owner}` : name;
}

/** Tri d'affichage : titulaire d'abord, puis Invité 1, 2… */
export function sortTableGuests<T extends TableGuestTicket>(tickets: readonly T[]): T[] {
  return [...tickets].sort((a, b) => a.guest_number - b.guest_number);
}
