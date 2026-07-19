import { ExploreDayTabs } from 'yuno-design-system';

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

// Dates ISO figées à midi : pas de Date.now(), et aucune bascule de jour selon
// le fuseau de la machine de capture.
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
  percentSold: 0,
  isTrending: false,
  interestedCount: 320,
};

const ev = (
  id: string,
  title: string,
  venueName: string,
  venueSlug: string,
  startAt: string,
  minPrice: number | null,
  genres: string[],
  colors: [string, string],
  label: string,
) => ({
  ...base,
  id,
  title,
  venueName,
  venueSlug,
  startAt,
  minPrice,
  genres,
  posterUrl: poster(colors[0], colors[1], label),
});

const jeudi = ev('e1', 'Techno Basement', 'Sala Mirador', 'sala-mirador', '2026-08-13T23:00:00.000Z', 15, ['Techno'], ['#E8192C', '#1B1B1E'], 'TB');
const vendredi = [
  ev('e2', 'La Noche Roja', 'Teatro Barceló', 'teatro-barcelo', '2026-08-14T23:30:00.000Z', 30, ['Reggaeton'], ['#7B2FF7', '#141414'], 'LNR'),
  ev('e3', 'Warehouse 22', 'Fabrik', 'fabrik', '2026-08-14T22:00:00.000Z', 25, ['Hard Techno'], ['#1F6FEB', '#0A0A0A'], 'W22'),
  ev('e4', 'Afro Terraza', 'Azotea Círculo', 'azotea-circulo', '2026-08-14T20:30:00.000Z', 18, ['Afro House'], ['#00C2A8', '#0A0A0A'], 'AT'),
];
const samedi = [
  ...vendredi.map((e, i) => ({ ...e, id: `s${i}`, startAt: e.startAt.replace('08-14', '08-15') })),
  ev('e5', 'Open Decks', 'Café Berlín', 'cafe-berlin', '2026-08-15T21:00:00.000Z', 0, ['Open Format'], ['#FF8A00', '#0E0E10'], 'OD'),
  ev('e6', 'Rooftop Sunset', 'Azotea Círculo', 'azotea-circulo', '2026-08-15T19:00:00.000Z', 22, ['House'], ['#E8192C', '#0E0E10'], 'RS'),
];

const day = (key: string, iso: string, events: typeof vendredi) => ({
  key,
  date: new Date(iso),
  events,
});

const Column = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 420 }}>{children}</div>
);

const noop = { chipGenres: [] as string[], freeOnly: false };

// La semaine telle que la construit Explore.tsx : premier jour libellé AUJ, puis
// les abréviations de jour, avec jusqu'à 3 pastilles selon le nombre de soirées.
export const SemaineComplete = () => (
  <Column>
    <ExploreDayTabs
      {...noop}
      weekData={[
        day('AUJ', '2026-08-13T12:00:00.000Z', [jeudi]),
        day('VEN', '2026-08-14T12:00:00.000Z', vendredi),
        day('SAM', '2026-08-15T12:00:00.000Z', samedi),
        day('DIM', '2026-08-16T12:00:00.000Z', []),
        day('LUN', '2026-08-17T12:00:00.000Z', []),
      ]}
    />
  </Column>
);

// Plus de 4 soirées ce jour-là : le bouton « voir les N events » apparaît.
export const JourCharge = () => (
  <Column>
    <ExploreDayTabs
      {...noop}
      weekData={[
        day('AUJ', '2026-08-15T12:00:00.000Z', samedi),
        day('DIM', '2026-08-16T12:00:00.000Z', []),
        day('LUN', '2026-08-17T12:00:00.000Z', [jeudi]),
      ]}
    />
  </Column>
);

// Filtre « gratuit » actif : la journée n'a rien à moins de 0€ → état vide du jour.
export const JourVide = () => (
  <Column>
    <ExploreDayTabs
      chipGenres={[]}
      freeOnly
      weekData={[
        day('AUJ', '2026-08-14T12:00:00.000Z', vendredi),
        day('SAM', '2026-08-15T12:00:00.000Z', samedi),
      ]}
    />
  </Column>
);

// Filtre par genre : seules les soirées Techno du jour restent.
export const FiltreGenre = () => (
  <Column>
    <ExploreDayTabs
      chipGenres={['Hard Techno']}
      freeOnly={false}
      weekData={[day('AUJ', '2026-08-14T12:00:00.000Z', vendredi)]}
    />
  </Column>
);
