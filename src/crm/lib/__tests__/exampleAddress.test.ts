import { describe, expect, it } from 'vitest';
import { isExampleAddress } from '@/crm/lib/fileImport';

// Audit du 18/10, UI-05 : la puce « nouveau.contact@exemple.fr » n'ajoute
// jamais de faux contact à la vraie base.
describe('isExampleAddress', () => {
  it('reconnaît les domaines d’exemple', () => {
    for (const e of ['nouveau.contact@exemple.fr', 'a@example.com', 'b@ejemplo.es', 'c@shop.test', 'd@x.invalid', 'e@foo.example'])
      expect(isExampleAddress(e), e).toBe(true);
  });
  it('laisse passer les vraies adresses', () => {
    for (const e of ['lea@gmail.com', 'contact@exemples-de-soirees.fr', 'x@myexample.com', 'y@testing.io', 'pas-une-adresse'])
      expect(isExampleAddress(e), e).toBe(false);
  });
});
