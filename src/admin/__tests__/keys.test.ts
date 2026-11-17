import { describe, expect, it } from 'vitest';
import { GO_KEYS } from '../shell/keys';
import { ADMIN_NAV, RUBRIC_IDS } from '../nav';

describe('raccourcis g + lettre', () => {
  it('une lettre par rubrique, aucune en double', () => {
    expect(new Set(GO_KEYS.map((g) => g.key)).size).toBe(GO_KEYS.length);
    expect(GO_KEYS.map((g) => g.rubric).sort()).toEqual([...RUBRIC_IDS].sort());
  });
  it('chaque lettre mène à la base de sa rubrique', () => {
    for (const g of GO_KEYS) expect(ADMIN_NAV.find((r) => r.id === g.rubric)?.base).toBe(g.to);
  });
  it('chaque rubrique a sa propre icône', () => {
    expect(new Set(ADMIN_NAV.map((r) => r.icon)).size).toBe(ADMIN_NAV.length);
  });
});
