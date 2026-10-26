import { describe, expect, it } from 'vitest';
import { encodePng, handleShapeRequest, parseShape, shapePixels } from '../emailShape';

const q = (s: string) => new URLSearchParams(s);
const px = (d: { width: number; data: Uint8Array }, x: number, y: number) => Array.from(d.data.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4));

describe('email shapes', () => {
  it('refuses an unknown kind and bounds every number', () => {
    expect(parseShape('triangle', q(''))).toBeNull();
    const s = parseShape('wave', q('w=99999&h=0&n=-3&amp=9&scale=9'))!;
    expect(s.w).toBe(1200);
    expect(s.h).toBe(4);
    expect(s.n).toBe(0.5);
    expect(s.amp).toBe(1);
    // Le plafond de pixels baisse la densité, jamais la taille affichée.
    const big = parseShape('scallop', q('w=1200&h=400&scale=3'))!;
    expect(big.w * big.scale * big.h * big.scale).toBeLessThanOrEqual(600_000 * 1.0001);
  });

  it('draws an edge: top color above, bottom color below, transparent when "none"', () => {
    const d = shapePixels(parseShape('wave', q('top=ff0000&bottom=none&w=40&h=20&scale=1'))!);
    expect(px(d, 20, 0)).toEqual([255, 0, 0, 255]);
    expect(px(d, 20, 19)[3]).toBe(0);
  });

  it('draws a ribbon between two parallel edges', () => {
    const d = shapePixels(parseShape('slant', q('top=000000&fill=ffffff&bottom=0000ff&w=100&h=50&thick=0.3&scale=1'))!);
    const column = Array.from({ length: 50 }, (_, y) => px(d, 50, y).slice(0, 3).join(','));
    expect(column).toContain('0,0,0');
    expect(column).toContain('255,255,255');
    expect(column).toContain('0,0,255');
  });

  it('turns a shape upside down with invert, colors staying in place', () => {
    const up = shapePixels(parseShape('scallop', q('top=ffffff&bottom=000000&w=60&h=20&n=3&scale=1'))!);
    const down = shapePixels(parseShape('scallop', q('top=ffffff&bottom=000000&w=60&h=20&n=3&scale=1&invert=1'))!);
    // Droit : des bosses noires montent du bas (le centre d'une bosse touche le haut).
    expect(px(up, 10, 3)).toEqual([0, 0, 0, 255]);
    expect(px(up, 1, 3)).toEqual([255, 255, 255, 255]);
    // Retourné : des bosses blanches pendent du haut, le noir reste en bas.
    expect(px(down, 10, 16)).toEqual([255, 255, 255, 255]);
    expect(px(down, 1, 16)).toEqual([0, 0, 0, 255]);
    expect(px(down, 1, 0)).toEqual([255, 255, 255, 255]);
  });

  it('draws a checker with outlined squares', () => {
    const d = shapePixels(parseShape('checker', q('colors=00ff00,ffff00&stroke=000000&sw=2&w=40&h=10&n=4&scale=1'))!);
    expect(px(d, 5, 5)).toEqual([0, 255, 0, 255]);
    expect(px(d, 15, 5)).toEqual([255, 255, 0, 255]);
    expect(px(d, 10, 5).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('encodes a valid PNG and serves it cached for a year', async () => {
    const png = await encodePng(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]));
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const res = await handleShapeRequest(new URL('https://yunoapp.eu/email-shape/zigzag.png?top=111111&bottom=eeeeee&w=200&h=20'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // IHDR : largeur et hauteur au double de la taille affichée.
    const v = new DataView(bytes.buffer);
    expect([v.getUint32(16), v.getUint32(20)]).toEqual([400, 40]);
    expect((await handleShapeRequest(new URL('https://yunoapp.eu/email-shape/nope.png'))).status).toBe(404);
  });
});
