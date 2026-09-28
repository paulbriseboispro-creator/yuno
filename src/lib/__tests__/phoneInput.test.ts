import { describe, expect, it } from 'vitest';
import {
  composePhone,
  countryByCode,
  countryFromInternationalInput,
  countryFromPhone,
  hasPhoneNumber,
  splitPhone,
  type Country,
} from '@/lib/countries';

const c = (code: string) => countryByCode(code) as Country;

describe('composePhone', () => {
  it('drops the national trunk 0 and groups by the country format', () => {
    expect(composePhone('0788849932', c('FR'))).toBe('+33 7 88 84 99 32');
    expect(composePhone('612345678', c('ES'))).toBe('+34 612 34 56 78');
    expect(composePhone('07911123456', c('GB'))).toBe('+44 7911 123456');
  });

  it('returns an empty value when no digit was typed', () => {
    expect(composePhone('', c('FR'))).toBe('');
    expect(composePhone('  ', c('BE'))).toBe('');
  });

  it('dials Puerto Rico as +1 without repeating 787', () => {
    expect(composePhone('7875550123', c('PR'))).toBe('+1 (787) 555-0123');
    expect(countryFromPhone('+1 (787) 555-0123')?.code).toBe('PR');
  });

  it('caps the number at 15 digits (E.164)', () => {
    const v = composePhone('6'.repeat(30), c('FR'));
    expect(v.replace(/\D/g, '').length).toBe(15);
  });
});

describe('countryFromInternationalInput', () => {
  it('detects a pasted international number', () => {
    expect(countryFromInternationalInput('+44 7911 123456')?.code).toBe('GB');
    expect(countryFromInternationalInput('0032 470 12 34 56')?.code).toBe('BE');
  });

  it('stays silent on a national number', () => {
    expect(countryFromInternationalInput('06 12 34 56 78')).toBeNull();
    expect(countryFromInternationalInput('612345678')).toBeNull();
  });
});

describe('splitPhone', () => {
  it('splits a stored number into country + national part', () => {
    const r = splitPhone('+34 612 34 56 78', c('FR'));
    expect(r.country.code).toBe('ES');
    expect(r.national).toBe('612 34 56 78');
    expect(r.recognized).toBe(true);
  });

  it('keeps a legacy number without dial code under the fallback country', () => {
    const r = splitPhone('0788849932', c('FR'));
    expect(r.country.code).toBe('FR');
    expect(r.national).toBe('0788849932');
    expect(r.recognized).toBe(false);
  });

  it('round-trips through composePhone', () => {
    const v = composePhone('0470123456', c('BE'));
    const r = splitPhone(v, c('FR'));
    expect(r.country.code).toBe('BE');
    expect(composePhone(r.national, r.country)).toBe(v);
    expect(hasPhoneNumber(v)).toBe(true);
  });
});
