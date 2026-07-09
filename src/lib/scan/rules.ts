import type {
  GuestListScanEntity,
  ScanContext,
  ScanVerdict,
  TableScanEntity,
  TicketScanEntity,
} from './types';

/**
 * Règles PURES de validation des scans de porte — aucune I/O, aucune date
 * implicite. Le chemin online (Bouncer.tsx) et le chemin offline (manifeste
 * local) passent tous les deux par ici : une divergence de règles entre les
 * deux serait un bug de sécurité d'accès en soirée.
 *
 * ⚠️ L'ORDRE des vérifications par type d'entité est du comportement observé
 * par le staff (quel message s'affiche en premier) — ne pas le « normaliser » :
 *  - billets  : venue → [cancel] → déjà scanné → non payé → OK
 *  - tables   : venue → non payé → déjà scanné → OK
 *  - guest list : venue → déjà scanné → annulée → deadline → OK
 */

/** GL- préfixe = entrée guest list ; sinon lookup générique attendee→ticket→table. */
export function classifyQr(qr: string): 'guest_list' | 'generic' {
  return qr.startsWith('GL-') ? 'guest_list' : 'generic';
}

/**
 * Deadline d'une guest list : HH:MM ancré sur la date de début de l'événement,
 * reporté au lendemain si l'heure tombe avant le début (ex. event à 23h,
 * deadline 01h30 → 01h30 le lendemain). Extraction exacte de la logique
 * historique de Bouncer.tsx — NE PAS dupliquer ailleurs.
 */
export function computeGuestListDeadline(deadlineTime: string, eventStartAt: string): Date {
  const [h, m] = deadlineTime.substring(0, 5).split(':').map(Number);
  const eventStart = new Date(eventStartAt);
  const deadline = new Date(eventStart);
  deadline.setHours(h, m, 0, 0);
  if (deadline < eventStart) deadline.setDate(deadline.getDate() + 1);
  return deadline;
}

/** Priorité des deadlines GL : entrée > guest list > free_before_time. */
export function resolveGuestListDeadline(
  entity: Pick<GuestListScanEntity, 'entryDeadline' | 'glDeadline' | 'freeBeforeTime'>,
): { time: string | null; source: 'entry' | 'guest_list' } {
  const entryLevel = entity.entryDeadline || entity.glDeadline;
  if (entity.entryDeadline) return { time: entity.entryDeadline, source: 'entry' };
  return { time: entryLevel || entity.freeBeforeTime, source: 'guest_list' };
}

export function validateTicketEntry(entity: TicketScanEntity, ctx: ScanContext): ScanVerdict {
  if (entity.venueId !== ctx.venueId) return { status: 'wrong_venue' };

  if (ctx.mode === 'cancel') {
    if (entity.status !== 'paid') return { status: 'not_paid' };
    if (entity.scanned) return { status: 'cannot_cancel_scanned' };
    return { status: 'cancel_ready' };
  }

  if (entity.scanned) return { status: 'already', scannedAt: entity.scannedAt };
  if (entity.status !== 'paid') return { status: 'not_paid' };
  return { status: 'success' };
}

export function validateTableReservation(entity: TableScanEntity, ctx: ScanContext): ScanVerdict {
  if (entity.venueId !== ctx.venueId) return { status: 'wrong_venue' };
  if (entity.status !== 'paid') return { status: 'not_paid' };
  if (entity.scanned) return { status: 'already', scannedAt: entity.scannedAt };
  return { status: 'success' };
}

export function validateGuestListEntry(entity: GuestListScanEntity, ctx: ScanContext): ScanVerdict {
  if (entity.venueId !== ctx.venueId) return { status: 'wrong_venue' };
  if (entity.scanned) return { status: 'already', scannedAt: entity.scannedAt };
  if (entity.status === 'cancelled') return { status: 'cancelled' };

  const { time, source } = resolveGuestListDeadline(entity);
  if (time) {
    const deadline = computeGuestListDeadline(time, entity.eventStartAt);
    if (ctx.now > deadline) return { status: 'deadline_passed', deadlineSource: source };
  }

  return { status: 'success' };
}
