import { Label, Textarea } from 'yuno-design-system';

// Verbatim from src/pages/TableCheckout.tsx:798 — the remarks field of the
// table-booking checkout.
const areaClass =
  'rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50';

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

export const DemandeSpeciale = () => (
  <div style={{ width: 380, display: 'grid', gap: 6 }}>
    <Label htmlFor="p-remarks" className="font-mono" style={labelStyle}>
      Demande spéciale
    </Label>
    <Textarea
      id="p-remarks"
      rows={3}
      className={areaClass}
      placeholder="Anniversaire, allergies, heure d'arrivée…"
    />
  </div>
);

export const MessageAuClub = () => (
  <div style={{ width: 380, display: 'grid', gap: 6 }}>
    <Label htmlFor="p-msg" className="font-mono" style={labelStyle}>
      Message au club
    </Label>
    <Textarea
      id="p-msg"
      rows={4}
      className={areaClass}
      defaultValue={
        "On fête l'anniversaire d'Alba (25 ans). Si possible une table proche du DJ booth, et le magnum à minuit avec cierges."
      }
    />
    <p className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: '#5A5A5E' }}>
      132 / 400 CARACTÈRES
    </p>
  </div>
);

export const Desactive = () => (
  <div style={{ width: 380, display: 'grid', gap: 6 }}>
    <Label htmlFor="p-locked" className="font-mono" style={labelStyle}>
      Demande spéciale — verrouillée
    </Label>
    <Textarea
      id="p-locked"
      rows={3}
      disabled
      className={areaClass}
      defaultValue="Réservation confirmée, modifications closes 24 h avant l'event."
    />
  </div>
);
