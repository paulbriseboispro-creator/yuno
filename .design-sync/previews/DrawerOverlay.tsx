import {
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
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

// Le voile de DrawerOverlay (noir 80 %) n'est lisible qu'avec une page derrière et
// un tiroir assez court pour la laisser voir : Explore est rendu au-dessous.
export const SurExplore = () => (
  <div>
    <FondExplore />
    <Drawer defaultOpen>
    <DrawerContent style={{ background: '#0E0E10', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <DrawerHeader>
        <p className="font-mono" style={kicker}>Récapitulatif</p>
        <DrawerTitle className="font-display font-bold uppercase" style={bigTitle}>
          Ta commande au bar
        </DrawerTitle>
        <DrawerDescription className="font-sans" style={bodyText}>
          Retrait au comptoir · Sala Mirador, Madrid
        </DrawerDescription>
      </DrawerHeader>
      <div style={{ padding: '0 16px' }}>
        <div style={block}>
          <Ligne label="2 × Gin tonic" value="18,00 €" />
          <Ligne label="1 × Corona" value="6,00 €" />
          <Ligne label="Frais de service" value="0,90 €" />
          <Ligne label="Total" value="24,90 €" strong />
        </div>
      </div>
      <DrawerFooter>
        <Button>Payer 24,90 €</Button>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
  </div>
);

export const SurFiltres = () => (
  <div>
    <FondExplore />
    <Drawer defaultOpen>
    <DrawerContent style={{ background: '#0E0E10', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <DrawerHeader>
        <p className="font-mono" style={kicker}>Filtres</p>
        <DrawerTitle className="font-display font-bold uppercase" style={bigTitle}>
          Ta soirée à Madrid
        </DrawerTitle>
        <DrawerDescription className="font-sans" style={bodyText}>
          128 soirées ce week-end.
        </DrawerDescription>
      </DrawerHeader>
      <div style={{ padding: '0 16px', display: 'grid', gap: 12 }}>
        <div>
          <p className="font-mono" style={{ ...metaLine, fontSize: 9.5, color: '#5A5A5E', letterSpacing: '0.14em' }}>Genre</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {['Techno', 'House', 'Reggaeton', 'Afro House', 'Open format'].map((g, i) => (
              <span
                key={g}
                className="font-mono font-bold uppercase"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  padding: '3px 10px',
                  borderRadius: 999,
                  color: i === 0 ? '#FFFFFF' : '#E5E5E5',
                  background: i === 0 ? '#E8192C' : 'rgba(255,255,255,0.06)',
                  border: '1px solid ' + (i === 0 ? '#E8192C' : 'rgba(255,255,255,0.10)'),
                }}
              >
                {g}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="font-mono" style={{ ...metaLine, fontSize: 9.5, color: '#5A5A5E', letterSpacing: '0.14em' }}>Budget entrée</p>
          <p className="font-display font-bold" style={{ fontSize: 22, color: '#FFFFFF', letterSpacing: '-0.03em', margin: '6px 0 0' }}>
            15 € — 40 €
          </p>
        </div>
      </div>
      <DrawerFooter>
        <Button>Voir les 46 soirées</Button>
        <DrawerClose asChild>
          <Button variant="ghost">Tout effacer</Button>
        </DrawerClose>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
  </div>
);
