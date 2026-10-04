/**
 * Images envoyées depuis la Console CRM : recadrées au carré côté navigateur
 * avant l'envoi (photo de profil, logo de l'espace). Rien ne part en taille
 * d'origine : un logo de 6 Mo voyagerait dans chaque e-mail.
 */

function loadImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  return new Promise((ok, ko) => {
    const i = new Image();
    i.onload = () => ok({ img: i, url });
    i.onerror = (e) => { URL.revokeObjectURL(url); ko(e); };
    i.src = url;
  });
}

/** Côté le plus court de l'image, en pixels. */
export async function imageMinSide(file: File): Promise<number> {
  const { img, url } = await loadImage(file);
  URL.revokeObjectURL(url);
  return Math.min(img.width, img.height);
}

/**
 * Carré centré de `size` px. JPEG pour une photo ; PNG pour un logo, qui
 * garde sa transparence (un JPEG la remplit de noir).
 */
export async function squareImage(file: File, size = 384, type: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<Blob> {
  const { img, url } = await loadImage(file);
  try {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const m = Math.min(img.width, img.height);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
    return await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('canvas'))), type, type === 'image/jpeg' ? 0.86 : undefined));
  } finally {
    URL.revokeObjectURL(url);
  }
}
