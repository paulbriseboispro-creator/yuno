import QRCode from 'qrcode';

/**
 * Story QR du linktree — UNE image 9:16 (1080×1920) prête à poster qui envoie
 * vers la page du promoteur (= toutes ses soirées), pas vers une soirée
 * précise. Avatar, nom, « Toutes mes soirées », QR du lien /promo/<slug>,
 * l'URL courte en toutes lettres, signature agence « Powered by Yuno ».
 *
 * 100 % client (canvas) : aucun coût serveur, marche dans l'app native.
 * L'avatar Supabase Storage est servi avec CORS * → crossOrigin='anonymous'
 * garde le canvas exportable ; s'il échoue, la story sort simplement sans
 * avatar plutôt que d'échouer.
 */

export type LinktreeStoryInput = {
  /** Nom affiché en grand (prénom du promoteur, ou son @slug). */
  name: string;
  /** Accroche localisée dessinée sous le nom — ex. « Toutes mes soirées ». */
  subtitle: string;
  /** URL encodée dans le QR (la page /promo/<slug>). */
  link: string;
  /** URL courte lisible affichée sous le QR — ex. yunoapp.eu/promo/leo. */
  linkLabel: string;
  avatarUrl?: string | null;
  agencyName?: string | null;
};

const W = 1080;
const H = 1920;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
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

export async function generateLinktreeStoryBlob(input: LinktreeStoryInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');

  // ── Fond de marque : nuit + halos rouges discrets ──
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#16050a');
  bg.addColorStop(0.5, '#0a0a0c');
  bg.addColorStop(1, '#20060b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const halo = (x: number, y: number, r: number, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(232,25,44,${alpha})`);
    g.addColorStop(1, 'rgba(232,25,44,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  halo(W * 0.15, H * 0.12, 420, 0.16);
  halo(W * 0.9, H * 0.85, 520, 0.13);

  // ── Avatar en médaillon (optionnel), anneau rouge ──
  let y = 430;
  if (input.avatarUrl) {
    try {
      const img = await loadImage(input.avatarUrl);
      const r = 120;
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, y, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      // cover dans le cercle
      const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
      ctx.drawImage(img, W / 2 - (img.width * scale) / 2, y - (img.height * scale) / 2, img.width * scale, img.height * scale);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(W / 2, y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#E8192C';
      ctx.lineWidth = 8;
      ctx.stroke();
      y += r + 130;
    } catch {
      // sans avatar — la composition remonte naturellement
    }
  }

  // ── Nom + accroche ──
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 84px system-ui, -apple-system, "Helvetica Neue", sans-serif';
  let name = input.name.toUpperCase();
  while (ctx.measureText(name).width > W - 140 && name.length > 4) {
    name = `${name.slice(0, -2)}…`;
  }
  ctx.fillText(name, W / 2, y);

  ctx.font = '600 44px system-ui, -apple-system, "Helvetica Neue", sans-serif';
  ctx.fillStyle = '#E8192C';
  ctx.fillText(input.subtitle, W / 2, y + 78);

  // ── QR dans une carte blanche arrondie, centré ──
  const qrSize = 340;
  const pad = 30;
  const cardW = qrSize + pad * 2;
  const cardX = (W - cardW) / 2;
  const cardY = y + 160;
  roundRect(ctx, cardX, cardY, cardW, cardW, 40);
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

  // ── URL courte lisible (pour ceux qui ne scannent pas) ──
  ctx.font = '600 36px ui-monospace, "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(input.linkLabel, W / 2, cardY + cardW + 84);

  // ── Signature ──
  ctx.font = '600 32px system-ui, -apple-system, "Helvetica Neue", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  const signature = [input.agencyName, 'Powered by Yuno'].filter(Boolean).join('  ·  ');
  ctx.fillText(signature, W / 2, H - 110);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/** Génère puis télécharge la story (nom de fichier sûr). */
export async function downloadLinktreeStory(input: LinktreeStoryInput, filenameBase: string): Promise<void> {
  const blob = await generateLinktreeStoryBlob(input);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'linktree'}-story.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
