/**
 * Clé d'une personne dans l'adresse de sa fiche : `/admin/clients/:id`.
 *
 * `:id` est l'E-MAIL (encodé), parce que sept clients sur neuf n'ont pas de
 * compte : l'e-mail est la seule clé qu'ils aient tous (c'est aussi celle des
 * étiquettes et des notes). Un id de compte (uuid, que donne la recherche ⌘K
 * et les anciennes adresses `/admin/people/:id`) est accepté : la RPC
 * `admin_person` le résout en e-mail par le profil.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PersonKey { email: string | null; userId: string | null }

export function parsePersonKey(raw: string | null | undefined): PersonKey {
  const v = (raw ?? '').trim();
  if (!v) return { email: null, userId: null };
  if (UUID.test(v)) return { email: null, userId: v.toLowerCase() };
  return { email: v.toLowerCase(), userId: null };
}

export function personHref(key: string): string {
  return `/admin/clients/${encodeURIComponent(key)}`;
}
