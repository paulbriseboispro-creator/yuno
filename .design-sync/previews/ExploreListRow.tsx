import { ExploreListRow } from 'yuno-design-system';

// Vignettes en SVG inline : déterministes et hors-ligne (cf. EventCard).
const poster = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="222" height="222">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="222" height="222" fill="url(#g)"/>
      <text x="50%" y="58%" text-anchor="middle" fill="rgba(255,255,255,0.92)"
        font-family="Space Grotesk, sans-serif" font-size="58" font-weight="700"
        letter-spacing="2">${label}</text>
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
  interestedCount: 428,
};

// Encadrement par les filets de l'agenda « Cette semaine » (ExploreDayTabs).
const Ruled = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 420, padding: '0 20px' }}>
    <div
      style={{
        borderTop: '1px solid rgba(255,255,255,0.08)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {children}
    </div>
  </div>
);

export const Standard = () => (
  <Ruled>
    <ExploreListRow
      event={{
        ...base,
        title: 'Techno Basement',
        posterUrl: poster('#E8192C', '#1B1B1E', 'TB'),
        venueName: 'Sala Mirador',
        venueSlug: 'sala-mirador',
        minPrice: 15,
        genres: ['Techno', 'Hard Groove'],
      }}
    />
  </Ruled>
);

export const Partenaire = () => (
  <Ruled>
    <ExploreListRow
      event={{
        ...base,
        id: 'evt-2',
        startAt: '2026-08-15T20:00:00.000Z',
        title: 'Rooftop Sunset',
        posterUrl: poster('#FF8A00', '#0E0E10', 'RS'),
        venueName: 'Azotea Círculo',
        venueSlug: 'azotea-circulo',
        minPrice: 22,
        genres: ['House', 'Disco'],
        isAffiliate: true,
        affiliateEventSlug: 'rooftop-sunset',
      }}
    />
  </Ruled>
);

export const Gratuit = () => (
  <Ruled>
    <ExploreListRow
      event={{
        ...base,
        id: 'evt-3',
        startAt: '2026-08-16T21:30:00.000Z',
        title: 'Open Decks',
        posterUrl: null,
        venueName: 'Café Berlín',
        venueSlug: 'cafe-berlin',
        minPrice: 0,
        genres: ['Open Format'],
      }}
    />
  </Ruled>
);

// L'usage réel : une pile de lignes séparées par des filets, dans l'agenda du jour.
export const Agenda = () => (
  <div style={{ width: 420, padding: '0 20px' }}>
    {[
      {
        ...base,
        id: 'evt-4',
        title: 'La Noche Roja',
        posterUrl: poster('#7B2FF7', '#141414', 'LNR'),
        venueName: 'Teatro Barceló',
        venueSlug: 'teatro-barcelo',
        minPrice: 30,
        genres: ['Reggaeton'],
      },
      {
        ...base,
        id: 'evt-5',
        startAt: '2026-08-14T23:30:00.000Z',
        title: 'Warehouse 22',
        posterUrl: poster('#1F6FEB', '#0A0A0A', 'W22'),
        venueName: 'Fabrik',
        venueSlug: 'fabrik',
        minPrice: 25,
        genres: ['Hard Techno'],
      },
      {
        ...base,
        id: 'evt-6',
        startAt: '2026-08-15T01:00:00.000Z',
        title: 'Afro Terraza',
        posterUrl: poster('#00C2A8', '#0A0A0A', 'AT'),
        venueName: 'Azotea Círculo',
        venueSlug: 'azotea-circulo',
        minPrice: 18,
        genres: ['Afro House'],
      },
    ].map((event, i) => (
      <div
        key={event.id}
        style={{
          borderTop: i === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <ExploreListRow event={event} />
      </div>
    ))}
  </div>
);
