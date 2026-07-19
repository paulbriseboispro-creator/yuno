import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'yuno-design-system';

// CardDescription is muted body text; only readable when graded against the
// header and title it sits under.
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

export const DescriptionEditoriale = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <CardTitle className="font-display uppercase" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          Rooftop Sunset
        </CardTitle>
        <CardDescription style={{ fontSize: 14, lineHeight: 1.55 }}>
          Coucher de soleil sur les toits de Malasaña, house et disco jusqu'à minuit,
          puis la fête descend au sous-sol.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
          Azotea Círculo · Dès 22 €
        </p>
      </CardContent>
    </Card>
  </div>
);

export const DescriptionMeta = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={mono}>
          Billet nominatif
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          Techno Basement
        </CardTitle>
        <CardDescription className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
          Sala Mirador · 14 août 2026 · 23:00
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.5 }}>
          Présentez le QR code à l'entrée, pièce d'identité obligatoire.
        </p>
      </CardContent>
    </Card>
  </div>
);

export const DescriptionAvertissement = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
          Presque complet
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          Warehouse Sessions
        </CardTitle>
        <CardDescription style={{ fontSize: 14, lineHeight: 1.55 }}>
          Il reste 12 entrées sur ce round. Le prochain palier passe à 28 €.
        </CardDescription>
      </CardHeader>
    </Card>
  </div>
);
