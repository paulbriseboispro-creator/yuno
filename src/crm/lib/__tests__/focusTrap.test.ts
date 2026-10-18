import { describe, expect, it } from 'vitest';
import { nextTrapIndex } from '@/crm/ui/focusTrap';

// Audit du 18/10, UI-05 : Tab tourne dans la fenêtre ouverte.
describe('nextTrapIndex', () => {
  it('boucle aux deux bords', () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0);
    expect(nextTrapIndex(3, 0, true)).toBe(2);
    expect(nextTrapIndex(3, 1, false)).toBe(2);
  });
  it('depuis la fenêtre elle-même : le premier, ou le dernier en arrière', () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });
  it('rien à focaliser', () => {
    expect(nextTrapIndex(0, -1, false)).toBe(-1);
  });
});
