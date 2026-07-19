import { ExploreRailCard } from 'yuno-design-system';

// Affiches en SVG inline : déterministes et hors-ligne (cf. EventCard).
const poster = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="444" height="300">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="444" height="300" fill="url(#g)"/>
      <text x="50%" y="58%" text-anchor="middle" fill="rgba(255,255,255,0.92)"
        font-family="Space Grotesk, sans-serif" font-size="72" font-weight="700"
        letter-spacing="4">${label}</text>
    </svg>`,
  );

// Dates ISO figées — un Date.now() re-clérait la capture à chaque run.
const base = {
  id: 'evt-1',
  slug: 'techno-basement',
  organizerSlug: null,
  startAt: '2026-08-14T23:00:00.000Z',
  endAt: '2026-08-15T06:00:00.000Z',
  venueCity: 'Madrid',
  eventType: 'club',
  isLive: false,
  isOrganizerLed: false,
  isAffiliate: false,
  tablesRemaining: null,
  percentSold: 40,
  isTrending: false,
};

export const Standard = () => (
  <ExploreRailCard
    event={{
      ...base,
      title: 'Techno Basement',
      posterUrl: poster('#E8192C', '#1B1B1E', 'TB'),
      venueName: 'Sala Mirador',
      venueSlug: 'sala-mirador',
      minPrice: 15,
      genres: ['Techno', 'Hard Groove'],
      interestedCount: 428,
    }}
  />
);

export const Partenaire = () => (
  <ExploreRailCard
    event={{
      ...base,
      id: 'evt-2',
      title: 'Rooftop Sunset',
      posterUrl: poster('#FF8A00', '#0E0E10', 'RS'),
      venueName: 'Azotea Círculo',
      venueSlug: 'azotea-circulo',
      minPrice: 22,
      genres: ['House', 'Disco'],
      interestedCount: 1240,
      isAffiliate: true,
      affiliateEventSlug: 'rooftop-sunset',
    }}
  />
);

export const Gratuit = () => (
  <ExploreRailCard
    event={{
      ...base,
      id: 'evt-3',
      title: 'Open Decks',
      posterUrl: poster('#00C2A8', '#0A0A0A', 'OD'),
      venueName: 'Café Berlín',
      venueSlug: 'cafe-berlin',
      minPrice: 0,
      genres: ['Open Format'],
      interestedCount: 96,
    }}
  />
);

export const Rail = () => (
  <div style={{ display: 'flex', gap: 14 }}>
    <ExploreRailCard
      event={{
        ...base,
        id: 'evt-4',
        title: 'La Noche Roja',
        posterUrl: poster('#7B2FF7', '#141414', 'LNR'),
        venueName: 'Teatro Barceló',
        venueSlug: 'teatro-barcelo',
        minPrice: 30,
        genres: ['Reggaeton', 'Latin'],
        interestedCount: 2870,
      }}
    />
    <ExploreRailCard
      event={{
        ...base,
        id: 'evt-5',
        startAt: '2026-08-16T00:00:00.000Z',
        title: 'Warehouse 22',
        posterUrl: poster('#1F6FEB', '#0A0A0A', 'W22'),
        venueName: 'Fabrik',
        venueSlug: 'fabrik',
        minPrice: 25,
        genres: ['Hard Techno'],
        interestedCount: 3410,
      }}
    />
  </div>
);
