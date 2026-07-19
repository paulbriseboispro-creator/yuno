import { Avatar, AvatarFallback, AvatarImage } from 'yuno-design-system';

// AvatarFallback is h-full w-full inside the Avatar root and its default
// bg-muted (#121212) is nearly invisible on the public #0A0A0A page. Rendered
// alone it is a blank square; the truthful preview is the whole Avatar, with
// an explicit tint so the initials read.
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

export const InitialesClient = () => (
  <div style={{ ...page, width: 320, display: 'flex', alignItems: 'center', gap: 14 }}>
    <Avatar className="h-16 w-16">
      <AvatarFallback
        className="font-mono"
        style={{ background: 'rgba(232,25,44,0.16)', color: '#E8192C', fontSize: 18, fontWeight: 700 }}
      >
        PS
      </AvatarFallback>
    </Avatar>
    <div style={{ display: 'grid', gap: 4 }}>
      <span className="font-display uppercase" style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
        Paula Serrano
      </span>
      <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
        Membre depuis mars 2026
      </span>
    </div>
  </div>
);

export const TeintesDeSecours = () => (
  <div style={{ ...page, display: 'flex', alignItems: 'center', gap: 16 }}>
    <Avatar className="h-14 w-14">
      <AvatarFallback
        className="font-mono"
        style={{ background: 'rgba(232,25,44,0.16)', color: '#E8192C', fontSize: 15, fontWeight: 700 }}
      >
        AB
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-14 w-14">
      <AvatarFallback
        className="font-mono"
        style={{ background: 'rgba(255,255,255,0.08)', color: '#E5E5E5', fontSize: 15, fontWeight: 700 }}
      >
        KR
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-14 w-14 rounded-xl">
      <AvatarFallback
        className="rounded-xl font-mono"
        style={{ background: 'rgba(192,132,252,0.18)', color: '#C084FC', fontSize: 15, fontWeight: 700 }}
      >
        AC
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-14 w-14">
      <AvatarFallback
        className="font-mono"
        style={{ background: 'rgba(255,255,255,0.06)', color: '#9A9A9A', fontSize: 12, fontWeight: 700 }}
      >
        +424
      </AvatarFallback>
    </Avatar>
  </div>
);

// Mixed list: some clients have a photo, some do not. The fallback has to sit
// at the same weight as a real portrait or the list looks broken.
export const ListeMixte = () => (
  <div style={{ ...page, width: 320, display: 'grid', gap: 14 }}>
    <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
      Guest list · Rooftop Sunset
    </p>
    {[
      { ini: 'AB', name: 'Alba Bermúdez', src: portrait('#E8192C', '#1B1B1E', 'AB') },
      { ini: 'KR', name: 'Kike Ruiz', src: '' },
      { ini: 'NV', name: 'Nuria Vega', src: portrait('#FF8A00', '#0E0E10', 'NV') },
      { ini: 'PS', name: 'Paula Serrano', src: '' },
    ].map((g) => (
      <div key={g.ini} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar className="h-11 w-11">
          <AvatarImage src={g.src} alt={g.name} />
          <AvatarFallback
            className="font-mono"
            style={{ background: 'rgba(232,25,44,0.16)', color: '#E8192C', fontSize: 12, fontWeight: 700 }}
          >
            {g.ini}
          </AvatarFallback>
        </Avatar>
        <span style={{ fontSize: 14, color: '#E5E5E5' }}>{g.name}</span>
      </div>
    ))}
  </div>
);
