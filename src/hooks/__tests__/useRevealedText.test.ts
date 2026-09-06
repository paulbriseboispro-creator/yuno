import { describe, it, expect } from 'vitest';
import { __advanceForTest as advance, nextCursor } from '../useRevealedText';

const ID = 'cb621ee2-7934-4918-8a82-714337c79a56';

describe("avance du curseur d'écriture", () => {
  it('avance d\'un caractère par pas', () => {
    expect(advance('bonjour', 0, 3)).toBe(3);
  });

  it('franchit un jeton de carte d\'un seul bloc', () => {
    // Les ~40 caractères du jeton sont invisibles : les dévoiler un par un
    // ferait un temps mort avant l'apparition de la carte.
    const text = `ok [[event:${ID}]] fin`;
    expect(advance(text, 3, 1)).toBe(3 + `[[event:${ID}]]`.length);
  });

  it('ne dépasse jamais la fin du texte', () => {
    expect(advance('abc', 0, 99)).toBe(3);
  });

  it('écrit un message de 240 signes en ~2 s à 60 images/s', () => {
    // Rattrapage proportionnel : la durée d'écriture doit rester crédible,
    // ni instantanée ni traînante.
    const text = 'x'.repeat(240);
    let cursor = 0;
    let ticks = 0;
    while (cursor < text.length && ticks < 1000) {
      cursor = nextCursor(text, cursor);
      ticks++;
    }
    expect(cursor).toBe(240);
    expect(ticks).toBeGreaterThan(60);
    expect(ticks).toBeLessThan(180);
  });
});
