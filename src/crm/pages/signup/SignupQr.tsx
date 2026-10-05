/**
 * Le QR d'une page d'inscription : un vrai QR (bibliothèque `qrcode`) qui mène
 * au lien exact de l'endroit (`?src=`), dessiné en SVG à l'écran et
 * téléchargeable en PNG 1024 px, prêt à imprimer.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrSvg({ url, size }: { url: string; size: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1C1517', light: '#FFFFFF00' } })
      .then((s) => { if (!off) setSvg(s.replace('<svg ', `<svg width="${size}" height="${size}" shape-rendering="crispEdges" style="display:block" `)); })
      .catch(() => { if (!off) setSvg(null); });
    return () => { off = true; };
  }, [url, size]);
  return svg
    ? <span aria-hidden style={{ display: 'block', width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
    : <span aria-hidden style={{ display: 'block', width: size, height: size, borderRadius: 8, background: 'var(--sand-100)' }} />;
}

/** Télécharge le QR d'un lien en PNG (1024 px, marge blanche). */
export async function downloadQr(url: string, name: string): Promise<void> {
  const data = await QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#1C1517', light: '#FFFFFF' } });
  const a = document.createElement('a');
  a.href = data;
  a.download = `qr-${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page'}.png`;
  a.click();
}
