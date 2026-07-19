import { Checkbox, Input, Label, Textarea } from 'yuno-design-system';

const fieldClass =
  'h-11 rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50';

// Public labels are metadata: JetBrains Mono, uppercase, tracked, #5A5A5E
// (DESIGN_SYSTEM_PUBLIC §3.4 + src/pages/TableCheckout.tsx:781).
const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

export const ChampsCheckout = () => (
  <div style={{ width: 360, display: 'grid', gap: 16 }}>
    <div style={{ display: 'grid', gap: 6 }}>
      <Label htmlFor="l-name" className="font-mono" style={labelStyle}>
        Nom sur la réservation
      </Label>
      <Input id="l-name" className={fieldClass} defaultValue="Alba Serrano" />
    </div>
    <div style={{ display: 'grid', gap: 6 }}>
      <Label htmlFor="l-note" className="font-mono" style={labelStyle}>
        Demande spéciale
      </Label>
      <Textarea
        id="l-note"
        rows={2}
        className="rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50"
        placeholder="Optionnel"
      />
    </div>
  </div>
);

export const ChampRequis = () => (
  <div style={{ width: 360, display: 'grid', gap: 6 }}>
    <Label htmlFor="l-mail" className="font-mono" style={labelStyle}>
      Email <span style={{ color: '#E8192C' }}>*</span>
    </Label>
    <Input id="l-mail" type="email" className={fieldClass} placeholder="alba@correo.es" />
    <p className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: '#5A5A5E' }}>
      LES BILLETS PARTENT SUR CETTE ADRESSE
    </p>
  </div>
);

export const LabelCliquable = () => (
  <label
    htmlFor="l-cgv"
    style={{
      width: 360,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: 16,
      background: '#141414',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10,
      cursor: 'pointer',
    }}
  >
    <Checkbox id="l-cgv" defaultChecked style={{ marginTop: 2 }} />
    <Label htmlFor="l-cgv" style={{ color: '#E5E5E5', fontSize: 13, lineHeight: 1.45 }}>
      J'accepte les conditions de vente et la politique de remboursement du Club Sala Mirador.
    </Label>
  </label>
);

export const LabelDesactive = () => (
  <div style={{ width: 360, display: 'grid', gap: 6 }}>
    <Input id="l-off" className={fieldClass} defaultValue="Vente terminée" disabled />
    <Label htmlFor="l-off" className="font-mono" style={{ ...labelStyle, opacity: 0.7 }}>
      Round 1 — complet
    </Label>
  </div>
);
