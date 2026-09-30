import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyNegative } from '../money';

const norm = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatMoney', () => {
  it('toujours deux décimales, même sur un entier', () => {
    expect(norm(formatMoney(12, 'fr-FR'))).toBe('12,00 €');
    expect(formatMoney(12, 'en-GB')).toBe('€12.00');
  });
  it('ne perd pas les centimes sous 1 €', () => {
    expect(norm(formatMoney(0.27, 'fr-FR'))).toBe('0,27 €');
  });
  it('pas de notation compacte au-delà de 10 000', () => {
    expect(norm(formatMoney(12345.6, 'fr-FR'))).toBe('12 345,60 €');
  });
  it('absent ou non fini → tiret', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(NaN)).toBe('—');
  });
  it("un zéro négatif n'a pas de signe", () => {
    expect(norm(formatMoney(-0.001, 'fr-FR'))).toBe('0,00 €');
  });
  it('déduction signée', () => {
    expect(norm(formatMoneyNegative(0.27, 'fr-FR'))).toBe('−0,27 €');
    expect(norm(formatMoneyNegative(0, 'fr-FR'))).toBe('0,00 €');
  });
});
