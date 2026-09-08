import { describe, expect, it } from 'vitest';
import { IMPORT_COUNTRIES, normalizePhone, parsePhoneList } from '../smsImport';

const FR = IMPORT_COUNTRIES.find((c) => c.code === 'FR')!;
const ES = IMPORT_COUNTRIES.find((c) => c.code === 'ES')!;

describe('normalizePhone', () => {
  it('completes French national numbers and keeps international ones', () => {
    expect(normalizePhone('06 12 34 56 78', FR)).toBe('+33612345678');
    expect(normalizePhone('+33 6 12 34 56 78', FR)).toBe('+33612345678');
    expect(normalizePhone('0033612345678', FR)).toBe('+33612345678');
    expect(normalizePhone('33612345678', FR)).toBe('+33612345678');
    expect(normalizePhone("'0612345678", FR)).toBe('+33612345678');
  });
  it('handles Spain (no trunk prefix) and rejects garbage', () => {
    expect(normalizePhone('612 345 678', ES)).toBe('+34612345678');
    expect(normalizePhone('+34612345678', FR)).toBe('+34612345678');
    expect(normalizePhone('abc', FR)).toBeNull();
    expect(normalizePhone('123', FR)).toBeNull();
  });
});

describe('parsePhoneList', () => {
  it('reads a CSV with headers, dedupes and keeps names', () => {
    const r = parsePhoneList('Prénom;Nom;Téléphone\nLéa;Martin;06 12 34 56 78\nMax;Durand;+33 7 00 00 00 00\nLéa;Martin;0612345678\n;;pas un numéro', FR);
    expect(r.contacts).toEqual([
      { phone: '+33612345678', first_name: 'Léa', last_name: 'Martin' },
      { phone: '+33700000000', first_name: 'Max', last_name: 'Durand' },
    ]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid.length).toBe(1);
    expect(r.detected.phone).toBe('Téléphone');
  });
  it('reads a bare list of numbers without header', () => {
    const r = parsePhoneList('0612345678\n0698765432', FR);
    expect(r.contacts.map((c) => c.phone)).toEqual(['+33612345678', '+33698765432']);
  });
  it('takes the text cell as the name on a headerless two-column file', () => {
    const r = parsePhoneList('Léa Martin;0612345678', FR);
    expect(r.contacts[0]).toEqual({ phone: '+33612345678', first_name: 'Léa', last_name: 'Martin' });
  });
});
