import { InputOTP, InputOTPGroup, InputOTPSlot } from 'yuno-design-system';

// A slot reads its char from OTPInputContext by index — rendered outside an
// InputOTP it throws. Written as the full parent composition, with the value
// varied so the card shows the two states a slot actually has: filled and empty.

const mono: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

const slotClass = 'h-12 w-12 border-white/[0.10] bg-[#1F1F22] text-white text-base';

const Six = ({ value }: { value: string }) => (
  <InputOTP maxLength={6} value={value} onChange={() => {}}>
    <InputOTPGroup>
      <InputOTPSlot index={0} className={slotClass} />
      <InputOTPSlot index={1} className={slotClass} />
      <InputOTPSlot index={2} className={slotClass} />
      <InputOTPSlot index={3} className={slotClass} />
      <InputOTPSlot index={4} className={slotClass} />
      <InputOTPSlot index={5} className={slotClass} />
    </InputOTPGroup>
  </InputOTP>
);

export const SlotsRemplis = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Code complet
    </p>
    <Six value="482913" />
  </div>
);

export const SlotsPartiels = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Trois chiffres saisis, trois vides
    </p>
    <Six value="482" />
  </div>
);

export const SlotsVides = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      En attente du SMS
    </p>
    <Six value="" />
  </div>
);

export const SlotsLarges = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Slots élargis — écran de retrait au bar
    </p>
    <InputOTP maxLength={4} value="7402" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className="h-16 w-14 border-white/[0.10] bg-[#1F1F22] text-white text-2xl" />
        <InputOTPSlot index={1} className="h-16 w-14 border-white/[0.10] bg-[#1F1F22] text-white text-2xl" />
        <InputOTPSlot index={2} className="h-16 w-14 border-white/[0.10] bg-[#1F1F22] text-white text-2xl" />
        <InputOTPSlot index={3} className="h-16 w-14 border-white/[0.10] bg-[#1F1F22] text-white text-2xl" />
      </InputOTPGroup>
    </InputOTP>
  </div>
);
