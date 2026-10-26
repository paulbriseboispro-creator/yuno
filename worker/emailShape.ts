// Formes décoratives des e-mails : vagues, festons, zigzags, arches, biais,
// damiers et rayures, dessinés en PNG à la demande sur yunoapp.eu.
//
// Un e-mail ne peut porter ni SVG ni CSS de forme (clip-path, mask) : Gmail et
// Outlook les ignorent, et Yuno les retire. Les designers d'e-mails cuisent
// donc leurs vagues et leurs bords dans des images ; l'IA du pro n'a pas
// d'outil de dessin, elle compose une adresse :
//
//   https://yunoapp.eu/email-shape/wave.png?top=FBE7C6&bottom=F4A582&h=40&n=3
//
// `top` = la couleur au-dessus de la frontière, `bottom` = celle du dessous
// (`none` = transparent, pour poser la forme sur une photo en fond de cellule).
// Le PNG est rendu au double de la taille affichée (écrans Retina), sans
// dépendance (encodeur PNG + CompressionStream), et mis en cache un an : la
// même adresse rend toujours la même image.
//
// Pur et testé (worker/__tests__/emailShape.test.ts).

export const SHAPE_KINDS = ['wave', 'scallop', 'zigzag', 'arch', 'curve', 'slant', 'torn', 'checker', 'stripes', 'dots'] as const;
export type ShapeKind = typeof SHAPE_KINDS[number];

export const SHAPE_PATH_RE = /^\/email-shape\/([a-z]+)\.png$/;

export interface ShapeSpec {
  kind: ShapeKind;
  /** Couleur au-dessus de la frontière (RGBA). */
  top: Rgba;
  /** Couleur au-dessous. */
  bottom: Rgba;
  /**
   * Ruban : la couleur ENTRE deux bords parallèles (une vague épaisse qui
   * passe sur une photo, par exemple). null = un seul bord.
   */
  fill: Rgba | null;
  /** Épaisseur du ruban en part de la hauteur (0,05 à 0,9). */
  thick: number;
  /** Contour des cases d'un damier (style illustré), null = aucun. */
  stroke: Rgba | null;
  /** Épaisseur du contour (px affichés). */
  sw: number;
  /** Couleurs qui alternent (damier, rayures, pois) ; défaut [top, bottom]. */
  colors: Rgba[];
  /** Taille affichée (px CSS). */
  w: number;
  h: number;
  /** Nombre d'ondes, de festons, de dents, de cases (selon la forme). */
  n: number;
  /** Amplitude de la frontière en part de la hauteur (0,1 à 1). */
  amp: number;
  /** Miroir horizontal (biais vers l'autre côté, vague décalée). */
  flip: boolean;
  /** Retourne la forme de haut en bas (la vague pointe vers le bas). */
  invert: boolean;
  /** Décalage de phase (0 à 1) d'une vague ou d'un zigzag. */
  phase: number;
  /** Graine d'un bord déchiré. */
  seed: number;
  /** Rangées d'un damier. */
  rows: number;
  /** Densité de pixels du PNG (2 = Retina). */
  scale: number;
}

type Rgba = [number, number, number, number];

const NONE: Rgba = [0, 0, 0, 0];

function color(v: string | null, fallback: Rgba): Rgba {
  if (v == null || v === '') return fallback;
  const s = v.trim().replace(/^#/, '').toLowerCase();
  if (s === 'none' || s === 'transparent') return NONE;
  if (/^[0-9a-f]{3}$/.test(s)) return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), 255];
  if (/^[0-9a-f]{6}$/.test(s)) return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), 255];
  return fallback;
}

