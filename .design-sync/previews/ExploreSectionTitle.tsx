import { ExploreSectionTitle } from 'yuno-design-system';

// Le composant porte son propre padding latéral de 20px : on le pose dans une
// largeur mobile réaliste, comme dans Explore.tsx.
const Column = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 400 }}>{children}</div>
);

export const KickerEtTitre = () => (
  <Column>
    <ExploreSectionTitle kicker="LES PLUS SUIVIS" title="Les DJs à ne pas manquer" />
  </Column>
);

export const AvecAction = () => (
  <Column>
    <ExploreSectionTitle
      kicker="LES INCONTOURNABLES"
      title="Clubs populaires"
      action="Tout voir"
      onAction={() => {}}
    />
  </Column>
);

export const SansKicker = () => (
  <Column>
    <ExploreSectionTitle title="Cette semaine" />
  </Column>
);

// titleNoWrap : le titre reste sur une ligne et s'ellipse au lieu de pousser
// l'action « Tout voir » hors cadre.
export const TitreLongTronque = () => (
  <Column>
    <ExploreSectionTitle
      kicker="EN CE MOMENT"
      title="Les soirées les plus réservées à Madrid ce week-end"
      action="Tout voir"
      onAction={() => {}}
      titleNoWrap
    />
  </Column>
);
