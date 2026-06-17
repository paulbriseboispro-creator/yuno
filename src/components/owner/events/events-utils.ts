// Pure helpers + constants extracted verbatim from OwnerEvents.tsx.
export const CROPPER_CONTAINER_PX = 144;

export const MUSIC_GENRES = ['House', 'Techno', 'Rap / Hip-Hop', 'Afro / Shatta', 'Reggaeton / Latino', 'Commercial / Hits', 'Electro / EDM', 'Open Format'];

export function cropToSquare(dataUrl: string, position: { x: number; y: number; scale: number } | null, outputSize = 1080): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight, C = CROPPER_CONTAINER_PX;
      const baseScale = Math.max(C / W, C / H);
      const totalScale = baseScale * (position?.scale ?? 1);
      const cropSize = C / totalScale;
      const cropX = Math.max(0, Math.min(W - cropSize, W / 2 - (C / 2 + (position?.x ?? 0)) / totalScale));
      const cropY = Math.max(0, Math.min(H - cropSize, H / 2 - (C / 2 + (position?.y ?? 0)) / totalScale));
      const canvas = document.createElement('canvas');
      canvas.width = outputSize; canvas.height = outputSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not available'));
      ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, outputSize, outputSize);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/jpeg', 0.90);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
