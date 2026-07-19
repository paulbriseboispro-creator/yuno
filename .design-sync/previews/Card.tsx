import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Separator,
} from 'yuno-design-system';

// Page background of the public app (#0A0A0A). The Card token --card is 8%
// (#141414), so without a page-dark wrapper the surface has nothing to read
// against and the card looks like it never rendered.
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

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 12,
};

export const RecapCommande = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={mono}>
          Commande YN-4471
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          Techno Basement
        </CardTitle>
        <CardDescription className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
          Sala Mirador · 14 août 2026 · 23:00
        </CardDescription>
      </CardHeader>
      <CardContent style={{ display: 'grid', gap: 10 }}>
        <div style={row}>
          <span style={{ fontSize: 14, color: '#E5E5E5' }}>2 × Entrée générale</span>
          <span className="font-mono" style={{ fontSize: 13, color: '#fff' }}>
            30,00 €
          </span>
        </div>
        <div style={row}>
          <span style={{ fontSize: 14, color: '#E5E5E5' }}>Frais de service</span>
          <span className="font-mono" style={{ fontSize: 13, color: '#9A9A9A' }}>
            1,20 €
          </span>
        </div>
        <Separator className="bg-white/10" />
        <div style={row}>
          <span className="font-mono" style={{ ...mono, color: '#5A5A5E' }}>
            Total
          </span>
          <span
            className="font-display"
            style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em' }}
          >
            31,20 €
          </span>
        </div>
      </CardContent>
    </Card>
  </div>
);

export const CarteFidelite = () => (
  <div style={page}>
    <Card style={{ borderColor: 'rgba(232,25,44,0.28)' }}>
      <CardHeader>
        <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
          Fidélité club
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          Teatro Barceló
        </CardTitle>
        <CardDescription style={{ fontSize: 13, color: '#9A9A9A' }}>
          Encore 2 soirées avant votre bouteille offerte.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          style={{
            height: 2,
            width: '100%',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <div style={{ height: '100%', width: '60%', background: '#E8192C', borderRadius: 1 }} />
        </div>
        <p className="font-mono" style={{ ...mono, marginTop: 10, letterSpacing: '0.06em' }}>
          6 / 10 visites
        </p>
      </CardContent>
    </Card>
  </div>
);

export const ReservationTable = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={mono}>
          Table VIP · Carré 4
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          La Noche Roja
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.5 }}>
          6 personnes, deux bouteilles incluses, accès prioritaire jusqu'à 01:00.
        </p>
      </CardContent>
      <CardFooter style={row}>
        <span className="font-mono" style={{ ...mono, color: '#5A5A5E' }}>
          Dès
        </span>
        <span
          className="font-display"
          style={{ fontSize: 24, fontWeight: 700, color: '#E8192C', letterSpacing: '-0.03em' }}
        >
          450 €
        </span>
      </CardFooter>
    </Card>
  </div>
);
