/**
 * « Complet » posé à la main — porte unique des trois piliers.
 *
 * Un club ou un organisateur peut fermer la vente d'une soirée sans la
 * dépublier : la page reste en ligne, elle affiche « Complet ». C'est autre
 * chose que `tables_enabled = false` (la section disparaît) et autre chose que
 * `table_packs.is_active = false` (les formules d'un club sont venue-scopées —
 * les éteindre les ferme sur TOUTES ses soirées).
 *
 * Tout est donc EVENT-SCOPÉ, club comme organisateur :
 *   events.tickets_sold_out      → toute la billetterie
 *   events.tables_sold_out       → toutes les tables
 *   events.sold_out_pack_ids     → certaines formules, pour CETTE soirée
 *   events.guest_list_sold_out   → toute la guest list
 *   guest_lists.manually_sold_out→ une part (maison, DJ, promoteur…)
 *
 * Ces drapeaux ferment le LIBRE-SERVICE (page publique, checkout, inscription).
 * L'ajout manuel d'un invité, la réservation walk-in et le placement restent
 * ouverts : le club garde la main sur sa soirée.
 *
 * Le serveur reste le juge final (create-ticket-checkout, create-table-checkout,
 * create-guest-list-entry) — ce module ne sert qu'à ne jamais proposer un
 * formulaire condamné.
 */

/** La part de la ligne `events` qui porte les drapeaux. Volontairement tolérante :
 *  les pages publiques lisent l'event par `select('*')`, les pages pro par colonnes
 *  choisies, et une colonne pas encore migrée arrive en `undefined`. */
export interface SoldOutEvent {
  tickets_sold_out?: boolean | null;
  tables_sold_out?: boolean | null;
  guest_list_sold_out?: boolean | null;
  sold_out_pack_ids?: string[] | null;
}

/** Forme camelCase, telle que les pages publiques la gardent en état. */
export interface SoldOutFlags {
  ticketsSoldOut: boolean;
  tablesSoldOut: boolean;
  guestListSoldOut: boolean;
  soldOutPackIds: string[];
}

export const NO_SOLD_OUT: SoldOutFlags = {
  ticketsSoldOut: false,
  tablesSoldOut: false,
  guestListSoldOut: false,
  soldOutPackIds: [],
};

/** Lit les drapeaux d'une ligne `events` (snake_case) — jamais d'exception,
 *  jamais d'`undefined` en sortie : sans drapeau, rien n'est complet. */
export function soldOutFlags(event: SoldOutEvent | null | undefined): SoldOutFlags {
  if (!event) return NO_SOLD_OUT;
  return {
    ticketsSoldOut: !!event.tickets_sold_out,
    tablesSoldOut: !!event.tables_sold_out,
    guestListSoldOut: !!event.guest_list_sold_out,
    soldOutPackIds: Array.isArray(event.sold_out_pack_ids) ? event.sold_out_pack_ids : [],
  };
}

/** Une formule est complète si la soirée entière l'est, ou si elle est nommée. */
export function isPackSoldOut(flags: SoldOutFlags, packId: string | null | undefined): boolean {
  if (flags.tablesSoldOut) return true;
  return !!packId && flags.soldOutPackIds.includes(packId);
}

/** Le pilier tables n'a plus RIEN à vendre : soirée complète, ou toutes les
 *  formules encore proposées sont nommées complètes. */
export function areAllPacksSoldOut(flags: SoldOutFlags, packIds: string[]): boolean {
  if (flags.tablesSoldOut) return true;
  return packIds.length > 0 && packIds.every(id => flags.soldOutPackIds.includes(id));
}

/** Une part de guest list est fermée si la soirée ferme tout, ou si elle est
 *  marquée complète elle-même. */
export function isGuestListSoldOut(
  flags: SoldOutFlags,
  part: { manually_sold_out?: boolean | null } | null | undefined,
): boolean {
  return flags.guestListSoldOut || !!part?.manually_sold_out;
}
