import { describe, expect, it } from 'vitest';
import { faststartBytes } from '@/lib/mp4Faststart';

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, body: number[]) => [...u32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body];

function build(moovFirst: boolean) {
  const ftyp = box('ftyp', [...'qt  '].map((c) => c.charCodeAt(0)).concat(u32(0)));
  const payload = [11, 22, 33, 44, 55, 66, 77, 88];
  const mdat = box('mdat', payload);
  const stco = (offset: number) => box('stco', [...u32(0), ...u32(1), ...u32(offset)]);
  const moovFor = (offset: number) => box('moov', box('trak', box('mdia', box('minf', box('stbl', stco(offset))))));
  const moovLen = moovFor(0).length;
  const bytes = moovFirst
    ? [...ftyp, ...moovFor(ftyp.length + moovLen + 8), ...mdat]
    : [...ftyp, ...mdat, ...moovFor(ftyp.length + 8)];
  return { bytes: new Uint8Array(bytes), payload };
}

const readOffset = (b: Uint8Array) => {
  const i = new TextDecoder().decode(b).indexOf('stco');
  return new DataView(b.buffer).getUint32(i + 4 + 8);
};

describe('faststartBytes', () => {
  it('déplace le moov devant le mdat et recale les décalages', () => {
    const { bytes, payload } = build(false);
    const out = faststartBytes(bytes);
    expect(out).not.toBe(bytes);
    expect(out.length).toBe(bytes.length);
    expect(new TextDecoder().decode(out).indexOf('moov')).toBeLessThan(new TextDecoder().decode(out).indexOf('mdat'));
    const off = readOffset(out);
    expect([...out.slice(off, off + payload.length)]).toEqual(payload);
  });

  it('ne touche pas un fichier déjà en tête ni un fichier illisible', () => {
    const { bytes } = build(true);
    expect(faststartBytes(bytes)).toBe(bytes);
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(faststartBytes(junk)).toBe(junk);
  });
});
