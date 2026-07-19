import { EventCard } from 'yuno-design-system';

// Inline SVG posters: deterministic and offline. Remote images would make the
// render check flaky and the capture hashes unstable.
const poster = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="600" height="600" fill="url(#g)"/>
      <text x="50%" y="52%" text-anchor="middle" fill="rgba(255,255,255,0.92)"
        font-family="Space Grotesk, sans-serif" font-size="64" font-weight="700"
        letter-spacing="4">${label}</text>
    </svg>`,
  );

// Fixed dates — a Date.now()-derived value would re-key the capture on every run
// and clear the grade.
const base = {
  id: 'evt-1',
  slug: 'techno-basement',
  organizerSlug: null,
  startAt: '2026-08-14T23:00:00.000Z',
  endAt: '2026-08-15T06:00:00.000Z',
  venueCity: 'Madrid',
  distance: 1.2,
  eventType: 'club',
  isLive: false,
  isOrganizerLed: false,
  isAffiliate: false,
};

export const Standard = () => (
  <div style={{ width: 340 }}>
    <EventCard
      event={{
        ...base,
        title: 'TECHNO BASEMENT',
        posterUrl: poster('#E8192C', '#1B1B1E', 'TB'),
        venueName: 'Club Sala Mirador',
        venueSlug: 'sala-mirador',
        minPrice: 15,
        genres: ['Techno', 'Hard Groove'],
        interestedCount: 428,
        percentSold: 42,
        tablesRemaining: 6,
        isTrending: false,
      }}
    />
  </div>
);

export const Tendance = () => (
  <div style={{ width: 340 }}>
    <EventCard
      event={{
        ...base,
        id: 'evt-2',
        title: 'ROOFTOP SUNSET',
        posterUrl: poster('#FF8A00', '#0E0E10', 'RS'),
        venueName: 'Azotea Círculo',
        venueSlug: 'azotea-circulo',
        minPrice: 22,
        genres: ['House', 'Disco'],
        interestedCount: 1240,
        percentSold: 88,
        tablesRemaining: 1,
        isTrending: true,
      }}
    />
  </div>
);

export const EnDirect = () => (
  <div style={{ width: 340 }}>
    <EventCard
      event={{
        ...base,
        id: 'evt-3',
        title: 'LA NOCHE ROJA',
        posterUrl: poster('#7B2FF7', '#141414', 'LNR'),
        venueName: 'Teatro Barceló',
        venueSlug: 'teatro-barcelo',
        minPrice: 30,
        genres: ['Reggaeton', 'Latin'],
        interestedCount: 2870,
        percentSold: 100,
        tablesRemaining: null,
        isLive: true,
        isTrending: true,
      }}
    />
  </div>
);

export const Gratuit = () => (
  <div style={{ width: 340 }}>
    <EventCard
      event={{
        ...base,
        id: 'evt-4',
        title: 'OPEN DECKS',
        posterUrl: poster('#00C2A8', '#0A0A0A', 'OD'),
        venueName: 'Café Berlín',
        venueSlug: 'cafe-berlin',
        minPrice: null,
        genres: ['Open Format'],
        interestedCount: 96,
        percentSold: 12,
        tablesRemaining: null,
        isTrending: false,
      }}
    />
  </div>
);
