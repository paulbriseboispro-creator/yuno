import { describe, expect, it } from 'vitest';
import { holdoutEstimate, holdoutVerdict, keepsHoldout } from '../holdout';

const s = (nc: number, nh: number, z: number | null, done = true) => ({
  done, z, contacted: { n: nc, buyers: 0 }, control: { n: nh, buyers: 0 },
});

describe('holdoutVerdict', () => {
  it('ne compare pas sous 10 personnes par groupe', () => {
    expect(holdoutVerdict(s(742, 9, 3))).toBe('few');
    expect(holdoutVerdict(s(9, 80, 3))).toBe('few');
  });
  it('attend la soirée', () => {
    expect(holdoutVerdict(s(742, 78, 3, false))).toBe('pending');
  });
  it("n'invente pas de gain sous |z| = 2", () => {
    expect(holdoutVerdict(s(742, 78, 1.99))).toBe('none');
    expect(holdoutVerdict(s(742, 78, -1.5))).toBe('none');
    expect(holdoutVerdict(s(742, 78, null))).toBe('none');
  });
  it('dit le sens d’une différence nette', () => {
    expect(holdoutVerdict(s(742, 78, 2))).toBe('gain');
    expect(holdoutVerdict(s(742, 78, -2.4))).toBe('loss');
  });
});

describe('keepsHoldout', () => {
  it('seulement un envoi « Qui cibler » relié à une soirée', () => {
    expect(keepsHoldout({ seg: 'all', f: { ntgt: { e: 'x', a: 'lineup' } } }, 'x')).toBe(true);
    expect(keepsHoldout({ seg: 'all', f: { ntgt: { e: 'x', a: 'lineup' } } }, null)).toBe(false);
    expect(keepsHoldout({ seg: 'hab', f: {} }, 'x')).toBe(false);
    expect(keepsHoldout(null, 'x')).toBe(false);
  });
});

describe('holdoutEstimate', () => {
  it('arrondit et ne descend jamais sous zéro', () => {
    expect(holdoutEstimate(820, 10)).toBe(82);
    expect(holdoutEstimate(0, 10)).toBe(0);
    expect(holdoutEstimate(100, 0)).toBe(0);
  });
});
