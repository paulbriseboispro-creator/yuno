import { ExploreDJCard } from 'yuno-design-system';

// Portraits en SVG inline : déterministes et hors-ligne, comme dans EventCard.
const portrait = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="300">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="280" height="300" fill="url(#g)"/>
      <circle cx="140" cy="112" r="52" fill="rgba(0,0,0,0.28)"/>
      <text x="50%" y="60%" text-anchor="middle" fill="rgba(255,255,255,0.92)"
        font-family="Space Grotesk, sans-serif" font-size="62" font-weight="700"
        letter-spacing="2">${label}</text>
    </svg>`,
  );

export const Standard = () => (
  <ExploreDJCard
    dj={{
      id: 'dj-1',
      slug: 'marco-valdes',
      handle: 'marco-valdes',
      stageName: 'Marco Valdés',
      profileImageUrl: portrait('#E8192C', '#141417', 'MV'),
      musicGenres: ['Techno', 'Hard Groove'],
      isVerified: true,
      followersCount: 12400,
    }}
  />
);

export const Classement = () => (
  <ExploreDJCard
    rank={1}
    dj={{
      id: 'dj-2',
      slug: 'nina-cruz',
      handle: 'nina-cruz',
      stageName: 'Nina Cruz',
      profileImageUrl: portrait('#7B2FF7', '#0F0F12', 'NC'),
      musicGenres: ['Afro House', 'Melodic'],
      isVerified: true,
      followersCount: 8730,
    }}
  />
);

export const SansPortrait = () => (
  <ExploreDJCard
    dj={{
      id: 'dj-3',
      slug: 'kilo-serrano',
      handle: null,
      stageName: 'Kilo Serrano',
      profileImageUrl: null,
      musicGenres: ['Reggaeton'],
      isVerified: false,
      followersCount: 0,
    }}
  />
);

export const Carrousel = () => (
  <div style={{ display: 'flex', gap: 14 }}>
    <ExploreDJCard
      rank={2}
      dj={{
        id: 'dj-4',
        slug: 'lucia-bravo',
        handle: 'lucia-bravo',
        stageName: 'Lucía Bravo',
        profileImageUrl: portrait('#FF8A00', '#0E0E10', 'LB'),
        musicGenres: ['House', 'Disco'],
        isVerified: true,
        followersCount: 5210,
      }}
    />
    <ExploreDJCard
      rank={3}
      dj={{
        id: 'dj-5',
        slug: 'ruben-oso',
        handle: 'ruben-oso',
        stageName: 'Rubén Oso',
        profileImageUrl: portrait('#00C2A8', '#0A0A0A', 'RO'),
        musicGenres: ['Open Format'],
        isVerified: false,
        followersCount: 1840,
      }}
    />
  </div>
);
