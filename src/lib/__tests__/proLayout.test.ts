import { describe, expect, it } from 'vitest';
import { isConsolePath, proPageVariantForPath, proSkeletonVariantForPath } from '../proLayout';

describe('isConsolePath', () => {
  it('reconnaît les quatre Consoles', () => {
    for (const p of ['/owner/events', '/manager/dashboard', '/organizer-app', '/agency-app/clubs']) {
      expect(isConsolePath(p)).toBe(true);
    }
  });
  it('ignore le public et le staff de nuit', () => {
    for (const p of ['/', '/event/x', '/bouncer', '/o/amoris', '/owners', '/organizer-apps']) {
      expect(isConsolePath(p)).toBe(false);
    }
  });
});

describe('proSkeletonVariantForPath', () => {
  it('rend le tableau de bord pour les accueils', () => {
    expect(proSkeletonVariantForPath('/owner/dashboard')).toBe('dashboard');
    expect(proSkeletonVariantForPath('/organizer-app')).toBe('dashboard');
    expect(proSkeletonVariantForPath('/organizer-app/')).toBe('dashboard');
    expect(proSkeletonVariantForPath('/agency-app/dashboard')).toBe('dashboard');
  });
  it('choisit la forme de la page', () => {
    expect(proSkeletonVariantForPath('/owner/analytics')).toBe('analytics');
    expect(proSkeletonVariantForPath('/owner/orders')).toBe('table');
    expect(proSkeletonVariantForPath('/organizer-app/events')).toBe('cards');
    expect(proSkeletonVariantForPath('/owner/venue')).toBe('form');
    expect(proSkeletonVariantForPath('/owner/guest-list')).toBe('list');
  });
  it('ne rend jamais « dashboard » pour un squelette de page', () => {
    expect(proPageVariantForPath('/organizer-app')).toBe('analytics');
    expect(proPageVariantForPath('/owner/orders')).toBe('table');
  });
});
