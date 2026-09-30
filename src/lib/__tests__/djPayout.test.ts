import { describe, expect, it } from 'vitest';
import { djSetReference, isValidIban, normalizeIban, performerName, isExternalSet } from '../djPayout';

describe('isValidIban', () => {
  it('accepte un IBAN valide, espaces et minuscules compris', () => {
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 189')).toBe(true);
    expect(isValidIban('fr7630006000011234567890189')).toBe(true);
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('ES91 2100 0418 4502 0005 1332')).toBe(true);
  });
  it('refuse une faute de frappe (clé de contrôle) et une forme fausse', () => {
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 188')).toBe(false);
    expect(isValidIban('FR76')).toBe(false);
    expect(isValidIban('')).toBe(false);
    expect(isValidIban('1234 5678 9012 3456')).toBe(false);
  });
  it('normalise comme la base', () => {
    expect(normalizeIban(' fr76 3000\t6000 ')).toBe('FR7630006000');
  });
});

describe('djSetReference', () => {
  it('rend une référence courte et stable', () => {
    expect(djSetReference('1a2b3c4d-0000-4000-8000-000000000000')).toBe('YDJ-1A2B3C4D');
  });
});

describe('performerName', () => {
  it('nom de scène, sinon prénom + nom, sinon artiste externe', () => {
    expect(performerName({ dj_id: 'x', dj: { first_name: 'Léa', last_name: 'Martin', stage_name: 'LÉA M' } })).toBe('LÉA M');
    expect(performerName({ dj_id: 'x', dj: { first_name: 'Léa', last_name: 'Martin', stage_name: '' } })).toBe('Léa Martin');
    expect(performerName({ dj_id: null, artist_name: '  Kaytranada ' })).toBe('Kaytranada');
    expect(isExternalSet({ dj_id: null, artist_name: 'X' })).toBe(true);
    expect(isExternalSet({ dj_id: 'x' })).toBe(false);
  });
});
