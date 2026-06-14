export interface PhotoGridProps {
  venueName: string;
  eventTitle: string;
  photos: string[];
  ctaText: string;
  language: string;
  bgColor1?: string;
  bgColor2?: string;
  textColor?: string;
}

function getGridStyle(count: number): React.CSSProperties {
  switch (count) {
    case 1: return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    case 2: return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    case 3: return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    case 4: return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    case 5: return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' };
    case 6: return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' };
    default: return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
  }
}

function getPhotoSpan(count: number, index: number): React.CSSProperties {
  if (count === 1) return {};
  if (count === 2) return {};
  if (count === 3 && index === 0) return { gridColumn: '1 / -1' };
  if (count === 5 && index === 0) return { gridColumn: '1 / -1' };
  return {};
}

export function PhotoGridTemplate({
  venueName,
  eventTitle,
  photos,
  ctaText,
  language,
  bgColor1,
  bgColor2,
  textColor,
}: PhotoGridProps) {
  const bg1 = bgColor1 || '#150000';
  const bg2 = bgColor2 || '#050505';
  const txt = textColor || '#ffffff';
  const count = Math.min(photos.length, 6);

  return (
    <div style={{
      width: 1080, height: 1920, position: 'relative', overflow: 'hidden',
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: '#050505',
    }}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${bg1} 0%, ${bg2} 100%)` }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`, backgroundSize: '200px 200px' }} />
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, transparent 5%, rgba(220,38,38,0.4) 30%, rgba(220,38,38,0.15) 70%, transparent 95%)' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, transparent 5%, rgba(220,38,38,0.4) 30%, rgba(220,38,38,0.15) 70%, transparent 95%)' }} />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', padding: '60px 36px 36px' }}>
        {/* Header */}
        <p style={{ fontSize: 32, fontWeight: 900, color: `${txt}b3`, textTransform: 'uppercase', letterSpacing: 10, textAlign: 'center', marginBottom: 8 }}>
          {venueName}
        </p>
        <h1 style={{ fontSize: 64, fontWeight: 900, color: txt, textAlign: 'center', lineHeight: 1.1, margin: '0 0 8px', textShadow: '0 0 80px rgba(220,38,38,0.5)' }}>
          {eventTitle.toUpperCase()}
        </h1>
        <div style={{ width: 120, height: 4, background: 'linear-gradient(90deg, transparent, #dc2626, transparent)', margin: '20px auto 32px', borderRadius: 2 }} />

        {/* Photo Grid */}
        <div style={{
          flex: 1, display: 'grid', gap: 12, borderRadius: 28, overflow: 'hidden',
          ...getGridStyle(count),
        }}>
          {photos.slice(0, 6).map((photo, i) => (
            <div key={i} style={{
              position: 'relative', overflow: 'hidden', borderRadius: 20,
              ...getPhotoSpan(count, i),
            }}>
              <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} crossOrigin="anonymous" />
              {/* Subtle overlay */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.4) 100%)' }} />
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{
          marginTop: 32, padding: '28px 0', borderRadius: 24,
          background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
          textAlign: 'center', boxShadow: '0 0 40px rgba(220,38,38,0.3)',
        }}>
          <p style={{ fontSize: 36, fontWeight: 900, color: '#fff', margin: 0, letterSpacing: 4 }}>
            {ctaText}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 24 }}>
          <p style={{ fontSize: 24, fontWeight: 800, color: `${txt}55`, letterSpacing: 6, margin: 0 }}>POWERED BY</p>
          <p style={{ fontSize: 36, fontWeight: 900, color: '#dc2626', letterSpacing: 3, margin: 0 }}>YUNO</p>
        </div>
      </div>
    </div>
  );
}
