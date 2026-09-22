/**
 * Compositeur de visuels de pub — une story / un reel (9:16) ou un post feed
 * (4:5) dessinés dans le navigateur depuis l'affiche de la soirée et ses
 * faits (titre, date, lieu, prix d'appel), aux couleurs de la DA publique
 * (Space Grotesk capitales pour le titre, JetBrains Mono pour la métadonnée).
 *
 * C'est l'équivalent, pour la pub, des blocs live de l'Email Studio : le pro
 * choisit un gabarit, Yuno remplit avec ce qu'il sait, et le résultat part
 * chez Meta comme un JPEG ordinaire (Meta n'a pas de variables ni de calques).
 * Trois gabarits, volontairement peu : « Affiche » (plein cadre, dégradé bas),
 * « Cadre » (affiche posée sur son propre flou), « Bandeau » (affiche en haut,
 * bandeau noir typographique en bas).
 */
import type { ComposedDesign } from '@/lib/metaAds';

export const COMPOSER_TEMPLATES: ComposedDesign['template'][] = ['cover', 'frame', 'band'];
export const COMPOSER_ACCENTS = ['#E8192C', '#FFFFFF', '#F2B23C', '#34D399', '#60A5FA', '#A78BFA'];

const SIZES: Record<ComposedDesign['ratio'], { w: number; h: number }> = { '9:16': { w: 1080, h: 1920 }, '4:5': { w: 1080, h: 1350 } };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = url;
  });
}

async function ensureFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('700 100px "Space Grotesk"'),
      document.fonts.load('500 40px "JetBrains Mono"'),
      document.fonts.load('500 40px "Inter"'),
    ]);
  } catch { /* les polices système prennent le relais */ }
}

/** Dessine l'image en `cover` dans le rectangle donné. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Dessine l'image en `contain` (entière) centrée dans le rectangle, rend son cadre réel. */
function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  return { x: dx, y: dy, w: dw, h: dh };
}

/** Coupe un texte en lignes qui tiennent dans `maxWidth`, au plus `maxLines` (la dernière est tronquée par « … »). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && (cur && !lines.includes(cur) || words.join(' ').length > lines.join(' ').length)) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function fitTitle(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number, startPx: number, minPx: number): { px: number; lines: string[] } {
  for (let px = startPx; px >= minPx; px -= 6) {
    ctx.font = `700 ${px}px "Space Grotesk", system-ui, sans-serif`;
    const lines = wrap(ctx, text, maxWidth, maxLines);
    const whole = lines.join(' ').replace('…', '');
    if (!lines.some((l) => l.endsWith('…')) || px === minPx) return { px, lines };
    if (whole.length >= text.length) return { px, lines };
  }
  ctx.font = `700 ${minPx}px "Space Grotesk", system-ui, sans-serif`;
  return { px: minPx, lines: wrap(ctx, text, maxWidth, maxLines) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/**
 * Rend le visuel sur un canvas (1080 px de large). `posterUrl` doit être
 * servi avec CORS (le Storage Supabase l'est) : sans ça le canvas est
 * « taint » et `toBlob` échoue.
 */
export async function renderComposedDesign(design: ComposedDesign, posterUrl: string | null, canvas?: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  await ensureFonts();
  const { w: W, h: H } = SIZES[design.ratio];
  const c = canvas ?? document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  const img = posterUrl ? await loadImage(posterUrl).catch(() => null) : null;
  const M = 72; // marge
  const accent = design.accent || '#E8192C';
  const story = design.ratio === '9:16';
  ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, 0, W, H);

  // ── fond / affiche ──
  let textTop = H; // bas de la zone d'affiche
  if (design.template === 'cover') {
    if (img) drawCover(ctx, img, 0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, 'rgba(10,10,10,0)'); g.addColorStop(0.55, 'rgba(10,10,10,0.72)'); g.addColorStop(1, 'rgba(10,10,10,0.96)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    textTop = H;
  } else if (design.template === 'frame') {
    if (img) {
      ctx.save(); ctx.filter = 'blur(48px) brightness(0.45)'; drawCover(ctx, img, -60, -60, W + 120, H + 120); ctx.restore();
      const boxH = story ? H * 0.58 : H * 0.62;
      const r = drawContain(ctx, img, M, story ? H * 0.12 : M, W - 2 * M, boxH);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3; ctx.strokeRect(r.x, r.y, r.w, r.h);
      textTop = H;
    }
  } else {
    const bandH = story ? Math.round(H * 0.34) : Math.round(H * 0.30);
    if (img) drawCover(ctx, img, 0, 0, W, H - bandH);
    ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, H - bandH, W, bandH);
    ctx.fillStyle = accent; ctx.fillRect(0, H - bandH, W, 8);
    textTop = H;
  }

  // ── textes (bas) ──
  const mono = (px: number) => `500 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  const bottom = H - (story ? 220 : 110); // laisse la place au bouton / à l'UI Meta en story
  let y = bottom;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  // CTA pill
  if (design.cta.trim()) {
    ctx.font = `600 ${story ? 34 : 30}px "Inter", system-ui, sans-serif`;
    const tw = ctx.measureText(design.cta.trim().toUpperCase()).width;
    const ph = story ? 84 : 72, pw = tw + 72;
    roundRect(ctx, M, y - ph, pw, ph, ph / 2);
    ctx.fillStyle = accent; ctx.fill();
    ctx.fillStyle = accent.toUpperCase() === '#FFFFFF' || accent.toUpperCase() === '#F2B23C' || accent.toUpperCase() === '#34D399' ? '#0A0A0A' : '#FFFFFF';
    ctx.fillText(design.cta.trim().toUpperCase(), M + 36, y - ph / 2 + 12);
    y -= ph + 40;
  }
  // subtitle (mono)
  if (design.subtitle.trim()) {
    ctx.font = mono(story ? 34 : 30);
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    const lines = wrap(ctx, design.subtitle.trim().toUpperCase(), W - 2 * M, 2);
    for (let i = lines.length - 1; i >= 0; i--) { ctx.fillText(lines[i], M, y); y -= (story ? 46 : 40); }
    y -= 18;
  }
  // title
  if (design.title.trim()) {
    const { px, lines } = fitTitle(ctx, design.title.trim().toUpperCase(), W - 2 * M, 3, story ? 132 : 112, 64);
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24;
    for (let i = lines.length - 1; i >= 0; i--) { ctx.fillText(lines[i], M - 4, y); y -= px * 0.98; }
    ctx.shadowBlur = 0;
    y -= 10;
  }
  // kicker
  if (design.kicker.trim()) {
    ctx.font = mono(story ? 30 : 26);
    ctx.fillStyle = accent;
    ctx.fillText(design.kicker.trim().toUpperCase(), M, y);
  }
  void textTop;
  return c;
}

export async function composeToBlob(design: ComposedDesign, posterUrl: string | null): Promise<Blob> {
  const c = await renderComposedDesign(design, posterUrl);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('to_blob_failed'))), 'image/jpeg', 0.9));
}
