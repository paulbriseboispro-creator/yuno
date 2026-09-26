import { describe, expect, it } from 'vitest';
import { resolveVatRegime, sellerVat } from '../generateDocuments';

// Miroir SQL : organizer_vat_rate() (migration 20260926130000). Mêmes cas.
describe('resolveVatRegime', () => {
  it('explicit regime wins', () => {
    expect(resolveVatRegime({ vat_regime: 'subject', bde_verified: true })).toBe('subject');
    expect(resolveVatRegime({ vat_regime: 'franchise', bde_verified: false })).toBe('franchise');
    expect(resolveVatRegime({ vat_regime: 'exempt_association' })).toBe('exempt_association');
  });
  it('unset: association is exempt, anyone else stays at 20%', () => {
    expect(resolveVatRegime({ vat_regime: null, bde_verified: true })).toBe('exempt_association');
    expect(resolveVatRegime({ vat_regime: null, bde_verified: false })).toBe('subject');
    expect(resolveVatRegime(null)).toBe('subject');
  });
  it('unknown value falls back like unset', () => {
    expect(resolveVatRegime({ vat_regime: 'bogus', bde_verified: true })).toBe('exempt_association');
  });
});

describe('sellerVat', () => {
  it('subject = 20% without mention', () => {
    expect(sellerVat('subject')).toEqual({ rate: 20 });
  });
  it('non-registered = 0% with the legal mention in the document language', () => {
    expect(sellerVat('exempt_association', 'fr')).toEqual({ rate: 0, mention: 'TVA non applicable, art. 261-7-1° du CGI.' });
    expect(sellerVat('franchise', 'fr').mention).toContain('293 B');
    expect(sellerVat('franchise', 'en').mention).toMatch(/^VAT not applicable/);
    expect(sellerVat('exempt_association', 'es').mention).toMatch(/^IVA no aplicable/);
  });
});
