import { describe, expect, it } from 'vitest';
import { parsePersonKey, personHref } from '../personKey';

describe('person key', () => {
  it('reads an e-mail, lowercased', () => {
    expect(parsePersonKey('Jane.Doe@Example.COM')).toEqual({ email: 'jane.doe@example.com', userId: null });
  });
  it('reads an account id', () => {
    expect(parsePersonKey('6F1C0E2A-0000-4000-8000-000000000001')).toEqual({ email: null, userId: '6f1c0e2a-0000-4000-8000-000000000001' });
  });
  it('is empty for nothing', () => {
    expect(parsePersonKey(' ')).toEqual({ email: null, userId: null });
    expect(parsePersonKey(undefined)).toEqual({ email: null, userId: null });
  });
  it('encodes the e-mail in the address', () => {
    expect(personHref('a+b@x.fr')).toBe('/admin/clients/a%2Bb%40x.fr');
  });
});
