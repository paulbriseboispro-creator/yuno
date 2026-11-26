// Carte bouteilles d'une table VIP et précommande (D8, vague C3a).
// La carte vient de la RPC `get_table_menu(event)` (carte du club effectif, sinon de la soirée) ;
// le navigateur n'envoie QUE { menuItemId, quantity } : prix et noms sont relus en base.
// Le total affiché ici est INDICATIF et « à régler sur place », jamais ajouté au paiement en ligne.

export const BOTTLE_MAX_PER_LINE = 20;
export const BOTTLE_MAX_LINES = 20;

export interface TableMenuItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  brand: string | null;
  volume_cl: number | null;
  price: number;
  image_url: string | null;
  needs_mixer: boolean;
  max_mixers: number | null;
  position: number | null;
}

export interface PreorderSelection {
  menuItemId: string;
  quantity: number;
}

/** Lecture tolérante de la réponse de get_table_menu : une ligne illisible est écartée, jamais une erreur. */
export function parseTableMenu(raw: unknown): TableMenuItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TableMenuItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const price = Number(o.price);
    if (typeof o.id !== 'string' || typeof o.name !== 'string' || !Number.isFinite(price) || price < 0) continue;
    out.push({
      id: o.id,
      name: o.name,
      description: typeof o.description === 'string' && o.description ? o.description : null,
      category: typeof o.category === 'string' && o.category ? o.category : 'other',
      brand: typeof o.brand === 'string' && o.brand ? o.brand : null,
      volume_cl: Number.isFinite(Number(o.volume_cl)) && Number(o.volume_cl) > 0 ? Number(o.volume_cl) : null,
      price,
      image_url: typeof o.image_url === 'string' && o.image_url ? o.image_url : null,
      needs_mixer: !!o.needs_mixer,
      max_mixers: Number.isFinite(Number(o.max_mixers)) ? Number(o.max_mixers) : null,
      position: Number.isFinite(Number(o.position)) ? Number(o.position) : null,
    });
  }
  return out;
}

/** Quantité entière bornée à 0..20 (0 = retirer la ligne). */
export function clampBottleQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(BOTTLE_MAX_PER_LINE, Math.max(0, Math.trunc(n)));
}

/** Ajoute `delta` à une ligne ; refuse une 21e ligne distincte. Rend la nouvelle table de quantités. */
export function bumpBottleQty(qty: Record<string, number>, id: string, delta: number): Record<string, number> {
  const current = qty[id] || 0;
  if (current === 0 && delta > 0 && Object.keys(qty).length >= BOTTLE_MAX_LINES) return qty;
  const next = { ...qty };
  const nv = clampBottleQty(current + delta);
  if (nv === 0) delete next[id]; else next[id] = nv;
  return next;
}

/** Total indicatif (prix de la carte × quantités), arrondi au centime. Les articles absents de la carte comptent zéro. */
export function preorderIndicativeTotal(menu: TableMenuItem[], qty: Record<string, number>): number {
  const byId = new Map(menu.map(m => [m.id, m]));
  let cents = 0;
  for (const [id, q] of Object.entries(qty)) {
    const it = byId.get(id);
    if (!it) continue;
    cents += Math.round(it.price * 100) * clampBottleQty(q);
  }
  return cents / 100;
}

/** Corps envoyé à create-table-checkout : jamais un prix, jamais un nom. */
export function toPreorderPayload(qty: Record<string, number>, menu?: TableMenuItem[]): PreorderSelection[] {
  const known = menu ? new Set(menu.map(m => m.id)) : null;
  return Object.entries(qty)
    .map(([menuItemId, q]) => ({ menuItemId, quantity: clampBottleQty(q) }))
    .filter(l => l.quantity > 0 && (!known || known.has(l.menuItemId)));
}

/** Récap d'une précommande lue par get_table_receipt : toujours « à régler sur place ». */
export interface ReceiptPreorder {
  orderId: string | null;
  status: string | null;
  total: number;
  items: { name: string; quantity: number; unitPrice: number }[];
}

export function parseReceiptPreorder(raw: unknown): ReceiptPreorder | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const items = Array.isArray(o.items)
    ? o.items.flatMap((i): ReceiptPreorder['items'] => {
        if (!i || typeof i !== 'object') return [];
        const r = i as Record<string, unknown>;
        const quantity = Number(r.quantity);
        if (typeof r.name !== 'string' || !Number.isFinite(quantity) || quantity <= 0) return [];
        return [{ name: r.name, quantity, unitPrice: Number(r.unit_price) || 0 }];
      })
    : [];
  if (items.length === 0) return null;
  const total = Number.isFinite(Number(o.total)) ? Number(o.total) : items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  return {
    orderId: typeof o.order_id === 'string' ? o.order_id : null,
    status: typeof o.status === 'string' ? o.status : null,
    total,
    items,
  };
}
