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

/**
 * Périmètre d'une porte. Une soirée se tient soit dans un CLUB, soit sous la
 * seule responsabilité d'un ORGANISATEUR (events.venue_id et partner_venue_id
 * tous les deux NULL). Le contrôle « ce QR appartient-il bien à ma porte ? »
 * doit donc pouvoir s'ancrer sur l'un ou l'autre.
 *
 * Un seul des deux champs est renseigné à la fois. Le club prime quand il
 * existe : c'est exactement le comportement d'avant pour tout le parc clubs.
 */
export interface DoorScope {
  venueId: string | null;
  organizerUserId: string | null;
}

interface BaseScanEntity {
  id: string;
  name: string | null;
  /** Statut métier de l'entité (tickets.status / guest_list_entries.status / table_reservations.status). */
  status: string;
  scanned: boolean;
  scannedAt: string | null;
  /** Club de la soirée. NULL sur une soirée sans club (org-led). */
  venueId: string | null;
  /** Organisateur de la soirée. NULL sur une soirée de club pure. */
  organizerUserId: string | null;
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
  /** Périmètre de la personne qui scanne (son club, ou son organisateur). */
  scope: DoorScope;
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
  | 'cannot_cancel_scanned'
  /** Chemin offline uniquement : QR absent du manifeste (billet acheté après la dernière synchro ?). */
  | 'not_found';

export interface ScanVerdict {
  status: ScanVerdictStatus;
  /** Renseigné pour 'already' : horodatage du scan précédent. */
  scannedAt?: string | null;
  /** Pour 'deadline_passed' : la deadline venait-elle de l'entrée (message dédié) ? */
  deadlineSource?: 'entry' | 'guest_list';
}
