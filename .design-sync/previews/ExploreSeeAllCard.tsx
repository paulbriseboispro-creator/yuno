import { ExploreSeeAllCard, ExploreDJCard, ExplorePopularClubCard } from 'yuno-design-system';

// Visuels en SVG inline : déterministes et hors-ligne (cf. EventCard).
const art = (w: number, h: number, from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <text x="50%" y="55%" text-anchor="middle" fill="rgba(255,255,255,0.9)"
        font-family="Space Grotesk, sans-serif" font-size="${Math.round(h / 3)}"
        font-weight="700" letter-spacing="3">${label}</text>
    </svg>`,
  );

// Gabarit du carrousel DJ (cap 10) — width/minHeight/borderRadius calqués sur
// ExploreDJCard, comme dans Explore.tsx.
export const FinDeCarrouselDJ = () => (
  <ExploreSeeAllCard label="Tout voir" onClick={() => {}} width={140} minHeight={198} borderRadius={14} />
);

// Gabarit du carrousel Clubs populaires (cap 10) — calqué sur ExplorePopularClubCard.
export const FinDeCarrouselClubs = () => (
  <ExploreSeeAllCard label="Ver todo" onClick={() => {}} width={282} minHeight={258} borderRadius={20} />
);

// L'usage réel : la carte ferme la rangée et adopte la hauteur de ses voisines.
export const EnPlaceDansLeRail = () => (
  <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
    <ExploreDJCard
      rank={9}
      dj={{
        id: 'dj-9',
        slug: 'lucia-bravo',
        handle: 'lucia-bravo',
        stageName: 'Lucía Bravo',
        profileImageUrl: art(280, 300, '#E8192C', '#141417', 'LB'),
        musicGenres: ['House'],
        isVerified: true,
        followersCount: 5210,
      }}
    />
    <ExploreDJCard
      rank={10}
      dj={{
        id: 'dj-10',
        slug: 'ruben-oso',
        handle: 'ruben-oso',
        stageName: 'Rubén Oso',
        profileImageUrl: art(280, 300, '#7B2FF7', '#0F0F12', 'RO'),
        musicGenres: ['Open Format'],
        isVerified: false,
        followersCount: 1840,
      }}
    />
    <ExploreSeeAllCard label="Tout voir" onClick={() => {}} width={140} minHeight={198} borderRadius={14} />
  </div>
);

export const EnPlaceDansLesClubs = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
    <ExplorePopularClubCard
      id="fabrik"
      name="Fabrik"
      coverUrl={art(564, 516, '#00C2A8', '#0A0A0A', 'FK')}
      logoUrl={null}
      city="Humanes"
      primaryGenre="Hard Techno"
    />
    <ExploreSeeAllCard label="See all" onClick={() => {}} width={282} minHeight={258} borderRadius={20} />
  </div>
);
