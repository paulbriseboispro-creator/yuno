/**
 * Où mène un résultat de `admin_search`. Module pur (testé). Quand la fiche
 * d'un type n'existe pas encore (organisateur, agence), le lien ouvre la
 * meilleure page actuelle ; les lots 2 et 3 le remplaceront par la fiche.
 */
import { orderHref } from '../money/orderLink';

export interface AdminSearchRow {
  kind: 'venue' | 'organizer' | 'agency' | 'crm' | 'person' | 'event' | 'ticket' | 'table';
  id: string;
  label: string;
  sub: string | null;
  ref: string | null;
  at: string | null;
}

export function searchResultHref(r: AdminSearchRow): string {
  const enc = encodeURIComponent;
  switch (r.kind) {
    case 'venue': return `/admin/pros/venues/${enc(r.id)}`;
    // Un organisateur n'a pas encore de fiche pro : sa fiche de compte.
    case 'organizer': return `/admin/clients/people/${enc(r.id)}`;
    case 'agency': return '/admin/pros/agencies';
    case 'crm': return `/admin/pros/crm/${enc(r.id)}`;
    case 'person': return `/admin/clients/people/${enc(r.id)}`;
    case 'event': return `/admin/clients/events?q=${enc(r.id)}`;
    case 'ticket': return orderHref('ticket', r.id);
    case 'table': return orderHref('table', r.id);
    default: return '/admin';
  }
}
