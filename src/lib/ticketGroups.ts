// Packs de billets (billetterie libre) — règles pures, testées.
//
// Un pack range des billets d'une même soirée sous un nom (« Accès Tia
// Felisa », « Tia Felisa + Chin Chin ») : la page de choix les montre en
// sections repliables, ouvertes par défaut. En base : `ticket_groups` et
// `ticket_rounds.group_id` ; le nom du pack est recopié sur le billet par la
// base (`ticket_rounds.group_label`, migration 20261129160000).

export const TICKET_GROUP_NAME_MAX = 60;
export const TICKET_GROUP_DESCRIPTION_MAX = 200;

export type TicketGroup = {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  position: number;
};

export type TicketGroupRow = {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  position: number;
};

export function mapTicketGroup(row: TicketGroupRow): TicketGroup {
  return { id: row.id, eventId: row.event_id, name: row.name, description: row.description, position: row.position };
}

// Le nom d'un billet hors de la page de choix : « Pack · Billet » (source
// unique partagée avec les fonctions edge).
export { ticketDisplayName } from '../../supabase/functions/_shared/ticket-name.ts';

/** Ce qu'il faut savoir d'un billet affiché pour le ranger et le prix d'appel. */
export type GroupableTicket = {
  id: string;
  groupId?: string | null;
  price: number;
  position: number;
  /** Achetable maintenant (ni épuisé, ni « Bientôt », ni fini, ni verrouillé). */
  buyable: boolean;
};

export type TicketPackSection<T extends GroupableTicket> = {
  group: TicketGroup;
  tickets: T[];
  /** Plus petit prix parmi les billets ACHETABLES ; null si aucun. */
  fromPrice: number | null;
};

/**
 * Range les billets visibles : d'abord ceux sans pack (l'ordre de la liste,
 * comme avant), puis chaque pack dans son ordre, avec ses billets dans l'ordre
 * de la liste. Un pack sans billet visible ne s'affiche pas. Un billet qui
 * pointe un pack inconnu reste hors pack.
 */
export function groupTicketsForDisplay<T extends GroupableTicket>(
  groups: TicketGroup[],
  tickets: T[],
): { loose: T[]; packs: TicketPackSection<T>[] } {
  const known = new Set(groups.map(g => g.id));
  const loose = tickets.filter(t => !t.groupId || !known.has(t.groupId));
  const packs = [...groups]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map(group => {
      const inPack = tickets.filter(t => t.groupId === group.id);
      const buyable = inPack.filter(t => t.buyable).map(t => t.price);
      return { group, tickets: inPack, fromPrice: buyable.length ? Math.min(...buyable) : null };
    })
    .filter(p => p.tickets.length > 0);
  return { loose, packs };
}

/** Le pack est-il utilisé sur cette soirée (au moins un billet rangé dedans) ? */
export function hasTicketPacks(groups: TicketGroup[], tickets: Array<{ groupId?: string | null }>): boolean {
  const known = new Set(groups.map(g => g.id));
  return tickets.some(t => !!t.groupId && known.has(t.groupId));
}

/** Nom saisi pour un pack : espaces retirés, vide refusé, longueur bornée. */
export function normalizeTicketGroupName(raw: string): string | null {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.slice(0, TICKET_GROUP_NAME_MAX);
}

export function normalizeTicketGroupDescription(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return v ? v.slice(0, TICKET_GROUP_DESCRIPTION_MAX) : null;
}
