import { Skeleton } from 'yuno-design-system';

// Skeleton is a bare div: it has no intrinsic size, and its default bg-muted
// (0 0% 7%, #121212) is invisible against the public #0A0A0A page. Without an
// explicit height AND an explicit tint it renders as literally nothing. The app
// solves this the same way — see VenuePage.tsx, which passes bg-white/[0.08] so
// a loading screen never looks like a black screen.
const sk = 'bg-white/[0.08]';

const page: React.CSSProperties = {
  background: '#0A0A0A',
  padding: 20,
  width: 340,
};

// Reproduces the venue page loading state verbatim: cover, title, club row,
// pill, section label, then two square event cards.
export const ChargementPageClub = () => (
  <div style={{ ...page, display: 'grid', gap: 16 }}>
    <Skeleton className={`w-full aspect-video rounded-xl ${sk}`} />
    <div className="space-y-3">
      <Skeleton className={`h-7 w-2/3 ${sk}`} />
      <div className="flex items-center gap-2">
        <Skeleton className={`h-7 w-7 rounded-full ${sk}`} />
        <Skeleton className={`h-4 w-40 ${sk}`} />
      </div>
      <Skeleton className={`h-8 w-28 rounded-full ${sk}`} />
    </div>
  </div>
);

// The Explore carousels load as square posters with a two-line info panel.
export const ChargementCarteEvent = () => (
  <div style={{ ...page, display: 'grid', gap: 14 }}>
    <Skeleton className={`h-3 w-24 ${sk}`} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {['a', 'b'].map((k) => (
        <div key={k} style={{ display: 'grid', gap: 8 }}>
          <Skeleton className={`w-full aspect-square rounded-lg ${sk}`} />
          <Skeleton className={`h-3 w-3/4 ${sk}`} />
          <Skeleton className={`h-4 w-full ${sk}`} />
          <Skeleton className={`h-3 w-1/2 ${sk}`} />
        </div>
      ))}
    </div>
  </div>
);

// Text placeholders for the event description block, staggered widths so the
// shape reads as a paragraph rather than a bar chart.
export const ChargementTexte = () => (
  <div style={{ ...page, display: 'grid', gap: 10 }}>
    <Skeleton className={`h-6 w-1/2 ${sk}`} />
    <Skeleton className={`h-4 w-full ${sk}`} />
    <Skeleton className={`h-4 w-full ${sk}`} />
    <Skeleton className={`h-4 w-5/6 ${sk}`} />
    <Skeleton className={`h-4 w-2/3 ${sk}`} />
  </div>
);

// Side-by-side with a real row: the placeholder must sit at the same rhythm as
// the content it stands in for.
export const ChargementLigneDJ = () => (
  <div style={{ ...page, display: 'grid', gap: 14 }}>
    {['a', 'b', 'c'].map((k) => (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Skeleton className={`h-11 w-11 rounded-full ${sk}`} />
        <div style={{ display: 'grid', gap: 6, flex: 1 }}>
          <Skeleton className={`h-4 w-2/3 ${sk}`} />
          <Skeleton className={`h-3 w-1/3 ${sk}`} />
        </div>
        <Skeleton className={`h-8 w-16 rounded-full ${sk}`} />
      </div>
    ))}
  </div>
);
