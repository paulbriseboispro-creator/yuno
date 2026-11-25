import { describe, expect, it } from 'vitest';
import {
  hashReceiptToken, isReceiptTokenShape, newReceiptToken, receiptTokenMatches,
} from '../../../supabase/functions/_shared/receipt-token.ts';

describe('receipt-token — secret de reçu d\'une table', () => {
  it('un jeton neuf a la bonne forme et ne se répète pas', () => {
    const a = newReceiptToken();
    const b = newReceiptToken();
    expect(isReceiptTokenShape(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it('le hachage est stable (SHA-256 hexadécimal) et différent du jeton', async () => {
    const t = 'a'.repeat(64);
    const h = await hashReceiptToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(t);
    expect(await hashReceiptToken(t)).toBe(h);
  });
  it('le bon jeton correspond, tout autre est refusé', async () => {
    const t = newReceiptToken();
    const h = await hashReceiptToken(t);
    expect(await receiptTokenMatches(t, h)).toBe(true);
    expect(await receiptTokenMatches(newReceiptToken(), h)).toBe(false);
    expect(await receiptTokenMatches('x', h)).toBe(false);
    expect(await receiptTokenMatches(undefined, h)).toBe(false);
    expect(await receiptTokenMatches(t, null)).toBe(false);
    expect(await receiptTokenMatches(h, h)).toBe(false); // le hachage n'est pas un jeton
  });
});
