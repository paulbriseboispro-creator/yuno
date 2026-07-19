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

// Radix ne monte le contenu que lorsque la racine est ouverte, dans un portail :
// sans `defaultOpen`, la carte ne montre rien du système. Le viewport et
// cardMode:"single" viennent de cfg.overrides.
export const TableVIP = () => (
  <Dialog defaultOpen>
    
    <DialogContent style={{ ...panel, borderRadius: 8 }}>
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
);

export const Billet = () => (
  <Dialog defaultOpen>
    <DialogContent style={{ ...panel, borderRadius: 8 }}>
      <DialogHeader>
        <p className="font-mono" style={kicker}>Billet confirmé</p>
        <DialogTitle className="font-display font-bold uppercase" style={bigTitle}>
          Ton billet pour Techno Basement
        </DialogTitle>
        <DialogDescription className="font-sans" style={bodyText}>
          Présente ce code à l'entrée. Une pièce d'identité peut être demandée.
        </DialogDescription>
      </DialogHeader>
      <div style={{ ...block, display: 'flex', alignItems: 'center', gap: 14 }}>
        <img src={qr} alt="" width={78} height={78} style={{ display: 'block', borderRadius: 2 }} />
        <div style={{ display: 'grid', gap: 5 }}>
          <p className="font-mono" style={metaLine}>Samedi 14 août · 23:00</p>
          <p className="font-mono" style={metaLine}>Sala Mirador · Madrid</p>
          <p className="font-display font-bold" style={{ fontSize: 15, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' }}>
            Entrée générale · 1 × 24,00 €
          </p>
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Fermer</Button>
        </DialogClose>
        <Button>Ajouter au wallet</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
