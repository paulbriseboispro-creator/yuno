/**
 * Types partagés du scan d'entrée (porte). Utilisés par le chemin online
 * (Bouncer.tsx) ET le chemin offline (manifeste local) — une seule source de
 * vérité pour les règles de validation.
 */

export type ScanEntityType =
  | 'ticket_attendee'
  | 'ticket'
  | 'guest_list_entry'
  | 'table_reservation';

interface BaseScanEntity {
  id: string;
  name: string | null;
  /** Statut métier de l'entité (tickets.status / guest_list_entries.status / table_reservations.status). */
  status: string;
  scanned: boolean;
  scannedAt: string | null;
  venueId: string;
}

export interface TicketScanEntity extends BaseScanEntity {
  type: 'ticket' | 'ticket_attendee';
  /** Id du ticket parent (= id pour un ticket simple). */
  ticketId: string;
}

export interface GuestListScanEntity extends BaseScanEntity {
  type: 'guest_list_entry';
  /** Deadline HH:MM(:SS) au niveau de l'entrée (prioritaire). */
  entryDeadline: string | null;
  /** Deadline HH:MM(:SS) au niveau de la guest list. */
  glDeadline: string | null;
  /** Heure « gratuit avant » de la guest list (fallback). */
  freeBeforeTime: string | null;
  /** start_at ISO de l'événement — ancre du calcul de deadline. */
  eventStartAt: string;
}

export interface TableScanEntity extends BaseScanEntity {
  type: 'table_reservation';
}

export type ScanEntity = TicketScanEntity | GuestListScanEntity | TableScanEntity;

export interface ScanContext {
  venueId: string;
  now: Date;
  mode: 'entry' | 'cancel';
}

export type ScanVerdictStatus =
  | 'success'
  | 'already'
  | 'not_paid'
  | 'cancelled'
  | 'deadline_passed'
  | 'wrong_venue'
  | 'cancel_ready'
  | 'cannot_cancel_scanned';

export interface ScanVerdict {
  status: ScanVerdictStatus;
  /** Renseigné pour 'already' : horodatage du scan précédent. */
  scannedAt?: string | null;
  /** Pour 'deadline_passed' : la deadline venait-elle de l'entrée (message dédié) ? */
  deadlineSource?: 'entry' | 'guest_list';
}
