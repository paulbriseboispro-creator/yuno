import { Badge } from 'yuno-design-system';

const row: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
};

// Le vocabulaire nightlife (genre, statut, rareté) passe en JetBrains Mono
// uppercase tracké — c'est la signature du design system public, appliquée par
// dessus la variante de couleur du composant.
const mono = 'font-mono uppercase text-[10px] font-bold tracking-[0.10em]';

// Axe de variantes réel du composant : default / secondary / destructive /
// outline / success / warning.
export const Variantes = () => (
  <div style={row}>
    <Badge variant="default">Complet</Badge>
    <Badge variant="secondary">Techno</Badge>
    <Badge variant="destructive">Annulé</Badge>
    <Badge variant="outline">Gratuit</Badge>
    <Badge variant="success">Payé</Badge>
    <Badge variant="warning">Dernières places</Badge>
  </div>
);

// Tags de genre sur une carte Explore : neutres, mono, jamais rouges — le rouge
// est réservé à l'urgence.
export const Genres = () => (
  <div style={row}>
    <Badge variant="secondary" className={mono}>
      Techno
    </Badge>
    <Badge variant="secondary" className={mono}>
      House
    </Badge>
    <Badge variant="secondary" className={mono}>
      Afro House
    </Badge>
    <Badge variant="secondary" className={mono}>
      Reggaeton
    </Badge>
    <Badge variant="outline" className={mono}>
      Open Format
    </Badge>
  </div>
);

// Statuts d'event : rouge = urgence / live, ambre = rareté, violet = partenaire
// affilié (le violet n'est pas une variante du composant, c'est le motif inline
// documenté par le design system).
export const Statuts = () => (
  <div style={row}>
    <Badge variant="default" className={mono}>
      Live
    </Badge>
    <Badge variant="default" className={mono}>
      Sold out
    </Badge>
    <Badge variant="warning" className={mono}>
      Dernières places
    </Badge>
    <Badge
      variant="outline"
      className={mono}
      style={{
        color: '#C084FC',
        background: 'rgba(192,132,252,0.15)',
        borderColor: 'rgba(192,132,252,0.35)',
      }}
    >
      Partenaire
    </Badge>
  </div>
);

// En contexte : la rangée de badges posée sur le panneau info d'une carte event.
export const SurCarteEvent = () => (
  <div
    style={{
      width: 320,
      background: '#141414',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10,
      padding: '14px 16px',
    }}
  >
    <div style={{ ...row, marginBottom: 10 }}>
      <Badge variant="default" className={mono}>
        Live
      </Badge>
      <Badge variant="secondary" className={mono}>
        Techno
      </Badge>
      <Badge variant="warning" className={mono}>
        88 % vendu
      </Badge>
    </div>
    <p
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: '#9A9A9A',
        margin: 0,
      }}
    >
      Sala Mirador
    </p>
    <p
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        fontSize: 17,
        color: '#FFFFFF',
        letterSpacing: '-0.005em',
        textTransform: 'uppercase',
        margin: '2px 0 0',
      }}
    >
      Techno Basement
    </p>
  </div>
);

// Dans un flux de commande : les statuts d'une commande boissons / billets.
export const StatutsDeCommande = () => (
  <div style={row}>
    <Badge variant="warning" className={mono}>
      En préparation
    </Badge>
    <Badge variant="success" className={mono}>
      Prête au bar
    </Badge>
    <Badge variant="secondary" className={mono}>
      Retirée
    </Badge>
    <Badge variant="destructive" className={mono}>
      Remboursée
    </Badge>
  </div>
);
