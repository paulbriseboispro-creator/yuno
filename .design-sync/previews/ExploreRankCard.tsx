import { ExploreRankCard } from 'yuno-design-system';

// Affiches en SVG inline : déterministes et hors-ligne (cf. EventCard).
const poster = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="200">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="330" height="200" fill="url(#g)"/>
      <text x="66%" y="60%" text-anchor="middle" fill="rgba(255,255,255,0.9)"
        font-family="Space Grotesk, sans-serif" font-size="54" font-weight="700"
        letter-spacing="3">${label}</text>
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
  percentSold: 62,
  isTrending: true,
  minPrice: 20,
};

export const PremierRang = () => (
  <ExploreRankCard
    rank={1}
    event={{
      ...base,
      title: 'La Noche Roja',
      posterUrl: poster('#E8192C', '#1B1B1E', 'LNR'),
      venueName: 'Teatro Barceló',
      venueSlug: 'teatro-barcelo',
      genres: ['Reggaeton', 'Latin'],
      interestedCount: 2870,
    }}
  />
);

export const SansVisuel = () => (
  <ExploreRankCard
    rank={4}
    event={{
      ...base,
      id: 'evt-2',
      startAt: '2026-08-16T00:00:00.000Z',
      title: 'Open Decks',
      posterUrl: null,
      venueName: 'Café Berlín',
      venueSlug: 'cafe-berlin',
      genres: ['Open Format'],
      interestedCount: 0,
    }}
  />
);

export const Classement = () => (
  <div style={{ display: 'flex', gap: 16 }}>
    <ExploreRankCard
      rank={2}
      event={{
        ...base,
        id: 'evt-3',
        title: 'Techno Basement',
        posterUrl: poster('#7B2FF7', '#141414', 'TB'),
        venueName: 'Sala Mirador',
        venueSlug: 'sala-mirador',
        genres: ['Techno'],
        interestedCount: 1980,
      }}
    />
    <ExploreRankCard
      rank={3}
      event={{
        ...base,
        id: 'evt-4',
        startAt: '2026-08-15T22:30:00.000Z',
        title: 'Warehouse 22',
        posterUrl: poster('#00C2A8', '#0A0A0A', 'W22'),
        venueName: 'Fabrik',
        venueSlug: 'fabrik',
        genres: ['Hard Techno'],
        interestedCount: 1340,
      }}
    />
  </div>
);
