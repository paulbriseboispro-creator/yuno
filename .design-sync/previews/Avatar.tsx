import { Avatar, AvatarFallback, AvatarImage } from 'yuno-design-system';

// Inline SVG portraits: deterministic and offline. A remote src would make the
// render check flaky and re-key the capture, which clears the grades.
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

// The Avatar root is h-10 w-10 by default but AvatarImage/AvatarFallback are
// h-full w-full: with neither a src nor children the whole thing paints nothing.
// Every story below carries both a real image and a fallback so the primitive
// can never render blank.
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

export const Tailles = () => (
  <div style={{ ...page, display: 'flex', alignItems: 'center', gap: 18 }}>
    <Avatar className="h-8 w-8">
      <AvatarImage src={portrait('#E8192C', '#1B1B1E', 'AB')} alt="Alba Bermúdez" />
      <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 10 }}>
        AB
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-10 w-10">
      <AvatarImage src={portrait('#7B2FF7', '#141414', 'KR')} alt="Kike Ruiz" />
      <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 12 }}>
        KR
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-14 w-14">
      <AvatarImage src={portrait('#FF8A00', '#0E0E10', 'NV')} alt="Nuria Vega" />
      <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 16 }}>
        NV
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-20 w-20">
      <AvatarImage src={portrait('#00C2A8', '#0A0A0A', 'PS')} alt="Paula Serrano" />
      <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 22 }}>
        PS
      </AvatarFallback>
    </Avatar>
  </div>
);

export const LigneLineup = () => (
  <div style={{ ...page, width: 320, display: 'grid', gap: 14 }}>
    <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
      Line-up · Sala Mirador
    </p>
    {[
      { ini: 'AB', name: 'Alba Bermúdez', slot: '23:00 — 01:00', from: '#E8192C', to: '#1B1B1E' },
      { ini: 'KR', name: 'Kike Ruiz', slot: '01:00 — 03:30', from: '#7B2FF7', to: '#141414' },
      { ini: 'NV', name: 'Nuria Vega', slot: '03:30 — 06:00', from: '#FF8A00', to: '#0E0E10' },
    ].map((dj) => (
      <div key={dj.ini} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar className="h-11 w-11">
          <AvatarImage src={portrait(dj.from, dj.to, dj.ini)} alt={dj.name} />
          <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 12 }}>
            {dj.ini}
          </AvatarFallback>
        </Avatar>
        <div style={{ display: 'grid', gap: 3 }}>
          <span style={{ fontSize: 14, color: '#fff' }}>{dj.name}</span>
          <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
            {dj.slot}
          </span>
        </div>
      </div>
    ))}
  </div>
);

export const LogoClubCarre = () => (
  <div style={{ ...page, width: 320, display: 'flex', alignItems: 'center', gap: 12 }}>
    <Avatar className="h-12 w-12 rounded-xl">
      <AvatarImage
        className="rounded-xl object-cover"
        src={portrait('#E8192C', '#0A0A0A', 'TB')}
        alt="Teatro Barceló"
      />
      <AvatarFallback className="rounded-xl font-mono" style={{ ...fallbackStyle, fontSize: 13 }}>
        TB
      </AvatarFallback>
    </Avatar>
    <div style={{ display: 'grid', gap: 3 }}>
      <span className="font-display uppercase" style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
        Teatro Barceló
      </span>
      <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
        Madrid · 6 / 10 visites
      </span>
    </div>
  </div>
);

// Overlapping stack: the portraits carry no initials, because a real photo
// stack overlaps freely — labelled circles would read as clipped text.
export const PileParticipants = () => (
  <div style={{ ...page, width: 320, display: 'grid', gap: 12 }}>
    <p className="font-mono" style={mono}>
      428 intéressés
    </p>
    <div style={{ display: 'flex' }}>
      {[
        { ini: 'AB', from: '#E8192C', to: '#1B1B1E' },
        { ini: 'KR', from: '#7B2FF7', to: '#141414' },
        { ini: 'NV', from: '#FF8A00', to: '#0E0E10' },
        { ini: 'PS', from: '#00C2A8', to: '#0A0A0A' },
      ].map((p, i) => (
        <Avatar
          key={p.ini}
          className="h-10 w-10"
          style={{ marginLeft: i === 0 ? 0 : -12, boxShadow: '0 0 0 2px #0A0A0A' }}
        >
          <AvatarImage src={portrait(p.from, p.to, '')} alt={p.ini} />
          <AvatarFallback className="font-mono" style={{ ...fallbackStyle, fontSize: 11 }}>
            {p.ini}
          </AvatarFallback>
        </Avatar>
      ))}
      <Avatar className="h-10 w-10" style={{ marginLeft: -12, boxShadow: '0 0 0 2px #0A0A0A' }}>
        <AvatarFallback
          className="font-mono"
          style={{ background: 'rgba(255,255,255,0.08)', color: '#E5E5E5', fontSize: 10, fontWeight: 700 }}
        >
          +424
        </AvatarFallback>
      </Avatar>
    </div>
  </div>
);
