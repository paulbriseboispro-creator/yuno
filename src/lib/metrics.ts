/**
 * Le dictionnaire des chiffres de Yuno (plan `docs/designs/ANALYTICS_SIMPLIFICATION_PLAN.md` §5).
 *
 * Un nom = une formule. Si deux écrans ont besoin de deux formules, ce sont
 * deux noms. Chaque chiffre a :
 *   - un libellé court (`m.<id>`) — le SEUL nom qu'on lui donne à l'écran ;
 *   - une définition en une phrase (`gl.<id>`), montrée par l'ⓘ `MetricHint`.
 *
 * Les montants eux-mêmes viennent des RPC (formules de `utils/fees.ts`,
 * remboursements déduits) : ce module ne recalcule jamais un CA, il ne fait
 * que les ratios entre deux chiffres déjà justes, avec les MÊMES seuils de
 * silence partout (pas de pourcentage sur une base trop mince).
 */

export type MetricId =
  | 'revenue'        // CA : prix − frais Yuno − assurance/gestion, remboursements déduits, avant Stripe
  | 'netPayout'      // Net versé : CA − frais Stripe (Paiements seulement)
  | 'tickets'        // Billets vendus : quantité vendue, annulés et remboursés exclus
  | 'tables'         // Tables réservées
  | 'guestList'      // Inscrits : guest list, annulés exclus
  | 'entries'        // Entrées : personnes scannées à la porte, tous piliers
  | 'attendance'     // Présence : entrées ÷ (billets + inscrits + convives)
  | 'fill'           // Remplissage : vendus ÷ capacité de la soirée
  | 'spendPerHead'   // Dépense par tête : CA ÷ entrées
  | 'basket'         // Panier moyen : CA ÷ commandes, toujours PAR PILIER
  | 'customers'      // Clients : personnes uniques par email
  | 'newCustomers'   // Nouveaux : première soirée dans la portée
  | 'returning'      // Habitués : deux soirées ou plus dans la portée
  | 'visits'         // Visites : vues de page consenties (un minimum)
  | 'conversion';    // Conversion : acheteurs ÷ visiteurs

export const METRIC_IDS: readonly MetricId[] = [
  'revenue', 'netPayout', 'tickets', 'tables', 'guestList', 'entries', 'attendance',
  'fill', 'spendPerHead', 'basket', 'customers', 'newCustomers', 'returning', 'visits', 'conversion',
];

/** Clé i18n du libellé court. */
export const metricLabelKey = (id: MetricId) => `m.${id}`;
/** Clé i18n de la définition (ⓘ). */
export const metricHintKey = (id: MetricId) => `gl.${id}`;

/**
 * En dessous de ce nombre, un pourcentage ne dit rien (« 100 % de nouveaux »
 * sur une personne). Même seuil que les goûts du réseau et l'analyseur de
 * contacts.
 */
export const MIN_SAMPLE = 10;

const finite = (v: number) => Number.isFinite(v) ? v : 0;

/** Remplissage en % (0-100, non borné au-delà : un surbooking se voit). Sans capacité → null. */
export function fillPct(sold: number, capacity: number | null | undefined): number | null {
  if (!capacity || capacity <= 0) return null;
  return (finite(sold) / capacity) * 100;
}

/** Dépense par tête : CA ÷ entrées. Sans entrée scannée → null (jamais « 0 € »). */
export function spendPerHead(revenue: number, entries: number): number | null {
  if (!entries || entries <= 0) return null;
  return finite(revenue) / entries;
}

/** Présence en % : entrées ÷ attendus. Sans attendu → null. */
export function attendancePct(entries: number, expected: number): number | null {
  if (!expected || expected <= 0) return null;
  return Math.min(100, (finite(entries) / expected) * 100);
}

/** Panier moyen d'UN pilier : CA ÷ commandes. Sans commande → null. */
export function basket(revenue: number, orders: number): number | null {
  if (!orders || orders <= 0) return null;
  return finite(revenue) / orders;
}

/** Part en % d'un total, muette sous le seuil d'échantillon. */
export function sharePct(part: number, total: number, minSample = MIN_SAMPLE): number | null {
  if (!total || total < minSample) return null;
  return (finite(part) / total) * 100;
}

/**
 * Variation relative en % entre deux périodes comparables. Pas de base (0) →
 * null : « +2 810 % » depuis presque rien n'informe personne, on montre alors
 * l'écart absolu (`absDelta`).
 */
export function pctDelta(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null;
  return ((finite(current) - previous) / previous) * 100;
}

/** Écart absolu, pour quand la base de comparaison est nulle. */
export function absDelta(current: number, previous: number): number {
  return finite(current) - finite(previous);
}

/**
 * Au-delà de ce seuil, une variation en % se lit mal (« +2 810 % ») : on
 * affiche l'écart absolu à la place.
 */
export const MAX_READABLE_PCT = 300;

export type Delta =
  | { kind: 'pct'; value: number }
  | { kind: 'abs'; value: number }
  | { kind: 'none' };

/** Choisit la forme lisible d'une comparaison : %, écart absolu, ou rien. */
export function readableDelta(current: number, previous: number | null | undefined): Delta {
  if (previous == null) return { kind: 'none' };
  const pct = pctDelta(current, previous);
  if (pct === null || Math.abs(pct) > MAX_READABLE_PCT) {
    const abs = absDelta(current, previous);
    return abs === 0 && pct === null ? { kind: 'none' } : { kind: 'abs', value: abs };
  }
  return { kind: 'pct', value: pct };
}
