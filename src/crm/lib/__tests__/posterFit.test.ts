import { describe, expect, it } from 'vitest';
import { posterFitMode } from '../posterFit';

describe('posterFitMode', () => {
  it('garde le rognage quand les proportions sont voisines', () => {
    expect(posterFitMode(16 / 9, 16 / 9)).toBe('cover');
    expect(posterFitMode(16 / 9, 1.6)).toBe('cover');
    expect(posterFitMode(3 / 4, 148 / 196)).toBe('cover');
  });

  it("montre l'affiche entière quand un 16:9 entre dans un cadre vertical", () => {
    expect(posterFitMode(1080 / 607, 148 / 196)).toBe('contain');
    expect(posterFitMode(1080 / 607, 164 / 206)).toBe('contain');
    expect(posterFitMode(1080 / 607, 390 / 800)).toBe('contain');
  });

  it("montre l'affiche entière quand un 3:4 entre dans un bandeau large", () => {
    expect(posterFitMode(3 / 4, 340 / 112)).toBe('contain');
  });

  it('retombe sur le rognage sans proportions connues', () => {
    expect(posterFitMode(null, 1)).toBe('cover');
    expect(posterFitMode(1, undefined)).toBe('cover');
    expect(posterFitMode(0, 1)).toBe('cover');
    expect(posterFitMode(Number.NaN, 1)).toBe('cover');
  });
});
