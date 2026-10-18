import { describe, expect, it } from 'vitest';
import { availableYunits } from '@/crm/lib/emailSend';

// Audit du 18/10, UI-05 : le contrôle d'envoi tient compte des Yunits déjà
// réservés par les campagnes programmées.
describe('availableYunits', () => {
  it('retire ce que les campagnes programmées ont réservé', () => {
    expect(availableYunits(10_000, 6_000)).toBe(4_000);
  });
  it('ne compte pas deux fois la campagne qu’on regarde si elle est programmée', () => {
    expect(availableYunits(10_000, 6_000, 6_000)).toBe(10_000);
    expect(availableYunits(10_000, 6_000, 2_000)).toBe(6_000);
  });
  it('jamais négatif', () => {
    expect(availableYunits(1_000, 5_000)).toBe(0);
    expect(availableYunits(1_000, 0, 3_000)).toBe(1_000);
  });
});
