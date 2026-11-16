/**
 * Où mène une alerte d'argent dans « À régler » : la commande (si l'alerte
 * nomme un billet ou une table), sinon la soirée. Module pur (testé).
 */
import { orderHref } from './orderLink';

export function issueLink(a: { reference_type: string | null; reference_id: string | null; event_id: string | null }): string | null {
  const ref = a.reference_id;
  if (ref && (a.reference_type === 'ticket' || a.reference_type === 'tickets')) return orderHref('ticket', ref);
  if (ref && (a.reference_type === 'table_reservation' || a.reference_type === 'table_reservations' || a.reference_type === 'table')) return orderHref('table', ref);
  if (a.event_id) return `/admin/clients/events?q=${encodeURIComponent(a.event_id)}`;
  return null;
}
