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

// Panneau étroit : le choix de ville d'ExploreHeader est volontairement plus
// resserré que le max-w-lg par défaut de DialogContent.
export const Etroit = () => (
  <Dialog defaultOpen>
    <DialogContent className="sm:max-w-sm" style={{ ...panel, borderRadius: 8, width: 320, maxWidth: 320 }}>
      <DialogHeader>
        <DialogTitle className="font-display font-bold uppercase" style={{ ...bigTitle, fontSize: 15, letterSpacing: '0.06em' }}>
          Choisis ta ville
        </DialogTitle>
        <DialogDescription className="font-sans" style={bodyText}>
          On te montre les soirées autour de toi.
        </DialogDescription>
      </DialogHeader>
      <div style={{ display: 'grid', gap: 6 }}>
        {[
          { ville: 'Madrid', n: '128 soirées', on: true },
          { ville: 'Barcelone', n: '74 soirées', on: false },
          { ville: 'Ibiza', n: '41 soirées', on: false },
        ].map((c) => (
          <div
            key={c.ville}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: 4,
              background: c.on ? 'rgba(232,25,44,0.06)' : '#1B1B1E',
              border: '1px solid ' + (c.on ? 'rgba(232,25,44,0.28)' : 'rgba(255,255,255,0.08)'),
            }}
          >
            <span className="font-display font-bold uppercase" style={{ fontSize: 14, color: '#FFFFFF', letterSpacing: '-0.005em' }}>
              {c.ville}
            </span>
            <span className="font-mono" style={{ ...metaLine, fontSize: 10, color: c.on ? '#E8192C' : '#5A5A5E' }}>{c.n}</span>
          </div>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
