import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

type QRItem = {
  label: string;
  description: string;
  url: string;
};

type Props = {
  items: QRItem[];
};

function QRCard({ item }: { item: QRItem }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, item.url, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    }).then(() => setReady(true)).catch(console.error);
  }, [item.url]);

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `qr-${item.label.toLowerCase().replace(/\s+/g, '-')}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  return (
    <div
      style={{
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '100%' }}>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: '#FFFFFF',
          }}
        >
          {item.label}
        </span>
        <span
          style={{
            fontSize: '11px',
            color: '#5A5A5E',
            textAlign: 'center',
          }}
        >
          {item.description}
        </span>
      </div>

      <div
        style={{
          borderRadius: '8px',
          overflow: 'hidden',
          opacity: ready ? 1 : 0,
          transition: 'opacity 300ms ease',
        }}
      >
        <canvas ref={canvasRef} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
        <button
          onClick={handleDownload}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: '#E5E5E5',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Télécharger PNG
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(item.url)}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.07)',
            background: 'transparent',
            color: '#5A5A5E',
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copier le lien
        </button>
      </div>
    </div>
  );
}

export default function AffiliateQRSection({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: items.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
        }}
      >
        {items.map((item) => (
          <QRCard key={item.url} item={item} />
        ))}
      </div>
    </div>
  );
}
