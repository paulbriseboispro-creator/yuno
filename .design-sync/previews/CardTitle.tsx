import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'yuno-design-system';

// CardTitle alone is a bare text node; graded inside the full Card it belongs to.
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

export const TitreAffiche = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={mono}>
          À la une
        </p>
        <CardTitle
          className="font-display uppercase"
          style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 0.95 }}
        >
          La Noche Roja
        </CardTitle>
        <CardDescription className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
          Teatro Barceló · Reggaeton
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.5 }}>
          La nuit latine la plus dense de Madrid, deux salles, jusqu'au petit matin.
        </p>
      </CardContent>
    </Card>
  </div>
);

export const TitreSurDeuxLignes = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
          Résidence mensuelle
        </p>
        <CardTitle
          className="font-display uppercase"
          style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}
        >
          Warehouse Sessions Vol. 12
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
          Nave 16 · Matadero · Dès 22 €
        </p>
      </CardContent>
    </Card>
  </div>
);

export const TitreCompact = () => (
  <div style={page}>
    <Card>
      <CardHeader style={{ paddingBottom: 12 }}>
        <CardTitle
          className="font-display uppercase"
          style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.005em' }}
        >
          Vestiaire inclus
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.5 }}>
          Déposez manteau et sac à l'entrée, le ticket arrive dans votre billet Yuno.
        </p>
      </CardContent>
    </Card>
  </div>
);
