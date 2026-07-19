import { ExploreEventCarousel } from 'yuno-design-system';

// Affiches en SVG inline : déterministes et hors-ligne (cf. EventCard).
const poster = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="530" height="420">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="530" height="420" fill="url(#g)"/>
      <text x="50%" y="52%" text-anchor="middle" fill="rgba(255,255,255,0.92)"
        font-family="Space Grotesk, sans-serif" font-size="96" font-weight="700"
        letter-spacing="4">${label}</text>
    </svg>`,
  );

// Dates ISO figées — un Date.now() re-clérait la capture à chaque run.
const base = {
  slug: null,
  organizerSlug: null,
  endAt: '2026-08-15T06:00:00.000Z',
  venueCity: 'Madrid',
  eventType: 'club',
  isLive: false,
  isOrganizerLed: false,
  isAffiliate: false,
  tablesRemaining: null,
  interestedCount: 640,
};

// Colonne de lecture. Le carrousel déborde horizontalement avec un « peek » de la
// carte suivante, exactement comme dans Explore.tsx : cette largeur laisse voir deux
// cartes entières plus l'amorce de la troisième (badge PARTENAIRE compris).
const Wide = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 780, overflow: 'hidden' }}>{children}</div>
);

// Colonne mobile stricte pour les branches qui n'ont pas de défilement.
const Column = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 400, overflow: 'hidden' }}>{children}</div>
);

const events = [
  {
    ...base,
    id: 'evt-1',
    title: 'Techno Basement',
    posterUrl: poster('#E8192C', '#1B1B1E', 'TB'),
    startAt: '2026-08-14T23:00:00.000Z',
    venueName: 'Sala Mirador',
    venueSlug: 'sala-mirador',
    minPrice: 15,
    genres: ['Techno', 'Hard Groove'],
    percentSold: 62,
    isTrending: true,
  },
  {
    ...base,
    id: 'evt-2',
    title: 'La Noche Roja',
    posterUrl: poster('#7B2FF7', '#141414', 'LNR'),
    startAt: '2026-08-14T23:30:00.000Z',
    venueName: 'Teatro Barceló',
    venueSlug: 'teatro-barcelo',
    minPrice: 30,
    genres: ['Reggaeton'],
    percentSold: 100,
    isTrending: false,
    isLive: true,
  },
  {
    ...base,
    id: 'evt-3',
    title: 'Rooftop Sunset',
    posterUrl: poster('#FF8A00', '#0E0E10', 'RS'),
    startAt: '2026-08-15T19:00:00.000Z',
    venueName: 'Azotea Círculo',
    venueSlug: 'azotea-circulo',
    minPrice: 22,
    genres: ['House', 'Disco'],
    percentSold: 12,
    isTrending: false,
    isAffiliate: true,
    affiliateEventSlug: 'rooftop-sunset',
  },
];

// 2 soirées ou plus → carrousel swipeable, avec peek de la suivante.
export const Carrousel = () => (
  <Wide>
    <ExploreEventCarousel events={events} city="Madrid" periodLabel="Ce soir" />
  </Wide>
);

// 1 seule soirée → carte hero pleine largeur (branche dédiée du composant).
export const Hero = () => (
  <Column>
    <ExploreEventCarousel
      events={[
        {
          ...base,
          id: 'evt-4',
          title: 'Warehouse 22',
          posterUrl: poster('#1F6FEB', '#0A0A0A', 'W22'),
          startAt: '2026-08-15T22:00:00.000Z',
          venueName: 'Fabrik',
          venueSlug: 'fabrik',
          minPrice: 25,
          genres: ['Hard Techno'],
          percentSold: 74,
          isTrending: true,
        },
      ]}
      city="Madrid"
      periodLabel="Samedi"
    />
  </Column>
);

// 0 soirée → titre conservé + phrase mono d'état vide.
export const Vide = () => (
  <Column>
    <ExploreEventCarousel events={[]} city="Madrid" periodLabel="Ce soir" />
  </Column>
);
