import { describe, expect, it } from 'vitest';
import { allIntegers, biggestDrop, cellTint, elapsedShare, intensity, linePath, linear, nearestIndex, niceTicks, tintOf } from '../ui/viz/core';
import { stepIndex } from '../ui/keys';

describe('niceTicks', () => {
  it('rien à graduer : une seule graduation à zéro', () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(-3)).toEqual([0]);
    expect(niceTicks(Number.NaN)).toEqual([0]);
    expect(niceTicks(Number.POSITIVE_INFINITY)).toEqual([0]);
  });
  it('couvre le maximum par pas ronds', () => {
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
    const t = niceTicks(9840);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(9840);
  });
  it('des comptes : jamais de graduation fractionnaire ni en double', () => {
    expect(niceTicks(1, 4, true)).toEqual([0, 1]);
    expect(niceTicks(3, 4, true)).toEqual([0, 1, 2, 3]);
    const t = niceTicks(7, 4, true);
    expect(t.every(Number.isInteger)).toBe(true);
    expect(new Set(t).size).toBe(t.length);
  });
  it('un montant peut garder des pas fractionnaires', () => {
    expect(niceTicks(1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('allIntegers', () => {
  it('ignore les trous, refuse une décimale', () => {
    expect(allIntegers([1, null, 3, undefined])).toBe(true);
    expect(allIntegers([])).toBe(true);
    expect(allIntegers([1, 2.5])).toBe(false);
  });
});

describe('linear, linePath, nearestIndex', () => {
  it('un domaine nul se pose au milieu', () => {
    expect(linear(0, 0, 0, 100)(5)).toBe(50);
  });
  it('null et NaN coupent la ligne au lieu de la casser', () => {
    expect(linePath([])).toBe('');
    expect(linePath([null, null])).toBe('');
    expect(linePath([[0, 0], null, [2, 2]])).toBe('M0.0,0.0M2.0,2.0');
    expect(linePath([[0, 0], [Number.NaN, 1], [2, 2]])).toBe('M0.0,0.0M2.0,2.0');
    expect(linePath([[1, 1]])).toBe('M1.0,1.0');
  });
  it('index borné, un seul point, largeur nulle', () => {
    expect(nearestIndex(50, 0, 0, 100)).toBe(0);
    expect(nearestIndex(50, 1, 0, 100)).toBe(0);
    expect(nearestIndex(50, 5, 0, 0)).toBe(0);
    expect(nearestIndex(-20, 5, 0, 100)).toBe(0);
    expect(nearestIndex(500, 5, 0, 100)).toBe(4);
    expect(nearestIndex(50, 5, 0, 100)).toBe(2);
    expect(nearestIndex(Number.NaN, 5, 0, 100)).toBe(0);
  });
});

describe('teintes', () => {
  it('zéro, null, NaN : aucune teinte', () => {
    expect(intensity(null, 10)).toBe(0);
    expect(intensity(Number.NaN, 10)).toBe(0);
    expect(intensity(5, 0)).toBe(0);
    expect(tintOf(0)).toBe('transparent');
    expect(cellTint(0, 0)).toBeUndefined();
    expect(cellTint(null, 10)).toBeUndefined();
  });
  it('bornée à [0, 1]', () => {
    expect(intensity(20, 10)).toBe(1);
    expect(intensity(-5, 10)).toBe(0);
  });
});

describe('biggestDrop, elapsedShare', () => {
  it('perte en personnes, null sans perte', () => {
    expect(biggestDrop([])).toBeNull();
    expect(biggestDrop([0, 0])).toBeNull();
    expect(biggestDrop([40, 28, 3])).toBe(2);
  });
  it('délai borné, durée nulle = 0', () => {
    expect(elapsedShare(0, 0, 5)).toBe(0);
    expect(elapsedShare(0, 10, 5)).toBe(0.5);
    expect(elapsedShare(0, 10, 50)).toBe(1);
    expect(elapsedShare(0, Number.NaN, 5)).toBe(0);
  });
});

describe('clavier des listes', () => {
  it('sans sélection, la première ; bornes respectées ; liste vide', () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBe(2);
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});
