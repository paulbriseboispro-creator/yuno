/**
 * Où mène un résultat de `admin_search`. Module pur (testé). Un pro ouvre sa
 * fiche unique (lot 2) ; une personne, sa fiche de compte.
 */
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
    // Fiche unique d'un pro (lot 2) : clé `venue:` | `org:` | `agency:`.
    case 'venue': return `/admin/pros/venue:${enc(r.id)}`;
    case 'organizer': return `/admin/pros/org:${enc(r.id)}`;
    case 'agency': return `/admin/pros/agency:${enc(r.id)}`;
    case 'crm': {
      const i = r.id.indexOf(':');
      return i > 0 ? `/admin/pros/${r.id.slice(0, i)}:${enc(r.id.slice(i + 1))}` : '/admin/pros';
    }
    // Une personne : la fiche unique (l'id de compte est résolu en e-mail par admin_person).
    case 'person': return `/admin/clients/${enc(r.id)}`;
    case 'event': return `/admin/clients/events?q=${enc(r.id)}`;
    case 'ticket':
    case 'table': return '/admin/money/orders';
    default: return '/admin';
  }
}
