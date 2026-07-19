import { Separator } from 'yuno-design-system';

const page: React.CSSProperties = {
  background: '#0A0A0A',
  padding: 20,
  width: 340,
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

// The default bg-border token is 0 0% 10% (#1A1A1A). On the public #0A0A0A page
// that is a hairline you can only just see, which is the intended editorial
// weight for a checkout recap.
export const RecapCheckout = () => (
  <div style={{ ...page, display: 'grid', gap: 12 }}>
    <p className="font-mono" style={{ ...mono, color: '#E8192C' }}>
      Récapitulatif
    </p>
    <div style={row}>
      <span style={{ fontSize: 14, color: '#E5E5E5' }}>2 × Entrée générale</span>
      <span className="font-mono" style={{ fontSize: 13, color: '#fff' }}>
        30,00 €
      </span>
    </div>
    <Separator />
    <div style={row}>
      <span style={{ fontSize: 14, color: '#E5E5E5' }}>1 × Gin tonic</span>
      <span className="font-mono" style={{ fontSize: 13, color: '#fff' }}>
        11,00 €
      </span>
    </div>
    <Separator />
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
  </div>
);

// Editorial weight: the public surfaces tint the rule to rgba(255,255,255,.08)
// so it survives on the deep-black page, same move VenuePage makes on Skeleton.
export const FiletEditorial = () => (
  <div style={{ ...page, display: 'grid', gap: 14 }}>
    <span className="font-display uppercase" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>
      Techno Basement
    </span>
    <Separator className="bg-white/10" />
    <p className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
      Sala Mirador · 14 août 2026 · 23:00
    </p>
    <Separator className="bg-white/10" />
    <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.55 }}>
      Quatre heures de hard groove dans la cave la plus étroite de Lavapiés.
    </p>
  </div>
);

// A red rule is the accent variant used to open a section on an event page.
export const FiletAccent = () => (
  <div style={{ ...page, display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Separator style={{ width: 28, background: '#E8192C' }} />
      <span className="font-mono" style={{ ...mono, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.18em' }}>
        Line-up
      </span>
    </div>
    <p style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.55 }}>
      Alba Bermúdez, Kike Ruiz et Nuria Vega se relaient jusqu'à 06:00.
    </p>
  </div>
);

// Vertical orientation needs a measured height from its parent: h-full against a
// zero-height row collapses to nothing.
export const MetaVerticale = () => (
  <div style={{ ...page }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 24 }}>
      <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
        Madrid
      </span>
      <Separator orientation="vertical" className="bg-white/10" />
      <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em' }}>
        23:00
      </span>
      <Separator orientation="vertical" className="bg-white/10" />
      <span className="font-mono" style={{ ...mono, letterSpacing: '0.06em', color: '#E8192C' }}>
        Dès 15 €
      </span>
    </div>
  </div>
);
