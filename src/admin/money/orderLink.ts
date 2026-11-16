/**
 * L'adresse d'une commande dans l'admin : `/admin/money/orders?tab=…&open=<type>:<id>`.
 * Module pur (testé) : ⌘K (searchHref.ts) et la page Commandes le partagent.
 */
export type OrderOpenType = 'ticket' | 'table';

export function orderHref(type: OrderOpenType, id: string): string {
  const tab = type === 'ticket' ? 'tickets' : 'tables';
  return `/admin/money/orders?tab=${tab}&open=${type}:${encodeURIComponent(id)}`;
}

/** `ticket:<id>` | `table:<id>` → { type, id } ; toute autre valeur → null. */
export function parseOpen(raw: string | null | undefined): { type: OrderOpenType; id: string } | null {
  if (!raw) return null;
  const m = /^(ticket|table):(.+)$/.exec(raw);
  if (!m || !m[2].trim()) return null;
  return { type: m[1] as OrderOpenType, id: decodeURIComponent(m[2]) };
}
