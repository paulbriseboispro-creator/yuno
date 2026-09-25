/**
 * Codes promo autonomes (plan Shotgun, lot F) — côté client.
 *
 * Le SERVEUR décide (create-ticket-checkout / create-table-checkout →
 * `claim_promo_code`). Ici on ne fait que prévisualiser la remise pour que le
 * total affiché soit celui que Stripe débitera : `promoDiscountAmount` est le
 * miroir EXACT de `promo_code_discount` (migration 20260924210000), testé sur
 * les mêmes cas. La règle de non-cumul est la même : la plus forte gagne.
 */

export type PromoPillar = 'tickets' | 'tables';

export interface AppliedPromo {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}

/** Capitales, sans espaces ; `null` si ce n'est pas un code valable. */
export function normalizePromoCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9_-]{3,32}$/.test(code) ? code : null;
}

// EPSILON : 1,005 € doit s’arrondir à 1,01 € comme en SQL (numeric), pas à 1,00 €.
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * La remise, au centime, jamais au-delà de la base.
 *   billets : % du sous-total, ou montant PAR billet ;
 *   tables  : % de l'acompte payé en ligne, ou montant par réservation.
 */
export function promoDiscountAmount(
  type: 'percentage' | 'fixed', value: number, pillar: PromoPillar, quantity: number, base: number,
): number {
  const b = Math.max(0, base || 0);
  const raw = type === 'percentage'
    ? round2((b * value) / 100)
    : pillar === 'tickets' ? round2(value * Math.max(quantity || 1, 1)) : round2(value);
  return Math.max(0, Math.min(b, raw));
}

/** Remise promoteur vs code promo : jamais de cumul, la plus forte gagne. */
export function bestDiscount(promoter: number, promo: number): { amount: number; source: 'promoter' | 'promo' | null } {
  if (promo > 0 && promo >= promoter) return { amount: promo, source: 'promo' };
  if (promoter > 0) return { amount: promoter, source: 'promoter' };
  return { amount: 0, source: null };
}

const KEY = (eventId: string) => `yuno_promo_code:${eventId}`;

/** Un lien `…?promo=CODE` garde le code pour la soirée pendant la session. */
export function rememberPromoForEvent(eventId: string, raw: string | null): void {
  const code = normalizePromoCode(raw);
  if (!eventId || !code) return;
  try { sessionStorage.setItem(KEY(eventId), code); } catch { /* stockage indisponible */ }
}

export function recallPromoForEvent(eventId: string | null | undefined): string | null {
  if (!eventId) return null;
  try { return normalizePromoCode(sessionStorage.getItem(KEY(eventId))); } catch { return null; }
}

export function forgetPromoForEvent(eventId: string | null | undefined): void {
  if (!eventId) return;
  try { sessionStorage.removeItem(KEY(eventId)); } catch { /* rien */ }
}

/** Raisons de refus renvoyées par la base (clés i18n `promo.reason.*`). */
export const PROMO_REASONS = ['not_found', 'inactive', 'not_started', 'expired', 'not_eligible', 'exhausted', 'unavailable', 'rate_limited'] as const;

export function promoReasonKey(reason: string | null | undefined): string {
  return `promo.reason.${(PROMO_REASONS as readonly string[]).includes(reason ?? '') ? reason : 'not_found'}`;
}
