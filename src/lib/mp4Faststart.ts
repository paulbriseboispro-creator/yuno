/**
 * « Fast start » d'un MP4 / MOV : déplace l'atome `moov` (l'index du film)
 * AVANT les données `mdat`, comme qt-faststart.
 *
 * Un iPhone écrit le `moov` À LA FIN du fichier : pour lancer la vidéo, le
 * navigateur doit d'abord aller chercher ces derniers octets, ce qui sur 4G
 * retardait (ou empêchait) le démarrage de la vidéo de la page soirée. Les
 * données ne sont pas réencodées : seuls les décalages des morceaux (`stco` /
 * `co64`) sont recalés de la taille du `moov`.
 *
 * Rend le fichier tel quel dès qu'un cas sort du cadre simple (déjà en tête,
 * `moov` compressé, `mdat` après le `moov`, décalage qui déborderait) : un
 * fichier non optimisé se lit toujours, un fichier mal réécrit jamais.
 */

type Box = { type: string; start: number; size: number; header: number };

function readBoxes(bytes: Uint8Array, start: number, end: number): Box[] | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Box[] = [];
  let off = start;
  while (off + 8 <= end) {
    let size = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) return null;
      size = Number(dv.getBigUint64(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) return null;
    out.push({ type, start: off, size, header });
    off += size;
  }
  return off === end ? out : null;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta']);

/** Recale stco / co64 dans le moov (copié). `false` = cas non géré. */
function shiftChunkOffsets(moov: Uint8Array, delta: number): boolean {
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const walk = (start: number, end: number): boolean => {
    const boxes = readBoxes(moov, start, end);
    if (!boxes) return false;
    for (const b of boxes) {
      const body = b.start + b.header;
      if (b.type === 'cmov') return false;
      if (b.type === 'stco' || b.type === 'co64') {
        const count = dv.getUint32(body + 4);
        const wide = b.type === 'co64';
        const step = wide ? 8 : 4;
        if (body + 8 + count * step > b.start + b.size) return false;
        for (let i = 0; i < count; i++) {
          const p = body + 8 + i * step;
          if (wide) {
            dv.setBigUint64(p, dv.getBigUint64(p) + BigInt(delta));
          } else {
            const next = dv.getUint32(p) + delta;
            if (next > 0xffffffff) return false;
            dv.setUint32(p, next);
          }
        }
      } else if (CONTAINERS.has(b.type) && b.type !== 'udta') {
        if (!walk(body, b.start + b.size)) return false;
      }
    }
    return true;
  };
  return walk(0, moov.length);
}

export function faststartBytes(bytes: Uint8Array): Uint8Array {
  const top = readBoxes(bytes, 0, bytes.length);
  if (!top) return bytes;
  const moovIdx = top.findIndex((b) => b.type === 'moov');
  const firstMdat = top.findIndex((b) => b.type === 'mdat');
  if (moovIdx < 0 || firstMdat < 0 || moovIdx < firstMdat) return bytes;
  // Des données après le moov : leurs décalages ne bougeraient pas, cas rare non géré.
  if (top.slice(moovIdx + 1).some((b) => b.type === 'mdat')) return bytes;

  const m = top[moovIdx];
  const moov = bytes.slice(m.start, m.start + m.size);
  if (!shiftChunkOffsets(moov, m.size)) return bytes;

  const out = new Uint8Array(bytes.length);
  let w = 0;
  top.forEach((b, i) => {
    if (i === moovIdx) return;
    if (i === firstMdat) { out.set(moov, w); w += moov.length; }
    out.set(bytes.subarray(b.start, b.start + b.size), w);
    w += b.size;
  });
  return out;
}

/** Version fichier : rend le même `File` s'il n'y avait rien à faire. */
export async function faststartFile(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const out = faststartBytes(bytes);
  if (out === bytes) return file;
  return new File([out], file.name, { type: file.type, lastModified: file.lastModified });
}
