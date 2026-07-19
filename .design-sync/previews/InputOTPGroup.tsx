import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from 'yuno-design-system';

// InputOTPGroup is a bare flex row: it only exists inside an InputOTP, whose
// context feeds every slot. Written as the complete parent composition — the
// only render that tells the truth about the group's job (welding slots into a
// single bordered block, first/last rounded).

const mono: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

const slotClass = 'h-12 w-12 border-white/[0.10] bg-[#1F1F22] text-white text-base';

export const GroupeUnique = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Un seul groupe — code SMS
    </p>
    <InputOTP maxLength={6} value="482913" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
        <InputOTPSlot index={3} className={slotClass} />
        <InputOTPSlot index={4} className={slotClass} />
        <InputOTPSlot index={5} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);

export const DeuxGroupes = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Deux groupes — code de retrait bar
    </p>
    <InputOTP maxLength={6} value="740265" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} className={slotClass} />
        <InputOTPSlot index={4} className={slotClass} />
        <InputOTPSlot index={5} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);

export const GroupeCourt = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      PIN vestiaire — 4 chiffres
    </p>
    <InputOTP maxLength={4} value="0619" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
        <InputOTPSlot index={3} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);
