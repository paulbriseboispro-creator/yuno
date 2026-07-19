import {
  Avatar,
  AvatarFallback,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from 'yuno-design-system';

// CardContent is the padded body slot; graded as the body of a whole Card.
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

export const ContenuFacture = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={mono}>
          Commande YN-4471
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
          Détail du panier
        </CardTitle>
      </CardHeader>
      <CardContent style={{ display: 'grid', gap: 10 }}>
        <div style={row}>
          <span style={{ fontSize: 14, color: '#E5E5E5' }}>2 × Entrée générale</span>
          <span className="font-mono" style={{ fontSize: 13, color: '#fff' }}>
            30,00 €
          </span>
        </div>
        <div style={row}>
          <span style={{ fontSize: 14, color: '#E5E5E5' }}>1 × Gin tonic</span>
          <span className="font-mono" style={{ fontSize: 13, color: '#fff' }}>
            11,00 €
          </span>
        </div>
        <Separator className="bg-white/10" />
        <div style={row}>
          <span className="font-mono" style={{ ...mono, color: '#5A5A5E' }}>
            Total
          </span>
          <span
            className="font-display"
            style={{ fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em' }}
          >
            41,00 €
          </span>
        </div>
      </CardContent>
    </Card>
  </div>
);

export const ContenuLineup = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
          Line-up
        </p>
        <CardTitle className="font-display uppercase" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
          Techno Basement
        </CardTitle>
      </CardHeader>
      <CardContent style={{ display: 'grid', gap: 14 }}>
        {[
          { ini: 'AB', name: 'Alba Bermúdez', slot: '23:00 — 01:00' },
          { ini: 'KR', name: 'Kike Ruiz', slot: '01:00 — 03:30' },
          { ini: 'NV', name: 'Nuria Vega', slot: '03:30 — 06:00' },
        ].map((dj) => (
          <div key={dj.ini} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar className="h-9 w-9">
              <AvatarFallback
                className="font-mono"
                style={{ background: 'rgba(232,25,44,0.24)', color: '#FF6273', fontSize: 12, fontWeight: 700 }}
              >
                {dj.ini}
              </AvatarFallback>
            </Avatar>
            <div style={{ display: 'grid', gap: 3 }}>
              <span style={{ fontSize: 14, color: '#fff' }}>{dj.name}</span>
              <span className="font-mono" style={{ ...mono, fontSize: 10, letterSpacing: '0.06em' }}>
                {dj.slot}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
);

export const ContenuTexte = () => (
  <div style={page}>
    <Card>
      <CardHeader>
        <CardTitle className="font-display uppercase" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>
          Accès et conditions
        </CardTitle>
        <CardDescription style={{ fontSize: 13 }}>Sala Mirador, calle Argumosa 12.</CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.6 }}>
          Entrée réservée aux plus de 18 ans. Le vestiaire ferme à 05:30. Les billets
          sont remboursables jusqu'à 48 h avant l'ouverture des portes.
        </p>
      </CardContent>
    </Card>
  </div>
);
