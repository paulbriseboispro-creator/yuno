// Bornes SERVEUR du checkout d'une table VIP : ce que le navigateur envoie
// (convives, statut de placement, formule) n'est jamais pris tel quel.
//
// PUR et SANS IMPORT : testé par src/lib/__tests__/tableBounds.test.ts, utilisé
// par create-table-checkout.

/** Valeurs acceptées pour `placementStatus` (liste blanche). */
export const ALLOWED_PLACEMENT_STATUSES = ["none", "requested", "assign_on_arrival"] as const;
export type PlacementStatus = typeof ALLOWED_PLACEMENT_STATUSES[number];

/** Un appel direct ne peut pas poser `approved` / `rejected` : tout le reste devient `none`. */
export function safePlacementStatus(raw: unknown): PlacementStatus {
  return (ALLOWED_PLACEMENT_STATUSES as readonly string[]).includes(raw as string) ? raw as PlacementStatus : "none";
}

/**
 * Nombre de convives : entier dans [1, base + extras max] de la formule.
 * Moins que la base est permis (une table de 4 prise à 2 paie le prix de base,
 * comme le permet le compteur du checkout). Absent (undefined, null, "") = la
 * base de la formule. `null` = refusé (zéro, négatif, décimal, texte, au-delà
 * du maximum).
 */
export function parseGuestCount(raw: unknown, baseCapacity: unknown, maxExtraPersons: unknown): number | null {
  const base = Math.max(1, Math.floor(Number(baseCapacity)) || 1);
  const max = base + Math.max(0, Math.floor(Number(maxExtraPersons)) || 0);
  if (raw === undefined || raw === null || raw === "") return base;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

/** L'acompte est au plus le prix de la table : un acompte fixe plus haut ne se paie pas. */
export function boundDeposit(deposit: number, totalPrice: number): number {
  return Math.min(deposit, totalPrice);
}

/**
 * La formule appartient-elle à la soirée ? Event-scopé : celle de la soirée.
 * Avec un club : celle de la soirée, ou celle du club (sans soirée), jamais
 * celle d'un autre club.
 */
export function packInScope(
  pack: { event_id?: string | null; venue_id?: string | null },
  scope: { eventId: string; eventScoped: boolean; clubId: string | null },
): boolean {
  if (pack.event_id === scope.eventId) return true;
  if (scope.eventScoped) return false;
  return !pack.event_id && !!scope.clubId && pack.venue_id === scope.clubId;
}
