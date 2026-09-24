import { describe, expect, it } from 'vitest';
import { bestDiscount, normalizePromoCode, promoDiscountAmount, promoReasonKey } from '../promoCode';

describe('promoDiscountAmount (miroir de promo_code_discount)', () => {
  it('pourcentage du sous-total, au centime', () => {
    expect(promoDiscountAmount('percentage', 20, 'tickets', 3, 60)).toBe(12);
    expect(promoDiscountAmount('percentage', 20, 'tickets', 2, 40)).toBe(8);
    expect(promoDiscountAmount('percentage', 15, 'tickets', 1, 19.99)).toBe(3);
  });
  it('montant PAR billet, plafonné au sous-total', () => {
    expect(promoDiscountAmount('fixed', 5, 'tickets', 3, 60)).toBe(15);
    expect(promoDiscountAmount('fixed', 25, 'tickets', 3, 60)).toBe(60);
  });
  it('tables : sur l’acompte, montant par réservation', () => {
    expect(promoDiscountAmount('fixed', 50, 'tables', 1, 200)).toBe(50);
    expect(promoDiscountAmount('percentage', 10, 'tables', 1, 200)).toBe(20);
    expect(promoDiscountAmount('fixed', 500, 'tables', 1, 200)).toBe(200);
  });
  it('jamais négatif', () => {
    expect(promoDiscountAmount('fixed', 5, 'tickets', 1, 0)).toBe(0);
  });
});

describe('règles', () => {
  it('pas de cumul : la plus forte gagne', () => {
    expect(bestDiscount(4, 12)).toEqual({ amount: 12, source: 'promo' });
    expect(bestDiscount(12, 4)).toEqual({ amount: 12, source: 'promoter' });
    expect(bestDiscount(0, 0)).toEqual({ amount: 0, source: null });
  });
  it('normalise le code comme la base', () => {
    expect(normalizePromoCode(' early 20 ')).toBe('EARLY20');
    expect(normalizePromoCode('ab')).toBeNull();
    expect(normalizePromoCode('é!')).toBeNull();
  });
  it('raison inconnue → message générique', () => {
    expect(promoReasonKey('exhausted')).toBe('promo.reason.exhausted');
    expect(promoReasonKey('weird')).toBe('promo.reason.not_found');
  });
});
