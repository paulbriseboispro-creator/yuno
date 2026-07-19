import { Avatar, AvatarFallback, AvatarImage } from 'yuno-design-system';

// AvatarImage is a Radix slot that only paints once its src resolves, and it is
// h-full w-full so it inherits every dimension from the Avatar root. Rendered on
// its own it is invisible — the truthful preview is the full Avatar composition.
// Inline SVG keeps the capture deterministic and offline.
const portrait = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="200" height="200" fill="url(#g)"/>
      <text x="50%" y="58%" text-anchor="middle" fill="rgba(255,255,255,0.95)"
        font-family="Space Grotesk, sans-serif" font-size="76" font-weight="700"
        letter-spacing="2">${label}</text>
    </svg>`,
  );

const page: React.CSSProperties = {
  background: '#0A0A0A',
  padding: 20,
};

const mono: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#9A9A9A',
};

const fallbackStyle: React.CSSProperties = {
  background: 'rgba(232,25,44,0.16)',
  color: '#E8192C',
  fontWeight: 700,
};

export const PhotoDJ = () => (
  <div style={{ ...page, width: 320, display: 'flex', alignItems: 'center', gap: 14 }}>
    <Avatar className="h-16 w-16">
      <AvatarImage src={portrait('#E8192C', '#1B1B1E', 'AB')} alt="Alba Bermúdez" />
      <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 16 }}>
        AB
      </AvatarFallback>
    </Avatar>
    <div style={{ display: 'grid', gap: 4 }}>
      <span className="font-display uppercase" style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
        Alba Bermúdez
      </span>
      <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
        Techno · Madrid · 1 240 abonnés
      </span>
    </div>
  </div>
);

// object-cover matters when the source is not square; the class lands on the
// image slot, not on the Avatar root.
export const PhotoRecadree = () => (
  <div style={{ ...page, display: 'flex', alignItems: 'center', gap: 18 }}>
    <Avatar className="h-20 w-20">
      <AvatarImage
        className="object-cover"
        src={portrait('#7B2FF7', '#141414', 'KR')}
        alt="Kike Ruiz"
      />
      <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 22 }}>
        KR
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-20 w-20 rounded-xl">
      <AvatarImage
        className="rounded-xl object-cover"
        src={portrait('#FF8A00', '#0E0E10', 'AC')}
        alt="Azotea Círculo"
      />
      <AvatarFallback className="rounded-xl font-mono" style={{ ...fallbackStyle, fontSize: 20 }}>
        AC
      </AvatarFallback>
    </Avatar>
  </div>
);

// A src that cannot resolve is the everyday case for a client with no photo:
// Radix drops the image slot and the fallback takes over. Nothing renders blank.
export const SourceIntrouvable = () => (
  <div style={{ ...page, width: 320, display: 'flex', alignItems: 'center', gap: 14 }}>
    <Avatar className="h-16 w-16">
      <AvatarImage src="" alt="Paula Serrano" />
      <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 16 }}>
        PS
      </AvatarFallback>
    </Avatar>
    <div style={{ display: 'grid', gap: 4 }}>
      <span className="font-display uppercase" style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
        Paula Serrano
      </span>
      <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
        Aucune photo de profil
      </span>
    </div>
  </div>
);
