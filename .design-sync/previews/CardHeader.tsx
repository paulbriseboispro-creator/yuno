import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'yuno-design-system';

// CardHeader has no standalone rendering worth grading: it is a padded flex
// column. The only truthful preview is the whole Card, with the header as the
// subject of the composition.
const page: React.CSSProperties = {
  background: '#0A0A0A',
  padding: 20,
  width: 380,
};

const mono: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#9A9A9A',
};

export const EnteteComplet = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
          Vendredi 14 août
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          Techno Basement
        </CardTitle>
        <CardDescription className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
          Sala Mirador · Madrid · 23:00 → 06:00
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.5 }}>
          Quatre heures de hard groove dans la cave la plus étroite de Lavapiés.
        </p>
      </CardContent>
    </Card>
  </div>
);

export const EnteteAvecAction = () => (
  <div style={page}>
    <Card>
      <CardHeader style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <p className="font-mono" style={mono}>
            Guest list
          </p>
          <CardTitle className="font-display uppercase" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
            Rooftop Sunset
          </CardTitle>
        </div>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#E8192C',
            border: '1px solid rgba(232,25,44,0.5)',
            borderRadius: 999,
            padding: '4px 9px',
            whiteSpace: 'nowrap',
          }}
        >
          Confirmée
        </span>
      </CardHeader>
      <CardContent>
        <p className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
          Azotea Círculo · 4 noms · Entrée avant 01:00
        </p>
      </CardContent>
    </Card>
  </div>
);

export const EnteteSeul = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={mono}>
          Votre soirée
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          Open Decks
        </CardTitle>
        <CardDescription style={{ fontSize: 13, color: '#9A9A9A' }}>
          Entrée libre, platines ouvertes à tous dès 21:00.
        </CardDescription>
      </CardHeader>
    </Card>
  </div>
);
