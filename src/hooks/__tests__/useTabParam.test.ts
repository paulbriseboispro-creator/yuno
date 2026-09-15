import { describe, expect, it } from 'vitest';
import { pickTab } from '../useTabParam';

const TABLE_TABS = ['events', 'zones', 'packs', 'presets'] as const;

describe('onglet lu dans l\'URL', () => {
  it('retient un onglet connu', () => {
    expect(pickTab('packs', TABLE_TABS)).toBe('packs');
  });

  it("ignore un onglet inconnu plutôt que d'afficher du vide", () => {
    expect(pickTab('bouteilles', TABLE_TABS)).toBeNull();
  });

  it('ignore une URL sans onglet', () => {
    expect(pickTab(null, TABLE_TABS)).toBeNull();
    expect(pickTab('', TABLE_TABS)).toBeNull();
  });
});