const num = (v: string | null, def: number, min: number, max: number): number => {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

/** Les paramètres d'une adresse de forme, bornés (une adresse folle ne coûte jamais cher). */
export function parseShape(kind: string, q: URLSearchParams): ShapeSpec | null {
  if (!(SHAPE_KINDS as readonly string[]).includes(kind)) return null;
  const k = kind as ShapeKind;
  const top = color(q.get('top') ?? q.get('a'), [255, 255, 255, 255]);
  const bottom = color(q.get('bottom') ?? q.get('b'), [17, 17, 17, 255]);
  const list = (q.get('colors') || '').split(/[,\s]+/).filter(Boolean).slice(0, 8).map((c) => color(c, NONE));
  const w = Math.round(num(q.get('w'), 600, 8, 1200));
  const defH = k === 'checker' ? 24 : k === 'slant' || k === 'arch' || k === 'curve' ? 60 : 40;
  const h = Math.round(num(q.get('h'), defH, 4, 400));
  const defN = k === 'wave' ? 2 : k === 'scallop' ? 12 : k === 'zigzag' ? 20 : k === 'checker' ? Math.max(1, Math.round(w / h)) : k === 'stripes' ? 16 : k === 'dots' ? 20 : 1;
  const scale = Math.round(num(q.get('scale'), 2, 1, 3));
  // Plafond de pixels : 600 000 rendus au plus (la densité baisse au-delà).
  const s = Math.max(1, Math.min(scale, Math.floor(Math.sqrt(600_000 / (w * h)))));
  return {
    kind: k,
    top,
    bottom,
    fill: q.get('fill') ? color(q.get('fill'), NONE) : null,
    thick: num(q.get('thick'), 0.5, 0.05, 0.9),
    stroke: q.get('stroke') ? color(q.get('stroke'), NONE) : null,
    sw: num(q.get('sw'), 1.5, 0.5, 6),
    colors: list.length >= 2 ? list : [top, bottom],
    w,
    h,
    // Décimal permis (1,5 vague) ; un damier ou des rayures comptent en entiers.
    n: k === 'checker' || k === 'stripes' || k === 'dots' ? Math.round(num(q.get('n'), defN, 1, 200)) : Math.round(num(q.get('n'), defN, 0.5, 200) * 10) / 10,
    amp: num(q.get('amp'), 1, 0.1, 1),
    flip: q.get('flip') === '1' || q.get('flip') === 'true',
    invert: q.get('invert') === '1' || q.get('invert') === 'true',
    phase: num(q.get('phase'), 0, 0, 1),
    seed: Math.round(num(q.get('seed'), 7, 0, 9999)),
    rows: Math.round(num(q.get('rows'), 1, 1, 12)),
    scale: s,
  };
}

// ── Frontières : y(x) en part de la hauteur (0 = haut, 1 = bas) ─────────────

function rand(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Frontière d'une forme à bord (u = 0..1 sur la largeur), ou null pour les motifs. */
function boundary(spec: ShapeSpec): ((u: number) => number) | null {
  const { n, amp, phase } = spec;
  const lo = 0.5 - amp / 2;
  const hi = 0.5 + amp / 2;
  const span = (t: number) => lo + (hi - lo) * t; // t 0 = haut de l'amplitude
  switch (spec.kind) {
    case 'wave':
      return (u) => span(0.5 + 0.5 * Math.sin(2 * Math.PI * (n * u + phase)));
    case 'scallop':
      // Festons : des demi-cercles qui montent du bas (la couleur du bas en bosses).
      return (u) => {
        const f = (n * u + phase) % 1;
        const d = 2 * f - 1;
        return span(1 - Math.sqrt(Math.max(0, 1 - d * d)));
      };
    case 'zigzag':
      return (u) => {
        const f = (n * u + phase) % 1;
        return span(f < 0.5 ? 1 - 2 * f : 2 * f - 1);
      };
    case 'arch':
      // Un dôme : la couleur du bas monte au centre.
      return (u) => span(1 - Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)));
    case 'curve':
      // Une cuvette : la couleur du haut descend au centre.
      return (u) => span(Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)));
    case 'slant':
      return (u) => span(u);
    case 'torn': {
      const r = rand(spec.seed);
      const pts = Array.from({ length: Math.max(4, n * 24) + 1 }, () => r());
      return (u) => {
        const x = u * (pts.length - 1);
        const i = Math.min(pts.length - 2, Math.floor(x));
        const t = x - i;
        return span(pts[i] * (1 - t) + pts[i + 1] * t);
      };
    }
    default:
      return null;
  }
}

