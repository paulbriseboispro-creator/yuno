/**
 * Quand la Console CRM ne trouve aucun espace (écran 403), la personne est
 * peut-être TITULAIRE d'un compte Yuno Billetterie : on lui propose d'y
 * ajouter Yuno CRM (/open/crm, essai de 14 jours, la billetterie ne change
 * pas) au lieu de la renvoyer vers « Changer de compte », qui ne fait que
 * déconnecter. Comptes lus par `get_my_product_accounts` (migration
 * 20261006100000) : seuls ceux que la personne possède, les seuls où
 * `open_product_on_my_account` accepte d'ouvrir un produit.
 */

export interface ProductAccountRow {
  kind: 'venue' | 'org';
  name: string | null;
  products: string[] | null;
}

export interface OpenCrmOffer {
  /** Nom du compte à compléter, ou null quand plusieurs comptes le peuvent. */
  name: string | null;
  href: string;
}

export const OPEN_CRM_PATH = '/open/crm';

export function openCrmOffer(rows: ProductAccountRow[] | null | undefined): OpenCrmOffer | null {
  const candidates = (rows ?? []).filter((r) => !(r.products ?? []).includes('crm'));
  if (!candidates.length) return null;
  const name = candidates.length === 1 ? (candidates[0].name?.trim() || null) : null;
  return { name, href: OPEN_CRM_PATH };
}
