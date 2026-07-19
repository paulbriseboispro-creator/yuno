import { Slider } from 'yuno-design-system';

// Slider's root is `flex w-full`: dropped into a card with no sized parent it
// collapses to zero width and the card reads as blank. Every story below gives
// it an explicit width AND a defaultValue (the thumb count is derived from the
// value array — no value, no thumbs).

const mono: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

const value: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.04em',
  color: '#E5E5E5',
};

const head: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 14,
};

// Mirrors the price section of src/components/explore/FilterPage.tsx:305–343.
export const FiltrePrix = () => (
  <div style={{ width: 320 }}>
    <div style={head}>
      <p className="font-mono" style={{ ...mono, margin: 0 }}>
        Prix
      </p>
      <span className="font-mono" style={value}>
        15 € – 80 €
      </span>
    </div>
    <Slider defaultValue={[15, 80]} min={0} max={200} step={5} className="py-2" />
  </div>
);

// Mirrors the timing section of FilterPage.tsx:345–383 (22 h → 06 h window).
export const PlageHoraire = () => (
  <div style={{ width: 320 }}>
    <div style={head}>
      <p className="font-mono" style={{ ...mono, margin: 0 }}>
        Créneau
      </p>
      <span className="font-mono" style={value}>
        00:00 – 05:00
      </span>
    </div>
    <Slider defaultValue={[2, 7]} min={0} max={12} step={1} className="py-2" />
  </div>
);

export const BudgetTable = () => (
  <div style={{ width: 320 }}>
    <div style={head}>
      <p className="font-mono" style={{ ...mono, margin: 0 }}>
        Budget table VIP
      </p>
      <span className="font-mono" style={value}>
        jusqu'à 450 €
      </span>
    </div>
    <Slider defaultValue={[450]} min={150} max={1200} step={50} className="py-2" />
  </div>
);

export const Desactive = () => (
  <div style={{ width: 320 }}>
    <div style={head}>
      <p className="font-mono" style={{ ...mono, margin: 0 }}>
        Distance — position refusée
      </p>
      <span className="font-mono" style={{ ...value, color: '#5A5A5E' }}>
        — km
      </span>
    </div>
    <Slider defaultValue={[3]} min={1} max={25} step={1} disabled className="py-2" />
  </div>
);
