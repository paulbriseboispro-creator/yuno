import QRCode from 'qrcode';

/**
 * Kit de partage 30 secondes — génère une story 9:16 (1080×1920) prête à
 * poster : flyer en fond, dégradé lisible, nom/date/club, QR du lien tracé du
 * promoteur, signature agence « Powered by Yuno » discrète.
 *
 * 100 % client (canvas) : aucun coût serveur, marche hors app native. Le flyer
 * Supabase Storage est servi avec CORS * → crossOrigin='anonymous' garde le
 * canvas exportable ; si l'image échoue (URL externe sans CORS), on retombe
 * sur un fond dégradé de marque plutôt que d'échouer.
 */

export type StoryInput = {
  eventName: string;
  /** ex. « SAM. 14 SEPT · 23:00 » — déjà localisé par l'appelant. */
  dateLabel: string;
  venueName?: string | null;
  flyerUrl?: string | null;
  /** URL encodée dans le QR (lien tracé ?via= du promoteur). */
  link: string;
  agencyName?: string | null;
};

const W = 1080;
const H = 1920;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('flyer load failed'));
    img.src = url;
  });
}

/** Dessine l'image en cover (remplit le cadre, rogne le surplus). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, -1)}…` : `${last}…`;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function generateStoryBlob(input: StoryInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');

  // ── Fond : flyer en cover, sinon dégradé de marque ──
  let hasFlyer = false;
  if (input.flyerUrl) {
    try {
      drawCover(ctx, await loadImage(input.flyerUrl));
      hasFlyer = true;
    } catch {
      // fallback ci-dessous
    }
  }
  if (!hasFlyer) {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1a0507');
    bg.addColorStop(0.5, '#0a0a0c');
    bg.addColorStop(1, '#2a070c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Dégradé de lisibilité sur le tiers bas ──
  const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.72)');
  grad.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);

  // ── Textes ──
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 76px system-ui, -apple-system, "Helvetica Neue", sans-serif';
  const nameLines = wrapText(ctx, input.eventName.toUpperCase(), W - 140, 2);
  let y = H * 0.665 - (nameLines.length - 1) * 88;
  for (const line of nameLines) {
    ctx.fillText(line, W / 2, y);
    y += 88;
  }

  ctx.font = '600 42px system-ui, -apple-system, "Helvetica Neue", sans-serif';
  ctx.fillStyle = '#E8192C';
  const sub = [input.dateLabel, input.venueName ?? ''].filter(Boolean).join('  ·  ');
  ctx.fillText(sub, W / 2, y + 14);

  // ── QR dans une carte blanche arrondie ──
  const qrSize = 300;
  const pad = 26;
  const cardW = qrSize + pad * 2;
  const cardX = (W - cardW) / 2;
  const cardY = H * 0.72;
  roundRect(ctx, cardX, cardY, cardW, cardW, 36);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, input.link, {
    width: qrSize,
    margin: 0,
    color: { dark: '#0a0a0c', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
  ctx.drawImage(qrCanvas, cardX + pad, cardY + pad, qrSize, qrSize);

  // ── Signature ──
  ctx.font = '600 34px system-ui, -apple-system, "Helvetica Neue", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const signature = [input.agencyName, 'Powered by Yuno'].filter(Boolean).join('  ·  ');
  ctx.fillText(signature, W / 2, cardY + cardW + 76);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/** Génère puis télécharge la story (nom de fichier sûr). */
export async function downloadStory(input: StoryInput, filenameBase: string): Promise<void> {
  const blob = await generateStoryBlob(input);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story'}-story.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
