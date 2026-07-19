import { Button, Input, Label } from 'yuno-design-system';

// Verbatim from src/pages/TableCheckout.tsx:50 — the field skin every public
// checkout uses. Copied rather than approximated so the compiled Tailwind
// actually contains these utilities.
const fieldClass =
  'h-11 rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50';

// Metadata label = JetBrains Mono uppercase tracked (DESIGN_SYSTEM_PUBLIC §3.4).
const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

const field: React.CSSProperties = { display: 'grid', gap: 6 };

export const ReservationTable = () => (
  <div style={{ width: 360, display: 'grid', gap: 16 }}>
    <div style={field}>
      <Label htmlFor="p-name" className="font-mono" style={labelStyle}>
        Nom complet *
      </Label>
      <Input id="p-name" className={fieldClass} placeholder="Alba Serrano" />
    </div>
    <div style={field}>
      <Label htmlFor="p-mail" className="font-mono" style={labelStyle}>
        Email *
      </Label>
      <Input id="p-mail" type="email" className={fieldClass} placeholder="alba@correo.es" />
    </div>
    <div style={field}>
      <Label htmlFor="p-tel" className="font-mono" style={labelStyle}>
        Téléphone *
      </Label>
      <Input id="p-tel" type="tel" className={fieldClass} defaultValue="+34 612 44 08 91" />
    </div>
  </div>
);

export const CodePromo = () => (
  <div style={{ width: 360, display: 'grid', gap: 6 }}>
    <Label htmlFor="p-promo" className="font-mono" style={labelStyle}>
      Code promoteur
    </Label>
    <div style={{ display: 'flex', gap: 8 }}>
      <Input
        id="p-promo"
        className={fieldClass}
        defaultValue="ALBA-MADRID"
        style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
      />
      <Button variant="outline" style={{ height: 44, flexShrink: 0 }}>
        Appliquer
      </Button>
    </div>
    <p className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: '#E8192C' }}>
      −15 % SUR LES BILLETS
    </p>
  </div>
);

export const Recherche = () => (
  <div style={{ width: 360 }}>
    <Input
      type="search"
      className={fieldClass}
      placeholder="Clubs, events, DJ…"
      defaultValue="techno madrid"
    />
  </div>
);

export const Etats = () => (
  <div style={{ width: 360, display: 'grid', gap: 12 }}>
    <Input className={fieldClass} placeholder="Quantité de billets" />
    <Input className={fieldClass} type="number" defaultValue={2} min={1} max={10} />
    <Input className={fieldClass} defaultValue="Vente terminée" disabled />
  </div>
);
