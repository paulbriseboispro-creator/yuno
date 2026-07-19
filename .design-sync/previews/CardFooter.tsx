import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from 'yuno-design-system';

// CardFooter is the trailing action row; graded as the closing band of a whole Card.
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

export const PiedPrixEtCTA = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={mono}>
          Table VIP · Carré 4
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
          La Noche Roja
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.5 }}>
          6 personnes, deux bouteilles incluses, accès prioritaire jusqu'à 01:00.
        </p>
      </CardContent>
      <CardFooter style={{ justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <span className="font-mono" style={{ ...mono, color: '#5A5A5E' }}>
            Dès
          </span>
          <span
            className="font-display"
            style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em' }}
          >
            450 €
          </span>
        </div>
        <Button>Réserver</Button>
      </CardFooter>
    </Card>
  </div>
);

export const PiedDeuxActions = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <CardTitle className="font-display uppercase" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
          Rooftop Sunset
        </CardTitle>
        <CardDescription style={{ fontSize: 13 }}>
          Azotea Círculo, jeudi 20 août, portes à 19:00.
        </CardDescription>
      </CardHeader>
      <CardFooter style={{ gap: 10 }}>
        <Button style={{ flex: 1 }}>Prendre un billet</Button>
        <Button variant="outline" style={{ flex: 1 }}>
          Plus tard
        </Button>
      </CardFooter>
    </Card>
  </div>
);

export const PiedMention = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
          Paiement accepté
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
          Commande confirmée
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.5 }}>
          Vos 2 billets sont dans l'onglet « Mes billets », prêts à scanner hors ligne.
        </p>
      </CardContent>
      <CardFooter>
        <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em', color: '#5A5A5E' }}>
          Reçu envoyé à paula@yunoapp.eu
        </span>
      </CardFooter>
    </Card>
  </div>
);
