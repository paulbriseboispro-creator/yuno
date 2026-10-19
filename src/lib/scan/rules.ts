import type {
  DoorScope,
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

/**
 * La personne qui scanne est-elle bien à la porte de CETTE soirée ?
 *
 * Le périmètre a DEUX faces, et elles ne s'excluent pas : la même personne peut
 * être employée d'un club et recrutée par un organisateur pour une soirée sans
 * club. Le QR passe s'il correspond à l'UNE ou à l'AUTRE. Faire primer le club
 * sur l'organisateur faisait refuser toute la soirée d'un videur qui traînait un
 * `profiles.venue_id` d'un ancien poste, alors que la base (`is_event_door_staff`)
 * lui donnait bien les droits.
 *
 * Fermé par défaut : une porte sans périmètre ne valide rien. C'est ce qui
 * évite qu'un `null === null` fasse passer n'importe quel QR d'une soirée
 * org-led sur la porte d'une autre — chaque branche exige un périmètre POSÉ,
 * jamais une égalité de deux absences.
 */
export function isInDoorScope(
  entity: { venueId: string | null; organizerUserId: string | null },
  scope: DoorScope,
): boolean {
  if (scope.venueId && entity.venueId === scope.venueId) return true;
  if (scope.organizerUserId && entity.organizerUserId === scope.organizerUserId) return true;
  return false;
}

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

/**
 * Retard par rapport à l'heure limite d'entrée d'un tarif (format 'HH:MM').
 * `now` est une heure MURALE (ses getHours() / getMinutes() sont celles de la
 * soirée : `nowInParis()`, ou `toZonedTime(new Date(), fuseau de la soirée)`).
 * Gère les limites après minuit (ex. 01:00 = le lendemain quand la soirée
 * démarre le soir) : avant 6 h du matin, on n'est « hors créneau » qu'entre la
 * limite et 6 h. Sert aussi à l'heure limite de la boisson offerte. Une seule
 * arithmétique pour le videur (app Yuno Pro) et le scan web de l'organisateur :
 * deux portes de la même soirée ne doivent jamais trancher différemment.
 */
export function computeLateness(entryDeadline: string, now: Date): { isPast: boolean; lateLabel: string } {
  const [dH, dM] = entryDeadline.split(':').map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const deadlineMinutes = dH * 60 + dM;
  const isPast = deadlineMinutes < 6 * 60
    ? (currentMinutes >= 6 * 60 ? false : currentMinutes > deadlineMinutes)
    : currentMinutes > deadlineMinutes;

  let diff = currentMinutes - deadlineMinutes;
  if (diff < 0) diff += 24 * 60; // minuit franchi
  const lateH = Math.floor(diff / 60);
  const lateM = diff % 60;
  const lateLabel = lateH > 0 ? `${lateH}h${lateM.toString().padStart(2, '0')}` : `${lateM} min`;
  return { isPast, lateLabel };
}

/**
 * Heure limite de la boisson offerte d'un tarif (HH:MM). Seul le mode « heure
 * fixe » se lit à la porte : un délai après l'entrée n'a pas d'heure à afficher.
 */
export function drinkCutoffOf(round: { drink_cutoff_time?: string | null; drink_deadline_type?: string | null }): string | undefined {
  return round.drink_deadline_type === 'fixed_time' && round.drink_cutoff_time
    ? round.drink_cutoff_time.substring(0, 5)
    : undefined;
}

/**
 * Nombre de personnes qu'un QR fait entrer, donc de boissons offertes à
 * remettre. Le QR du billet entier fait entrer toute la commande, moins les
 * places déjà remboursées une à une à la porte (`refundedPlaces`) ; un QR
 * nominatif (`ticket_attendee`, un ami nommé à l'achat) ne fait entrer que
 * SA personne — lui afficher la quantité de la commande faisait servir une
 * boisson par place à chaque ami scanné.
 */
export function entryHeadcount(
  type: TicketScanEntity['type'],
  quantity: number | null | undefined,
  refundedPlaces = 0,
): number {
  if (type === 'ticket_attendee') return 1;
  const places = Math.floor(Number(quantity) || 1) - Math.max(0, Math.floor(Number(refundedPlaces) || 0));
  return Math.max(1, places);
}

/**
 * QR du BILLET ENTIER (e-mail, Wallet) d'un billet à places nominatives : il
 * fait entrer les places encore libres — ni entrées avec leur propre QR, ni
 * remboursées une à une. Il n'est « déjà scanné » que quand il n'en reste
 * aucune. Avant, le billet parent étant marqué dès qu'un premier ami entrait
 * avec SON QR, l'acheteur et les autres amis se voyaient répondre « Déjà
 * scanné ». `places` = null : billet sans places (son QR est la seule entrée).
 */
export function wholeTicketDoorState(
  ticketScanned: boolean | null | undefined,
  quantity: number | null | undefined,
  places: { remaining: number } | null,
): { scanned: boolean; headcount: number } {
  if (!places) return { scanned: !!ticketScanned, headcount: entryHeadcount('ticket', quantity) };
  const remaining = Math.max(0, Math.floor(places.remaining));
  return { scanned: remaining === 0, headcount: Math.max(1, remaining) };
}

export function validateTicketEntry(entity: TicketScanEntity, ctx: ScanContext): ScanVerdict {
  if (!isInDoorScope(entity, ctx.scope)) return { status: 'wrong_venue' };

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
  if (!isInDoorScope(entity, ctx.scope)) return { status: 'wrong_venue' };
  if (entity.status !== 'paid') return { status: 'not_paid' };
  if (entity.scanned) return { status: 'already', scannedAt: entity.scannedAt };
  return { status: 'success' };
}

export function validateGuestListEntry(entity: GuestListScanEntity, ctx: ScanContext): ScanVerdict {
  if (!isInDoorScope(entity, ctx.scope)) return { status: 'wrong_venue' };
  if (entity.scanned) return { status: 'already', scannedAt: entity.scannedAt };
  if (entity.status === 'cancelled') return { status: 'cancelled' };

  const { time, source } = resolveGuestListDeadline(entity);
  if (time) {
    const deadline = computeGuestListDeadline(time, entity.eventStartAt);
    if (ctx.now > deadline) return { status: 'deadline_passed', deadlineSource: source };
  }

  return { status: 'success' };
}
