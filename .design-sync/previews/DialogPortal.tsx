import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from 'yuno-design-system';

const panel = {
  background: '#141414',
  border: '1px solid rgba(255,255,255,0.08)',
};

const kicker = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#E8192C',
  margin: 0,
};

const metaLine = {
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#9A9A9A',
  margin: 0,
};

const bigTitle = {
  fontSize: 22,
  letterSpacing: '-0.025em',
  lineHeight: 1,
  color: '#FFFFFF',
};

const bodyText = { fontSize: 13, lineHeight: 1.45, color: '#9A9A9A' };

const block = {
  display: 'grid',
  gap: 8,
  padding: '12px 0',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

// Non exporté : seules les fonctions exportées deviennent des cellules.
const Ligne = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
    <span className="font-mono" style={{ ...metaLine, fontSize: 10.5, color: strong ? '#5A5A5E' : '#9A9A9A' }}>
      {label}
    </span>
    <span
      className={strong ? 'font-display font-bold' : 'font-mono'}
      style={{ fontSize: strong ? 20 : 12, color: strong ? '#FFFFFF' : '#E5E5E5', letterSpacing: strong ? '-0.02em' : '0.02em' }}
    >
      {value}
    </span>
  </div>
);

const poster = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="' + from + '"/><stop offset="100%" stop-color="' + to + '"/>' +
      '</linearGradient></defs><rect width="300" height="300" fill="url(#g)"/>' +
      '<text x="50%" y="55%" text-anchor="middle" fill="rgba(255,255,255,0.92)" ' +
      'font-family="Space Grotesk, sans-serif" font-size="54" font-weight="700" letter-spacing="3">' +
      label +
      '</text></svg>',
  );

// Page Explore derrière l'overlay : sans fond riche, le voile et le flou de
// DialogOverlay / DrawerOverlay ne se lisent sur aucune capture.
const FondExplore = () => (
  <div style={{ minHeight: 'calc(100vh - 48px)', background: '#0A0A0A', padding: '18px 20px' }}>
    <p className="font-mono" style={kicker}>À la une · Madrid</p>
    <h2
      className="font-display font-bold uppercase"
      style={{ fontSize: 30, letterSpacing: '-0.025em', lineHeight: 0.95, color: '#FFFFFF', margin: '10px 0 16px' }}
    >
      Ce soir à Madrid
    </h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {[
        { src: poster('#E8192C', '#1B1B1E', 'TB'), venue: 'Sala Mirador', title: 'Techno Basement', price: 'Dès 15 €' },
        { src: poster('#FF8A00', '#0E0E10', 'RS'), venue: 'Azotea Círculo', title: 'Rooftop Sunset', price: 'Dès 22 €' },
        { src: poster('#7B2FF7', '#141414', 'LNR'), venue: 'Teatro Barceló', title: 'La Noche Roja', price: 'Dès 30 €' },
      ].map((e) => (
        <div key={e.title} style={{ ...panel, borderRadius: 10, overflow: 'hidden' }}>
          <img src={e.src} alt="" style={{ display: 'block', width: '100%', aspectRatio: '1 / 1' }} />
          <div style={{ padding: '8px 10px 10px' }}>
            <p className="font-mono" style={{ ...metaLine, fontSize: 9 }}>{e.venue}</p>
            <p
              className="font-display font-bold uppercase"
              style={{ fontSize: 13, letterSpacing: '-0.005em', color: '#FFFFFF', margin: '3px 0 5px' }}
            >
              {e.title}
            </p>
            <p className="font-mono font-bold" style={{ fontSize: 10, letterSpacing: '0.04em', color: '#E8192C', margin: 0 }}>
              {e.price}
            </p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Faux QR déterministe (motif figé, aucun aléa) — un vrai QR n'apporterait rien
// à la lecture du style et re-clérait la capture.
const QR_ROWS = [
  '111011101', '100010001', '101010101', '100011001', '111000111',
  '001101100', '110011011', '010110010', '111010111',
];
const qr = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" shape-rendering="crispEdges">' +
    '<rect width="90" height="90" fill="#FFFFFF"/>' +
    QR_ROWS.map((row, y) =>
      row.split('').map((b, x) => (b === '1'
        ? '<rect x="' + (5 + x * 9) + '" y="' + (5 + y * 9) + '" width="9" height="9" fill="#0A0A0A"/>'
        : '')).join(''),
    ).join('') +
  '</svg>',
);

// Le dialogue est déclaré dans la carte de 190×58 en overflow:hidden posée en haut
// à droite ; DialogPortal le sort de cet arbre pour le monter à la racine, donc il
// s'affiche entier et centré au lieu d'être rogné.
export const DepuisUneCarte = () => (
  <div>
    <FondExplore />
    <div
      style={{
        position: 'absolute',
        right: 16,
        top: 16,
        width: 210,
        height: 62,
        overflow: 'hidden',
        borderRadius: 10,
        background: '#3A0A11',
        border: '2px solid #E8192C',
        padding: 10,
      }}
    >
      <p className="font-mono" style={{ ...metaLine, fontSize: 9, color: '#FFFFFF', fontWeight: 700 }}>Carte hôte 210×62 · overflow hidden</p>
      <Dialog defaultOpen>
      
      <DialogContent style={{ ...panel, borderRadius: 8, width: 360, maxWidth: 360 }}>
        <DialogHeader>
          <p className="font-mono" style={kicker}>Table VIP</p>
          <DialogTitle className="font-display font-bold uppercase" style={bigTitle}>
            Confirmer ta table pour 6
          </DialogTitle>
          <DialogDescription className="font-sans" style={bodyText}>
            Sala Mirador · Madrid · samedi 14 août, 23:00
          </DialogDescription>
        </DialogHeader>
        <div style={block}>
          <Ligne label="Carré VIP · 6 personnes" value="420,00 €" />
          <Ligne label="Frais de service" value="30,00 €" />
          <Ligne label="Total" value="450,00 €" strong />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Retour</Button>
          </DialogClose>
          <Button>Payer 450 €</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  </div>
);

// DialogPortal utilisé à la main : tout ce qu'il enveloppe (la légende comme le
// panneau) est déplacé hors du flux et empilé au-dessus de la page voilée.
export const AvecPortailExplicite = () => (
  <div>
    <FondExplore />
    <Dialog defaultOpen>
      <DialogPortal>
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 20,
            transform: 'translateX(-50%)',
            zIndex: 50,
          }}
        >
          <p className="font-mono" style={{ ...metaLine, fontSize: 9.5, textAlign: 'center' }}>
            Rendu par DialogPortal
          </p>
        </div>
        <DialogContent style={{ ...panel, borderRadius: 8 }}>
          <DialogHeader>
            <p className="font-mono" style={kicker}>Billet confirmé</p>
            <DialogTitle className="font-display font-bold uppercase" style={bigTitle}>
              Ton billet pour Techno Basement
            </DialogTitle>
            <DialogDescription className="font-sans" style={bodyText}>
              Samedi 14 août · 23:00 · Sala Mirador, Madrid.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button style={{ width: '100%' }}>Voir mon billet</Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  </div>
);
