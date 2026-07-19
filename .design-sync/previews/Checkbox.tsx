import { Checkbox, Label } from 'yuno-design-system';

// Checkbox is a bare 16x16 box: rendered alone in a card it reads as blank.
// Every story here composes it the way the public app actually does — inside a
// clickable row with mono metadata — so the card shows a real control.

const rowBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: 16,
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 10,
  cursor: 'pointer',
};

const mono: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
};

// Verbatim structure from src/pages/TicketCheckout.tsx:836–857 (insurance opt-in).
export const AssuranceBillet = () => (
  <label
    htmlFor="c-insurance"
    style={{
      ...rowBase,
      width: 380,
      backgroundColor: 'rgba(232,25,44,0.05)',
      borderColor: 'rgba(232,25,44,0.28)',
    }}
  >
    <Checkbox id="c-insurance" defaultChecked style={{ marginTop: 2 }} />
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Assurance annulation</span>
        <span
          className="font-mono"
          style={{ ...mono, color: '#E8192C', padding: '2px 6px', borderRadius: 999, background: 'rgba(232,25,44,0.10)' }}
        >
          +10 %
        </span>
      </div>
      <p style={{ fontSize: 11, color: '#9A9A9A', margin: 0 }}>
        Remboursement intégral jusqu'à 6 h avant l'ouverture des portes.
      </p>
    </div>
  </label>
);

export const ConsentementsCheckout = () => (
  <div style={{ width: 380, display: 'grid', gap: 12 }}>
    <label
      htmlFor="c-cgv"
      style={{ ...rowBase, backgroundColor: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <Checkbox id="c-cgv" defaultChecked style={{ marginTop: 2 }} />
      <Label htmlFor="c-cgv" style={{ color: '#E5E5E5', fontSize: 13, lineHeight: 1.45 }}>
        J'accepte les conditions de vente du Club Sala Mirador.
      </Label>
    </label>
    <label
      htmlFor="c-news"
      style={{ ...rowBase, backgroundColor: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <Checkbox id="c-news" style={{ marginTop: 2 }} />
      <Label htmlFor="c-news" style={{ color: '#E5E5E5', fontSize: 13, lineHeight: 1.45 }}>
        Prévenez-moi des prochaines soirées techno à Madrid.
      </Label>
    </label>
  </div>
);

export const FiltreGenres = () => (
  <div style={{ width: 260, display: 'grid', gap: 14 }}>
    <p className="font-mono" style={{ ...mono, color: '#5A5A5E', margin: 0 }}>
      Genres
    </p>
    {[
      ['Techno', 'g-techno', true],
      ['House', 'g-house', true],
      ['Reggaeton', 'g-regg', false],
      ['Afro House', 'g-afro', false],
    ].map(([label, id, on]) => (
      <div key={id as string} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Checkbox id={id as string} defaultChecked={on as boolean} />
        <Label htmlFor={id as string} style={{ color: '#E5E5E5', fontSize: 13 }}>
          {label as string}
        </Label>
      </div>
    ))}
  </div>
);

export const Etats = () => (
  <div style={{ width: 300, display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Checkbox id="c-on" defaultChecked />
      <Label htmlFor="c-on" style={{ color: '#E5E5E5', fontSize: 13 }}>
        Coché — table VIP 6 personnes
      </Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Checkbox id="c-off" />
      <Label htmlFor="c-off" style={{ color: '#E5E5E5', fontSize: 13 }}>
        Décoché — vestiaire prépayé
      </Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Checkbox id="c-dis" disabled defaultChecked />
      <Label htmlFor="c-dis" style={{ color: '#5A5A5E', fontSize: 13 }}>
        Verrouillé — guest list fermée
      </Label>
    </div>
  </div>
);
