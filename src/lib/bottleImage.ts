// Shared geometry + canvas baking for the VIP bottle image framing system.
// The on-screen editor frame and the baked output share the same 3:4 ratio as
// the customer-facing bottle card, so the editor preview is a true WYSIWYG.

export const BOTTLE_FRAME = { w: 180, h: 240 };
export const BOTTLE_OUTPUT = { w: 600, h: 800 };

export interface BottleTransform {
  scale: number;
  x: number;
  y: number;
}

export const DEFAULT_BOTTLE_TRANSFORM: BottleTransform = { scale: 1, x: 0, y: 0 };

// object-contain fit of an image into the frame, in frame (CSS) pixels.
export function containFit(natW: number, natH: number, frameW: number, frameH: number) {
  const imgRatio = natW / natH;
  const frameRatio = frameW / frameH;
  if (imgRatio > frameRatio) return { w: frameW, h: frameW / imgRatio };
  return { w: frameH * imgRatio, h: frameH };
}

/**
 * Bakes the owner's chosen framing into a transparent WebP at the card ratio.
 * The math mirrors the live editor preview exactly (frame scaled up by
 * k = OUTPUT / FRAME), so what the owner frames is what customers see.
 */
export async function composeBottleBlob(src: string, transform: BottleTransform): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });

  const k = BOTTLE_OUTPUT.w / BOTTLE_FRAME.w;
  const base = containFit(img.naturalWidth, img.naturalHeight, BOTTLE_FRAME.w, BOTTLE_FRAME.h);
  const dw = base.w * k * transform.scale;
  const dh = base.h * k * transform.scale;
  const dx = BOTTLE_OUTPUT.w / 2 + transform.x * k - dw / 2;
  const dy = BOTTLE_OUTPUT.h / 2 + transform.y * k - dh / 2;

  const canvas = document.createElement('canvas');
  canvas.width = BOTTLE_OUTPUT.w;
  canvas.height = BOTTLE_OUTPUT.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 0.92)
  );
}
