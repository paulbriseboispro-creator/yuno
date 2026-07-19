import { ExplorePopularClubCard } from 'yuno-design-system';

// Visuels en SVG inline : déterministes et hors-ligne (cf. EventCard).
const cover = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="564" height="516">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="564" height="516" fill="url(#g)"/>
      <text x="50%" y="46%" text-anchor="middle" fill="rgba(255,255,255,0.9)"
        font-family="Space Grotesk, sans-serif" font-size="110" font-weight="700"
        letter-spacing="4">${label}</text>
    </svg>`,
  );

export const Standard = () => (
  <ExplorePopularClubCard
    id="sala-mirador"
    name="Sala Mirador"
    coverUrl={cover('#E8192C', '#1B1B1E', 'SM')}
    logoUrl={null}
    city="Madrid"
    primaryGenre="Techno"
  />
);

export const Partenaire = () => (
  <ExplorePopularClubCard
    id="teatro-barcelo"
    name="Teatro Barceló"
    coverUrl={cover('#7B2FF7', '#141414', 'TB')}
    logoUrl={null}
    city="Madrid"
    primaryGenre="Reggaeton"
    isAffiliate
    slug="teatro-barcelo"
  />
);

// coverUrl/logoUrl à null : le composant retombe sur son dégradé dérivé de l'id,
// avec la trame diagonale par-dessus.
export const DegradeParDefaut = () => (
  <ExplorePopularClubCard
    id="cafe-berlin"
    name="Café Berlín"
    coverUrl={null}
    logoUrl={null}
    city="Madrid"
    primaryGenre="Afro House"
  />
);

export const Carrousel = () => (
  <div style={{ display: 'flex', gap: 12 }}>
    <ExplorePopularClubCard
      id="fabrik"
      name="Fabrik"
      coverUrl={cover('#00C2A8', '#0A0A0A', 'FK')}
      logoUrl={null}
      city="Humanes"
      primaryGenre="Hard Techno"
    />
    <ExplorePopularClubCard
      id="azotea-circulo"
      name="Azotea Círculo"
      coverUrl={cover('#FF8A00', '#0E0E10', 'AC')}
      logoUrl={null}
      city="Madrid"
      primaryGenre="House"
    />
  </div>
);