// ── Rendu ────────────────────────────────────────────────────────────────────

/** Retourne une image de haut en bas, sur place. */
function flipRows(data: Uint8Array, W: number, H: number): void {
  const row = W * 4;
  const tmp = new Uint8Array(row);
  for (let y = 0; y < H >> 1; y++) {
    const a = y * row, b = (H - 1 - y) * row;
    tmp.set(data.subarray(a, a + row));
    data.copyWithin(a, b, b + row);
    data.set(tmp, b);
  }
}

/** Pixels RGBA (non prémultipliés) d'une forme, à sa densité. */
export function shapePixels(spec: ShapeSpec): { width: number; height: number; data: Uint8Array } {
  const W = spec.w * spec.scale;
  const H = spec.h * spec.scale;
  const data = new Uint8Array(W * H * 4);
  const SS = 4; // sous-échantillons par pixel et par axe

  // Écrit le mélange (prémultiplié) de trois couleurs pondérées.
  const put3 = (i: number, c1: Rgba, w1: number, c2: Rgba, w2: number, c3: Rgba, w3: number) => {
    const a1 = (c1[3] / 255) * w1, a2 = (c2[3] / 255) * w2, a3 = (c3[3] / 255) * w3;
    const a = a1 + a2 + a3;
    const o = i * 4;
    if (a <= 0) { data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0; return; }
    data[o] = Math.round((c1[0] * a1 + c2[0] * a2 + c3[0] * a3) / a);
    data[o + 1] = Math.round((c1[1] * a1 + c2[1] * a2 + c3[1] * a3) / a);
    data[o + 2] = Math.round((c1[2] * a1 + c2[2] * a2 + c3[2] * a3) / a);
    data[o + 3] = Math.round(Math.min(1, a) * 255);
  };
  const solid = (i: number, c: Rgba) => { const o = i * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = c[3]; };

  const fy = boundary(spec);
  if (fy) {
    const fill = spec.fill;
    // Ruban : haut / ruban / bas entre deux bords parallèles ; sinon un bord.
    // invert : la forme est dessinée droite puis retournée (voir plus bas),
    // les couleurs restent à leur place (top en haut, bottom en bas).
    const top = spec.invert ? spec.bottom : spec.top;
    const bottom = spec.invert ? spec.top : spec.bottom;
    const mid = fill ?? bottom;
    const room = fill ? 1 - spec.thick : 1;
    const thick = fill ? spec.thick * H : 0;
    const cols = new Float64Array(SS);
    for (let x = 0; x < W; x++) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < SS; k++) {
        let u = (x + (k + 0.5) / SS) / W;
        if (spec.flip) u = 1 - u;
        cols[k] = fy(u) * room * H;
        if (cols[k] < lo) lo = cols[k];
        if (cols[k] > hi) hi = cols[k];
      }
      for (let y = 0; y < H; y++) {
        const i = y * W + x;
        // Pixels loin des bords : une couleur pleine, sans calcul.
        if (y + 1 <= lo) { solid(i, top); continue; }
        if (y >= hi + thick) { solid(i, bottom); continue; }
        if (fill && y >= hi && y + 1 <= lo + thick) { solid(i, fill); continue; }
        let b1 = 0, b2 = 0;
        for (let k = 0; k < SS; k++) {
          b1 += Math.max(0, Math.min(1, y + 1 - cols[k]));
          if (fill) b2 += Math.max(0, Math.min(1, y + 1 - (cols[k] + thick)));
        }
        b1 /= SS; b2 /= SS;
        if (fill) put3(i, top, 1 - b1, fill, b1 - b2, bottom, b2);
        else put3(i, top, 1 - b1, bottom, b1, mid, 0);
      }
    }
    if (spec.invert) flipRows(data, W, H);
    return { width: W, height: H, data };
  }

  // Motifs : la couleur de chaque sous-échantillon, comptée par index.
  const colors = spec.stroke ? [...spec.colors, spec.stroke] : spec.colors;
  const n = spec.colors.length;
  const counts = new Float64Array(colors.length);
  const cw = spec.w / spec.n;
  const ch = spec.h / spec.rows;
  const ry = 0.35 * spec.amp;
  const r = Math.min(0.5, (spec.h / cw) * 0.5) * 0.7;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      counts.fill(0);
      for (let j = 0; j < SS; j++) {
        const v = (y + (j + 0.5) / SS) / H;
        for (let k = 0; k < SS; k++) {
          const u = ((spec.flip ? W - 1 - x : x) + (k + 0.5) / SS) / W;
          let c: number;
          if (spec.kind === 'checker') {
            const cx = Math.floor(u * spec.n);
            const cy = Math.floor(v * spec.rows);
            c = (((cx + cy) % n) + n) % n;
            if (spec.stroke) {
              // Contour : distance au bord de la case, en px affichés.
              const dx = Math.min((u * spec.n - cx) * cw, (cx + 1 - u * spec.n) * cw);
              const dy = Math.min((v * spec.rows - cy) * ch, (cy + 1 - v * spec.rows) * ch);
              if (Math.min(dx, dy) < spec.sw / 2 || v * spec.h < spec.sw || (1 - v) * spec.h < spec.sw) c = n;
            }
          } else if (spec.kind === 'stripes') {
            // Rayures à 45° : n bandes sur la largeur.
            c = ((Math.floor(u * spec.n + v * spec.n * (spec.h / spec.w)) % n) + n) % n;
          } else {
            // Pois : une rangée de n pois de la 2e couleur sur la 1re.
            const dx = (u * spec.n) % 1 - 0.5;
            const dy = v - 0.5;
            c = (dx * dx) / (r * r) + (dy * dy) / (ry * ry) <= 1 ? 1 % n : 0;
          }
          counts[c] += 1;
        }
      }
      // Les trois couleurs les plus présentes (un pixel en mélange rarement plus).
      let i1 = 0, i2 = -1, i3 = -1;
      for (let c = 1; c < colors.length; c++) if (counts[c] > counts[i1]) i1 = c;
      for (let c = 0; c < colors.length; c++) if (c !== i1 && counts[c] > 0 && (i2 < 0 || counts[c] > counts[i2])) i2 = c;
      for (let c = 0; c < colors.length; c++) if (c !== i1 && c !== i2 && counts[c] > 0 && (i3 < 0 || counts[c] > counts[i3])) i3 = c;
      const t = SS * SS;
      put3(y * W + x, colors[i1], counts[i1] / t, colors[i2 < 0 ? i1 : i2], i2 < 0 ? 0 : counts[i2] / t, colors[i3 < 0 ? i1 : i3], i3 < 0 ? 0 : counts[i3] / t);
    }
  }
  return { width: W, height: H, data };
}

// ── Encodeur PNG (RGBA 8 bits, sans dépendance) ─────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

async function zlib(raw: Uint8Array): Promise<Uint8Array> {
  // CompressionStream('deflate') = format zlib (RFC 1950), celui qu'attend PNG.
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtre « none »
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function renderShapePng(spec: ShapeSpec): Promise<Uint8Array> {
  const px = shapePixels(spec);
  return encodePng(px.width, px.height, px.data);
}

/** Route du Worker : /email-shape/<forme>.png?… */
export async function handleShapeRequest(url: URL): Promise<Response> {
  const m = SHAPE_PATH_RE.exec(url.pathname);
  const spec = m ? parseShape(m[1], url.searchParams) : null;
  if (!spec) {
    return new Response(`Unknown shape. Shapes: ${SHAPE_KINDS.join(', ')}.`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const png = await renderShapePng(spec);
  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
}
