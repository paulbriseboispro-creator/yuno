import { ExploreChipRow } from 'yuno-design-system';

// Le composant est contrôlé : les stories figent l'état actif au lieu de le gérer,
// ce qui rend chaque combinaison lisible sur sa propre carte.
// Largeur suffisante pour que la rangée entière soit lisible : le composant est un
// scroller horizontal, une colonne de 400px masquerait les chips de genre et donc
// les états actifs qu'on cherche justement à montrer.
const Column = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 780, padding: '12px 0' }}>{children}</div>
);

const noop = () => {};

export const DateActive = () => (
  <Column>
    <ExploreChipRow
      dateFilter="today"
      onDateChip={noop}
      genreFilter={[]}
      onGenreToggle={noop}
      freeOnly={false}
      onFreeToggle={noop}
    />
  </Column>
);

export const WeekEnd = () => (
  <Column>
    <ExploreChipRow
      dateFilter="weekend"
      onDateChip={noop}
      genreFilter={[]}
      onGenreToggle={noop}
      freeOnly={false}
      onFreeToggle={noop}
    />
  </Column>
);

export const GratuitEtGenre = () => (
  <Column>
    <ExploreChipRow
      dateFilter="tomorrow"
      onDateChip={noop}
      genreFilter={['House']}
      onGenreToggle={noop}
      freeOnly
      onFreeToggle={noop}
    />
  </Column>
);

export const PlusieursGenres = () => (
  <Column>
    <ExploreChipRow
      dateFilter=""
      onDateChip={noop}
      genreFilter={['House', 'Reggaeton']}
      onGenreToggle={noop}
      freeOnly={false}
      onFreeToggle={noop}
    />
  </Column>
);
