import { describe, it, expect } from 'vitest';
import { shortAddress } from '@/lib/addressDisplay';

describe('shortAddress', () => {
  it('garde rue, numéro et ville, sans code postal (cas de la fiche Tia Felisa)', () => {
    expect(shortAddress('C. Escuderos, 5, 40001 Segovia', 'Segovia')).toBe('C. Escuderos, 5, Segovia');
  });

  it('retire le pays et la région derrière la ville', () => {
    expect(shortAddress('Calle de Atocha, 12, 28012 Madrid, Comunidad de Madrid, España', 'Madrid')).toBe('Calle de Atocha, 12, Madrid');
    expect(shortAddress('12 Rue de la Paix, 75002 Paris, France', 'Paris')).toBe('12 Rue de la Paix, Paris');
  });

  it('compare la ville sans tenir compte des accents ni de la casse', () => {
    expect(shortAddress('Calle Mayor 3, 28013 MADRID', 'Madrid')).toBe('Calle Mayor 3, MADRID');
    expect(shortAddress('Rue X, 33000 Bordeaux', 'bordeaux')).toBe('Rue X, Bordeaux');
  });

  it('ajoute la ville quand l’adresse ne la porte pas', () => {
    expect(shortAddress('Plaza del Azoguejo, 1', 'Segovia')).toBe('Plaza del Azoguejo, 1, Segovia');
  });

  it('ne touche pas un numéro de rue à 1 à 3 chiffres', () => {
    expect(shortAddress('Avenida de América, 122, 28028 Madrid', 'Madrid')).toBe('Avenida de América, 122, Madrid');
  });

  it('retire un code postal seul sur sa ligne', () => {
    expect(shortAddress('Calle Sol, 4, 28013, Madrid', 'Madrid')).toBe('Calle Sol, 4, Madrid');
  });

  it('rend l’adresse nettoyée sans ville connue', () => {
    expect(shortAddress('Calle Sol, 4, 28013 Madrid, España', null)).toBe('Calle Sol, 4, Madrid');
  });

  it('ne rend rien sans adresse : la ville seule n’est pas une adresse', () => {
    expect(shortAddress('', 'Segovia')).toBeNull();
    expect(shortAddress(null, 'Segovia')).toBeNull();
    expect(shortAddress(undefined, undefined)).toBeNull();
  });
});
