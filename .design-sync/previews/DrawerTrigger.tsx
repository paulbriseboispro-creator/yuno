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

export const AvecDeclencheur = () => (
  <Drawer defaultOpen>
    <DrawerTrigger asChild>
      <Button variant="default">Commander une bouteille</Button>
    </DrawerTrigger>
    <DrawerContent style={{ background: '#0E0E10', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <DrawerHeader>
        <p className="font-mono" style={kicker}>Bottle service</p>
        <DrawerTitle className="font-display font-bold uppercase" style={bigTitle}>
          Choisis ta bouteille
        </DrawerTitle>
        <DrawerDescription className="font-sans" style={bodyText}>
          Servie à ta table · Carré VIP 6 personnes · Sala Mirador
        </DrawerDescription>
      </DrawerHeader>
      <div style={{ display: 'grid', gap: 6, padding: '0 16px' }}>
        {[
          { nom: 'Belvedere 70 cl', note: 'Vodka · 4 softs inclus', prix: '180 €', on: true },
          { nom: 'Moët & Chandon Brut', note: 'Champagne · 75 cl', prix: '220 €', on: false },
          { nom: 'Don Julio 1942', note: 'Tequila · 70 cl', prix: '450 €', on: false },
        ].map((b) => (
          <div
            key={b.nom}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '9px 12px',
              borderRadius: 4,
              background: b.on ? 'rgba(232,25,44,0.06)' : '#141414',
              border: '1px solid ' + (b.on ? 'rgba(232,25,44,0.28)' : 'rgba(255,255,255,0.08)'),
            }}
          >
            <div>
              <p className="font-display font-bold uppercase" style={{ fontSize: 13, color: '#FFFFFF', margin: 0, letterSpacing: '-0.005em' }}>
                {b.nom}
              </p>
              <p className="font-mono" style={{ ...metaLine, fontSize: 9.5, marginTop: 3 }}>{b.note}</p>
            </div>
            <span className="font-mono font-bold" style={{ fontSize: 12, letterSpacing: '0.02em', color: b.on ? '#E8192C' : '#E5E5E5' }}>
              {b.prix}
            </span>
          </div>
        ))}
      </div>
      <DrawerFooter>
        <Button>Ajouter — 180 €</Button>
        <DrawerClose asChild>
          <Button variant="ghost">Plus tard</Button>
        </DrawerClose>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
);

// Les deux déclencheurs de la page, tiroirs fermés : l'état par défaut.
export const Ferme = () => (
  <div style={{ display: 'grid', gap: 10, padding: 20, justifyItems: 'start' }}>
    <p className="font-mono" style={kicker}>Sala Mirador · au bar</p>
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="default">Commander une bouteille</Button>
      </DrawerTrigger>
      <DrawerContent style={{ background: '#0E0E10' }}>
        <DrawerHeader>
          <DrawerTitle className="font-display font-bold uppercase" style={bigTitle}>Choisis ta bouteille</DrawerTitle>
          <DrawerDescription className="font-sans" style={bodyText}>Servie à ta table.</DrawerDescription>
        </DrawerHeader>
      </DrawerContent>
    </Drawer>
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Filtrer les soirées</Button>
      </DrawerTrigger>
      <DrawerContent style={{ background: '#0E0E10' }}>
        <DrawerHeader>
          <DrawerTitle className="font-display font-bold uppercase" style={bigTitle}>Ta soirée à Madrid</DrawerTitle>
          <DrawerDescription className="font-sans" style={bodyText}>128 soirées ce week-end.</DrawerDescription>
        </DrawerHeader>
      </DrawerContent>
    </Drawer>
  </div>
);
